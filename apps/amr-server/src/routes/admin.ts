/**
 * Rafineri ekranları için yönetim uçları (R1, R2, bildirimler, ayarlar).
 * Sprint 1'de oturum / rol yok; ADMIN_TOKEN verilirse X-Admin-Token başlığı istenir.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppContext } from "../context.ts";
import { allSettings, getSetting, listAudit, listNotifications, markNotificationRead, recentTicks, setSetting, unreadCount } from "../db.ts";
import { getDocument, limitUsage, listCurrentAccountMovements, listDocuments, listVaultMovements } from "../ledger.ts";
import { randomUUID } from "node:crypto";
import { enqueueEvent, listDeliveries } from "../events.ts";
import type { VaultError } from "../vault.ts";
import type { FulfilmentError } from "../fulfilment.ts";
import type { CatalogItem } from "@amr/contract";
import type { SettlementError } from "../settlement.ts";
import { ROLE_TR, SECOND_APPROVAL, type Permission, type Role } from "../users.ts";
import { listRequests, requestSummary } from "../reqlog.ts";
import { documentPdf } from "../pdf.ts";
import { bus, type BusEvent } from "../bus.ts";

const ACTOR = "admin"; // geriye dönük varsayılan; gerçek aktör X-User başlığından gelir

/** Demoda kullanıcı üst şeritten seçilir ve X-User başlığıyla gelir. */
const actorOf = (req: any): string => (req.headers["x-user"] as string) || (req.query?.user as string) || ACTOR;

