/**
 * AMR defteri: iki hesap, hareketlerden türetilen bakiyeler (Akışlar 02, Sistem 07).
 *
 *   current_account_movements  T (gram, işaretli) ve P (kur bazında para, işaretli) bu tablodan türer
 *   vault_movements            V alt kalemleri (kasada, kasaya konuluyor, sevkiyatta) bu tablodan türer
 *   documents                  Tahsis Belgesi, fişler, ekstreler: içerik + sha256 + HMAC imza
 *   meta.account_seq           her hareket demeti bir seq alır; bakiye bilgisinde döner
 *
 * İşaret kuralı: T artı = Kanzasset aldı, henüz kasaya konmadı · P eksi = Kanzasset borçlu, artı = rafineri borçlu.
 * Her şey tam sayı (mg, cent). Bakiyeler her okumada hareketlerden yeniden hesaplanır (yeniden hesaplama = kontrol).
 */
import { createHash, createHmac } from "node:crypto";
import { CCYS, type Account, type Ccy, type Document, type Movement } from "@amr/contract";
import { type Db, getMeta, getSetting, now, setMeta } from "./db.ts";

export function ensureLedgerTables(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS current_account_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      gold_mg INTEGER NOT NULL DEFAULT 0,
      ccy TEXT,
      amount_cents INTEGER,
      ref TEXT,
      related_id TEXT,
      ts TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cam_ts ON current_account_movements(ts);
    CREATE TABLE IF NOT EXISTS vault_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      in_vault_mg INTEGER NOT NULL DEFAULT 0,
      placing_mg INTEGER NOT NULL DEFAULT 0,
      shipping_mg INTEGER NOT NULL DEFAULT 0,
      related_id TEXT,
      doc_id TEXT,
      ts TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
      doc_id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      related_id TEXT NOT NULL,
      content TEXT NOT NULL,
      hash TEXT NOT NULL,
      signature TEXT NOT NULL,
      created_ts TEXT NOT NULL,
      sent_ts TEXT
    );
    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT PRIMARY KEY,
      client_order_id TEXT NOT NULL UNIQUE,
      side TEXT NOT NULL,
      qty_mg INTEGER NOT NULL,
      ccy TEXT NOT NULL,
      quote_seq INTEGER NOT NULL,
      limit_px TEXT NOT NULL,
      tif TEXT NOT NULL,
      time_limit_ms INTEGER NOT NULL,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      reject_reason TEXT,
      fill_px TEXT,
      fill_amount_cents INTEGER,
      trade_ts TEXT,
      doc_id TEXT,
      account_seq INTEGER,
      account_json TEXT,
      received_ts TEXT NOT NULL,
      decided_ts TEXT,
      history TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS orders_received ON orders(received_ts);
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      event_id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_ts TEXT NOT NULL,
      last_error TEXT,
      created_ts TEXT NOT NULL,
      sent_ts TEXT
    );
  `);
}

// ---------- seq ----------
export const accountSeq = (db: Db) => getMeta(db, "account_seq", 0);
export function nextAccountSeq(db: Db): number {
  const s = accountSeq(db) + 1;
  setMeta(db, "account_seq", s);
  return s;
}

// ---------- bakiye ----------
export function vaultBalance(db: Db) {
  const r = db.prepare("SELECT COALESCE(SUM(in_vault_mg),0) AS v, COALESCE(SUM(placing_mg),0) AS p, COALESCE(SUM(shipping_mg),0) AS s FROM vault_movements").get() as { v: number; p: number; s: number };
  return { in_vault_mg: r.v, placing_mg: r.p, shipping_mg: r.s };
}
export function currentAccountBalance(db: Db) {
  const g = db.prepare("SELECT COALESCE(SUM(gold_mg),0) AS g FROM current_account_movements").get() as { g: number };
  const rows = db.prepare("SELECT ccy, COALESCE(SUM(amount_cents),0) AS c FROM current_account_movements WHERE ccy IS NOT NULL GROUP BY ccy").all() as { ccy: Ccy; c: number }[];
  const money = CCYS.map((ccy) => ({ ccy, cents: rows.find((r) => r.ccy === ccy)?.c ?? 0 }));
  return { gold_mg: g.g, money };
}
export function account(db: Db, status: Account["status"] = "OK"): Account {
  return { seq: accountSeq(db), vault: vaultBalance(db), current_account: currentAccountBalance(db), status };
}

// ---------- hareketler ----------
export interface CurrentAccountEntry { type: Movement["type"]; gold_mg?: number; ccy?: Ccy; amount_cents?: number; ref?: string; related_id?: string }
export interface VaultEntry { type: string; in_vault_mg?: number; placing_mg?: number; shipping_mg?: number; related_id?: string; doc_id?: string }

/** Bir hareket demeti (ör. bir fill): tek seq, tek zaman. Hareket yoksa seq ilerlemez. */
export function postMovements(db: Db, entries: { current?: CurrentAccountEntry[]; vault?: VaultEntry[] }): number {
  const ts = now();
  const seq = nextAccountSeq(db);
  const ca = db.prepare("INSERT INTO current_account_movements(seq, type, gold_mg, ccy, amount_cents, ref, related_id, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const e of entries.current ?? []) ca.run(seq, e.type, e.gold_mg ?? 0, e.ccy ?? null, e.amount_cents ?? null, e.ref ?? null, e.related_id ?? null, ts);
  const vm = db.prepare("INSERT INTO vault_movements(seq, type, in_vault_mg, placing_mg, shipping_mg, related_id, doc_id, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const e of entries.vault ?? []) vm.run(seq, e.type, e.in_vault_mg ?? 0, e.placing_mg ?? 0, e.shipping_mg ?? 0, e.related_id ?? null, e.doc_id ?? null, ts);
  return seq;
}

export function listCurrentAccountMovements(db: Db, opts: { from?: string; to?: string; limit?: number } = {}): Movement[] {
  const rows = db.prepare(
    "SELECT id, seq, type, gold_mg, ccy, amount_cents, ref, related_id, ts FROM current_account_movements WHERE ts >= ? AND ts <= ? ORDER BY id DESC LIMIT ?",
  ).all(opts.from ?? "0000", opts.to ?? "9999", opts.limit ?? 200) as any[];
  return rows.map((r) => ({ id: r.id, seq: r.seq, type: r.type, gold_mg: r.gold_mg, ccy: r.ccy ?? undefined, amount_cents: r.amount_cents ?? undefined, ref: r.ref ?? undefined, related_id: r.related_id ?? undefined, ts: r.ts }));
}
export function listVaultMovements(db: Db, limit = 200) {
  return db.prepare("SELECT * FROM vault_movements ORDER BY id DESC LIMIT ?").all(limit) as any[];
}

/** Açılış devri: defter boşken bir kez. Kasada zaten Kanzasset adına duran gram (demo: 20 kg). */
export function openingBalance(db: Db, vaultMg: number) {
  if (vaultMg <= 0) return;
  const n = db.prepare("SELECT COUNT(*) AS n FROM vault_movements").get() as { n: number };
  if (n.n > 0) return;
  postMovements(db, { vault: [{ type: "OPENING", in_vault_mg: vaultMg, related_id: "opening" }], current: [{ type: "OPENING", gold_mg: 0, ref: "açılış devri" }] });
}

// ---------- cari hesap limiti (K3) ----------
export function limits(db: Db) {
  return {
    gold_mg: Number(getSetting(db, "limit.current_account_gold_mg", "15000000")),
    money: {
      USD: Number(getSetting(db, "limit.current_account_usd_cents", "250000000")),
      EUR: Number(getSetting(db, "limit.current_account_eur_cents", "230000000")),
      AED: Number(getSetting(db, "limit.current_account_aed_cents", "920000000")),
    } as Record<Ccy, number>,
  };
}
export function limitUsage(db: Db) {
  const lim = limits(db);
  const bal = currentAccountBalance(db);
  const gold = { used_mg: Math.abs(bal.gold_mg), limit_mg: lim.gold_mg, pct: lim.gold_mg ? Math.abs(bal.gold_mg) / lim.gold_mg : 0 };
  const money = bal.money.map((m) => ({ ccy: m.ccy, used_cents: Math.abs(m.cents), limit_cents: lim.money[m.ccy], pct: lim.money[m.ccy] ? Math.abs(m.cents) / lim.money[m.ccy] : 0 }));
  return { gold, money, max_pct: Math.max(gold.pct, ...money.map((m) => m.pct)) };
}

// ---------- belgeler ----------
export function docSignKey(db: Db) { return getSetting(db, "doc.sign_key", "amr-doc-dev-key"); }
export function canonical(obj: unknown): string { return JSON.stringify(sortKeys(obj)); }
function sortKeys(v: any): any {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
export function signContent(db: Db, content: unknown) {
  const hash = createHash("sha256").update(canonical(content)).digest("hex");
  const signature = createHmac("sha256", docSignKey(db)).update(hash).digest("hex");
  return { hash, signature };
}
let docCounter = 0;
export function createDocument(db: Db, type: Document["meta"]["type"], relatedId: string, content: Record<string, unknown>): Document {
  const ts = now();
  const prefix: Record<string, string> = { ALLOCATION_CERTIFICATE: "TB", VAULT_IN_SLIP: "KGF", VAULT_OUT_SLIP: "KCF", LOGISTICS_QUOTE: "LT", REFINING_QUOTE: "RT", SHIPPING_SLIP: "SF", DELIVERY_RECORD: "TK", VAULT_STATEMENT: "KE", CURRENT_ACCOUNT_STATEMENT: "CE", SETTLEMENT_STATEMENT: "ME" };
  const doc_id = `${prefix[type] ?? "DOC"}-${ts.slice(0, 10).replace(/-/g, "")}-${String(++docCounter).padStart(4, "0")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const full = { doc_id, type, ...content, issued_by: "Ahlatcı Metal Refinery", issued_ts: ts };
  const { hash, signature } = signContent(db, full);
  db.prepare("INSERT INTO documents(doc_id, type, related_id, content, hash, signature, created_ts) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(doc_id, type, relatedId, JSON.stringify(full), hash, signature, ts);
  return { meta: { doc_id, type, related_id: relatedId, hash, signature, created_ts: ts }, content: full };
}
export function getDocument(db: Db, docId: string): Document | undefined {
  const r = db.prepare("SELECT * FROM documents WHERE doc_id = ?").get(docId) as any;
  if (!r) return undefined;
  return { meta: { doc_id: r.doc_id, type: r.type, related_id: r.related_id, hash: r.hash, signature: r.signature, created_ts: r.created_ts, sent_ts: r.sent_ts ?? undefined }, content: JSON.parse(r.content) };
}
export function markDocumentSent(db: Db, docId: string) {
  db.prepare("UPDATE documents SET sent_ts = COALESCE(sent_ts, ?) WHERE doc_id = ?").run(now(), docId);
}
export function listDocuments(db: Db, limit = 100) {
  return (db.prepare("SELECT doc_id, type, related_id, hash, created_ts, sent_ts FROM documents ORDER BY created_ts DESC LIMIT ?").all(limit) as any[]);
}
