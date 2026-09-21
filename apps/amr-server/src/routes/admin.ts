/**
 * Rafineri ekranları için yönetim uçları (R1, R2, bildirimler, ayarlar).
 * Sprint 1'de oturum / rol yok; ADMIN_TOKEN verilirse X-Admin-Token başlığı istenir.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppContext } from "../context.ts";
import { allSettings, getSetting, listAudit, listNotifications, markNotificationRead, recentTicks, setSetting, unreadCount } from "../db.ts";
import { getDocument, limitUsage, listCurrentAccountMovements, listDocuments, listVaultMovements } from "../ledger.ts";
import { enqueueEvent, listDeliveries } from "../events.ts";
import type { VaultError } from "../vault.ts";
import { bus, type BusEvent } from "../bus.ts";

const ACTOR = "admin"; // Sprint 1: tek kullanıcı

export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const token = process.env.ADMIN_TOKEN;
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/admin")) return;
    if (token && req.headers["x-admin-token"] !== token && (req.query as any)?.token !== token) return reply.code(401).send({ error: "ADMIN_TOKEN" });
  });

  const overview = () => ({
    source: { ...ctx.source.state },
    publish: ctx.publisher.snapshotState(),
    subscribers: ctx.publisher.listSubscribers(),
    unread: unreadCount(ctx.db),
    settings: allSettings(ctx.db),
    ts: new Date().toISOString(),
    account: ctx.orders.account(),
    limit: limitUsage(ctx.db),
    orders_today: ctx.orders.todaySummary(),
    vault_pending: ctx.vault.pending().length,
    vault_overdue: ctx.vault.placingQueue().filter((r) => r.status === "OVERDUE").length,
  });

  app.get("/admin/overview", async () => overview());

  // ----- R3: emirler -----
  app.get<{ Querystring: { day?: string; side?: string; status?: string; limit?: string } }>("/admin/orders", async (req) =>
    ctx.orders.list({ day: req.query.day, side: req.query.side, status: req.query.status, limit: Math.min(1000, Number(req.query.limit ?? 200)) }));
  app.get<{ Params: { id: string } }>("/admin/orders/:id", async (req, reply) => ctx.orders.status(req.params.id) ?? reply.code(404).send({ error: "emir yok" }));

  // ----- R5: cari hesap -----
  app.get<{ Querystring: { limit?: string } }>("/admin/current-account", async (req) => ({
    account: ctx.orders.account(),
    limit: limitUsage(ctx.db),
    movements: listCurrentAccountMovements(ctx.db, { limit: Math.min(1000, Number(req.query.limit ?? 200)) }),
  }));
  app.get("/admin/vault/movements", async () => listVaultMovements(ctx.db));

  // ----- R4: kasa hesabı (05, 06) -----
  app.get<{ Querystring: { type?: string; status?: string; limit?: string } }>("/admin/vault", async (req) => ({
    account: ctx.orders.account(),
    pending: ctx.vault.pending(),
    placing_queue: ctx.vault.placingQueue(),
    requests: ctx.vault.list({ type: req.query.type, status: req.query.status, limit: Math.min(1000, Number(req.query.limit ?? 200)) }),
    movements: listVaultMovements(ctx.db, 100),
    accept_mode: getSetting(ctx.db, "vault.accept_mode", "MANUAL"),
    accept_target_minutes: Number(getSetting(ctx.db, "vault.accept_target_minutes", "15")),
    placement_due_days: Number(getSetting(ctx.db, "vault.placement_due_days", "3")),
  }));
  app.get<{ Querystring: { date?: string } }>("/admin/vault/statement", async (req) => ctx.vault.statement(req.query.date));

  /** R4 aksiyonları: Kabul et / Reddet · Kasaya konuluyor · Kasaya konuldu. Hepsi denetim günlüğüne yazılır. */
  const vaultAction = (fn: (id: string, body: any) => unknown) => async (req: any, reply: any) => {
    try { return fn(req.params.id, req.body ?? {}); }
    catch (e) { return reply.code((e as VaultError).code ?? 409).send({ error: (e as Error).message }); }
  };
  app.post<{ Params: { id: string } }>("/admin/vault/:id/accept", vaultAction((id) => ctx.vault.accept(id, ACTOR)));
  app.post<{ Params: { id: string }; Body: { reason?: string } }>("/admin/vault/:id/reject", async (req, reply) => {
    const reason = req.body?.reason?.trim();
    if (!reason) return reply.code(400).send({ error: "gerekçe zorunlu" });
    try { return ctx.vault.reject(req.params.id, reason, ACTOR); }
    catch (e) { return reply.code((e as VaultError).code ?? 409).send({ error: (e as Error).message }); }
  });
  app.post<{ Params: { id: string } }>("/admin/vault/:id/placing", vaultAction((id) => ctx.vault.placing(id, ACTOR)));
  app.post<{ Params: { id: string } }>("/admin/vault/:id/placed", vaultAction((id) => ctx.vault.placed(id, ACTOR)));
  // R5: mahsuplaşma çağır (pencere mantığı Sprint 5; şimdilik karşı tarafa talep olayı + bildirim)
  app.post<{ Body: { reason?: string } }>("/admin/settlement/request", async (req, reply) => {
    const reason = req.body?.reason?.trim();
    if (!reason) return reply.code(400).send({ error: "gerekçe zorunlu" });
    const id = enqueueEvent(ctx, "settlement.requested", { requested_by: "AMR", trigger: "REQUEST_AMR", reason, ts: new Date().toISOString() });
    ctx.audit(ACTOR, "settlement.request", undefined, { reason });
    ctx.notify("settlement.requested", "Mahsuplaşma talep edildi (AMR)", reason, id);
    return { ok: true, event_id: id };
  });

  // ----- R9 (ön): belgeler ve olay teslimleri -----
  app.get("/admin/documents", async () => listDocuments(ctx.db));
  app.get<{ Params: { id: string } }>("/admin/documents/:id", async (req, reply) => getDocument(ctx.db, req.params.id) ?? reply.code(404).send({ error: "belge yok" }));
  app.get("/admin/events", async () => listDeliveries(ctx));

  // ----- R2: merkez bağlantısı -----
  app.post<{ Body: { url?: string } }>("/admin/source/connect", async (req, reply) => {
    const url = req.body?.url?.trim() || getSetting(ctx.db, "source.url", process.env.SOURCE_URL ?? "ws://localhost:4100/prices");
    if (!/^wss?:\/\//.test(url)) return reply.code(400).send({ error: "URL ws:// ya da wss:// ile başlamalı" });
    const before = { ...ctx.source.state };
    setSetting(ctx.db, "source.url", url);
    ctx.source.connect(url);
    ctx.audit(ACTOR, "source.connect", { status: before.status, url: before.url }, { url });
    return { ok: true, source: ctx.source.state };
  });
  app.post("/admin/source/disconnect", async () => {
    const before = { ...ctx.source.state };
    ctx.source.disconnect();
    ctx.audit(ACTOR, "source.disconnect", { status: before.status }, { status: ctx.source.state.status });
    return { ok: true, source: ctx.source.state };
  });

  // ----- R2: yayını durdur / başlat -----
  app.post<{ Body: { reason?: string } }>("/admin/publish/halt", async (req, reply) => {
    const reason = req.body?.reason?.trim();
    if (!reason) return reply.code(400).send({ error: "gerekçe zorunlu" });
    ctx.publisher.halt(reason);
    ctx.audit(ACTOR, "publish.halt", undefined, { reason });
    ctx.notify("publish.halt", "Fiyat yayını durduruldu", reason);
    return { ok: true, publish: ctx.publisher.snapshotState() };
  });
  app.post("/admin/publish/resume", async () => {
    ctx.publisher.resume();
    ctx.audit(ACTOR, "publish.resume");
    ctx.notify("publish.resume", "Fiyat yayını başlatıldı");
    return { ok: true, publish: ctx.publisher.snapshotState() };
  });

  app.get<{ Querystring: { limit?: string } }>("/admin/ticks", async (req) => recentTicks(ctx.db, Math.min(500, Number(req.query.limit ?? 50))));
  app.get("/admin/subscribers", async () => ctx.publisher.listSubscribers());

  // ----- bildirimler -----
  app.get("/admin/notifications", async () => ({ unread: unreadCount(ctx.db), items: listNotifications(ctx.db, 50) }));
  app.post<{ Params: { id: string } }>("/admin/notifications/:id/read", async (req) => {
    markNotificationRead(ctx.db, Number(req.params.id));
    bus.publish({ kind: "subscribers", count: ctx.publisher.snapshotState().subscribers }); // istemciler unread'i yeniden çeker
    return { ok: true, unread: unreadCount(ctx.db) };
  });

  // ----- ayarlar ve denetim günlüğü (R10, Sprint 1: parametre listesi) -----
  app.get("/admin/settings", async () => allSettings(ctx.db));
  app.put<{ Body: Record<string, string> }>("/admin/settings", async (req) => {
    const before = allSettings(ctx.db);
    for (const [k, v] of Object.entries(req.body ?? {})) if (typeof v === "string") setSetting(ctx.db, k, v);
    ctx.audit(ACTOR, "settings.update", before, allSettings(ctx.db));
    return allSettings(ctx.db);
  });
  app.get("/admin/audit", async () => listAudit(ctx.db, 100));

  // ----- canlı akış (SSE) -----
  app.get("/admin/stream", async (req, reply: FastifyReply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });
    const write = (ev: BusEvent) => reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
    write({ kind: "source", state: { ...ctx.source.state } });
    write({ kind: "publish", state: ctx.publisher.snapshotState() });
    write({ kind: "account", account: ctx.orders.account() });
    const onEvent = (ev: BusEvent) => write(ev);
    bus.on("event", onEvent);
    const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 15000);
    req.raw.on("close", () => { bus.off("event", onEvent); clearInterval(ping); });
    await new Promise(() => { /* bağlantı kapanınca Fastify temizler */ });
  });
}
