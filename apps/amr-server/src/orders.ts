/**
 * Emir motoru (Akışlar 03, 04, 07, 08, 09 · Sistem 05, 08).
 *
 *  POST /v1/orders  → RECEIVED → (FILLED | REJECTED | CANCELLED), FOK, tümü ya hiç.
 *  Kontrol sırası: tekrar (client_order_id) · miktar · yayın açık mı · quote_seq tazeliği · limit_px · cari hesap limiti (K3).
 *  Fill fiyatı: o anki rafineri fiyatı (alışta ask, satışta bid); limit_px KZ'nin slippage korumasıdır.
 *  Alışta Tahsis Belgesi üretilir. Her fill cari hesaba işlenir (T ± gram, P ∓ bedel) ve cevapta bakiye bilgisi döner.
 *  debug.order_delay_ms > 0 ise karar geciktirilir (cevapsız emir senaryosu): bu sürede iptal gelirse CANCELLED, kesin cevap.
 *  Sunucu yeniden başlarsa açık kalan RECEIVED emirler CANCELLED olur (KZ zaten zaman aşımına düşmüştür).
 */
import { randomUUID } from "node:crypto";
import { ORDER_RULES, type Account, type OrderRequest, type OrderResponse, type OrderStatus, type RejectReason } from "@amr/contract";
import type { AppContext } from "./context.ts";
import { getSetting, now } from "./db.ts";
import { account, createDocument, currentAccountBalance, limitUsage, limits, postMovements } from "./ledger.ts";
import { bus } from "./bus.ts";
import { enqueueEvent } from "./events.ts";

const toCents = (px: string) => Math.round(Number(px) * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);
/** bedel = fiyat (cent / g) × gram; gram = mg / 1000; yarım yukarı */
export const amountCents = (pxCents: number, qtyMg: number) => Math.round((pxCents * qtyMg) / 1000);

type Row = {
  order_id: string; client_order_id: string; side: "BUY" | "SELL"; qty_mg: number; ccy: "USD" | "EUR" | "AED"; quote_seq: number; limit_px: string;
  tif: string; time_limit_ms: number; request_hash: string; status: OrderStatus; reject_reason: string | null; fill_px: string | null; fill_amount_cents: number | null;
  trade_ts: string | null; doc_id: string | null; account_seq: number | null; account_json: string | null; received_ts: string; decided_ts: string | null; history: string;
};

export class OrderEngine {
  private pending = new Map<string, { timer: NodeJS.Timeout; resolve: (r: OrderResponse) => void; cancelRequested: boolean }>();
  private limitWarned = false;

  constructor(private ctx: AppContext) {
    // yeniden başlama: açık kalan emirler kesin cevapla kapanır
    const open = ctx.db.prepare("SELECT order_id FROM orders WHERE status IN ('RECEIVED','CANCEL_REQUESTED')").all() as { order_id: string }[];
    for (const o of open) this.finish(o.order_id, "CANCELLED", { note: "sunucu yeniden başladı; işlenmemiş emir iptal" });
  }

  get accountStatus(): Account["status"] {
    if (!this.ctx.publisher.snapshotState().tradable) return "HALTED";
    if (limitUsage(this.ctx.db).max_pct >= 1) return "HALTED";
    return "OK";
  }
  account(): Account { return account(this.ctx.db, this.accountStatus); }

