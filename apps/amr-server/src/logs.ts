/**
 * Kayıtlar (R11): geriye dönük tek pencere.
 *
 * Beş kaynak aynı biçimde okunur, hepsi filtrelenir ve sayfalanır:
 *   requests      istek günlüğü (VARA kanıtı): Kanzasset'in istekleri ve panelin değişiklikleri
 *   audit         denetim günlüğü: kim ne yaptı, öncesi ve sonrası
 *   events        olay teslimleri (webhook kuyruğu)
 *   notifications bildirimler
 *   ticks         fiyat tick'leri
 *
 * Tek uç (`GET /admin/logs`) döner: satırlar + toplam sayı. Sayfa geçişi `offset` ile,
 * böylece "eskiye doğru git" ekranda kolayca yapılır ve kayıt sayısı sınırsız büyüyebilir.
 */
import type { FastifyInstance } from "fastify";
import type { AppContext } from "./context.ts";

export type LogSource = "requests" | "audit" | "events" | "notifications" | "ticks";

export interface LogRow {
  ts: string;
  source: LogSource;
  /** Ekranda ilk sütun: kim ya da hangi kanal. */
  who: string;
  /** İkinci sütun: ne oldu (tek satır). */
  what: string;
  /** Üçüncü sütun: sonuç ya da durum etiketi. */
  state: string;
  /** İyi / uyarı / kötü: rozetin rengi. */
  level: "ok" | "warn" | "bad" | "neut";
  /** Ayrıntı satırı (açılır). */
  detail?: string;
}

export interface LogQuery { source?: string; q?: string; from?: string; to?: string; limit?: number; offset?: number }

const like = (q?: string) => (q ? `%${q}%` : null);

