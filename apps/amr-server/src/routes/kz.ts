/**
 * Kanzasset'e açık uçlar (sözleşme, Sistem 05):
 *   GET  /v1/session/status                         oturum ve yayın durumu
 *   WS   /v1/prices                                 fiyat yayını (ilk mesaj auth)
 *   POST /v1/orders · GET /v1/orders/:id · POST /v1/orders/:id/cancel   emir (03, 04), durum sorgusu, iptal (Cevapsız emir)
 *   GET  /v1/account                                bakiye bilgisi, anlık fotoğraf (02)
 *   GET  /v1/current-account/statement?from=&to=    cari hesap ekstresi (12, adım 1)
 *   POST /v1/vault/in · POST /v1/vault/out          kasa talimatı (05, 06) · GET /v1/vault/requests/:id
 *   GET  /v1/vault/statement?date=                  günlük kasa ekstresi, rezerv kanıtı (Kontroller)
 *   POST /v1/deliveries · approve|cancel · GET       fiziksel teslimat (10)
 *   GET  /v1/catalog                                rafinasyon ürün kataloğu (11)
 *   POST /v1/refining · approve|cancel · GET        rafinasyon (11)
 *   POST /v1/settlements · confirm · payment-notice · payment-received   mahsuplaşma (12)
 *   GET  /v1/documents/:id                          Tahsis Belgesi ve fişler (JSON; /pdf ile PDF)
 */
import type { FastifyInstance } from "fastify";
import { DeliveryRequestBody, OrderRequest, RefiningRequestBody, VaultRequestBody, type Catalog, type CurrentAccountStatement, type SessionStatus, type VaultStatement, type WsAuth } from "@amr/contract";
import { Value } from "@sinclair/typebox/value";
import type { AppContext } from "../context.ts";
import { parseScope, type RequestedAmounts, type SettlementError } from "../settlement.ts";
import { verify } from "../auth.ts";
import { currentAccountBalance, getDocument, listCurrentAccountMovements, markDocumentSent, signContent } from "../ledger.ts";
import { FulfilmentError } from "../fulfilment.ts";
import { documentPdf } from "../pdf.ts";

