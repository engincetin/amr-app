/**
 * AMR defteri (SQLite, node:sqlite). Sprint 1 tabloları:
 *   settings        parametreler (merkez adresi, yayın durumu, kesim saati...)
 *   meta            sayaçlar (fiyat seq)
 *   price_ticks     yayınlanan tick'ler (30 gün saklanır)
 *   notifications   bildirim zili
 *   audit_log       her elle aksiyon: kim, ne zaman, ne, önce / sonra
 *   api_clients     Kanzasset istemcisi: anahtar + imza sırrı + olay adresi
 * Sonraki sprintler: orders, current_account_*, vault_*, deliveries, catalog_items, refining_requests, settlements, documents.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_ts TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS price_ticks (
      seq INTEGER PRIMARY KEY,
      ts TEXT NOT NULL,
      tradable INTEGER NOT NULL,
      prices TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS price_ticks_ts ON price_ticks(ts);
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      related_id TEXT,
      created_ts TEXT NOT NULL,
      read_ts TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      before TEXT,
      after TEXT
    );
    CREATE TABLE IF NOT EXISTS api_clients (
      api_key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      secret TEXT NOT NULL,
      event_url TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_ts TEXT NOT NULL
    );
  `);
  return db;
}

export const now = () => new Date().toISOString();

export function getSetting(db: Db, key: string, fallback: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}
export function setSetting(db: Db, key: string, value: string) {
  db.prepare("INSERT INTO settings(key, value, updated_ts) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ts = excluded.updated_ts")
    .run(key, value, now());
}
export function allSettings(db: Db): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function getMeta(db: Db, key: string, fallback = 0): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: number } | undefined;
  return row?.value ?? fallback;
}
export function setMeta(db: Db, key: string, value: number) {
  db.prepare("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function insertTick(db: Db, seq: number, ts: string, tradable: boolean, prices: unknown) {
  db.prepare("INSERT INTO price_ticks(seq, ts, tradable, prices) VALUES (?, ?, ?, ?)").run(seq, ts, tradable ? 1 : 0, JSON.stringify(prices));
}
export function recentTicks(db: Db, limit = 50) {
  const rows = db.prepare("SELECT seq, ts, tradable, prices FROM price_ticks ORDER BY seq DESC LIMIT ?").all(limit) as
    { seq: number; ts: string; tradable: number; prices: string }[];
  return rows.map((r) => ({ seq: r.seq, ts: r.ts, tradable: r.tradable === 1, prices: JSON.parse(r.prices) }));
}
export function pruneTicks(db: Db, keepDays = 30) {
  const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString();
  db.prepare("DELETE FROM price_ticks WHERE ts < ?").run(cutoff);
}

export function addNotification(db: Db, type: string, title: string, body = "", relatedId?: string) {
  const r = db.prepare("INSERT INTO notifications(type, title, body, related_id, created_ts) VALUES (?, ?, ?, ?, ?)")
    .run(type, title, body, relatedId ?? null, now());
  return Number(r.lastInsertRowid);
}
export function listNotifications(db: Db, limit = 50) {
  return db.prepare("SELECT * FROM notifications ORDER BY id DESC LIMIT ?").all(limit) as Array<{
    id: number; type: string; title: string; body: string; related_id: string | null; created_ts: string; read_ts: string | null;
  }>;
}
export function markNotificationRead(db: Db, id: number) {
  db.prepare("UPDATE notifications SET read_ts = ? WHERE id = ? AND read_ts IS NULL").run(now(), id);
}
export function unreadCount(db: Db): number {
  const r = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE read_ts IS NULL").get() as { n: number };
  return r.n;
}

export function audit(db: Db, actor: string, action: string, before?: unknown, after?: unknown) {
  db.prepare("INSERT INTO audit_log(ts, actor, action, before, after) VALUES (?, ?, ?, ?, ?)")
    .run(now(), actor, action, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after));
}
export function listAudit(db: Db, limit = 100) {
  return db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").all(limit);
}

/**
 * Kanzasset istemcisini kaydeder. Kayıt varsa dokunulmaz: anahtar ve olay adresi panelden yönetilir.
 * `forceEventUrl` yalnız olay adresi ortam değişkeniyle açıkça verildiğinde gelir (KZ_EVENT_URL);
 * o zaman kayıtlı adres güncellenir, yoksa Kanzasset başka bir portta çalışırken olaylar sessizce boşluğa gider.
 */
export function ensureApiClient(db: Db, apiKey: string, name: string, secret: string, eventUrl?: string, forceEventUrl = false) {
  db.prepare("INSERT INTO api_clients(api_key, name, secret, event_url, created_ts) VALUES (?, ?, ?, ?, ?) ON CONFLICT(api_key) DO NOTHING")
    .run(apiKey, name, secret, eventUrl ?? null, now());
  if (forceEventUrl && eventUrl) db.prepare("UPDATE api_clients SET event_url = ? WHERE api_key = ? AND event_url IS NOT ?").run(eventUrl, apiKey, eventUrl);
}
export function getApiClient(db: Db, apiKey: string) {
  return db.prepare("SELECT * FROM api_clients WHERE api_key = ? AND active = 1").get(apiKey) as
    { api_key: string; name: string; secret: string; event_url: string | null } | undefined;
}
