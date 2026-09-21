/**
 * OpenAPI dışa aktarımı (Sprint 1: yalnız oturum durumu ve fiyat soketi şemaları).
 * Sonraki sprintlerde emir, kasa talimatı, teslimat, rafinasyon ve mahsuplaşma uçları eklenir.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as C from "../src/index.ts";

const doc = {
  openapi: "3.1.0",
  info: {
    title: "AMR uygulaması API",
    version: C.CONTRACT_VERSION,
    description:
      "Kanzasset ↔ AMR sözleşmesi. Kimlik: X-API-Key, X-Timestamp, X-Signature (HMAC-SHA256: ts + yöntem + yol + gövde). POST için Idempotency-Key.",
  },
  paths: {
    "/v1/session/status": {
      get: {
        summary: "Oturum durumu: yayın açık mı, merkez bağlı mı",
        responses: { "200": { description: "OK", content: { "application/json": { schema: C.SessionStatus } } } },
      },
    },
    "/v1/prices": {
      get: {
        summary: "WebSocket fiyat yayını (01). İlk mesaj auth; sonra subscribed, snapshot, tick, heartbeat, halt, resume.",
        responses: { "101": { description: "WebSocket" } },
      },
    },
  },
  components: {
    schemas: {
      SessionStatus: C.SessionStatus,
      Account: C.Account,
      PriceLevel: C.PriceLevel,
      WsAuth: C.WsAuth,
      WsSnapshot: C.WsSnapshot,
      WsTick: C.WsTick,
      WsHeartbeat: C.WsHeartbeat,
      WsHalt: C.WsHalt,
      WsResume: C.WsResume,
      OrderRequest: C.OrderRequest,
      OrderResponse: C.OrderResponse,
      VaultRequestBody: C.VaultRequestBody,
      VaultRequest: C.VaultRequest,
      EventEnvelope: C.EventEnvelope,
      RejectReason: C.RejectReason,
    },
  },
};

const out = resolve(import.meta.dirname, "../../../openapi.json");
writeFileSync(out, JSON.stringify(doc, null, 2));
console.log("openapi.json yazıldı:", out);
