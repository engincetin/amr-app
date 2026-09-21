/**
 * Kanzasset'e açık uçlar (sözleşme): GET /v1/session/status · WS /v1/prices
 * Sonraki sprintler: /v1/orders, /v1/vault/in|out, /v1/deliveries, /v1/catalog, /v1/refining, /v1/account, /v1/settlements, /v1/documents
 */
import type { FastifyInstance } from "fastify";
import type { SessionStatus, WsAuth } from "@amr/contract";
import type { AppContext } from "../context.ts";
import { verify } from "../auth.ts";

export async function kzRoutes(app: FastifyInstance, ctx: AppContext) {
  // REST kimlik doğrulama kancası (yalnız /v1/*)
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/v1/") || req.url.startsWith("/v1/prices")) return;
    const body = req.body ? JSON.stringify(req.body) : "";
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
