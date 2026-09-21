/**
 * OpenAPI dışa aktarımı (Sprint 2: oturum, fiyat soketi, emirler, bakiye bilgisi, cari hesap ekstresi, belgeler, olaylar).
 * Sonraki sprintlerde kasa talimatı, teslimat, rafinasyon ve mahsuplaşma uçları eklenir. Çıktı: repo kökünde openapi.json.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as C from "../src/index.ts";

const json = (schema: unknown, description = "OK") => ({ description, content: { "application/json": { schema } } });
const authParams = [
  { name: "X-API-Key", in: "header", required: true, schema: { type: "string" } },
  { name: "X-Timestamp", in: "header", required: true, schema: { type: "string", format: "date-time" } },
  { name: "X-Signature", in: "header", required: true, schema: { type: "string" }, description: "HMAC-SHA256(secret, ts + METHOD + path + body) hex" },
];
const idem = { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } };

const doc = {
  openapi: "3.1.0",
  info: {
    title: "AMR uygulaması API",
    version: C.CONTRACT_VERSION,
    description:
      "Kanzasset ↔ AMR sözleşmesi. Kimlik: X-API-Key, X-Timestamp, X-Signature (HMAC-SHA256: ts + yöntem + yol + ham gövde). POST için Idempotency-Key. Miktarlar tam sayı (mg, cent), fiyatlar ondalık dize. Rafineri tarafında mint / burn / token kavramı yoktur.",
  },
  paths: {
    "/v1/session/status": { get: { summary: "Oturum durumu: yayın açık mı, merkez bağlı mı", parameters: authParams, responses: { "200": json(C.SessionStatus) } } },
    "/v1/prices": { get: { summary: "WebSocket fiyat yayını (01). İlk mesaj auth; sonra subscribed, snapshot, tick, heartbeat, halt, resume.", responses: { "101": { description: "WebSocket" } } } },
    "/v1/orders": {
      post: {
        summary: "Alış / satış emri (03, 04, 07, 08, 09). FOK: tümü ya hiç. Aynı client_order_id ile tekrar aynı cevabı alır.",
        parameters: [...authParams, idem],
        requestBody: { required: true, content: { "application/json": { schema: C.OrderRequest } } },
        responses: { "200": json(C.OrderResponse, "FILLED / REJECTED / CANCELLED; FILLED cevabında account (bakiye bilgisi) ve alışta allocation_certificate"), "400": { description: "geçersiz emir" }, "401": { description: "kimlik" }, "409": { description: "client_order_id başka gövdeyle kullanıldı (DUPLICATE_ORDER)" } },
      },
    },
    "/v1/orders/{id}": { get: { summary: "Durum sorgusu (order_id ya da client_order_id)", parameters: [...authParams, { name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": json(C.OrderResponse), "404": { description: "emir yok" } } } },
    "/v1/orders/{id}/cancel": { post: { summary: "İptal talebi, kesin cevap: işlenmemişse CANCELLED, işlenmişse mevcut sonuç (FILLED = geç fill)", parameters: [...authParams, idem, { name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": json(C.OrderResponse), "404": { description: "emir yok" } } } },
    "/v1/account": { get: { summary: "Bakiye bilgisi, anlık fotoğraf (02)", parameters: authParams, responses: { "200": json(C.Account) } } },
    "/v1/current-account/statement": { get: { summary: "Cari hesap ekstresi (12, adım 1): hareketler, T, kur bazında para, hizmet bedelleri, imza", parameters: [...authParams, { name: "from", in: "query", schema: { type: "string", format: "date-time" } }, { name: "to", in: "query", schema: { type: "string", format: "date-time" } }], responses: { "200": json(C.CurrentAccountStatement) } } },
    "/v1/documents/{id}": { get: { summary: "Belge: Tahsis Belgesi, fişler, ekstreler (JSON içerik + sha256 + HMAC imza; PDF Sprint 3)", parameters: [...authParams, { name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": json(C.Document), "404": { description: "belge yok" } } } },
  },
  webhooks: {
    event: {
      post: {
        summary: "AMR → KZ olay teslimi (06). KZ olay adresine POST; imza başlıkları REST ile aynı; Idempotency-Key = event_id. 2xx değilse üstel bekleme ile tekrar.",
        requestBody: { required: true, content: { "application/json": { schema: C.EventEnvelope } } },
        responses: { "200": { description: "alındı" } },
        description: `Olay türleri: ${C.EVENT_TYPES.join(", ")}`,
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
      OrderStatus: C.OrderStatus,
      RejectReason: C.RejectReason,
      Movement: C.Movement,
      CurrentAccountStatement: C.CurrentAccountStatement,
      Document: C.Document,
      DocumentMeta: C.DocumentMeta,
      VaultRequestBody: C.VaultRequestBody,
      VaultRequest: C.VaultRequest,
      EventEnvelope: C.EventEnvelope,
    },
  },
};

const out = resolve(import.meta.dirname, "../../../openapi.json");
writeFileSync(out, JSON.stringify(doc, null, 2));
console.log("openapi.json yazıldı:", out);
