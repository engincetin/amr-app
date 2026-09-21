/**
 * Fiziksel teslimat (Akışlar 10) ve rafinasyon (Akışlar 11) · ekranlar R6, R7.
 *
 * İki akış aynı iskeleti paylaşır; rafinasyonda QUOTED sonrası IN_PRODUCTION adımı vardır:
 *   REQUESTED → QUOTED → APPROVED → (PREPARING | IN_PRODUCTION) → READY → SHIPPED → DELIVERED
 *   iptal: teslimatta sevkiyattan önce, rafinasyonda üretime girmeden; READY'den iptalde külçe kasaya döner.
 *
 * Defter etkisi (ikisinde de aynı):
 *   APPROVED   P[kur] −bedel (Kanzasset borçlu; teslimatta lojistik, rafinasyonda ürün bedeli + lojistik)
 *   READY      kasada −x · sevkiyatta +x   (Sevkiyat Fişi; V toplamı değişmez, külçe hâlâ bizim)
 *   DELIVERED  sevkiyatta −x               (Teslimat Kaydı; V −x, Kanzasset aynı anda burn eder)
 *   READY'den iptal: sevkiyatta −x · kasada +x
 *
 * Rafineri tarafında müşteri adı yoktur: yalnız "Kanzasset FZCO", adres referansı ve sigorta lehtarı referansı görünür.
 * Kanzasset marjı ve komisyonu müşteri tarafındadır, rafineriye gelmez.
 */
import { randomUUID } from "node:crypto";
import { QUOTE_RULES, type Account, type Catalog, type CatalogItem, type Delivery, type DeliveryStatus, type Refining, type RefiningStatus } from "@amr/contract";
import type { AppContext } from "./context.ts";
import { getMeta, getSetting, now, setMeta } from "./db.ts";
import { createDocument, postMovements, vaultBalance } from "./ledger.ts";
import { bus } from "./bus.ts";
import { enqueueEvent } from "./events.ts";

