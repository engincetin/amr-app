/**
 * Kasa talimatları (Akışlar 05 Kasa girişi, 06 Kasa çıkışı · Sistem 05, 08 · ekran R4).
 *
 *  POST /v1/vault/in   cari hesaptaki gramı kasa hesabına taşır: REQUESTED → ACCEPTED → PLACING → PLACED (en geç T+3)
 *  POST /v1/vault/out  kasa hesabındaki gramı cari hesaba taşır: REQUESTED → ACCEPTED (biter)
 *
 *  Kabul elle verilir ("Kabul et"); `vault.accept_mode = AUTO` ise talep gelir gelmez kabul edilir.
 *  Kabulde fiş üretilir (Kasa Giriş Fişi / Kasa Çıkış Fişi) ve KZ'ye olayla gider; fiş mint'in dayanağıdır (K4).
 *
 *  Kural kontrolleri (istekte ve yeniden kabulde):
 *    giriş: cari hesap altını ≥ qty_mg   değilse INSUFFICIENT_CURRENT_ACCOUNT
 *    çıkış: kasada ≥ qty_mg              değilse INSUFFICIENT_VAULT ("kasaya konuluyor" sayılmaz)
 *
 *  Defter etkisi:
 *    giriş kabul  T −q · kasaya konuluyor +q      giriş konuldu  kasaya konuluyor −q · kasada +q
 *    çıkış kabul  kasada −b · T +b
 *  Fiyat yoktur: gramlar emirlerde zaten alındı ya da satıldı.
 *
 *  `ref` (Kanzasset referansı) tekildir: aynı ref ile gelen istek aynı talebi döner, ikinci kez işlenmez (çift mint koruması).
 */
import { randomUUID } from "node:crypto";
import type { Account, VaultRequest, VaultRequestStatus, VaultStatement } from "@amr/contract";
import type { AppContext } from "./context.ts";
import { getSetting, now } from "./db.ts";
import { createDocument, currentAccountBalance, listVaultMovements, postMovements, signContent, vaultBalance } from "./ledger.ts";
import { bus } from "./bus.ts";
import { enqueueEvent } from "./events.ts";