export async function kzRoutes(app: FastifyInstance, ctx: AppContext) {
  // REST kimlik doğrulama kancası (yalnız /v1/*); gövde imzaya ham metin olarak girer (KZ gönderdiği metni imzalar)
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as any).rawBody = body as string;
    try { done(null, body === "" ? undefined : JSON.parse(body as string)); } catch (e) { done(e as Error, undefined); }
  });
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/v1/") || req.url.startsWith("/v1/prices")) return;
    const body = ((req as any).rawBody as string | undefined) ?? "";
    const path = req.url.split("?")[0];
    const v = verify(ctx.db, req.headers["x-api-key"] as string, req.headers["x-timestamp"] as string, req.headers["x-signature"] as string, req.method, path, body);
    if (!v.ok) return reply.code(401).send({ error: v.code });
    (req as any).client = v.client;
  });

  app.get("/v1/session/status", async (): Promise<SessionStatus> => {
    const p = ctx.publisher.snapshotState();
    return {
      status: p.tradable ? "OPEN" : "HALTED",
      tradable: p.tradable,
      source_connected: p.sourceConnected,
      halt_reason: p.manualHalt ? p.haltReason ?? "yayın durdu" : p.sourceConnected ? undefined : "merkez bağlantısı yok",
      ts: new Date().toISOString(),
    };
  });

  // ----- emirler -----
  app.post("/v1/orders", async (req, reply) => {
    const body = req.body as unknown;
    if (!Value.Check(OrderRequest, body)) {
      const err = [...Value.Errors(OrderRequest, body)][0];
      return reply.code(400).send({ error: `geçersiz emir: ${err?.path ?? ""} ${err?.message ?? ""}`.trim(), reject_reason: "INVALID_QTY" });
    }
    const r = await ctx.orders.place(body);
    return reply.code(r.code).send(r.body);
  });
  app.get<{ Params: { id: string } }>("/v1/orders/:id", async (req, reply) => {
    const r = ctx.orders.status(req.params.id);
    return r ? r : reply.code(404).send({ error: "emir yok" });
  });
  app.post<{ Params: { id: string } }>("/v1/orders/:id/cancel", async (req, reply) => {
    const r = ctx.orders.cancel(req.params.id);
    return r ? r : reply.code(404).send({ error: "emir yok" });
  });

  // ----- bakiye bilgisi -----
  app.get("/v1/account", async () => ctx.orders.account());

  app.get<{ Querystring: { from?: string; to?: string } }>("/v1/current-account/statement", async (req): Promise<CurrentAccountStatement> => {
    const to = req.query.to ?? new Date().toISOString();
    const from = req.query.from ?? `${to.slice(0, 10)}T00:00:00.000Z`;
    const movements = listCurrentAccountMovements(ctx.db, { from, to, limit: 5000 });
    const bal = currentAccountBalance(ctx.db);
    const fees = movements.filter((m) => m.type === "FEE_DELIVERY" || m.type === "FEE_REFINING").map((m) => ({ type: m.type, ccy: m.ccy!, amount_cents: m.amount_cents ?? 0 }));
    const base = { window_from: from, window_to: to, movements, gold_mg: bal.gold_mg, money: bal.money, fees };
    const { hash, signature } = signContent(ctx.db, base);
    return { ...base, hash, signature };
  });

  // ----- kasa talimatları (05, 06) -----
  const vaultRequest = (type: "IN" | "OUT") => async (req: any, reply: any) => {
    const body = req.body as unknown;
    if (!Value.Check(VaultRequestBody, body)) {
      const err = [...Value.Errors(VaultRequestBody, body)][0];
      return reply.code(400).send({ error: `geçersiz kasa talimatı: ${err?.path ?? ""} ${err?.message ?? ""}`.trim(), reject_reason: "INVALID_QTY" });
    }
    const r = ctx.vault.request(type, body.qty_mg, body.ref);
    return reply.code(r.code).send(r.body);
  };
  app.post("/v1/vault/in", vaultRequest("IN"));
  app.post("/v1/vault/out", vaultRequest("OUT"));
  app.get<{ Params: { id: string } }>("/v1/vault/requests/:id", async (req, reply) => {
    const r = ctx.vault.get(req.params.id);
    return r ? r : reply.code(404).send({ error: "talep yok" });
  });
  app.get<{ Querystring: { date?: string } }>("/v1/vault/statement", async (req): Promise<VaultStatement> => ctx.vault.statement(req.query.date));

  // ----- fiziksel teslimat (10) ve rafinasyon (11) -----
  /** Motor hatasını sözleşmedeki red sebebiyle birlikte döner. */
  const guard = async (reply: any, fn: () => unknown) => {
    try { return fn(); }
    catch (e) {
      const f = e as FulfilmentError;
      return reply.code(f.code ?? 409).send({ error: f.message, ...(f.reason ? { reject_reason: f.reason } : {}) });
    }
  };

  app.post("/v1/deliveries", async (req, reply) => {
    const body = req.body as unknown;
    if (!Value.Check(DeliveryRequestBody, body)) {
      const err = [...Value.Errors(DeliveryRequestBody, body)][0];
      return reply.code(400).send({ error: `geçersiz teslimat talebi: ${err?.path ?? ""} ${err?.message ?? ""}`.trim(), reject_reason: "INVALID_QTY" });
    }
    return guard(reply, () => ctx.deliveries.request(body));
  });
  app.get<{ Params: { id: string } }>("/v1/deliveries/:id", async (req, reply) =>
    ctx.deliveries.get(req.params.id) ?? reply.code(404).send({ error: "teslimat talebi yok" }));
  app.post<{ Params: { id: string }; Body: { quote_id?: string } }>("/v1/deliveries/:id/approve", async (req, reply) =>
    guard(reply, () => ctx.deliveries.approve(req.params.id, req.body?.quote_id)));
  app.post<{ Params: { id: string }; Body: { reason?: string } }>("/v1/deliveries/:id/cancel", async (req, reply) =>
    guard(reply, () => ctx.deliveries.cancel(req.params.id, req.body?.reason?.trim() || "Kanzasset iptal etti", "kanzasset")));

  app.get("/v1/catalog", async (): Promise<Catalog> => ctx.catalog.get());

  app.post("/v1/refining", async (req, reply) => {
    const body = req.body as unknown;
    if (!Value.Check(RefiningRequestBody, body)) {
      const err = [...Value.Errors(RefiningRequestBody, body)][0];
      return reply.code(400).send({ error: `geçersiz rafinasyon talebi: ${err?.path ?? ""} ${err?.message ?? ""}`.trim(), reject_reason: "INVALID_QTY" });
    }
    return guard(reply, () => ctx.refining.request(body));
  });
  app.get<{ Params: { id: string } }>("/v1/refining/:id", async (req, reply) =>
    ctx.refining.get(req.params.id) ?? reply.code(404).send({ error: "rafinasyon talebi yok" }));
  app.post<{ Params: { id: string }; Body: { quote_id?: string } }>("/v1/refining/:id/approve", async (req, reply) =>
    guard(reply, () => ctx.refining.approve(req.params.id, req.body?.quote_id)));
  app.post<{ Params: { id: string }; Body: { reason?: string } }>("/v1/refining/:id/cancel", async (req, reply) =>
    guard(reply, () => ctx.refining.cancel(req.params.id, req.body?.reason?.trim() || "Kanzasset iptal etti", "kanzasset")));

  // ----- mahsuplaşma (12) -----
  /** Pencere açar; açık pencere varsa onu döner. İki taraf da çağırabilir. */
  app.post<{ Body: { trigger?: string; reason?: string; scope?: string[]; amounts?: RequestedAmounts } }>("/v1/settlements", async (req) => {
    const trigger = (req.body?.trigger as any) ?? "REQUEST_KZ";
    const s = ctx.settlement.open(trigger, req.body?.reason?.trim(), parseScope(req.body?.scope), req.body?.amounts);
    if (trigger === "REQUEST_KZ") ctx.notify("settlement.requested", "Kanzasset mahsuplaşma talep etti", req.body?.reason ?? "", s.settlement_id);
    return s;
  });
  app.get<{ Params: { id: string } }>("/v1/settlements/:id", async (req, reply) =>
    ctx.settlement.get(req.params.id) ?? reply.code(404).send({ error: "pencere yok" }));
  /** Mutabakat: KZ kendi ekstresinin özetini gönderir. */
  /** Altın teklifini onayla: kasa girişi talebi bundan sonra gelir (K1 güvencesi). */
  app.post<{ Params: { id: string } }>("/v1/settlements/:id/gold/approve", async (req, reply) => {
    try { return ctx.settlement.approveGold(req.params.id); }
    catch (e) { return reply.code((e as SettlementError).code ?? 409).send({ error: (e as Error).message }); }
  });

  app.post<{ Params: { id: string }; Body: { statement_hash?: string; gold_mg?: number; money?: { ccy: string; cents: number }[] } }>("/v1/settlements/:id/confirm", async (req, reply) => {
    const h = req.body?.statement_hash;
    if (!h) return reply.code(400).send({ error: "statement_hash zorunlu" });
    try { return ctx.settlement.confirm(req.params.id, h, { gold_mg: req.body?.gold_mg, money: req.body?.money }); }
    catch (e) { return reply.code((e as any).code ?? 409).send({ error: (e as Error).message }); }
  });
  app.post<{ Params: { id: string }; Body: { ccy?: string; amount_cents?: number; direction?: string; bank_ref?: string } }>("/v1/settlements/:id/payment-notice", async (req, reply) => {
    const b = req.body ?? {};
    if (!b.ccy || !b.bank_ref) return reply.code(400).send({ error: "ccy ve bank_ref zorunlu" });
    try { return ctx.settlement.paymentNotice(req.params.id, b.ccy, Number(b.amount_cents ?? 0), b.direction ?? "KZ_TO_AMR", b.bank_ref); }
    catch (e) { return reply.code((e as any).code ?? 409).send({ error: (e as Error).message }); }
  });
  app.post<{ Params: { id: string }; Body: { ccy?: string; bank_ref?: string } }>("/v1/settlements/:id/payment-received", async (req, reply) => {
    try { return ctx.settlement.paymentReceived(req.params.id, req.body?.ccy ?? "USD", req.body?.bank_ref); }
    catch (e) { return reply.code((e as any).code ?? 409).send({ error: (e as Error).message }); }
  });

  // ----- belgeler -----
  app.get<{ Params: { id: string } }>("/v1/documents/:id", async (req, reply) => {
    const d = getDocument(ctx.db, req.params.id);
    if (!d) return reply.code(404).send({ error: "belge yok" });
    markDocumentSent(ctx.db, req.params.id);
    return d;
  });
  /** Aynı belgenin PDF hâli (Kanzasset K4, K6, K7 ekranlarından indirir). */
  app.get<{ Params: { id: string } }>("/v1/documents/:id/pdf", async (req, reply) => {
    const d = getDocument(ctx.db, req.params.id);
    if (!d) return reply.code(404).send({ error: "belge yok" });
    markDocumentSent(ctx.db, req.params.id);
    return reply.header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="${d.meta.doc_id}.pdf"`)
      .send(documentPdf(d));
  });

  // WS fiyat yayını: ilk mesaj auth, 5 sn içinde gelmezse kapat
  app.get("/v1/prices", { websocket: true }, (socket) => {
    let authed = false;
    const timer = setTimeout(() => { if (!authed) socket.close(4401, "auth timeout"); }, 5000);
    socket.once("message", (raw) => {
      let msg: WsAuth | undefined;
      try { msg = JSON.parse(raw.toString()); } catch { /* yok */ }
      if (!msg || msg.type !== "auth") { socket.send(JSON.stringify({ type: "error", code: "AUTH_EXPECTED", message: "ilk mesaj auth olmalı" })); return socket.close(4401, "auth expected"); }
      const v = verify(ctx.db, msg.api_key, msg.ts, msg.sig, "GET", "/v1/prices");
      if (!v.ok) { socket.send(JSON.stringify({ type: "error", code: v.code, message: "kimlik doğrulanamadı" })); return socket.close(4401, v.code); }
      authed = true;
      clearTimeout(timer);
      ctx.publisher.addSubscriber(socket as any, v.client.name);
      ctx.notify("kz.connected", "Kanzasset fiyat soketine bağlandı", v.client.name);
      socket.on("close", () => ctx.notify("kz.disconnected", "Kanzasset fiyat soketi bağlantısı kapandı", v.client.name));
    });
  });
}