  /** Kanzasset'ten emir. Cevap: FILLED / REJECTED / CANCELLED (gecikmeli karar sırasında iptal gelirse). */
  async place(req: OrderRequest): Promise<{ code: number; body: OrderResponse | { error: string; reject_reason: RejectReason } }> {
    const db = this.ctx.db;
    const requestHash = JSON.stringify([req.side, req.qty_mg, req.ccy, req.quote_seq, req.limit_px, req.tif, req.time_limit_ms]);
    const existing = db.prepare("SELECT * FROM orders WHERE client_order_id = ?").get(req.client_order_id) as Row | undefined;
    if (existing) {
      if (existing.request_hash === requestHash) {
        // aynı emir tekrar: aynı cevap; karar bekleniyorsa onu bekle
        const p = this.pending.get(existing.order_id);
        if (p) return { code: 200, body: await new Promise<OrderResponse>((resolve) => { const prev = p.resolve; p.resolve = (r) => { prev(r); resolve(r); }; }) };
        return { code: 200, body: this.toResponse(existing) };
      }
      return { code: 409, body: { error: "client_order_id başka bir emirde kullanıldı", reject_reason: "DUPLICATE_ORDER" } };
    }

    const order_id = `ord_${randomUUID().slice(0, 8)}`;
    const ts = now();
    db.prepare(`INSERT INTO orders(order_id, client_order_id, side, qty_mg, ccy, quote_seq, limit_px, tif, time_limit_ms, request_hash, status, received_ts, history)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?, ?)`)
      .run(order_id, req.client_order_id, req.side, req.qty_mg, req.ccy, req.quote_seq, req.limit_px, req.tif, req.time_limit_ms, requestHash, ts, JSON.stringify([{ status: "RECEIVED", ts }]));

    const delay = Number(getSetting(db, "debug.order_delay_ms", "0"));
    if (delay <= 0) return { code: 200, body: this.decide(order_id) };
    return {
      code: 200,
      body: await new Promise<OrderResponse>((resolve) => {
        const timer = setTimeout(() => { this.pending.delete(order_id); resolve(this.decide(order_id)); }, delay);
        this.pending.set(order_id, { timer, resolve, cancelRequested: false });
      }),
    };
  }

  /** Durum sorgusu: order_id ya da client_order_id ile. */
  status(id: string): OrderResponse | undefined {
    const row = this.find(id);
    return row ? this.toResponse(row) : undefined;
  }

  /** İptal talebi: kesin cevap. İşlenmemişse CANCELLED; işlenmişse mevcut sonuç (FILLED = geç fill, KZ pozisyon kararı). */
  cancel(id: string): OrderResponse | undefined {
    const row = this.find(id);
    if (!row) return undefined;
    if (row.status === "RECEIVED" || row.status === "CANCEL_REQUESTED") {
      const p = this.pending.get(row.order_id);
      if (p) { clearTimeout(p.timer); this.pending.delete(row.order_id); }
      const r = this.finish(row.order_id, "CANCELLED", { note: "KZ iptal talebi; emir işlenmemişti" });
      p?.resolve(r);
      this.ctx.notify("order.cancelled", "Emir iptal edildi (KZ talebi)", `${row.side} ${(row.qty_mg / 1000).toFixed(3)} g · ${row.client_order_id}`, row.order_id);
      return r;
    }
    return this.toResponse(row);
  }

  list(opts: { day?: string; side?: string; status?: string; limit?: number } = {}): OrderResponse[] {
    const where: string[] = []; const args: (string | number)[] = [];
    if (opts.day) { where.push("substr(received_ts,1,10) = ?"); args.push(opts.day); }
    if (opts.side) { where.push("side = ?"); args.push(opts.side); }
    if (opts.status) { where.push("status = ?"); args.push(opts.status); }
    const rows = this.ctx.db.prepare(`SELECT * FROM orders ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY received_ts DESC LIMIT ?`).all(...args, opts.limit ?? 200) as Row[];
    return rows.map((r) => this.toResponse(r));
  }

  todaySummary() {
    const day = now().slice(0, 10);
    const rows = this.ctx.db.prepare("SELECT side, status, COUNT(*) AS n, COALESCE(SUM(CASE WHEN status='FILLED' THEN qty_mg END),0) AS mg FROM orders WHERE substr(received_ts,1,10) = ? GROUP BY side, status").all(day) as { side: string; status: string; n: number; mg: number }[];
    const sum = (side: string) => ({ filled: rows.filter((r) => r.side === side && r.status === "FILLED").reduce((a, r) => a + r.n, 0), mg: rows.filter((r) => r.side === side).reduce((a, r) => a + r.mg, 0), rejected: rows.filter((r) => r.side === side && r.status === "REJECTED").reduce((a, r) => a + r.n, 0) });
    return { day, buy: sum("BUY"), sell: sum("SELL"), total: rows.reduce((a, r) => a + r.n, 0) };
  }