/** Kaynak başına sorgu: WHERE parçası, sayım ve satır dönüşümü tek yerde durur. */
export function queryLogs(ctx: AppContext, opt: LogQuery): { items: LogRow[]; total: number; source: LogSource } {
  const db = ctx.db;
  const limit = Math.min(500, Math.max(1, opt.limit ?? 50));
  const offset = Math.max(0, opt.offset ?? 0);
  const q = like(opt.q?.trim());
  const from = opt.from?.trim() || null;
  const to = opt.to?.trim() || null;
  const source = (["requests", "audit", "events", "notifications", "ticks"].includes(opt.source ?? "") ? opt.source : "requests") as LogSource;

  const range = (col: string) => {
    const parts: string[] = [];
    const args: unknown[] = [];
    if (from) { parts.push(`${col} >= ?`); args.push(from); }
    if (to) { parts.push(`${col} <= ?`); args.push(`${to}T23:59:59.999Z`); }
    return { parts, args };
  };

  if (source === "requests") {
    const r = range("ts");
    if (q) { r.parts.push("(path LIKE ? OR actor LIKE ? OR api_key LIKE ? OR method LIKE ?)"); r.args.push(q, q, q, q); }
    const where = r.parts.length ? `WHERE ${r.parts.join(" AND ")}` : "";
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM request_log ${where}`).get(...r.args as never[]) as { n: number }).n;
    const rows = db.prepare(`SELECT * FROM request_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...r.args as never[], limit, offset) as unknown as {
      ts: string; method: string; path: string; status: number; duration_ms: number; channel: string; actor: string | null; api_key: string | null; idempotency_key: string | null; body_sha256: string | null; error: string | null;
    }[];
    return {
      source, total,
      items: rows.map((x) => ({
        ts: x.ts, source,
        who: x.actor ?? x.api_key ?? (x.channel === "KANZASSET" ? "Kanzasset" : "panel"),
        what: `${x.method} ${x.path}`,
        state: String(x.status),
        level: x.status >= 500 ? "bad" : x.status >= 400 ? "warn" : "ok",
        detail: [`${x.duration_ms} ms`, x.idempotency_key ? `idempotency ${x.idempotency_key}` : "", x.body_sha256 ? `gövde sha256 ${x.body_sha256}` : ""].filter(Boolean).join(" · "),
      })),
    };
  }

  if (source === "audit") {
    const r = range("ts");
    if (q) { r.parts.push("(actor LIKE ? OR action LIKE ?)"); r.args.push(q, q); }
    const where = r.parts.length ? `WHERE ${r.parts.join(" AND ")}` : "";
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM audit_log ${where}`).get(...r.args as never[]) as { n: number }).n;
    const rows = db.prepare(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...r.args as never[], limit, offset) as unknown as
      { ts: string; actor: string; action: string; before: string | null; after: string | null }[];
    return {
      source, total,
      items: rows.map((x) => ({
        ts: x.ts, source, who: x.actor, what: x.action, state: "kayıt", level: "neut",
        detail: [x.before ? `öncesi: ${x.before.slice(0, 300)}` : "", x.after ? `sonrası: ${x.after.slice(0, 300)}` : ""].filter(Boolean).join(" · "),
      })),
    };
  }

  if (source === "events") {
    const r = range("created_ts");
    if (q) { r.parts.push("(type LIKE ? OR event_id LIKE ? OR status LIKE ?)"); r.args.push(q, q, q); }
    const where = r.parts.length ? `WHERE ${r.parts.join(" AND ")}` : "";
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM webhook_deliveries ${where}`).get(...r.args as never[]) as { n: number }).n;
    const rows = db.prepare(`SELECT * FROM webhook_deliveries ${where} ORDER BY created_ts DESC LIMIT ? OFFSET ?`).all(...r.args as never[], limit, offset) as unknown as
      { event_id: string; type: string; status: string; attempts: number; last_error: string | null; created_ts: string; sent_ts: string | null }[];
    return {
      source, total,
      items: rows.map((x) => ({
        ts: x.created_ts, source, who: "Kanzasset'e", what: x.type, state: x.status,
        level: x.status === "SENT" ? "ok" : x.status === "FAILED" ? "bad" : "warn",
        detail: [`olay ${x.event_id}`, `${x.attempts} deneme`, x.sent_ts ? `teslim ${x.sent_ts}` : "", x.last_error ?? ""].filter(Boolean).join(" · "),
      })),
    };
  }

  if (source === "notifications") {
    const r = range("created_ts");
    if (q) { r.parts.push("(type LIKE ? OR title LIKE ? OR body LIKE ?)"); r.args.push(q, q, q); }
    const where = r.parts.length ? `WHERE ${r.parts.join(" AND ")}` : "";
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM notifications ${where}`).get(...r.args as never[]) as { n: number }).n;
    const rows = db.prepare(`SELECT * FROM notifications ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...r.args as never[], limit, offset) as unknown as
      { type: string; title: string; body: string; created_ts: string; read_ts: string | null }[];
    return {
      source, total,
      items: rows.map((x) => ({
        ts: x.created_ts, source, who: x.type, what: x.title, state: x.read_ts ? "okundu" : "yeni",
        level: x.read_ts ? "neut" : "warn", detail: x.body,
      })),
    };
  }

  const r = range("ts");
  if (q) { r.parts.push("(prices LIKE ?)"); r.args.push(q); }
  const where = r.parts.length ? `WHERE ${r.parts.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM price_ticks ${where}`).get(...r.args as never[]) as { n: number }).n;
  const rows = db.prepare(`SELECT * FROM price_ticks ${where} ORDER BY seq DESC LIMIT ? OFFSET ?`).all(...r.args as never[], limit, offset) as unknown as
    { seq: number; ts: string; tradable: number; prices: string }[];
  return {
    source, total,
    items: rows.map((x) => {
      const p = JSON.parse(x.prices) as { ccy: string; bid: string; ask: string }[];
      return {
        ts: x.ts, source, who: `seq ${x.seq}`,
        what: p.map((y) => `${y.ccy} ${y.bid} / ${y.ask}`).join(" · "),
        state: x.tradable ? "yayında" : "durdu", level: x.tradable ? "ok" : "warn",
      };
    }),
  };
}

export async function logRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get<{ Querystring: LogQuery }>("/admin/logs", async (req) =>
    queryLogs(ctx, {
      source: req.query.source,
      q: req.query.q,
      from: req.query.from,
      to: req.query.to,
      limit: Number(req.query.limit ?? 50),
      offset: Number(req.query.offset ?? 0),
    }));
}