export function ensureFulfilmentTables(db: AppContext["db"]) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS deliveries (
      delivery_id TEXT PRIMARY KEY,
      qty_mg INTEGER NOT NULL,
      address_ref TEXT NOT NULL,
      insured_party_ref TEXT NOT NULL,
      ref TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      quote TEXT,
      carrier TEXT,
      tracking_no TEXT,
      shipping_doc_id TEXT,
      pod_doc_id TEXT,
      reject_reason TEXT,
      requested_ts TEXT NOT NULL,
      history TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS refining_requests (
      refining_id TEXT PRIMARY KEY,
      items TEXT NOT NULL,
      total_mg INTEGER NOT NULL,
      address_ref TEXT NOT NULL,
      insured_party_ref TEXT NOT NULL,
      ref TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      quote TEXT,
      carrier TEXT,
      tracking_no TEXT,
      shipping_doc_id TEXT,
      pod_doc_id TEXT,
      reject_reason TEXT,
      requested_ts TEXT NOT NULL,
      history TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS catalog_items (
      item_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      weight_mg INTEGER NOT NULL,
      fineness TEXT NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      ccy TEXT NOT NULL,
      lead_time_days INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);
}

const g = (mg: number) => (mg / 1000).toLocaleString("tr-TR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const money = (c: number) => (c / 100).toFixed(2);

export class FulfilmentError extends Error {
  constructor(msg: string, public code = 409, public reason?: string) { super(msg); this.name = "FulfilmentError"; }
}

/** Katalog: rafineri R7'de yönetir, Kanzasset GET /v1/catalog ile çeker (değişince catalog.updated). */
export class CatalogDesk {
  constructor(private ctx: AppContext) {}

  seed() {
    const n = this.ctx.db.prepare("SELECT COUNT(*) AS n FROM catalog_items").get() as { n: number };
    if (n.n > 0) return;
    const rows: [string, string, number, number, number][] = [
      ["1g", "1 g külçe", 1_000, 1_200, 1],
      ["2.5g", "2,5 g külçe", 2_500, 2_000, 1],
      ["5g", "5 g külçe", 5_000, 3_000, 1],
      ["10g", "10 g külçe", 10_000, 4_500, 2],
      ["20g", "20 g külçe", 20_000, 7_000, 2],
      ["50g", "50 g külçe", 50_000, 12_000, 3],
      ["100g", "100 g külçe", 100_000, 20_000, 3],
      ["250g", "250 g külçe", 250_000, 38_000, 5],
      ["500g", "500 g külçe", 500_000, 60_000, 5],
      ["1kg", "1 kg külçe", 1_000_000, 95_000, 7],
    ];
    const ins = this.ctx.db.prepare("INSERT INTO catalog_items(item_id, name, weight_mg, fineness, unit_price_cents, ccy, lead_time_days, active, sort_order) VALUES (?, ?, ?, '999.9', ?, 'USD', ?, 1, ?)");
    rows.forEach(([id, name, mg, price, days], i) => ins.run(id, name, mg, price, days, i));
    setMeta(this.ctx.db, "catalog_version", 1);
  }

  get(): Catalog {
    const items = this.ctx.db.prepare("SELECT item_id, name, weight_mg, fineness, unit_price_cents, ccy, lead_time_days, active FROM catalog_items ORDER BY sort_order, weight_mg").all() as any[];
    return {
      version: getMeta(this.ctx.db, "catalog_version", 1),
      items: items.map((i) => ({ ...i, active: i.active === 1 })) as CatalogItem[],
      updated_ts: getSetting(this.ctx.db, "catalog.updated_ts", now()),
    };
  }

  item(id: string): CatalogItem | undefined {
    const r = this.ctx.db.prepare("SELECT item_id, name, weight_mg, fineness, unit_price_cents, ccy, lead_time_days, active FROM catalog_items WHERE item_id = ?").get(id) as any;
    return r ? { ...r, active: r.active === 1 } : undefined;
  }

  /** Ürün ekle ya da düzenle; sürüm artar ve Kanzasset'e catalog.updated gider. */
  upsert(it: Partial<CatalogItem> & { item_id: string }, actor: string): Catalog {
    const db = this.ctx.db;
    const ex = this.item(it.item_id);
    if (ex) {
      db.prepare("UPDATE catalog_items SET name = ?, weight_mg = ?, fineness = ?, unit_price_cents = ?, ccy = ?, lead_time_days = ?, active = ? WHERE item_id = ?")
        .run(it.name ?? ex.name, it.weight_mg ?? ex.weight_mg, it.fineness ?? ex.fineness, it.unit_price_cents ?? ex.unit_price_cents, it.ccy ?? ex.ccy, it.lead_time_days ?? ex.lead_time_days, (it.active ?? ex.active) ? 1 : 0, it.item_id);
    } else {
      if (!it.name || !it.weight_mg) throw new FulfilmentError("yeni üründe ad ve gramaj zorunlu", 400);
      db.prepare("INSERT INTO catalog_items(item_id, name, weight_mg, fineness, unit_price_cents, ccy, lead_time_days, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 999)")
        .run(it.item_id, it.name, it.weight_mg, it.fineness ?? "999.9", it.unit_price_cents ?? 0, it.ccy ?? "USD", it.lead_time_days ?? 1, (it.active ?? true) ? 1 : 0);
    }
    return this.bump(actor, ex ? `ürün güncellendi: ${it.item_id}` : `ürün eklendi: ${it.item_id}`);
  }

  private bump(actor: string, note: string): Catalog {
    const v = getMeta(this.ctx.db, "catalog_version", 1) + 1;
    setMeta(this.ctx.db, "catalog_version", v);
    const cat = this.get();
    this.ctx.audit(actor, "catalog.update", undefined, { version: v, note });
    enqueueEvent(this.ctx, "catalog.updated", { version: v, items: cat.items, note });
    bus.publish({ kind: "catalog", version: v });
    return cat;
  }
}

/** Teslimat ve rafinasyonun ortak sevkiyat adımları; iki akış da aynı kasa hareketlerini üretir. */
abstract class ShipmentDesk<S extends string> {
  constructor(protected ctx: AppContext) {}
  protected abstract table: string;
  protected abstract idCol: string;
  protected abstract eventPrefix: "delivery" | "refining";
  protected abstract label: string;

  protected row(id: string): any {
    return this.ctx.db.prepare(`SELECT * FROM ${this.table} WHERE ${this.idCol} = ? OR ref = ?`).get(id, id);
  }
  protected require(id: string, ...allowed: S[]): any {
    const r = this.row(id);
    if (!r) throw new FulfilmentError(`${this.label} yok: ${id}`, 404);
    if (!allowed.includes(r.status)) throw new FulfilmentError(`${this.label} ${r.status} durumunda; beklenen ${allowed.join(" / ")}`);
    return r;
  }
  protected push(r: any, status: S, ts: string, note: string) {
    return JSON.stringify([...JSON.parse(r.history), { status, ts, note }]);
  }
  protected setStatus(id: string, status: S, note: string, extra: Record<string, unknown> = {}) {
    const r = this.row(id);
    const ts = now();
    const sets = ["status = ?", "history = ?"];
    const args: unknown[] = [status, this.push(r, status, ts, note)];
    for (const [k, v] of Object.entries(extra)) { sets.push(`${k} = ?`); args.push(v); }
    this.ctx.db.prepare(`UPDATE ${this.table} SET ${sets.join(", ")} WHERE ${this.idCol} = ?`).run(...args as any, r[this.idCol]);
  }

  /** Kasada yeterli gram var mı (teslimat ve rafinasyon talebinin ortak kuralı). */
  protected checkVault(qtyMg: number) {
    const v = vaultBalance(this.ctx.db).in_vault_mg;
    if (v < qtyMg) throw new FulfilmentError(`kasada ${g(v)} g < talep ${g(qtyMg)} g`, 409, "INSUFFICIENT_VAULT");
  }

  /** Hazır: Sevkiyat Fişi kesilir, külçe kasadan sevkiyat alanına geçer (V toplamı değişmez). */
  protected doReady(id: string, qtyMg: number, actor: string, extraContent: Record<string, unknown>) {
    const doc = createDocument(this.ctx.db, "SHIPPING_SLIP", id, {
      title: "Sevkiyat Fişi", request_id: id, qty_mg: qtyMg, qty_g: g(qtyMg), fineness: "999.9",
      owner: "Kanzasset FZCO adına", prepared_by: actor, ...extraContent,
    });
    postMovements(this.ctx.db, { vault: [{ type: "SHIP_READY", in_vault_mg: -qtyMg, shipping_mg: qtyMg, related_id: id, doc_id: doc.meta.doc_id }] });
    return doc.meta.doc_id;
  }

  /** Teslim edildi: Teslimat Kaydı, sevkiyatta −x (V −x). Kanzasset aynı anda burn eder. */
  protected doDelivered(id: string, qtyMg: number, carrier: string | null, trackingNo: string | null, actor: string) {
    const doc = createDocument(this.ctx.db, "DELIVERY_RECORD", id, {
      title: "Teslimat Kaydı", request_id: id, qty_mg: qtyMg, qty_g: g(qtyMg),
      carrier: carrier ?? "", tracking_no: trackingNo ?? "", delivered_by: actor, delivered_ts: now(),
    });
    postMovements(this.ctx.db, { vault: [{ type: "DELIVERED", shipping_mg: -qtyMg, related_id: id, doc_id: doc.meta.doc_id }] });
    return doc.meta.doc_id;
  }

  /** READY'den iptal: külçe kasaya döner. */
  protected doReturn(id: string, qtyMg: number) {
    postMovements(this.ctx.db, { vault: [{ type: "SHIP_RETURN", in_vault_mg: qtyMg, shipping_mg: -qtyMg, related_id: id }] });
  }

  /** Onaylanan bedel cari hesaba kalem olur (Kanzasset borçlu). */
  protected doFee(id: string, type: "FEE_DELIVERY" | "FEE_REFINING", ccy: any, cents: number, ref: string) {
    postMovements(this.ctx.db, { current: [{ type, gold_mg: 0, ccy, amount_cents: -cents, ref, related_id: id }] });
  }

  protected emit(id: string, event: string, withAccount: boolean, payload: unknown) {
    const acc: Account | undefined = withAccount ? this.ctx.orders.account() : undefined;
    enqueueEvent(this.ctx, event, payload, acc);
    bus.publish({ kind: this.eventPrefix, item: payload });
    if (acc) bus.publish({ kind: "account", account: acc });
  }
}

// ---------------- Fiziksel teslimat (10) ----------------

export class DeliveryDesk extends ShipmentDesk<DeliveryStatus> {
  protected table = "deliveries";
  protected idCol = "delivery_id";
  protected eventPrefix = "delivery" as const;
  protected label = "teslimat talebi";

  /** KZ talebi: gram, adres referansı, sigorta lehtarı referansı. Kasada yeterli gram yoksa red. */
  request(body: { qty_mg: number; address_ref: string; insured_party_ref: string; ref: string }): Delivery {
    const ex = this.row(body.ref);
    if (ex) {
      if (ex.qty_mg === body.qty_mg) return this.toResponse(ex);
      throw new FulfilmentError(`ref ${body.ref} başka bir talepte kullanıldı`, 409, "DUPLICATE_ORDER");
    }
    if (!Number.isInteger(body.qty_mg) || body.qty_mg < 1) throw new FulfilmentError("miktar en az 0,001 g olmalı", 400, "INVALID_QTY");
    this.checkVault(body.qty_mg);
    const id = `dlv_${randomUUID().slice(0, 8)}`;
    const ts = now();
    this.ctx.db.prepare("INSERT INTO deliveries(delivery_id, qty_mg, address_ref, insured_party_ref, ref, status, requested_ts, history) VALUES (?, ?, ?, ?, ?, 'REQUESTED', ?, ?)")
      .run(id, body.qty_mg, body.address_ref, body.insured_party_ref, body.ref, ts, JSON.stringify([{ status: "REQUESTED", ts }]));
    this.ctx.notify("delivery.requested", "Yeni fiziksel teslimat talebi", `${g(body.qty_mg)} g · ref ${body.ref} · lojistik fiyatı girilmeli`, id);
    const d = this.toResponse(this.row(id));
    bus.publish({ kind: "delivery", item: d });
    return d;
  }

  get(id: string): Delivery | undefined { const r = this.row(id); return r ? this.toResponse(r) : undefined; }
  list(limit = 200): Delivery[] {
    return (this.ctx.db.prepare("SELECT * FROM deliveries ORDER BY requested_ts DESC LIMIT ?").all(limit) as any[]).map((r) => this.toResponse(r));
  }
  open(): Delivery[] { return this.list(500).filter((d) => d.status !== "DELIVERED" && d.status !== "CANCELLED" && d.status !== "FAILED"); }

  /** R6: lojistik fiyatı gir (taşıyıcıdan alınan). Lojistik Teklifi belgesi üretilir, KZ onayı beklenir. */
  quote(id: string, q: { carrier: string; amount_cents: number; ccy: string; valid_hours?: number }, actor: string): Delivery {
    const r = this.require(id, "REQUESTED", "QUOTED");
    const hours = q.valid_hours ?? Number(getSetting(this.ctx.db, "quote.delivery_valid_hours", String(QUOTE_RULES.deliveryValidHours)));
    const quote = {
      quote_id: `lq_${randomUUID().slice(0, 6)}`, carrier: q.carrier, amount_cents: q.amount_cents, ccy: q.ccy,
      valid_until: new Date(Date.now() + hours * 3_600_000).toISOString(),
    };
    const doc = createDocument(this.ctx.db, "LOGISTICS_QUOTE", r.delivery_id, {
      title: "Lojistik Teklifi", request_id: r.delivery_id, kz_ref: r.ref, qty_mg: r.qty_mg, qty_g: g(r.qty_mg),
      carrier: q.carrier, amount_cents: q.amount_cents, amount: money(q.amount_cents), ccy: q.ccy,
      valid_until: quote.valid_until, quoted_by: actor,
    });
    (quote as any).doc_id = doc.meta.doc_id;
    this.setStatus(r.delivery_id, "QUOTED", `lojistik fiyatı: ${money(q.amount_cents)} ${q.ccy} · ${q.carrier}`, { quote: JSON.stringify(quote), carrier: q.carrier });
    this.ctx.audit(actor, "delivery.quote", undefined, { delivery_id: r.delivery_id, ...quote });
    const d = this.toResponse(this.row(r.delivery_id));
    this.emit(r.delivery_id, "delivery.quoted", false, d);
    return d;
  }

  /** KZ onayı: bedel cari hesaba kalem olur (komisyon yok, masraf müşteriden aynen alınmıştır). */
  approve(id: string, quoteId: string | undefined): Delivery {
    const r = this.require(id, "QUOTED");
    const quote = JSON.parse(r.quote);
    if (quoteId && quoteId !== quote.quote_id) throw new FulfilmentError("teklif numarası uyuşmuyor", 409, "QUOTE_EXPIRED");
    if (Date.parse(quote.valid_until) < Date.now()) throw new FulfilmentError("teklif süresi doldu", 409, "QUOTE_EXPIRED");
    this.doFee(r.delivery_id, "FEE_DELIVERY", quote.ccy, quote.amount_cents, r.ref);
    this.setStatus(r.delivery_id, "APPROVED", `KZ onayı · lojistik bedeli ${money(quote.amount_cents)} ${quote.ccy} cari hesaba`);
    this.ctx.notify("delivery.approved", "Teslimat onaylandı (Kanzasset)", `${g(r.qty_mg)} g · hazırlığa alınabilir`, r.delivery_id);
    const d = this.toResponse(this.row(r.delivery_id));
    this.emit(r.delivery_id, "delivery.approved", true, d);
    return d;
  }

  preparing(id: string, actor: string): Delivery {
    const r = this.require(id, "APPROVED");
    this.setStatus(r.delivery_id, "PREPARING", `hazırlığa alındı: ${actor}`);
    this.ctx.audit(actor, "delivery.preparing", undefined, { delivery_id: r.delivery_id });
    const d = this.toResponse(this.row(r.delivery_id));
    this.emit(r.delivery_id, "delivery.preparing", false, d);
    return d;
  }

  ready(id: string, actor: string): Delivery {
    const r = this.require(id, "PREPARING", "APPROVED");
    const docId = this.doReady(r.delivery_id, r.qty_mg, actor, { kz_ref: r.ref, address_ref: r.address_ref, insured_party_ref: r.insured_party_ref, kind: "Fiziksel teslimat" });
    this.setStatus(r.delivery_id, "READY", "hazır · Sevkiyat Fişi kesildi", { shipping_doc_id: docId });
    this.ctx.audit(actor, "delivery.ready", undefined, { delivery_id: r.delivery_id, doc_id: docId });
    const d = this.toResponse(this.row(r.delivery_id));
    this.emit(r.delivery_id, "delivery.ready", true, d);
    return d;
  }

  shipped(id: string, carrier: string, trackingNo: string, actor: string): Delivery {
    const r = this.require(id, "READY");
    if (!trackingNo?.trim()) throw new FulfilmentError("takip numarası zorunlu", 400);
    this.setStatus(r.delivery_id, "SHIPPED", `taşıyıcıya verildi: ${carrier} · takip ${trackingNo}`, { carrier, tracking_no: trackingNo });
    this.ctx.audit(actor, "delivery.shipped", undefined, { delivery_id: r.delivery_id, carrier, tracking_no: trackingNo });
    const d = this.toResponse(this.row(r.delivery_id));
    this.emit(r.delivery_id, "delivery.shipped", false, d);
    return d;
  }

  delivered(id: string, actor: string): Delivery {
    const r = this.require(id, "SHIPPED");
    const docId = this.doDelivered(r.delivery_id, r.qty_mg, r.carrier, r.tracking_no, actor);
    this.setStatus(r.delivery_id, "DELIVERED", "teslim edildi · Teslimat Kaydı", { pod_doc_id: docId });
    this.ctx.audit(actor, "delivery.delivered", undefined, { delivery_id: r.delivery_id, doc_id: docId });
    const d = this.toResponse(this.row(r.delivery_id));
    this.emit(r.delivery_id, "delivery.delivered", true, d);
    return d;
  }

  /** İptal sevkiyattan önce. READY'den iptalde külçe kasaya döner. */
  cancel(id: string, reason: string, actor: string): Delivery {
    const r = this.require(id, "REQUESTED", "QUOTED", "APPROVED", "PREPARING", "READY");
    const wasReady = r.status === "READY";
    if (wasReady) this.doReturn(r.delivery_id, r.qty_mg);
    this.setStatus(r.delivery_id, "CANCELLED", `iptal: ${reason}${wasReady ? " · külçe kasaya döndü" : ""}`, { reject_reason: reason });
    this.ctx.audit(actor, "delivery.cancel", undefined, { delivery_id: r.delivery_id, reason });
    const d = this.toResponse(this.row(r.delivery_id));
    this.emit(r.delivery_id, "delivery.cancelled", wasReady, d);
    return d;
  }

  failed(id: string, reason: string, actor: string): Delivery {
    const r = this.require(id, "SHIPPED");
    this.setStatus(r.delivery_id, "FAILED", `teslim edilemedi: ${reason} · iade istisnası`, { reject_reason: reason });
    this.ctx.audit(actor, "delivery.failed", undefined, { delivery_id: r.delivery_id, reason });
    this.ctx.notify("delivery.failed", "Teslimat başarısız", `${g(r.qty_mg)} g · ${reason}`, r.delivery_id);
    const d = this.toResponse(this.row(r.delivery_id));
    this.emit(r.delivery_id, "delivery.failed", false, d);
    return d;
  }

  private toResponse(r: any): Delivery {
    const d: Delivery = {
      delivery_id: r.delivery_id, qty_mg: r.qty_mg, address_ref: r.address_ref, insured_party_ref: r.insured_party_ref,
      ref: r.ref, status: r.status, requested_ts: r.requested_ts, history: JSON.parse(r.history),
    };
    if (r.quote) d.quote = JSON.parse(r.quote);
    if (r.carrier) d.carrier = r.carrier;
    if (r.tracking_no) d.tracking_no = r.tracking_no;
    if (r.shipping_doc_id) d.shipping_doc_id = r.shipping_doc_id;
    if (r.pod_doc_id) d.pod_doc_id = r.pod_doc_id;
    if (r.reject_reason) d.reject_reason = r.reject_reason;
    return d;
  }
}

// ---------------- Rafinasyon (11) ----------------

export class RefiningDesk extends ShipmentDesk<RefiningStatus> {
  protected table = "refining_requests";
  protected idCol = "refining_id";
  protected eventPrefix = "refining" as const;
  protected label = "rafinasyon talebi";

  constructor(ctx: AppContext, private catalog: CatalogDesk) { super(ctx); }

  /** KZ talebi: katalog kalemleri × adet. Kasada toplam saf gram yeterli olmalı. */
  request(body: { items: { item_id: string; qty: number }[]; address_ref: string; insured_party_ref: string; ref: string }): Refining {
    const ex = this.row(body.ref);
    if (ex) return this.toResponse(ex);
    if (!body.items?.length) throw new FulfilmentError("en az bir kalem gerekli", 400, "INVALID_QTY");
    const lines = body.items.map((it) => {
      const ci = this.catalog.item(it.item_id);
      if (!ci) throw new FulfilmentError(`katalogda yok: ${it.item_id}`, 400);
      if (!ci.active) throw new FulfilmentError(`ürün pasif: ${it.item_id}`, 409);
      if (!Number.isInteger(it.qty) || it.qty < 1) throw new FulfilmentError(`adet geçersiz: ${it.item_id}`, 400, "INVALID_QTY");
      return { item_id: ci.item_id, name: ci.name, qty: it.qty, weight_mg: ci.weight_mg };
    });
    const total = lines.reduce((a, l) => a + l.qty * l.weight_mg, 0);
    this.checkVault(total);
    const id = `rfn_${randomUUID().slice(0, 8)}`;
    const ts = now();
    this.ctx.db.prepare("INSERT INTO refining_requests(refining_id, items, total_mg, address_ref, insured_party_ref, ref, status, requested_ts, history) VALUES (?, ?, ?, ?, ?, ?, 'REQUESTED', ?, ?)")
      .run(id, JSON.stringify(lines), total, body.address_ref, body.insured_party_ref, body.ref, ts, JSON.stringify([{ status: "REQUESTED", ts }]));
    this.ctx.notify("refining.requested", "Yeni rafinasyon talebi", `${lines.map((l) => `${l.qty} × ${l.name}`).join(", ")} · toplam ${g(total)} g · teklif verilmeli`, id);
    const r = this.toResponse(this.row(id));
    bus.publish({ kind: "refining", item: r });
    return r;
  }

  get(id: string): Refining | undefined { const r = this.row(id); return r ? this.toResponse(r) : undefined; }
  list(limit = 200): Refining[] {
    return (this.ctx.db.prepare("SELECT * FROM refining_requests ORDER BY requested_ts DESC LIMIT ?").all(limit) as any[]).map((r) => this.toResponse(r));
  }
  open(): Refining[] { return this.list(500).filter((r) => r.status !== "DELIVERED" && r.status !== "CANCELLED" && r.status !== "FAILED"); }

  /** R7: teklif ver (ürün bedeli + lojistik + üretim süresi). */
  quote(id: string, q: { product_cents: number; logistics_cents: number; ccy: string; lead_time_days: number; carrier?: string; valid_hours?: number }, actor: string): Refining {
    const r = this.require(id, "REQUESTED", "QUOTED");
    const hours = q.valid_hours ?? Number(getSetting(this.ctx.db, "quote.refining_valid_hours", String(QUOTE_RULES.refiningValidHours)));
    const quote = {
      quote_id: `rq_${randomUUID().slice(0, 6)}`, product_cents: q.product_cents, logistics_cents: q.logistics_cents,
      ccy: q.ccy, lead_time_days: q.lead_time_days, carrier: q.carrier,
      valid_until: new Date(Date.now() + hours * 3_600_000).toISOString(),
    };
    const items = JSON.parse(r.items);
    const doc = createDocument(this.ctx.db, "REFINING_QUOTE", r.refining_id, {
      title: "Rafinasyon Teklifi", request_id: r.refining_id, kz_ref: r.ref,
      items: items.map((l: any) => `${l.qty} × ${l.name}`).join(", "), total_mg: r.total_mg, total_g: g(r.total_mg),
      product_cents: q.product_cents, product: money(q.product_cents), logistics_cents: q.logistics_cents, logistics: money(q.logistics_cents),
      total: money(q.product_cents + q.logistics_cents), ccy: q.ccy, lead_time_days: q.lead_time_days,
      valid_until: quote.valid_until, quoted_by: actor,
    });
    (quote as any).doc_id = doc.meta.doc_id;
    this.setStatus(r.refining_id, "QUOTED", `teklif: ürün ${money(q.product_cents)} + lojistik ${money(q.logistics_cents)} ${q.ccy} · ${q.lead_time_days} gün`, { quote: JSON.stringify(quote), carrier: q.carrier ?? null });
    this.ctx.audit(actor, "refining.quote", undefined, { refining_id: r.refining_id, ...quote });
    const out = this.toResponse(this.row(r.refining_id));
    this.emit(r.refining_id, "refining.quoted", false, out);
    return out;
  }

  approve(id: string, quoteId: string | undefined): Refining {
    const r = this.require(id, "QUOTED");
    const quote = JSON.parse(r.quote);
    if (quoteId && quoteId !== quote.quote_id) throw new FulfilmentError("teklif numarası uyuşmuyor", 409, "QUOTE_EXPIRED");
    if (Date.parse(quote.valid_until) < Date.now()) throw new FulfilmentError("teklif süresi doldu", 409, "QUOTE_EXPIRED");
    const total = quote.product_cents + quote.logistics_cents;
    this.doFee(r.refining_id, "FEE_REFINING", quote.ccy, total, r.ref);
    this.setStatus(r.refining_id, "APPROVED", `KZ onayı · ${money(total)} ${quote.ccy} cari hesaba`);
    this.ctx.notify("refining.approved", "Rafinasyon onaylandı (Kanzasset)", `${g(r.total_mg)} g · üretime alınabilir`, r.refining_id);
    const out = this.toResponse(this.row(r.refining_id));
    this.emit(r.refining_id, "refining.approved", true, out);
    return out;
  }

  inProduction(id: string, actor: string): Refining {
    const r = this.require(id, "APPROVED");
    this.setStatus(r.refining_id, "IN_PRODUCTION", `üretime alındı: ${actor}`);
    this.ctx.audit(actor, "refining.in_production", undefined, { refining_id: r.refining_id });
    const out = this.toResponse(this.row(r.refining_id));
    this.emit(r.refining_id, "refining.in_production", false, out);
    return out;
  }

  ready(id: string, actor: string): Refining {
    const r = this.require(id, "IN_PRODUCTION");
    const items = JSON.parse(r.items);
    const docId = this.doReady(r.refining_id, r.total_mg, actor, {
      kz_ref: r.ref, address_ref: r.address_ref, insured_party_ref: r.insured_party_ref, kind: "Rafinasyon",
      items: items.map((l: any) => `${l.qty} × ${l.name}`).join(", "),
    });
    this.setStatus(r.refining_id, "READY", "hazır · Sevkiyat Fişi kesildi", { shipping_doc_id: docId });
    this.ctx.audit(actor, "refining.ready", undefined, { refining_id: r.refining_id, doc_id: docId });
    const out = this.toResponse(this.row(r.refining_id));
    this.emit(r.refining_id, "refining.ready", true, out);
    return out;
  }

  shipped(id: string, carrier: string, trackingNo: string, actor: string): Refining {
    const r = this.require(id, "READY");
    if (!trackingNo?.trim()) throw new FulfilmentError("takip numarası zorunlu", 400);
    this.setStatus(r.refining_id, "SHIPPED", `taşıyıcıya verildi: ${carrier} · takip ${trackingNo}`, { carrier, tracking_no: trackingNo });
    this.ctx.audit(actor, "refining.shipped", undefined, { refining_id: r.refining_id, carrier, tracking_no: trackingNo });
    const out = this.toResponse(this.row(r.refining_id));
    this.emit(r.refining_id, "refining.shipped", false, out);
    return out;
  }

  delivered(id: string, actor: string): Refining {
    const r = this.require(id, "SHIPPED");
    const docId = this.doDelivered(r.refining_id, r.total_mg, r.carrier, r.tracking_no, actor);
    this.setStatus(r.refining_id, "DELIVERED", "teslim edildi · Teslimat Kaydı", { pod_doc_id: docId });
    this.ctx.audit(actor, "refining.delivered", undefined, { refining_id: r.refining_id, doc_id: docId });
    const out = this.toResponse(this.row(r.refining_id));
    this.emit(r.refining_id, "refining.delivered", true, out);
    return out;
  }

  /** İptal yalnız üretime girmeden (Akışlar 11 durum makinesi): REQUESTED, QUOTED, APPROVED. */
  cancel(id: string, reason: string, actor: string): Refining {
    const r = this.require(id, "REQUESTED", "QUOTED", "APPROVED");
    const wasReady = false;
    if (wasReady) this.doReturn(r.refining_id, r.total_mg);
    this.setStatus(r.refining_id, "CANCELLED", `iptal: ${reason}${wasReady ? " · ürün kasaya döndü" : ""}`, { reject_reason: reason });
    this.ctx.audit(actor, "refining.cancel", undefined, { refining_id: r.refining_id, reason });
    const out = this.toResponse(this.row(r.refining_id));
    this.emit(r.refining_id, "refining.cancelled", wasReady, out);
    return out;
  }

  failed(id: string, reason: string, actor: string): Refining {
    const r = this.require(id, "SHIPPED");
    this.setStatus(r.refining_id, "FAILED", `teslim edilemedi: ${reason} · iade istisnası`, { reject_reason: reason });
    this.ctx.notify("refining.failed", "Rafinasyon teslimatı başarısız", `${g(r.total_mg)} g · ${reason}`, r.refining_id);
    const out = this.toResponse(this.row(r.refining_id));
    this.emit(r.refining_id, "refining.failed", false, out);
    return out;
  }

  private toResponse(r: any): Refining {
    const out: Refining = {
      refining_id: r.refining_id, items: JSON.parse(r.items), total_mg: r.total_mg, address_ref: r.address_ref,
      insured_party_ref: r.insured_party_ref, ref: r.ref, status: r.status, requested_ts: r.requested_ts, history: JSON.parse(r.history),
    };
    if (r.quote) out.quote = JSON.parse(r.quote);
    if (r.carrier) out.carrier = r.carrier;
    if (r.tracking_no) out.tracking_no = r.tracking_no;
    if (r.shipping_doc_id) out.shipping_doc_id = r.shipping_doc_id;
    if (r.pod_doc_id) out.pod_doc_id = r.pod_doc_id;
    if (r.reject_reason) out.reject_reason = r.reject_reason;
    return out;
  }
}