  // ---------- iç ----------
  private find(id: string): Row | undefined {
    return this.ctx.db.prepare("SELECT * FROM orders WHERE order_id = ? OR client_order_id = ?").get(id, id) as Row | undefined;
  }

  private decide(order_id: string): OrderResponse {
    const db = this.ctx.db;
    const row = this.find(order_id)!;
    if (row.status !== "RECEIVED" && row.status !== "CANCEL_REQUESTED") return this.toResponse(row);

    const reject = (reason: RejectReason, note: string) => {
      const r = this.finish(order_id, "REJECTED", { reject_reason: reason, note });
      if (reason === "CURRENT_ACCOUNT_LIMIT") this.ctx.notify("limit.exceeded", "Cari hesap limiti: emir reddedildi", `${row.side} ${(row.qty_mg / 1000).toFixed(3)} g · mahsuplaşma çağrılmalı`, order_id);
      return r;
    };

    if (row.qty_mg < ORDER_RULES.minQtyMg) return reject("INVALID_QTY", "miktar 0,001 g altında");
    const pub = this.ctx.publisher.snapshotState();
    if (!pub.tradable || !pub.lastPrices) return reject("TRADING_HALTED", pub.haltReason ?? "yayın durdu");

    // quote_seq: bilinen ve taze bir tick olmalı
    const maxAge = Number(getSetting(db, "order.quote_max_age_ms", String(ORDER_RULES.quoteMaxAgeMs)));
    const tick = db.prepare("SELECT ts FROM price_ticks WHERE seq = ?").get(row.quote_seq) as { ts: string } | undefined;
    if (!tick || row.quote_seq > pub.seq) return reject("STALE_QUOTE", `quote_seq ${row.quote_seq} bilinmiyor (güncel ${pub.seq})`);
    if (Date.now() - Date.parse(tick.ts) > maxAge) return reject("STALE_QUOTE", `quote_seq ${row.quote_seq} ${Math.round((Date.now() - Date.parse(tick.ts)) / 1000)} sn eski`);

    // fiyat: o anki rafineri fiyatı, limit_px ile karşılaştırılır
    const level = pub.lastPrices.find((p) => p.ccy === row.ccy);
    if (!level) return reject("INTERNAL_ERROR", `kur yok: ${row.ccy}`);
    const px = row.side === "BUY" ? level.ask : level.bid;
    const pxC = toCents(px); const limC = toCents(row.limit_px);
    if (row.side === "BUY" ? pxC > limC : pxC < limC) return reject("PRICE_OUTSIDE_LIMIT", `fiyat ${px}, limit ${row.limit_px}`);

    // K3: fill sonrası cari hesap limiti
    const amt = amountCents(pxC, row.qty_mg);
    const bal = currentAccountBalance(db);
    const lim = limits(db);
    const goldAfter = bal.gold_mg + (row.side === "BUY" ? row.qty_mg : -row.qty_mg);
    const moneyAfter = (bal.money.find((m) => m.ccy === row.ccy)?.cents ?? 0) + (row.side === "BUY" ? -amt : amt);
    if (Math.abs(goldAfter) > lim.gold_mg) return reject("CURRENT_ACCOUNT_LIMIT", `altın ${(Math.abs(goldAfter) / 1000).toFixed(3)} g > limit ${(lim.gold_mg / 1000).toFixed(0)} g`);
    if (Math.abs(moneyAfter) > lim.money[row.ccy]) return reject("CURRENT_ACCOUNT_LIMIT", `${row.ccy} ${fromCents(Math.abs(moneyAfter))} > limit ${fromCents(lim.money[row.ccy])}`);

    // FILL: cari hesap hareketi + (alışta) Tahsis Belgesi
    const trade_ts = now();
    let doc_id: string | null = null;
    if (row.side === "BUY") {
      const doc = createDocument(db, "ALLOCATION_CERTIFICATE", order_id, {
        title: "Tahsis Belgesi",
        order_id, client_order_id: row.client_order_id,
        qty_mg: row.qty_mg, qty_g: (row.qty_mg / 1000).toFixed(3), fineness: "999.9",
        px, ccy: row.ccy, amount_cents: amt,
        owner: "Kanzasset FZCO adına", terms: "Mülkiyet devri tamdır. Retention of title ve lien yoktur.",
        trade_ts,
      });
      doc_id = doc.meta.doc_id;
    }
    const seq = postMovements(db, {
      current: [{ type: row.side === "BUY" ? "FILL_BUY" : "FILL_SELL", gold_mg: row.side === "BUY" ? row.qty_mg : -row.qty_mg, ccy: row.ccy, amount_cents: row.side === "BUY" ? -amt : amt, ref: row.client_order_id, related_id: order_id }],
    });
    const acc = this.account();
    db.prepare("UPDATE orders SET fill_px = ?, fill_amount_cents = ?, trade_ts = ?, doc_id = ?, account_seq = ?, account_json = ? WHERE order_id = ?")
      .run(px, amt, trade_ts, doc_id, seq, JSON.stringify(acc), order_id);
    const r = this.finish(order_id, "FILLED", { note: `${px} ${row.ccy}` });
    this.watchLimit();
    return r;
  }

