/**
 * OpenAPI dışa aktarımı (Sprint 5: oturum, fiyat soketi, emirler, bakiye bilgisi, cari hesap ekstresi,
 * kasa talimatları ve günlük kasa ekstresi, fiziksel teslimat, katalog ve rafinasyon, mahsuplaşma, belgeler, olaylar).
 * mahsuplaşma ve belge PDF'i dahil bütün uçlar. Çıktı: repo kökünde openapi.json.
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
    "/v1/vault/in": {
      post: {
        summary: "Kasa girişi talebi (05): cari hesaptaki gramı kasa hesabına taşır. Kabulde Kasa Giriş Fişi üretilir (mint dayanağı, K4).",
        parameters: [...authParams, idem],
        requestBody: { required: true, content: { "application/json": { schema: C.VaultRequestBody } } },
        responses: { "200": json(C.VaultRequest, "REQUESTED (otomatik kabul açıksa ACCEPTED); aynı ref ile tekrar aynı talebi döner"), "400": { description: "geçersiz miktar" }, "409": { description: "cari hesap altını yetersiz (INSUFFICIENT_CURRENT_ACCOUNT) ya da ref başka talepte kullanıldı" } },
      },
    },
    "/v1/vault/out": {
      post: {
        summary: "Kasa çıkışı talebi (06): kasa hesabındaki gramı cari hesaba taşır. Kabulde Kasa Çıkış Fişi üretilir ve talep biter.",
        parameters: [...authParams, idem],
        requestBody: { required: true, content: { "application/json": { schema: C.VaultRequestBody } } },
        responses: { "200": json(C.VaultRequest, "REQUESTED (otomatik kabul açıksa ACCEPTED)"), "400": { description: "geçersiz miktar" }, "409": { description: "kasada yetersiz (INSUFFICIENT_VAULT); kasaya konuluyor sayılmaz" } },
      },
    },
    "/v1/vault/requests/{id}": { get: { summary: "Kasa talimatı durumu ve geçmişi (request_id ya da KZ referansı ile)", parameters: [...authParams, { name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": json(C.VaultRequest), "404": { description: "talep yok" } } } },
    "/v1/vault/statement": { get: { summary: "Günlük kasa ekstresi (rezerv kanıtı, V ≥ A): alt kalemler, hareketler, fiş referansları, imza", parameters: [...authParams, { name: "date", in: "query", schema: { type: "string" }, description: "YYYY-MM-DD; verilmezse bugün" }], responses: { "200": json(C.VaultStatement) } } },
    "/v1/deliveries": {
      post: {
        summary: "Fiziksel teslimat talebi (10): gram · adres referansı · sigorta lehtarı referansı. Kasada yeterli gram yoksa red.",
        parameters: [...authParams, idem],
        requestBody: { required: true, content: { "application/json": { schema: C.DeliveryRequestBody } } },
        responses: { "200": json(C.Delivery, "REQUESTED; aynı ref ile tekrar aynı talebi döner"), "400": { description: "geçersiz talep" }, "409": { description: "kasada yetersiz (INSUFFICIENT_VAULT)" } },
      },
    },
    "/v1/deliveries/{id}": { get: { summary: "Teslimat durumu ve geçmişi", parameters: [...authParams, { name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": json(C.Delivery), "404": { description: "talep yok" } } } },
    "/v1/deliveries/{id}/approve": { post: { summary: "Lojistik teklifini onayla (yalnız QUOTED iken ve teklif geçerliyken); onayla lojistik bedeli cari hesaba kalem olur", parameters: [...authParams, idem, { name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: { content: { "application/json": { schema: { type: "object", properties: { quote_id: { type: "string" } } } } } }, responses: { "200": json(C.Delivery), "409": { description: "durum ya da teklif süresi (QUOTE_EXPIRED)" } } } },
    "/v1/deliveries/{id}/cancel": { post: { summary: "Teslimat iptali (sevkiyattan önce); READY'den iptalde külçe kasaya döner", parameters: [...authParams, idem, { name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": json(C.Delivery), "409": { description: "durum uygun değil" } } } },
    "/v1/catalog": { get: { summary: "Rafinasyon ürün kataloğu (11): ürün · gramaj · ayar · tarife · üretim süresi. Değişince catalog.updated olayı gider.", parameters: authParams, responses: { "200": json(C.Catalog) } } },
    "/v1/refining": {
      post: {
        summary: "Rafinasyon talebi (11): katalog kalemleri × adet. Kasada toplam saf gram yeterli olmalı.",
        parameters: [...authParams, idem],
        requestBody: { required: true, content: { "application/json": { schema: C.RefiningRequestBody } } },
        responses: { "200": json(C.Refining, "REQUESTED · total_mg hesaplanır"), "400": { description: "geçersiz kalem" }, "409": { description: "kasada yetersiz (INSUFFICIENT_VAULT)" } },
      },
    },
    "/v1/refining/{id}": { get: { summary: "Rafinasyon durumu ve geçmişi", parameters: [...authParams, { name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": json(C.Refining), "404": { description: "talep yok" } } } },
    "/v1/refining/{id}/approve": { post: { summary: "Rafinasyon teklifini onayla (yalnız QUOTED iken); onayla ürün bedeli + lojistik cari hesaba kalem olur", parameters: [...authParams, idem, { name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: { content: { "application/json": { schema: { type: "object", properties: { quote_id: { type: "string" } } } } } }, responses: { "200": json(C.Refining), "409": { description: "durum ya da teklif süresi (QUOTE_EXPIRED)" } } } },
    "/v1/refining/{id}/cancel": { post: { summary: "Rafinasyon iptali (üretime girmeden)", parameters: [...authParams, idem, { name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": json(C.Refining), "409": { description: "durum uygun değil" } } } },
    "/v1/settlements": {
      post: {
        summary: "Mahsuplaşma penceresi aç ya da açık pencereyi al (12). İki taraf da çağırabilir; kesim saatinde rafineri kendiliğinden açar.",
        parameters: [...authParams, idem],
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { trigger: { type: "string", enum: ["CUTOFF", "REQUEST_KZ", "REQUEST_AMR", "LIMIT"] }, reason: { type: "string" } } } } } },
        responses: { "200": json(C.Settlement, "OPEN ya da DRAFT; açık pencere varsa o döner") },
      },
    },
    "/v1/settlements/{id}": { get: { summary: "Pencere durumu: ekstre, altın bacağı, kur bazında para bacağı", parameters: [...authParams, { name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": json(C.Settlement), "404": { description: "pencere yok" } } } },
    "/v1/settlements/{id}/confirm": { post: { summary: "Mutabakat: KZ kendi ekstresinin özetini ve toplamlarını gönderir. Eşitse RECONCILED, değilse MISMATCH ve diffs.", parameters: [...authParams, idem, { name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["statement_hash"], properties: { statement_hash: { type: "string" }, gold_mg: { type: "integer" }, money: { type: "array", items: { type: "object", properties: { ccy: { type: "string" }, cents: { type: "integer" } } } } } } } } }, responses: { "200": json(C.Settlement) } } },
    "/v1/settlements/{id}/payment-notice": { post: { summary: "Ödeme bildirimi: ödeyen taraf banka referansıyla bildirir", parameters: [...authParams, idem, { name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["ccy", "bank_ref"], properties: { ccy: { type: "string" }, amount_cents: { type: "integer" }, direction: { type: "string" }, bank_ref: { type: "string" } } } } } }, responses: { "200": json(C.Settlement, "PAYMENT_PENDING") } } },
    "/v1/settlements/{id}/payment-received": { post: { summary: "Ödeme alındı: alan taraf onaylar; bütün kurlar ve altın bacağı kapanınca SETTLED ve limit sayaçları sıfırlanır", parameters: [...authParams, idem, { name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: { content: { "application/json": { schema: { type: "object", properties: { ccy: { type: "string" }, bank_ref: { type: "string" } } } } } }, responses: { "200": json(C.Settlement) } } },
    "/v1/documents/{id}": { get: { summary: "Belge: Tahsis Belgesi, Kasa Giriş / Çıkış Fişi, teklifler, fişler, ekstreler (JSON içerik + sha256 + HMAC imza)", parameters: [...authParams, { name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": json(C.Document), "404": { description: "belge yok" } } } },
    "/v1/documents/{id}/pdf": { get: { summary: "Aynı belgenin PDF hâli (A4, rafineri başlığı, belge no, imza özeti)", parameters: [...authParams, { name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "PDF", content: { "application/pdf": { schema: { type: "string", format: "binary" } } } }, "404": { description: "belge yok" } } } },
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
      VaultRequestStatus: C.VaultRequestStatus,
      VaultStatement: C.VaultStatement,
      DeliveryRequestBody: C.DeliveryRequestBody,
      Delivery: C.Delivery,
      DeliveryStatus: C.DeliveryStatus,
      LogisticsQuote: C.LogisticsQuote,
      Catalog: C.Catalog,
      CatalogItem: C.CatalogItem,
      RefiningRequestBody: C.RefiningRequestBody,
      Refining: C.Refining,
      RefiningStatus: C.RefiningStatus,
      RefiningQuote: C.RefiningQuote,
      Settlement: C.Settlement,
      SettlementStatus: C.SettlementStatus,
      SettlementTrigger: C.SettlementTrigger,
      SettlementGoldLeg: C.SettlementGoldLeg,
      SettlementMoneyLeg: C.SettlementMoneyLeg,
      EventEnvelope: C.EventEnvelope,
    },
  },
};

const out = resolve(import.meta.dirname, "../../../openapi.json");
writeFileSync(out, JSON.stringify(doc, null, 2));
console.log("openapi.json yazıldı:", out);
