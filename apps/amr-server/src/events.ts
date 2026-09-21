/**
 * Olaylar (webhook, AMR → KZ · Sistem 06).
 *  Her durum değişikliği KZ'nin olay adresine POST edilir: zarf {event_id, type, ts, seq, data, account}.
 *  İmza başlıkları REST ile aynı (istemcinin sırrı ile): X-API-Key, X-Timestamp, X-Signature, Idempotency-Key = event_id.
 *  2xx değilse üstel bekleme ile yeniden dener (events.retry_schedule_ms; varsayılan demo için kısa), 24 saatte vazgeçer.
 *  Teslim durumu webhook_deliveries tablosunda; R9'da görünür.
 */
import { randomUUID } from "node:crypto";
import { signingString, type Account, type EventEnvelope } from "@amr/contract";
import type { AppContext } from "./context.ts";
import { getSetting, now } from "./db.ts";
import { hmacHex } from "./auth.ts";
import { accountSeq } from "./ledger.ts";
import { bus } from "./bus.ts";

export function enqueueEvent(ctx: AppContext, type: string, data: unknown, account?: Account) {
  const ev: EventEnvelope = { event_id: `evt_${randomUUID()}`, type, ts: now(), seq: account ? account.seq : accountSeq(ctx.db), data, account };
  ctx.db.prepare("INSERT INTO webhook_deliveries(event_id, type, payload, status, attempts, next_ts, created_ts) VALUES (?, ?, ?, 'PENDING', 0, ?, ?)")
    .run(ev.event_id, type, JSON.stringify(ev), ev.ts, ev.ts);
  bus.publish({ kind: "event", event: { event_id: ev.event_id, type, ts: ev.ts, status: "PENDING" } });
  return ev.event_id;
}

export function listDeliveries(ctx: AppContext, limit = 100) {
  return ctx.db.prepare("SELECT event_id, type, status, attempts, next_ts, last_error, created_ts, sent_ts FROM webhook_deliveries ORDER BY created_ts DESC LIMIT ?").all(limit);
}

export class EventDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  constructor(private ctx: AppContext, private everyMs = 1000) {}
  start() { this.timer = setInterval(() => void this.tick(), this.everyMs); }
  stop() { if (this.timer) clearInterval(this.timer); }

  targets() {
    return this.ctx.db.prepare("SELECT api_key, secret, event_url FROM api_clients WHERE active = 1 AND event_url IS NOT NULL").all() as { api_key: string; secret: string; event_url: string }[];
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const targets = this.targets();
      if (targets.length === 0) return;
      const due = this.ctx.db.prepare("SELECT event_id, payload, attempts, created_ts FROM webhook_deliveries WHERE status = 'PENDING' AND next_ts <= ? ORDER BY created_ts LIMIT 20").all(now()) as { event_id: string; payload: string; attempts: number; created_ts: string }[];
      for (const d of due) await this.deliver(d, targets[0]);
    } finally { this.busy = false; }
  }

  private async deliver(d: { event_id: string; payload: string; attempts: number; created_ts: string }, t: { api_key: string; secret: string; event_url: string }) {
    const ts = now();
    const url = new URL(t.event_url);
    const headers = {
      "content-type": "application/json",
      "x-api-key": t.api_key,
      "x-timestamp": ts,
      "x-signature": hmacHex(t.secret, signingString(ts, "POST", url.pathname, d.payload)),
      "idempotency-key": d.event_id,
    };
    let error: string | null = null;
    try {
      const res = await fetch(t.event_url, { method: "POST", headers, body: d.payload, signal: AbortSignal.timeout(5000) });
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) { error = (e as Error).message; }
    const attempts = d.attempts + 1;
    if (!error) {
      this.ctx.db.prepare("UPDATE webhook_deliveries SET status = 'SENT', attempts = ?, sent_ts = ?, last_error = NULL WHERE event_id = ?").run(attempts, ts, d.event_id);
      bus.publish({ kind: "event", event: { event_id: d.event_id, type: JSON.parse(d.payload).type, ts, status: "SENT" } });
      return;
    }
    const schedule = getSetting(this.ctx.db, "events.retry_schedule_ms", "5000,30000,120000,600000").split(",").map(Number);
    const giveUp = Number(getSetting(this.ctx.db, "events.give_up_ms", String(86_400_000)));
    if (Date.now() - Date.parse(d.created_ts) > giveUp) {
      this.ctx.db.prepare("UPDATE webhook_deliveries SET status = 'FAILED', attempts = ?, last_error = ? WHERE event_id = ?").run(attempts, error, d.event_id);
      this.ctx.notify("event.failed", "Olay KZ'ye teslim edilemedi", `${d.event_id}: ${error}`, d.event_id);
      return;
    }
    const wait = schedule[Math.min(attempts - 1, schedule.length - 1)] ?? 60_000;
    const next = new Date(Date.now() + wait).toISOString();
    this.ctx.db.prepare("UPDATE webhook_deliveries SET attempts = ?, next_ts = ?, last_error = ? WHERE event_id = ?").run(attempts, next, error, d.event_id);
    if (attempts === 1) bus.publish({ kind: "event", event: { event_id: d.event_id, type: JSON.parse(d.payload).type, ts, status: "RETRY", error } });
  }
}
