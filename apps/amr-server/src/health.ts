/**
 * Sağlık ucu (GET /health).
 *
 * Tek satırlık "ok" yerine alt sistemlerin durumunu verir: veritabanı, merkez bağlantısı,
 * Kanzasset yayını, olay kuyruğu, kasa talimatları ve açık mahsuplaşma penceresi.
 * İzleme aracı da, sunumda ekranı açan da aynı yerden bakar.
 *
 * Genel durum:
 *   ok        her şey yerinde
 *   degraded  çalışıyor ama ilgilenilmesi gereken bir şey var (merkez kopuk, olay teslim edilemedi, vade geçti)
 *   down      veritabanı okunamıyor; sunucu iş göremez
 *
 * HTTP kodu yalnız `down` durumunda 503'tür. `degraded` 200 döner: konteyner sağlıklıdır,
 * merkez soketi koptu diye servis yeniden başlatılmaz (bkz. docs/KARARLAR.md).
 */
import type { FastifyInstance } from "fastify";
import type { AppContext } from "./context.ts";
import { getSetting, now } from "./db.ts";
import { vaultBalance, currentAccountBalance } from "./ledger.ts";

type Level = "ok" | "degraded" | "down";
interface Check { status: Level; detail: string; [k: string]: unknown }

const STARTED = Date.now();
const worst = (a: Level, b: Level): Level => (a === "down" || b === "down" ? "down" : a === "degraded" || b === "degraded" ? "degraded" : "ok");
const ageS = (ts: string | null | undefined) => (ts ? Math.round((Date.now() - Date.parse(ts)) / 1000) : null);

/** Sağlık fotoğrafı. Hiçbir şey yazmaz, yalnız okur. */
export function healthSnapshot(ctx: AppContext) {
  const checks: Record<string, Check> = {};

  // 1. Veritabanı: gerçekten bir okuma yapar, "açık mı" demekle yetinmez.
  try {
    const row = ctx.db.prepare("SELECT COUNT(*) AS n FROM current_account_movements").get() as { n: number };
    checks.database = { status: "ok", detail: `okunuyor, ${row.n} cari hesap hareketi`, movements: row.n };
  } catch (e) {
    checks.database = { status: "down", detail: `okunamıyor: ${(e as Error).message}` };
    return { status: "down" as Level, ts: now(), uptime_s: Math.round((Date.now() - STARTED) / 1000), checks };
  }

  // 2. Merkez bağlantısı: fiyat buradan gelir, kopuksa yayın durur.
  const s = ctx.source.state;
  const srcAge = ageS(s.lastPriceTs);
  checks.source = {
    status: s.status === "CONNECTED" ? "ok" : "degraded",
    detail: s.status === "CONNECTED" ? `bağlı, son fiyat ${srcAge ?? "?"} sn önce` : `bağlı değil (${s.status})${s.lastError ? ": " + s.lastError : ""}`,
    connection: s.status, url: s.url, connected_since: s.connectedSince, last_price_age_s: srcAge, last_error: s.lastError,
  };

  // 3. Kanzasset yayını: tradable kapalıysa karşı taraf müşteri işlemlerini durdurur.
  const p = ctx.publisher.snapshotState();
  checks.publish = {
    status: p.tradable ? "ok" : "degraded",
    detail: p.tradable ? `açık, ${p.subscribers} abone, seq ${p.seq}` : `durdu: ${p.manualHalt ? (p.haltReason ?? "elle durduruldu") : !p.sourceConnected ? "merkez bağlantısı yok" : (p.haltReason ?? "sebep kaydedilmedi")}`,
    tradable: p.tradable, manual_halt: p.manualHalt, halt_reason: p.haltReason, subscribers: p.subscribers, seq: p.seq,
    last_tick_age_s: ageS(p.lastTickTs),
  };

  // 4. Olay kuyruğu: teslim edilemeyen olay varsa karşı tarafın kaydı geride kalır.
  const q = ctx.db.prepare("SELECT status, COUNT(*) AS n FROM webhook_deliveries GROUP BY status").all() as { status: string; n: number }[];
  const byStatus = Object.fromEntries(q.map((r) => [r.status, r.n])) as Record<string, number>;
  const oldest = ctx.db.prepare("SELECT MIN(created_ts) AS t FROM webhook_deliveries WHERE status = 'PENDING'").get() as { t: string | null };
  const failed = byStatus.FAILED ?? 0, pending = byStatus.PENDING ?? 0;
  checks.events = {
    status: failed > 0 ? "degraded" : "ok",
    detail: failed > 0 ? `${failed} olay teslim edilemedi` : `${byStatus.SENT ?? 0} gönderildi, ${pending} sırada`,
    sent: byStatus.SENT ?? 0, pending, failed, oldest_pending_age_s: ageS(oldest.t),
  };

  // 5. Kasa talimatları: vadesi geçen giriş (T+3) karşı tarafta mint'i bloke eder.
  const v = ctx.db.prepare("SELECT status, COUNT(*) AS n FROM vault_requests GROUP BY status").all() as { status: string; n: number }[];
  const vs = Object.fromEntries(v.map((r) => [r.status, r.n])) as Record<string, number>;
  const overdue = vs.OVERDUE ?? 0;
  checks.vault = {
    status: overdue > 0 ? "degraded" : "ok",
    detail: overdue > 0 ? `${overdue} kasa girişi vadesi geçti (T+${getSetting(ctx.db, "vault.placement_due_days", "3")})` : `${vs.REQUESTED ?? 0} bekleyen talep`,
    requested: vs.REQUESTED ?? 0, placing: vs.PLACING ?? 0, overdue,
  };

  // 6. Mahsuplaşma: açık pencere varsa gün kapanmamıştır.
  const open = ctx.db.prepare("SELECT settlement_id AS id, status FROM settlements WHERE status NOT IN ('SETTLED','CANCELLED') ORDER BY opened_ts DESC LIMIT 1").get() as { id: string; status: string } | undefined;
  checks.settlement = {
    status: "ok",
    detail: open ? `açık pencere ${open.id} (${open.status})` : "açık pencere yok",
    open_id: open?.id ?? null, open_status: open?.status ?? null,
    cutoff: `${getSetting(ctx.db, "settlement.cutoff_local", "17:00")} ${getSetting(ctx.db, "settlement.timezone", "Asia/Dubai")}`,
  };

  const vb = vaultBalance(ctx.db), ca = currentAccountBalance(ctx.db);
  const status = Object.values(checks).reduce<Level>((acc, c) => worst(acc, c.status), "ok");
  return {
    status, ts: now(), uptime_s: Math.round((Date.now() - STARTED) / 1000),
    balances: { vault_mg: vb.in_vault_mg + vb.placing_mg + vb.shipping_mg, current_account_gold_mg: ca.gold_mg },
    checks,
  };
}

export async function healthRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/health", async (_req, reply) => {
    const h = healthSnapshot(ctx);
    return reply.code(h.status === "down" ? 503 : 200).send(h);
  });
}