  /** Durumu kapatır, geçmişe yazar, olay ve canlı akış üretir. */
  private finish(order_id: string, status: OrderStatus, extra: { reject_reason?: RejectReason; note?: string }): OrderResponse {
    const db = this.ctx.db;
    const row = this.find(order_id)!;
    const ts = now();
    const history = [...JSON.parse(row.history), { status, ts, note: extra.note }];
    db.prepare("UPDATE orders SET status = ?, reject_reason = COALESCE(?, reject_reason), decided_ts = ?, history = ? WHERE order_id = ?")
      .run(status, extra.reject_reason ?? null, ts, JSON.stringify(history), order_id);
    const resp = this.toResponse(this.find(order_id)!);
    const type = status === "FILLED" ? "order.filled" : status === "REJECTED" ? "order.rejected" : "order.cancelled";
    enqueueEvent(this.ctx, type, resp, status === "FILLED" ? resp.account : undefined);
    bus.publish({ kind: "order", order: resp });
    if (status === "FILLED") bus.publish({ kind: "account", account: resp.account });
    return resp;
  }

  private watchLimit() {
    const u = limitUsage(this.ctx.db);
    const warnPct = Number(getSetting(this.ctx.db, "limit.warn_pct", "80")) / 100;
    if (u.max_pct >= warnPct && !this.limitWarned) {
      this.limitWarned = true;
      this.ctx.notify("limit.warning", "Cari hesap limiti yaklaştı", `kullanım %${Math.round(u.max_pct * 100)}; mahsuplaşma çağrılabilir`);
    } else if (u.max_pct < warnPct * 0.9) this.limitWarned = false;
  }

  private toResponse(r: Row): OrderResponse {
    const resp: OrderResponse = {
      order_id: r.order_id, client_order_id: r.client_order_id, status: r.status, side: r.side, qty_mg: r.qty_mg, ccy: r.ccy,
      quote_seq: r.quote_seq, limit_px: r.limit_px, received_ts: r.received_ts, decided_ts: r.decided_ts ?? undefined, history: JSON.parse(r.history),
    };
    if (r.reject_reason) resp.reject_reason = r.reject_reason as RejectReason;
    if (r.status === "FILLED" && r.fill_px) {
      resp.fill = { px: r.fill_px, qty_mg: r.qty_mg, amount_cents: r.fill_amount_cents ?? 0, ccy: r.ccy, trade_ts: r.trade_ts ?? r.decided_ts ?? r.received_ts };
      if (r.doc_id) resp.allocation_certificate = { doc_id: r.doc_id, url: `/v1/documents/${r.doc_id}` };
      if (r.account_json) resp.account = JSON.parse(r.account_json);
    }
    return resp;
  }
}
