/**
 * İstek günlüğü (VARA kanıtı).
 *
 * Kanzasset'ten gelen her `/v1` isteği ve panelden yapılan her değiştirici istek
 * kalıcı olarak yazılır: ne zaman, hangi anahtarla, hangi uca, ne sonuç, kaç ms.
 * Gövdenin kendisi saklanmaz; imzalanan gövdenin `sha256` özeti saklanır. Böylece
 * "bu istek bu gövdeyle geldi" sonradan kanıtlanır, kişisel veri taşınmaz.
 *
 * Saklama süresi parametredir (`log.retention_days`, varsayılan 90 gün);
 * süresi geçen satırlar dakikada bir taranarak silinir.
 *
 * Okuma ekranı: R9 Belgeler · uç `GET /admin/requests`.
 */
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "./db.ts";
import { getSetting, now } from "./db.ts";
import type { AppContext } from "./context.ts";

export interface RequestLogRow {
  id: number;
  ts: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  channel: "KANZASSET" | "PANEL";
  actor: string | null;
  api_key: string | null;
  idempotency_key: string | null;
  body_sha256: string | null;
  bytes: number;
  ip: string | null;
  error: string | null;
}

export function ensureRequestLogTable(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS request_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      channel TEXT NOT NULL,
      actor TEXT,
      api_key TEXT,
      idempotency_key TEXT,
      body_sha256 TEXT,
      bytes INTEGER NOT NULL DEFAULT 0,
      ip TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS request_log_ts ON request_log(ts);
    CREATE INDEX IF NOT EXISTS request_log_path ON request_log(path);
  `);
}

/** Yalnız kanıt değeri olan istekler yazılır: /v1'in tamamı, panelin değiştiricileri. */
export function shouldLog(method: string, url: string): "KANZASSET" | "PANEL" | null {
  const path = url.split("?")[0];
  if (path.startsWith("/v1")) return "KANZASSET";
  if (path.startsWith("/admin")) {
    if (path === "/admin/stream") return null; // canlı akış: açık kalır, istek değildir
    return method === "GET" ? null : "PANEL"; // ekran yenilemeleri gürültüdür, değişiklikler kanıttır
  }
  return null;
}

export function logRequest(db: Db, row: Omit<RequestLogRow, "id">) {
  db.prepare(`INSERT INTO request_log(ts, method, path, status, duration_ms, channel, actor, api_key, idempotency_key, body_sha256, bytes, ip, error)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(row.ts, row.method, row.path, row.status, row.duration_ms, row.channel, row.actor, row.api_key, row.idempotency_key, row.body_sha256, row.bytes, row.ip, row.error);
}

export interface RequestLogQuery { limit?: number; channel?: string; path?: string; onlyErrors?: boolean }

export function listRequests(db: Db, q: RequestLogQuery = {}): RequestLogRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (q.channel) { where.push("channel = ?"); args.push(q.channel); }
  if (q.path) { where.push("path LIKE ?"); args.push(`%${q.path}%`); }
  if (q.onlyErrors) where.push("status >= 400");
  const sql = `SELECT * FROM request_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`;
  return db.prepare(sql).all(...args, Math.min(1000, q.limit ?? 200)) as unknown as RequestLogRow[];
}

/** Ekranda üst şerit: kaç istek, kaç hata, ortalama süre. */
export function requestSummary(db: Db) {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const r = db.prepare(`SELECT COUNT(*) AS n, SUM(status >= 400) AS errors, AVG(duration_ms) AS avg_ms FROM request_log WHERE ts >= ?`).get(since) as
    { n: number; errors: number | null; avg_ms: number | null };
  const total = db.prepare("SELECT COUNT(*) AS n, MIN(ts) AS oldest FROM request_log").get() as { n: number; oldest: string | null };
  return {
    last_24h: r.n, errors_24h: r.errors ?? 0, avg_ms: r.avg_ms ? Math.round(r.avg_ms) : 0,
    total: total.n, oldest_ts: total.oldest,
    retention_days: Number(getSetting(db, "log.retention_days", "90")),
  };
}

export function pruneRequests(db: Db, keepDays: number) {
  if (!Number.isFinite(keepDays) || keepDays <= 0) return 0;
  const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString();
  const r = db.prepare("DELETE FROM request_log WHERE ts < ?").run(cutoff);
  return Number(r.changes ?? 0);
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Fastify kancası: istek başında saati tutar, cevapta satırı yazar.
 * Gövde özeti yalnız ham gövdeyi görebildiğimiz isteklerde alınır (HMAC doğrulaması için zaten saklanır).
 */
export function requestLogPlugin(app: FastifyInstance, ctx: AppContext) {
  app.addHook("onRequest", async (req: FastifyRequest) => {
    (req as { _startedAt?: bigint })._startedAt = process.hrtime.bigint();
  });
  app.addHook("onResponse", async (req: FastifyRequest, reply: FastifyReply) => {
    const channel = shouldLog(req.method, req.url);
    if (!channel) return;
    const started = (req as { _startedAt?: bigint })._startedAt;
    // /v1'de imzalanan ham gövde zaten tutuluyor (HMAC doğrulaması için): özet birebir odur.
    // Panelde ham gövde tutulmaz; çözümlenmiş gövdenin özeti alınır, kanıt değeri aynıdır.
    const raw = (req as { rawBody?: string }).rawBody ?? (req.body === undefined || req.body === null ? undefined : JSON.stringify(req.body));
    try {
      logRequest(ctx.db, {
        ts: now(),
        method: req.method,
        path: req.url.split("?")[0],
        status: reply.statusCode,
        duration_ms: started ? Math.round(Number(process.hrtime.bigint() - started) / 1e6) : 0,
        channel,
        actor: (req.headers["x-user"] as string) ?? null,
        api_key: (req.headers["x-api-key"] as string) ?? null,
        idempotency_key: (req.headers["idempotency-key"] as string) ?? null,
        body_sha256: raw ? sha(raw) : null,
        bytes: raw ? Buffer.byteLength(raw) : 0,
        ip: req.ip ?? null,
        error: reply.statusCode >= 400 ? String(reply.statusCode) : null,
      });
    } catch { /* günlük yazılamadıysa istek yine de tamamlanır */ }
  });
}

/** Saklama süresi taraması: dakikada bir, süresi geçen satırlar silinir. */
export class RequestLogPruner {
  private timer: NodeJS.Timeout | null = null;
  constructor(private ctx: AppContext) {}
  start(intervalMs = 60_000) {
    this.tick();
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref?.();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  tick() {
    const days = Number(getSetting(this.ctx.db, "log.retention_days", "90"));
    pruneRequests(this.ctx.db, days);
  }
}
