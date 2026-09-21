/**
 * Kanzasset'e açık uçlar (sözleşme, Sistem 05):
 *   GET  /v1/session/status                         oturum ve yayın durumu
 *   WS   /v1/prices                                 fiyat yayını (ilk mesaj auth)
 *   POST /v1/orders · GET /v1/orders/:id · POST /v1/orders/:id/cancel   emir (03, 04), durum sorgusu, iptal (Cevapsız emir)
 *   GET  /v1/account                                bakiye bilgisi, anlık fotoğraf (02)
 *   GET  /v1/current-account/statement?from=&to=    cari hesap ekstresi (12, adım 1)
 *   POST /v1/vault/in · POST /v1/vault/out          kasa talimatı (05, 06) · GET /v1/vault/requests/:id
 *   GET  /v1/vault/statement?date=                  günlük kasa ekstresi, rezerv kanıtı (Kontroller)
 *   GET  /v1/documents/:id                          Tahsis Belgesi ve fişler (JSON)
 * Sonraki sprintler: /v1/deliveries, /v1/catalog, /v1/refining, /v1/settlements
 */
import type { FastifyInstance } from "fastify";
import { OrderRequest, VaultRequestBody, type CurrentAccountStatement, type SessionStatus, type VaultStatement, type WsAuth } from "@amr/contract";
import { Value } from "@sinclair/typebox/value";
import type { AppContext } from "../context.ts";
import { verify } from "../auth.ts";
import { currentAccountBalance, getDocument, listCurrentAccountMovements, markDocumentSent, signContent } from "../ledger.ts";

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

  // ----- belgeler -----
  app.get<{ Params: { id: string } }>("/v1/documents/:id", async (req, reply) => {
    const d = getDocument(ctx.db, req.params.id);
    if (!d) return reply.code(404).send({ error: "belge yok" });
    markDocumentSent(ctx.db, req.params.id);
    return d;
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