export function ensureVaultTables(db: AppContext["db"]) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vault_requests (
      request_id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      qty_mg INTEGER NOT NULL,
      ref TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      doc_id TEXT,
      reject_reason TEXT,
      accepted_by TEXT,
      requested_ts TEXT NOT NULL,
      accepted_ts TEXT,
      placing_ts TEXT,
      placed_ts TEXT,
      due_ts TEXT,
      history TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS vault_requests_status ON vault_requests(status);
  `);
}

type Row = {
  request_id: string; type: "IN" | "OUT"; qty_mg: number; ref: string; status: VaultRequestStatus; doc_id: string | null;
  reject_reason: string | null; accepted_by: string | null; requested_ts: string; accepted_ts: string | null;
  placing_ts: string | null; placed_ts: string | null; due_ts: string | null; history: string;
};

const g = (mg: number) => (mg / 1000).toLocaleString("tr-TR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export class VaultDesk {
  constructor(private ctx: AppContext) {}

  // ---------- Kanzasset tarafı (05, 06) ----------

  /** Kasa talimatı talebi. Aynı `ref` ile tekrar gelen istek aynı talebi döner. */
  request(type: "IN" | "OUT", qty_mg: number, ref: string): { code: number; body: VaultRequest | { error: string; reject_reason: string } } {
    const db = this.ctx.db;
    const existing = db.prepare("SELECT * FROM vault_requests WHERE ref = ?").get(ref) as Row | undefined;
    if (existing) {
      if (existing.type === type && existing.qty_mg === qty_mg) return { code: 200, body: this.toResponse(existing) };
      return { code: 409, body: { error: `ref ${ref} başka bir talepte kullanıldı`, reject_reason: "DUPLICATE_ORDER" } };
    }
    if (!Number.isInteger(qty_mg) || qty_mg < 1) return { code: 400, body: { error: "miktar en az 0,001 g olmalı", reject_reason: "INVALID_QTY" } };

    const check = this.checkRule(type, qty_mg);
    if (check) return { code: 409, body: { error: check.text, reject_reason: check.reason } };

    const request_id = `vr_${randomUUID().slice(0, 8)}`;
    const ts = now();
    db.prepare("INSERT INTO vault_requests(request_id, type, qty_mg, ref, status, requested_ts, history) VALUES (?, ?, ?, ?, 'REQUESTED', ?, ?)")
      .run(request_id, type, qty_mg, ref, ts, JSON.stringify([{ status: "REQUESTED", ts }]));

    const label = type === "IN" ? "Kasa girişi" : "Kasa çıkışı";
    const targetMin = Number(getSetting(db, "vault.accept_target_minutes", "15"));
    this.ctx.notify(`vault.${type === "IN" ? "in" : "out"}_requested`, `Bekleyen kasa talebi: ${label.toLowerCase()}`, `${g(qty_mg)} g · ref ${ref} · hedef cevap ${targetMin} dk`, request_id);
    bus.publish({ kind: "vault", request: this.toResponse(this.find(request_id)!) });

    if (getSetting(db, "vault.accept_mode", "MANUAL") === "AUTO") return { code: 200, body: this.accept(request_id, "otomatik kabul") };
    return { code: 200, body: this.toResponse(this.find(request_id)!) };
  }

  get(id: string): VaultRequest | undefined {
    const r = this.find(id);
    return r ? this.toResponse(r) : undefined;
  }

  list(opts: { type?: string; status?: string; limit?: number } = {}): VaultRequest[] {
    const where: string[] = []; const args: (string | number)[] = [];
    if (opts.type) { where.push("type = ?"); args.push(opts.type); }
    if (opts.status) { where.push("status = ?"); args.push(opts.status); }
    const rows = this.ctx.db.prepare(`SELECT * FROM vault_requests ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY requested_ts DESC LIMIT ?`).all(...args, opts.limit ?? 200) as Row[];
    return rows.map((r) => this.toResponse(r));
  }

  /** R4 kuyruğu: karar bekleyen talepler (hedef cevap süresi sayacı ekranda). */
  pending(): VaultRequest[] { return this.list({ status: "REQUESTED" }); }
  /** Kasaya koyma kuyruğu: kabul edilmiş, henüz konulmamış girişler (T+3 sayacı). */
  placingQueue(): VaultRequest[] {
    const rows = this.ctx.db.prepare("SELECT * FROM vault_requests WHERE type = 'IN' AND status IN ('ACCEPTED','PLACING','OVERDUE') ORDER BY due_ts").all() as Row[];
    return rows.map((r) => this.toResponse(r));
  }

  // ---------- rafineri personeli (R4) ----------

  /** Kabul et: fiş üretilir, defter işlenir, KZ'ye olay gider. Kural kabulde yeniden kontrol edilir. */
  accept(id: string, actor: string): VaultRequest {
    const db = this.ctx.db;
    const row = this.require(id, "REQUESTED");
    const check = this.checkRule(row.type, row.qty_mg);
    if (check) return this.reject(id, check.text, actor);

    const ts = now();
    let doc_id: string;
    let seq: number;
    if (row.type === "IN") {
      const doc = createDocument(db, "VAULT_IN_SLIP", row.request_id, {
        title: "Kasa Giriş Fişi",
        request_id: row.request_id, kz_ref: row.ref,
        qty_mg: row.qty_mg, qty_g: g(row.qty_mg), fineness: "999.9",
        statement: "Gramlar kasa hesabında Kanzasset FZCO adına tutulmaktadır.",
        accepted_ts: ts, accepted_by: actor,
      });
      doc_id = doc.meta.doc_id;
      seq = postMovements(db, {
        current: [{ type: "VAULT_IN", gold_mg: -row.qty_mg, ref: row.ref, related_id: row.request_id }],
        vault: [{ type: "IN_ACCEPTED", placing_mg: row.qty_mg, related_id: row.request_id, doc_id }],
      });
    } else {
      const doc = createDocument(db, "VAULT_OUT_SLIP", row.request_id, {
        title: "Kasa Çıkış Fişi",
        request_id: row.request_id, kz_ref: row.ref,
        qty_mg: row.qty_mg, qty_g: g(row.qty_mg), fineness: "999.9",
        accepted_ts: ts, accepted_by: actor,
      });
      doc_id = doc.meta.doc_id;
      seq = postMovements(db, {
        current: [{ type: "VAULT_OUT", gold_mg: row.qty_mg, ref: row.ref, related_id: row.request_id }],
        vault: [{ type: "OUT_ACCEPTED", in_vault_mg: -row.qty_mg, related_id: row.request_id, doc_id }],
      });
    }

    const dueDays = Number(getSetting(db, "vault.placement_due_days", "3"));
    const due_ts = row.type === "IN" ? new Date(Date.parse(ts) + dueDays * 86_400_000).toISOString() : null;
    db.prepare("UPDATE vault_requests SET status = 'ACCEPTED', doc_id = ?, accepted_by = ?, accepted_ts = ?, due_ts = ?, history = ? WHERE request_id = ?")
      .run(doc_id, actor, ts, due_ts, this.push(row, "ACCEPTED", ts, `kabul: ${actor}`), row.request_id);

    this.ctx.audit(actor, `vault.${row.type === "IN" ? "in" : "out"}.accept`, { status: "REQUESTED" }, { request_id: row.request_id, qty_mg: row.qty_mg, doc_id, seq });
    const resp = this.emit(row.request_id, row.type === "IN" ? "vault.in_accepted" : "vault.out_accepted", true);
    // mahsuplaşmanın altın bacağı kasa talimatıyla kapanır (12)
    this.ctx.settlement?.onVaultAccepted(row.ref, row.qty_mg);
    return resp;
  }

  /** Reddet (gerekçeyle): gram cari hesapta / kasada kalır, KZ bildirim alır. */
  reject(id: string, reason: string, actor: string): VaultRequest {
    const row = this.require(id, "REQUESTED");
    const ts = now();
    this.ctx.db.prepare("UPDATE vault_requests SET status = 'REJECTED', reject_reason = ?, accepted_by = ?, history = ? WHERE request_id = ?")
      .run(reason, actor, this.push(row, "REJECTED", ts, reason), row.request_id);
    this.ctx.audit(actor, `vault.${row.type === "IN" ? "in" : "out"}.reject`, { status: "REQUESTED" }, { request_id: row.request_id, reason });
    return this.emit(row.request_id, row.type === "IN" ? "vault.in_rejected" : "vault.out_rejected", false);
  }

  /** Kasaya konuluyor: külçe kasaya taşınıyor. Defter değişmez (zaten "kasaya konuluyor" kaleminde). */
  placing(id: string, actor: string): VaultRequest {
    const row = this.require(id, "ACCEPTED", "OVERDUE");
    if (row.type !== "IN") throw new VaultError("yalnız kasa girişi kasaya konulur");
    const ts = now();
    const next = row.status === "OVERDUE" ? "OVERDUE" : "PLACING";
    this.ctx.db.prepare("UPDATE vault_requests SET status = ?, placing_ts = ?, history = ? WHERE request_id = ?")
      .run(next, ts, this.push(row, "PLACING", ts, `kasaya konuluyor: ${actor}`), row.request_id);
    this.ctx.audit(actor, "vault.in.placing", { status: row.status }, { request_id: row.request_id });
    return this.emit(row.request_id, "vault.in_placing", false);
  }

  /** Kasaya konuldu: kasaya konuluyor −q, kasada +q. Gecikmişse (OVERDUE) buradan kapanır. */
  placed(id: string, actor: string): VaultRequest {
    const row = this.require(id, "ACCEPTED", "PLACING", "OVERDUE");
    if (row.type !== "IN") throw new VaultError("yalnız kasa girişi kasaya konulur");
    const ts = now();
    postMovements(this.ctx.db, { vault: [{ type: "PLACED", placing_mg: -row.qty_mg, in_vault_mg: row.qty_mg, related_id: row.request_id, doc_id: row.doc_id ?? undefined }] });
    this.ctx.db.prepare("UPDATE vault_requests SET status = 'PLACED', placed_ts = ?, history = ? WHERE request_id = ?")
      .run(ts, this.push(row, "PLACED", ts, `kasaya konuldu: ${actor}${row.status === "OVERDUE" ? " (gecikmeli)" : ""}`), row.request_id);
    this.ctx.audit(actor, "vault.in.placed", { status: row.status }, { request_id: row.request_id, qty_mg: row.qty_mg });
    return this.emit(row.request_id, "vault.in_placed", true);
  }

  /**
   * T+3 taraması: vadesi geçmiş kasa girişleri OVERDUE olur, uyarı düşer, KZ'ye olay gider
   * (Kontroller: "kasaya konuldu" gecikti → uyarı, yeni mint bloke).
   */
  sweepOverdue(): VaultRequest[] {
    const ts = now();
    const rows = this.ctx.db.prepare("SELECT * FROM vault_requests WHERE type = 'IN' AND status IN ('ACCEPTED','PLACING') AND due_ts IS NOT NULL AND due_ts < ?").all(ts) as Row[];
    const out: VaultRequest[] = [];
    for (const row of rows) {
      this.ctx.db.prepare("UPDATE vault_requests SET status = 'OVERDUE', history = ? WHERE request_id = ?")
        .run(this.push(row, "OVERDUE", ts, `kasaya koyma vadesi (T+3) geçti`), row.request_id);
      this.ctx.notify("vault.in_overdue", "Kasaya koyma vadesi geçti (T+3)", `${g(row.qty_mg)} g · ref ${row.ref}; Kanzasset tarafında yeni mint bloke`, row.request_id);
      out.push(this.emit(row.request_id, "vault.in_overdue", false));
    }
    return out;
  }

  // ---------- günlük kasa ekstresi (rezerv kanıtı) ----------

  /** V ≥ A kontrolünün dayanağı: gün içi kasa hareketleri, açılış / kapanış alt kalemleri, fiş referansları, imza. */
  statement(date?: string): VaultStatement {
    const db = this.ctx.db;
    const day = date ?? now().slice(0, 10);
    const all = db.prepare("SELECT seq, type, in_vault_mg, placing_mg, shipping_mg, related_id, doc_id, ts FROM vault_movements ORDER BY id").all() as any[];
    const before = all.filter((m) => m.ts < `${day}T00:00:00.000Z`);
    const during = all.filter((m) => m.ts.slice(0, 10) === day);
    const sum = (rows: any[]) => rows.reduce((a, m) => ({ in_vault_mg: a.in_vault_mg + m.in_vault_mg, placing_mg: a.placing_mg + m.placing_mg, shipping_mg: a.shipping_mg + m.shipping_mg }), { in_vault_mg: 0, placing_mg: 0, shipping_mg: 0 });
    const opening = sum(before);
    const closing = sum([...before, ...during]);
    const slips = db.prepare("SELECT doc_id, type, related_id, created_ts FROM documents WHERE type IN ('VAULT_IN_SLIP','VAULT_OUT_SLIP') AND substr(created_ts,1,10) = ? ORDER BY created_ts").all(day) as any[];
    const base = {
      date: day,
      opening,
      closing,
      total_mg: closing.in_vault_mg + closing.placing_mg + closing.shipping_mg,
      movements: during.map((m) => ({ seq: m.seq, type: m.type, in_vault_mg: m.in_vault_mg, placing_mg: m.placing_mg, shipping_mg: m.shipping_mg, related_id: m.related_id ?? undefined, doc_id: m.doc_id ?? undefined, ts: m.ts })),
      slips: slips.map((s) => ({ doc_id: s.doc_id, type: s.type, related_id: s.related_id, created_ts: s.created_ts })),
    };
    const { hash, signature } = signContent(db, base);
    return { ...base, hash, signature };
  }

  /** Kasa hareketleri (R4 alt liste). */
  movements(limit = 200) { return listVaultMovements(this.ctx.db, limit); }

  // ---------- iç ----------

  /** Giriş: cari hesap altını yeterli mi · Çıkış: kasada yeterli mi ("kasaya konuluyor" sayılmaz). */
  private checkRule(type: "IN" | "OUT", qty_mg: number): { reason: string; text: string } | null {
    if (type === "IN") {
      const bal = currentAccountBalance(this.ctx.db).gold_mg;
      if (bal < qty_mg) return { reason: "INSUFFICIENT_CURRENT_ACCOUNT", text: `cari hesap altını ${g(bal)} g < talep ${g(qty_mg)} g` };
    } else {
      const v = vaultBalance(this.ctx.db).in_vault_mg;
      if (v < qty_mg) return { reason: "INSUFFICIENT_VAULT", text: `kasada ${g(v)} g < talep ${g(qty_mg)} g (kasaya konuluyor sayılmaz)` };
    }
    return null;
  }

  private find(id: string): Row | undefined {
    return this.ctx.db.prepare("SELECT * FROM vault_requests WHERE request_id = ? OR ref = ?").get(id, id) as Row | undefined;
  }
  private require(id: string, ...allowed: VaultRequestStatus[]): Row {
    const row = this.find(id);
    if (!row) throw new VaultError(`talep yok: ${id}`, 404);
    if (!allowed.includes(row.status)) throw new VaultError(`talep ${row.status} durumunda; beklenen ${allowed.join(" / ")}`);
    return row;
  }
  private push(row: Row, status: VaultRequestStatus, ts: string, note: string) {
    return JSON.stringify([...JSON.parse(row.history), { status, ts, note }]);
  }

  /** Durum değişikliğini KZ'ye olayla bildirir ve canlı akışa düşürür. */
  private emit(request_id: string, type: string, withAccount: boolean): VaultRequest {
    const resp = this.toResponse(this.find(request_id)!);
    const acc: Account | undefined = withAccount ? this.ctx.orders.account() : undefined;
    enqueueEvent(this.ctx, type, { ...resp }, acc);
    bus.publish({ kind: "vault", request: resp });
    if (acc) bus.publish({ kind: "account", account: acc });
    return resp;
  }

  private toResponse(r: Row): VaultRequest {
    const v: VaultRequest = {
      request_id: r.request_id, type: r.type, qty_mg: r.qty_mg, ref: r.ref, status: r.status,
      requested_ts: r.requested_ts, history: JSON.parse(r.history),
    };
    if (r.doc_id) v.doc_id = r.doc_id;
    if (r.reject_reason) v.reject_reason = r.reject_reason;
    if (r.accepted_ts) v.accepted_ts = r.accepted_ts;
    if (r.placing_ts) v.placing_ts = r.placing_ts;
    if (r.placed_ts) v.placed_ts = r.placed_ts;
    if (r.due_ts) v.due_ts = r.due_ts;
    return v;
  }
}

export class VaultError extends Error {
  constructor(msg: string, public code = 409) { super(msg); this.name = "VaultError"; }
}

/** Açılışta ve düzenli aralıkla T+3 taraması. */
export class VaultOverdueWatcher {
  private timer: NodeJS.Timeout | null = null;
  constructor(private desk: VaultDesk, private everyMs = 60_000) {}
  start() { this.desk.sweepOverdue(); this.timer = setInterval(() => this.desk.sweepOverdue(), this.everyMs); }
  stop() { if (this.timer) clearInterval(this.timer); }
}