/** R7 teklif formu: tutarlar cent ya da ondalık dize olarak gelebilir. */
interface RefiningQuoteBody {
  product_cents?: number; product?: string;
  logistics_cents?: number; logistics?: string;
  ccy?: "USD" | "EUR" | "AED"; lead_time_days?: number; carrier?: string; valid_hours?: number;
}

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
    deliveries_open: ctx.deliveries.open().length,
    refining_open: ctx.refining.open().length,
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
  /** Yetki kapısı: rolünde bu aksiyon yoksa 403. Denetçi hiçbir elle aksiyon yapamaz. */
  const allow = (req: any, reply: any, perm: Permission): string | null => {
    const actor = actorOf(req);
    if (!ctx.users.can(actor, perm)) { reply.code(403).send({ error: `${actor}: bu aksiyon için yetki yok (${perm})` }); return null; }
    return actor;
  };
  const vaultAction = (perm: Permission, fn: (id: string, body: any, actor: string) => unknown) => async (req: any, reply: any) => {
    const actor = allow(req, reply, perm);
    if (!actor) return reply;
    try { return fn(req.params.id, req.body ?? {}, actor); }
    catch (e) { return reply.code((e as VaultError).code ?? 409).send({ error: (e as Error).message }); }
  };
  app.post<{ Params: { id: string } }>("/admin/vault/:id/accept", vaultAction("vault.accept", (id, _b, actor) => ctx.vault.accept(id, actor)));
  app.post<{ Params: { id: string }; Body: { reason?: string } }>("/admin/vault/:id/reject", async (req, reply) => {
    const reason = req.body?.reason?.trim();
    if (!reason) return reply.code(400).send({ error: "gerekçe zorunlu" });
    const actor = allow(req, reply, "vault.accept");
    if (!actor) return reply;
    try { return ctx.vault.reject(req.params.id, reason, actor); }
    catch (e) { return reply.code((e as VaultError).code ?? 409).send({ error: (e as Error).message }); }
  });
  app.post<{ Params: { id: string } }>("/admin/vault/:id/placing", vaultAction("vault.place", (id, _b, actor) => ctx.vault.placing(id, actor)));
  app.post<{ Params: { id: string } }>("/admin/vault/:id/placed", vaultAction("vault.place", (id, _b, actor) => ctx.vault.placed(id, actor)));
  // R5: mahsuplaşma çağır (pencere mantığı Sprint 5; şimdilik karşı tarafa talep olayı + bildirim)
  app.post<{ Body: { reason?: string } }>("/admin/settlement/request", async (req, reply) => {
    const reason = req.body?.reason?.trim();
    if (!reason) return reply.code(400).send({ error: "gerekçe zorunlu" });
    const id = enqueueEvent(ctx, "settlement.requested", { requested_by: "AMR", trigger: "REQUEST_AMR", reason, ts: new Date().toISOString() });
    ctx.audit(ACTOR, "settlement.request", undefined, { reason });
    ctx.notify("settlement.requested", "Mahsuplaşma talep edildi (AMR)", reason, id);
    return { ok: true, event_id: id };
  });

  // ----- R6: fiziksel teslimat (10) -----
  /** R6 ve R7 aksiyonları; motor hatası durum koduyla döner. */
  const step = (perm: Permission, fn: (id: string, body: any, actor: string) => unknown) => async (req: any, reply: any) => {
    const actor = allow(req, reply, perm);
    if (!actor) return reply;
    try { return fn(req.params.id, req.body ?? {}, actor); }
    catch (e) { return reply.code((e as FulfilmentError).code ?? 409).send({ error: (e as Error).message }); }
  };

  app.get("/admin/deliveries", async () => ({ items: ctx.deliveries.list(300), open: ctx.deliveries.open().length }));
  app.get<{ Params: { id: string } }>("/admin/deliveries/:id", async (req, reply) => ctx.deliveries.get(req.params.id) ?? reply.code(404).send({ error: "talep yok" }));
  app.post<{ Params: { id: string }; Body: { carrier?: string; amount?: string; amount_cents?: number; ccy?: string; valid_hours?: number } }>("/admin/deliveries/:id/quote", async (req, reply) => {
    const b = req.body ?? {};
    const cents = b.amount_cents ?? Math.round(Number(String(b.amount ?? "").replace(",", ".")) * 100);
    if (!b.carrier?.trim()) return reply.code(400).send({ error: "taşıyıcı zorunlu" });
    if (!Number.isFinite(cents) || cents < 0) return reply.code(400).send({ error: "tutar geçersiz" });
    const actor = allow(req, reply, "delivery.steps");
    if (!actor) return reply;
    try { return ctx.deliveries.quote(req.params.id, { carrier: b.carrier.trim(), amount_cents: cents, ccy: b.ccy ?? "USD", valid_hours: b.valid_hours }, actor); }
    catch (e) { return reply.code((e as FulfilmentError).code ?? 409).send({ error: (e as Error).message }); }
  });
  app.post<{ Params: { id: string } }>("/admin/deliveries/:id/preparing", step("delivery.steps", (id, _b, actor) => ctx.deliveries.preparing(id, actor)));
  app.post<{ Params: { id: string } }>("/admin/deliveries/:id/ready", step("delivery.steps", (id, _b, actor) => ctx.deliveries.ready(id, actor)));
  app.post<{ Params: { id: string }; Body: { carrier?: string; tracking_no?: string } }>("/admin/deliveries/:id/shipped", step("delivery.steps", (id, b, actor) => ctx.deliveries.shipped(id, (b.carrier ?? "").trim(), (b.tracking_no ?? "").trim(), actor)));
  app.post<{ Params: { id: string } }>("/admin/deliveries/:id/delivered", step("delivery.steps", (id, _b, actor) => ctx.deliveries.delivered(id, actor)));
  app.post<{ Params: { id: string }; Body: { reason?: string } }>("/admin/deliveries/:id/cancel", step("delivery.steps", (id, b, actor) => ctx.deliveries.cancel(id, (b.reason ?? "").trim() || "rafineri iptal etti", actor)));
  app.post<{ Params: { id: string }; Body: { reason?: string } }>("/admin/deliveries/:id/failed", step("delivery.steps", (id, b, actor) => ctx.deliveries.failed(id, (b.reason ?? "").trim() || "teslim edilemedi", actor)));

  // ----- R7: katalog ve rafinasyon (11) -----
  app.get("/admin/catalog", async () => ctx.catalog.get());
  app.put<{ Body: Partial<CatalogItem> & { item_id?: string } }>("/admin/catalog", async (req, reply) => {
    const b = (req.body ?? {}) as Partial<CatalogItem> & { item_id?: string };
    if (!b.item_id) return reply.code(400).send({ error: "item_id zorunlu" });
    const actor = allow(req, reply, "catalog.edit");
    if (!actor) return reply;
    try { return ctx.catalog.upsert(b as Partial<CatalogItem> & { item_id: string }, actor); }
    catch (e) { return reply.code((e as FulfilmentError).code ?? 409).send({ error: (e as Error).message }); }
  });
  app.get("/admin/refining", async () => ({ items: ctx.refining.list(300), open: ctx.refining.open().length }));
  app.get<{ Params: { id: string } }>("/admin/refining/:id", async (req, reply) => ctx.refining.get(req.params.id) ?? reply.code(404).send({ error: "talep yok" }));
  app.post<{ Params: { id: string }; Body: RefiningQuoteBody }>("/admin/refining/:id/quote", async (req, reply) => {
    const b = (req.body ?? {}) as RefiningQuoteBody;
    const product = b.product_cents ?? Math.round(Number(String(b.product ?? "").replace(",", ".")) * 100);
    const logistics = b.logistics_cents ?? Math.round(Number(String(b.logistics ?? "").replace(",", ".")) * 100);
    if (!Number.isFinite(product) || product < 0 || !Number.isFinite(logistics) || logistics < 0) return reply.code(400).send({ error: "tutarlar geçersiz" });
    const actor = allow(req, reply, "refining.steps");
    if (!actor) return reply;
    try { return ctx.refining.quote(req.params.id, { product_cents: product, logistics_cents: logistics, ccy: b.ccy ?? "USD", lead_time_days: Number(b.lead_time_days ?? 3), carrier: b.carrier, valid_hours: b.valid_hours }, actor); }
    catch (e) { return reply.code((e as FulfilmentError).code ?? 409).send({ error: (e as Error).message }); }
  });
  app.post<{ Params: { id: string } }>("/admin/refining/:id/production", step("refining.steps", (id, _b, actor) => ctx.refining.inProduction(id, actor)));
  app.post<{ Params: { id: string } }>("/admin/refining/:id/ready", step("refining.steps", (id, _b, actor) => ctx.refining.ready(id, actor)));
  app.post<{ Params: { id: string }; Body: { carrier?: string; tracking_no?: string } }>("/admin/refining/:id/shipped", step("refining.steps", (id, b, actor) => ctx.refining.shipped(id, (b.carrier ?? "").trim(), (b.tracking_no ?? "").trim(), actor)));
  app.post<{ Params: { id: string } }>("/admin/refining/:id/delivered", step("refining.steps", (id, _b, actor) => ctx.refining.delivered(id, actor)));
  app.post<{ Params: { id: string }; Body: { reason?: string } }>("/admin/refining/:id/cancel", step("refining.steps", (id, b, actor) => ctx.refining.cancel(id, (b.reason ?? "").trim() || "rafineri iptal etti", actor)));
  app.post<{ Params: { id: string }; Body: { reason?: string } }>("/admin/refining/:id/failed", step("refining.steps", (id, b, actor) => ctx.refining.failed(id, (b.reason ?? "").trim() || "teslim edilemedi", actor)));

  // ----- R8: mahsuplaşma (12) -----
  app.get("/admin/settlements", async () => ({ items: ctx.settlement.list(), open: ctx.settlement.openWindow() ?? null }));
  app.get<{ Params: { id: string } }>("/admin/settlements/:id", async (req, reply) => ctx.settlement.get(req.params.id) ?? reply.code(404).send({ error: "pencere yok" }));
  /** Mahsuplaşma talep et (R8) ya da kesimi elle tetikle (demo). */
  app.post<{ Body: { reason?: string; trigger?: string } }>("/admin/settlements", async (req, reply) => {
    const actor = actorOf(req);
    if (!ctx.users.can(actor, "settlement.request")) return reply.code(403).send({ error: `${actor}: bu aksiyon için yetki yok (mahsuplaşma talebi)` });
    const trigger = (req.body?.trigger as any) ?? "REQUEST_AMR";
    const s = ctx.settlement.open(trigger, req.body?.reason?.trim());
    ctx.audit(actor, "settlement.open", undefined, { settlement_id: s.settlement_id, trigger });
    if (trigger === "REQUEST_AMR") enqueueEvent(ctx, "settlement.requested", { settlement_id: s.settlement_id, requested_by: "AMR", trigger, reason: req.body?.reason ?? null });
    return s;
  });
  app.post<{ Params: { id: string } }>("/admin/settlements/:id/draft", async (req, reply) => {
    try { return ctx.settlement.draft(req.params.id); }
    catch (e) { return reply.code((e as SettlementError).code ?? 409).send({ error: (e as Error).message }); }
  });
  /** AMR ödeyen taraf ise ödeme bildirimi; ikinci onay ister. */
  app.post<{ Params: { id: string }; Body: { ccy?: string; amount_cents?: number; direction?: string; bank_ref?: string; approval_id?: number; approver?: string } }>("/admin/settlements/:id/payment-notice", async (req, reply) => {
    const actor = actorOf(req);
    if (!ctx.users.can(actor, "settlement.payment")) return reply.code(403).send({ error: `${actor}: ödeme talimatı yetkisi yok` });
    const b = req.body ?? {};
    if (!b.ccy || !b.bank_ref?.trim()) return reply.code(400).send({ error: "kur ve banka referansı zorunlu" });
    if (!b.approval_id) {
      const id = ctx.users.requestApproval("settlement.payment", { settlement_id: req.params.id, ...b }, actor);
      return reply.code(202).send({ needs_approval: true, approval_id: id, message: "ödeme talimatı ikinci onay bekliyor" });
    }
    try {
      ctx.users.approve(Number(b.approval_id), b.approver ?? actor);
      return ctx.settlement.paymentNotice(req.params.id, b.ccy, Number(b.amount_cents ?? 0), b.direction ?? "AMR_TO_KZ", b.bank_ref.trim());
    } catch (e) { return reply.code(409).send({ error: (e as Error).message }); }
  });
  app.post<{ Params: { id: string }; Body: { ccy?: string; bank_ref?: string } }>("/admin/settlements/:id/payment-received", async (req, reply) => {
    const actor = actorOf(req);
    if (!ctx.users.can(actor, "settlement.payment")) return reply.code(403).send({ error: `${actor}: ödeme onayı yetkisi yok` });
    try { return ctx.settlement.paymentReceived(req.params.id, req.body?.ccy ?? "USD", req.body?.bank_ref); }
    catch (e) { return reply.code((e as SettlementError).code ?? 409).send({ error: (e as Error).message }); }
  });

  // ----- R9: belgeler -----
  app.get<{ Params: { id: string } }>("/admin/documents/:id/pdf", async (req, reply) => {
    const d = getDocument(ctx.db, req.params.id);
    if (!d) return reply.code(404).send({ error: "belge yok" });
    return reply.header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="${d.meta.doc_id}.pdf"`)
      .send(documentPdf(d));
  });

  // ----- R10: kullanıcılar, roller, ikinci onay -----
  app.get("/admin/users", async () => ({
    items: ctx.users.list().map((u) => ({ ...u, role_tr: ROLE_TR[u.role], permissions: ctx.users.permissions(u.role) })),
    roles: Object.entries(ROLE_TR).map(([code, name]) => ({ code, name, permissions: ctx.users.permissions(code as Role) })),
    second_approval: SECOND_APPROVAL,
    pending_approvals: ctx.users.pendingApprovals(),
  }));
  app.put<{ Body: { username?: string; display_name?: string; role?: Role; active?: boolean } }>("/admin/users", async (req, reply) => {
    const actor = actorOf(req);
    if (!ctx.users.can(actor, "users.write")) return reply.code(403).send({ error: `${actor}: kullanıcı yönetimi yetkisi yok` });
    if (!req.body?.username) return reply.code(400).send({ error: "username zorunlu" });
    return ctx.users.upsert(req.body as any, actor);
  });
  app.post<{ Params: { id: string }; Body: { approver?: string } }>("/admin/approvals/:id/approve", async (req, reply) => {
    const actor = req.body?.approver ?? actorOf(req);
    try { return { ok: true, ...ctx.users.approve(Number(req.params.id), actor) }; }
    catch (e) { return reply.code(409).send({ error: (e as Error).message }); }
  });
  app.post<{ Params: { id: string } }>("/admin/approvals/:id/reject", async (req) => { ctx.users.reject(Number(req.params.id), actorOf(req)); return { ok: true }; });
  /** API istemcisi: anahtar üret / iptal (ikinci onay ister). */
  app.get("/admin/clients", async () => ctx.db.prepare("SELECT api_key, name, event_url, active, created_ts FROM api_clients").all());
  app.post<{ Body: { name?: string; event_url?: string; approval_id?: number; approver?: string } }>("/admin/clients", async (req, reply) => {
    const actor = actorOf(req);
    if (!ctx.users.can(actor, "clients.write")) return reply.code(403).send({ error: `${actor}: istemci yönetimi yetkisi yok` });
    const b = req.body ?? {};
    if (!b.approval_id) {
      const id = ctx.users.requestApproval("clients.create", b, actor);
      return reply.code(202).send({ needs_approval: true, approval_id: id, message: "anahtar üretimi ikinci onay bekliyor" });
    }
    try { ctx.users.approve(Number(b.approval_id), b.approver ?? actor); } catch (e) { return reply.code(409).send({ error: (e as Error).message }); }
    const key = `kz-${randomUUID().slice(0, 8)}`;
    const secret = randomUUID().replace(/-/g, "");
    ctx.db.prepare("INSERT INTO api_clients(api_key, name, secret, event_url, active, created_ts) VALUES (?, ?, ?, ?, 1, ?)")
      .run(key, b.name ?? "Kanzasset", secret, b.event_url ?? null, new Date().toISOString());
    ctx.audit(actor, "clients.create", undefined, { api_key: key });
    return { api_key: key, secret, name: b.name ?? "Kanzasset" };
  });
  app.post<{ Params: { key: string } }>("/admin/clients/:key/revoke", async (req, reply) => {
    const actor = actorOf(req);
    if (!ctx.users.can(actor, "clients.write")) return reply.code(403).send({ error: `${actor}: istemci yönetimi yetkisi yok` });
    ctx.db.prepare("UPDATE api_clients SET active = 0 WHERE api_key = ?").run(req.params.key);
    ctx.audit(actor, "clients.revoke", undefined, { api_key: req.params.key });
    return { ok: true };
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
  /** Parametre değişikliği kritiktir: ikinci onay ister (Sistem 09). */
  app.put<{ Body: Record<string, string> & { approval_id?: string; approver?: string } }>("/admin/settings", async (req, reply) => {
    const actor = actorOf(req);
    if (!ctx.users.can(actor, "settings.write")) return reply.code(403).send({ error: `${actor}: parametre değiştirme yetkisi yok (Yönetici gerekir)` });
    const { approval_id, approver, ...values } = (req.body ?? {}) as Record<string, string>;
    if (!approval_id) {
      const id = ctx.users.requestApproval("settings.update", values, actor);
      return reply.code(202).send({ needs_approval: true, approval_id: id, message: "parametre değişikliği ikinci onay bekliyor", values });
    }
    let payload: Record<string, string>;
    try { payload = ctx.users.approve(Number(approval_id), approver ?? actor).payload as Record<string, string>; }
    catch (e) { return reply.code(409).send({ error: (e as Error).message }); }
    const before = allSettings(ctx.db);
    for (const [k, v] of Object.entries(payload)) if (typeof v === "string") setSetting(ctx.db, k, v);
    ctx.audit(actor, "settings.update", before, allSettings(ctx.db));
    return allSettings(ctx.db);
  });
  app.get("/admin/audit", async () => listAudit(ctx.db, 100));

  /**
   * İstek günlüğü (VARA kanıtı): Kanzasset'in her isteği ve panelin her değişikliği.
   * Gövde saklanmaz, imzalanan gövdenin sha256 özeti saklanır. Saklama süresi `log.retention_days`.
   */
  app.get<{ Querystring: { limit?: string; channel?: string; path?: string; errors?: string } }>("/admin/requests", async (req) => ({
    summary: requestSummary(ctx.db),
    items: listRequests(ctx.db, {
      limit: Number(req.query.limit ?? 200),
      channel: req.query.channel,
      path: req.query.path,
      onlyErrors: req.query.errors === "1",
    }),
  }));

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
