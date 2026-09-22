/**
 * AMR uygulaması sunucusu.
 *   PORT=4000          REST + WS (/v1/prices) + yönetim uçları (/admin/*) + rafineri ekranları (dist varsa /)
 *   SOURCE_URL         merkez fiyat soketi (varsayılan mock merkez: ws://localhost:4100/prices)
 *   SOURCE_AUTOCONNECT 1 ise açılışta merkeze bağlanır (varsayılan 1)
 *   KZ_API_KEY / KZ_API_SECRET  Kanzasset istemcisi (varsayılan kz-dev-key / kz-dev-secret)
 *   DB_PATH            SQLite dosyası (varsayılan data/amr.db)
 *   ADMIN_TOKEN        verilirse /admin/* için X-Admin-Token
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, ensureApiClient, addNotification, audit as auditRow, getSetting, setSetting } from "./db.ts";
import { ensureLedgerTables, openingBalance } from "./ledger.ts";
import { Publisher } from "./publisher.ts";
import { SourceConnection } from "./source.ts";
import { OrderEngine } from "./orders.ts";
import { VaultDesk, VaultOverdueWatcher, ensureVaultTables } from "./vault.ts";
import { CatalogDesk, DeliveryDesk, RefiningDesk, ensureFulfilmentTables } from "./fulfilment.ts";
import { CutoffWatcher, SettlementDesk, ensureSettlementTables } from "./settlement.ts";
import { UserDesk, ensureUserTables } from "./users.ts";
import { EventDispatcher, enqueueEvent } from "./events.ts";
import { kzRoutes } from "./routes/kz.ts";
import { adminRoutes } from "./routes/admin.ts";
import { docsRoutes } from "./docs.ts";
import { healthRoutes } from "./health.ts";
import { bus } from "./bus.ts";
import type { AppContext } from "./context.ts";

const PORT = Number(process.env.PORT ?? 4000);
const DB_PATH = process.env.DB_PATH ?? resolve(import.meta.dirname, "../data/amr.db");
const SOURCE_URL = process.env.SOURCE_URL ?? "ws://localhost:4100/prices";

export async function buildApp(opts: { dbPath?: string; autoconnect?: boolean; dispatchEvents?: boolean; sweepOverdue?: boolean; watchCutoff?: boolean } = {}) {
  const db = openDb(opts.dbPath ?? DB_PATH);
  ensureLedgerTables(db);
  ensureVaultTables(db);
  ensureFulfilmentTables(db);
  ensureSettlementTables(db);
  ensureUserTables(db);
  ensureApiClient(db, process.env.KZ_API_KEY ?? "kz-dev-key", "Kanzasset FZCO", process.env.KZ_API_SECRET ?? "kz-dev-secret", process.env.KZ_EVENT_URL ?? "http://localhost:5000/api/events");
  // varsayılan parametreler (R10)
  const defaults: Record<string, string> = {
    "source.url": SOURCE_URL,
    "settlement.cutoff_local": "17:00",
    "settlement.timezone": "Asia/Dubai",
    "settlement.windows_per_day": "1",
    "vault.accept_mode": "MANUAL", // MANUAL | AUTO
    "vault.accept_target_minutes": "15",
    "vault.placement_due_days": "3",
    "limit.current_account_gold_mg": String(15_000_000),
    "limit.current_account_usd_cents": String(250_000_000),
    "limit.current_account_eur_cents": String(230_000_000),
    "limit.current_account_aed_cents": String(920_000_000),
    "limit.warn_pct": "80",
    "order.quote_max_age_ms": "10000",
    "quote.delivery_valid_hours": "24",
    "quote.refining_valid_hours": "48",
    "events.retry_schedule_ms": "5000,30000,120000,600000",
    "debug.order_delay_ms": "0",
  };
  for (const [k, v] of Object.entries(defaults)) if (!getSetting(db, k, "")) setSetting(db, k, v);
  // açılış devri (demo): kasada Kanzasset adına duran gram; yalnız defter boşken
  openingBalance(db, Number(process.env.VAULT_OPENING_MG ?? 0));

  const publisher = new Publisher(db);
  const source = new SourceConnection();

  const ctx = {
    db,
    publisher,
    source,
    notify: (type: string, title: string, body = "", relatedId?: string) => {
      const id = addNotification(db, type, title, body, relatedId);
      bus.publish({ kind: "notification", id, type, title, body, created_ts: new Date().toISOString() });
      return id;
    },
    audit: (actor: string, action: string, before?: unknown, after?: unknown) => auditRow(db, actor, action, before, after),
  } as AppContext;
  ctx.orders = new OrderEngine(ctx);
  ctx.vault = new VaultDesk(ctx);
  ctx.catalog = new CatalogDesk(ctx);
  ctx.catalog.seed();
  ctx.deliveries = new DeliveryDesk(ctx);
  ctx.refining = new RefiningDesk(ctx, ctx.catalog);
  ctx.settlement = new SettlementDesk(ctx);
  ctx.users = new UserDesk(ctx);
  ctx.users.seed();
  const dispatcher = new EventDispatcher(ctx);
  if (opts.dispatchEvents ?? true) dispatcher.start();
  // T+3 taraması: vadesi geçen kasa girişleri OVERDUE olur (testlerde kapalı)
  const overdue = new VaultOverdueWatcher(ctx.vault);
  if (opts.sweepOverdue ?? true) overdue.start();
  // kesim saatinde pencere kendiliğinden açılır (talep gelmese de)
  const cutoff = new CutoffWatcher(ctx.settlement);
  if (opts.watchCutoff ?? true) cutoff.start();
  // yayın durdu / açıldı olayları KZ'ye (soketin yanında güvence)
  publisher.onTradableChange = (tradable, reason) => enqueueEvent(ctx, tradable ? "price.resume" : "price.halt", { reason: reason ?? null, ts: new Date().toISOString() });

  source.onPrice = (prices, ts) => publisher.onPrice(prices, ts);
  source.onStatus = (state, prev) => {
    if (state.status === "CONNECTED") {
      publisher.setSourceConnected(true);
      ctx.notify("source.connected", "Merkez bağlantısı kuruldu", state.url ?? "");
    } else if (prev === "CONNECTED") {
      publisher.setSourceConnected(false, "merkez bağlantısı kopuk");
      ctx.notify("source.disconnected", "Merkez bağlantısı koptu", state.lastError ?? "", undefined);
    }
  };

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(cors, { origin: true });
  await app.register(websocket);
  await app.register(async (inst) => kzRoutes(inst, ctx));
  await app.register(async (inst) => adminRoutes(inst, ctx));
  await app.register(async (inst) => docsRoutes(inst, ctx));
  await app.register(async (inst) => healthRoutes(inst, ctx));

  // Rafineri ekranları (üretim: apps/amr-web/dist)
  const webDist = resolve(import.meta.dirname, "../../amr-web/dist");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: "/" });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/v1") || req.url.startsWith("/admin") || req.url.startsWith("/docs") || req.url.startsWith("/health") || req.url.endsWith(".json")) return reply.code(404).send({ error: "not found" });
      return reply.sendFile("index.html");
    });
  }

  const autoconnect = opts.autoconnect ?? (process.env.SOURCE_AUTOCONNECT ?? "1") === "1";
  if (autoconnect) source.connect(getSetting(db, "source.url", SOURCE_URL));

  app.addHook("onClose", async () => { dispatcher.stop(); overdue.stop(); cutoff.stop(); publisher.stop(); source.disconnect(); db.close(); });
  return { app, ctx };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  const { app } = await buildApp();
  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`AMR uygulaması: http://localhost:${PORT}  · fiyat soketi ws://localhost:${PORT}/v1/prices · yönetim /admin/overview · API dokümanı /docs`);
}
