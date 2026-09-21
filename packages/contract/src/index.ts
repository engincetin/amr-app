/**
 * Kanzasset ↔ AMR sözleşmesi (v2.0, 21 Eylül 2026)
 *
 * Tek kaynak: fiyat soketi mesajları, REST şemaları, bakiye bilgisi, red sebepleri.
 * Kurallar: miktarlar tam sayı (mg, cent); fiyatlar ondalık dize ("142.00");
 * zaman ISO 8601 UTC; rafineri tarafında mint / burn / token kavramı yok.
 */
import { Type, type Static } from "@sinclair/typebox";

// ---------- Temel tipler ----------
export const Ccy = Type.Union([Type.Literal("USD"), Type.Literal("EUR"), Type.Literal("AED")]);
export type Ccy = Static<typeof Ccy>;
export const CCYS: Ccy[] = ["USD", "EUR", "AED"];

export const IsoTs = Type.String({ description: "ISO 8601 UTC" });
export const Decimal = Type.String({ pattern: "^-?\\d+(\\.\\d+)?$", description: "ondalık dize, ör. \"142.00\"" });

// ---------- Fiyat soketi (01) ----------
export const PriceLevel = Type.Object({
  ccy: Ccy,
  bid: Decimal,
  ask: Decimal,
});
export type PriceLevel = Static<typeof PriceLevel>;

export const WsAuth = Type.Object({
  type: Type.Literal("auth"),
  api_key: Type.String(),
  ts: IsoTs,
  sig: Type.String({ description: "HMAC-SHA256(secret, ts + 'GET' + '/v1/prices') hex" }),
});
export const WsSubscribed = Type.Object({ type: Type.Literal("subscribed"), ts: IsoTs });
export const WsSnapshot = Type.Object({
  type: Type.Literal("snapshot"),
  seq: Type.Integer(),
  ts: IsoTs,
  tradable: Type.Boolean(),
  prices: Type.Array(PriceLevel),
});
export const WsTick = Type.Object({
  type: Type.Literal("tick"),
  seq: Type.Integer(),
  ts: IsoTs,
  tradable: Type.Boolean(),
  prices: Type.Array(PriceLevel),
});
export const WsHeartbeat = Type.Object({
  type: Type.Literal("heartbeat"),
  seq: Type.Integer(),
  ts: IsoTs,
  tradable: Type.Boolean(),
});
export const WsHalt = Type.Object({
  type: Type.Literal("halt"),
  ts: IsoTs,
  reason: Type.String(),
});
export const WsResume = Type.Object({
  type: Type.Literal("resume"),
  seq: Type.Integer(),
  ts: IsoTs,
});
export const WsError = Type.Object({
  type: Type.Literal("error"),
  code: Type.String(),
  message: Type.String(),
});
export const WsServerMessage = Type.Union([WsSubscribed, WsSnapshot, WsTick, WsHeartbeat, WsHalt, WsResume, WsError]);
export type WsServerMessage = Static<typeof WsServerMessage>;
export type WsAuth = Static<typeof WsAuth>;

export const PRICE_SOCKET = {
  path: "/v1/prices",
  heartbeatMs: 5_000, // 5 sn tick yoksa heartbeat
  staleMs: 10_000, // 10 sn hiçbir mesaj yok → fiyat bayat (KZ tarafı kuralı)
  maxTickRateMs: 1_000, // saniyede en fazla ~1 tick
  authSkewMs: 5 * 60_000,
} as const;

// ---------- Oturum durumu ----------
export const SessionStatus = Type.Object({
  status: Type.Union([Type.Literal("OPEN"), Type.Literal("HALTED"), Type.Literal("MAINTENANCE")]),
  tradable: Type.Boolean(),
  source_connected: Type.Boolean({ description: "merkez bağlantısı" }),
  halt_reason: Type.Optional(Type.String()),
  ts: IsoTs,
});
export type SessionStatus = Static<typeof SessionStatus>;

// ---------- Bakiye bilgisi (02) ----------
export const MoneyBalance = Type.Object({ ccy: Ccy, cents: Type.Integer({ description: "eksi = Kanzasset borçlu, artı = rafineri borçlu" }) });
export const Account = Type.Object({
  seq: Type.Integer({ description: "hesap hareket numarası (fiyat seq'inden ayrı)" }),
  vault: Type.Object({
    in_vault_mg: Type.Integer({ description: "kasada" }),
    placing_mg: Type.Integer({ description: "kasaya konuluyor (kabul edildi, en geç T+3)" }),
    shipping_mg: Type.Integer({ description: "sevkiyatta (çıktı, henüz teslim edilmedi)" }),
  }),
  current_account: Type.Object({
    gold_mg: Type.Integer({ description: "T: artı = aldık, kasaya konmadı; eksi = sattık, kasadan çıkmadı" }),
    money: Type.Array(MoneyBalance),
  }),
  status: Type.Union([Type.Literal("OK"), Type.Literal("RECONCILE"), Type.Literal("HALTED")]),
});
export type Account = Static<typeof Account>;

// ---------- Emirler (03, 04, 07, 08, 09) ----------
export const Side = Type.Union([Type.Literal("BUY"), Type.Literal("SELL")]);
export const RejectReason = Type.Union([
  Type.Literal("PRICE_OUTSIDE_LIMIT"),
  Type.Literal("STALE_QUOTE"),
  Type.Literal("TRADING_HALTED"),
  Type.Literal("CURRENT_ACCOUNT_LIMIT"),
  Type.Literal("DUPLICATE_ORDER"),
  Type.Literal("INVALID_QTY"),
  Type.Literal("INSUFFICIENT_CURRENT_ACCOUNT"),
  Type.Literal("INSUFFICIENT_VAULT"),
  Type.Literal("QUOTE_EXPIRED"),
  Type.Literal("INTERNAL_ERROR"),
]);
export type RejectReason = Static<typeof RejectReason>;

export const OrderRequest = Type.Object({
  client_order_id: Type.String({ description: "KZ tarafında tekil; aynı id ile tekrar gelen istek aynı cevabı alır" }),
  side: Side,
  qty_mg: Type.Integer({ minimum: 1 }),
  ccy: Ccy,
  quote_seq: Type.Integer({ description: "emrin dayandığı fiyat tick'i" }),
  limit_px: Decimal,
  tif: Type.Literal("FOK"),
  time_limit_ms: Type.Integer({ minimum: 100 }),
});
export const Fill = Type.Object({
  px: Decimal,
  qty_mg: Type.Integer(),
  amount_cents: Type.Integer(),
  ccy: Ccy,
  trade_ts: IsoTs,
});
export const OrderStatus = Type.Union([
  Type.Literal("RECEIVED"),
  Type.Literal("CANCEL_REQUESTED"),
  Type.Literal("FILLED"),
  Type.Literal("REJECTED"),
  Type.Literal("CANCELLED"),
]);
export type OrderStatus = Static<typeof OrderStatus>;
export const OrderResponse = Type.Object({
  order_id: Type.String(),
  client_order_id: Type.String(),
  status: OrderStatus,
  side: Side,
  qty_mg: Type.Integer(),
  ccy: Ccy,
  quote_seq: Type.Integer(),
  limit_px: Decimal,
  fill: Type.Optional(Fill),
  reject_reason: Type.Optional(RejectReason),
  allocation_certificate: Type.Optional(Type.Object({ doc_id: Type.String(), url: Type.String() })),
  account: Type.Optional(Account),
  received_ts: IsoTs,
  decided_ts: Type.Optional(IsoTs),
  history: Type.Optional(Type.Array(Type.Object({ status: OrderStatus, ts: IsoTs, note: Type.Optional(Type.String()) }))),
});
export type OrderRequest = Static<typeof OrderRequest>;
export type OrderResponse = Static<typeof OrderResponse>;

export const ORDER_RULES = {
  quoteMaxAgeMs: 10_000, // quote_seq tick'i bundan eskiyse STALE_QUOTE
  minQtyMg: 1, // 0,001 g
} as const;

// ---------- Cari hesap ekstresi (12, adım 1) ----------
export const MovementType = Type.Union([
  Type.Literal("OPENING"),
  Type.Literal("FILL_BUY"),
  Type.Literal("FILL_SELL"),
  Type.Literal("VAULT_IN"),
  Type.Literal("VAULT_OUT"),
  Type.Literal("FEE_DELIVERY"),
  Type.Literal("FEE_REFINING"),
  Type.Literal("SETTLEMENT_PAYMENT"),
]);
export const Movement = Type.Object({
  id: Type.Integer(),
  seq: Type.Integer(),
  type: MovementType,
  gold_mg: Type.Integer({ description: "işaretli" }),
  ccy: Type.Optional(Ccy),
  amount_cents: Type.Optional(Type.Integer({ description: "işaretli: eksi Kanzasset borçlu" })),
  ref: Type.Optional(Type.String()),
  related_id: Type.Optional(Type.String()),
  ts: IsoTs,
});
export type Movement = Static<typeof Movement>;
export const CurrentAccountStatement = Type.Object({
  window_from: IsoTs,
  window_to: IsoTs,
  movements: Type.Array(Movement),
  gold_mg: Type.Integer(),
  money: Type.Array(MoneyBalance),
  fees: Type.Array(Type.Object({ type: Type.String(), ccy: Ccy, amount_cents: Type.Integer() })),
  hash: Type.String(),
  signature: Type.String(),
});
export type CurrentAccountStatement = Static<typeof CurrentAccountStatement>;

// ---------- Belgeler ----------
export const DocumentType = Type.Union([
  Type.Literal("ALLOCATION_CERTIFICATE"),
  Type.Literal("VAULT_IN_SLIP"),
  Type.Literal("VAULT_OUT_SLIP"),
  Type.Literal("LOGISTICS_QUOTE"),
  Type.Literal("REFINING_QUOTE"),
  Type.Literal("SHIPPING_SLIP"),
  Type.Literal("DELIVERY_RECORD"),
  Type.Literal("VAULT_STATEMENT"),
  Type.Literal("CURRENT_ACCOUNT_STATEMENT"),
  Type.Literal("SETTLEMENT_STATEMENT"),
]);
export const DocumentMeta = Type.Object({
  doc_id: Type.String(),
  type: DocumentType,
  related_id: Type.String(),
  hash: Type.String({ description: "sha256(content)" }),
  signature: Type.String({ description: "HMAC-SHA256(rafineri belge anahtarı, hash)" }),
  created_ts: IsoTs,
  sent_ts: Type.Optional(IsoTs),
});
export const Document = Type.Object({ meta: DocumentMeta, content: Type.Record(Type.String(), Type.Unknown()) });
export type Document = Static<typeof Document>;

// ---------- Kasa talimatı (05, 06) ----------
export const VaultRequestBody = Type.Object({
  qty_mg: Type.Integer({ minimum: 1 }),
  ref: Type.String({ description: "Kanzasset referans numarası" }),
});
/** Giriş: REQUESTED → ACCEPTED → PLACING → PLACED (en geç T+3; geçerse OVERDUE). Çıkış: REQUESTED → ACCEPTED ile biter. */
export const VaultRequestStatus = Type.Union([
  Type.Literal("REQUESTED"),
  Type.Literal("ACCEPTED"),
  Type.Literal("PLACING"),
  Type.Literal("PLACED"),
  Type.Literal("OVERDUE"),
  Type.Literal("REJECTED"),
]);
export type VaultRequestStatus = Static<typeof VaultRequestStatus>;
export const VaultRequest = Type.Object({
  request_id: Type.String(),
  type: Type.Union([Type.Literal("IN"), Type.Literal("OUT")]),
  qty_mg: Type.Integer(),
  ref: Type.String(),
  status: VaultRequestStatus,
  doc_id: Type.Optional(Type.String({ description: "Kasa Giriş / Çıkış Fişi" })),
  reject_reason: Type.Optional(Type.String()),
  requested_ts: IsoTs,
  accepted_ts: Type.Optional(IsoTs),
  placing_ts: Type.Optional(IsoTs),
  placed_ts: Type.Optional(IsoTs),
  due_ts: Type.Optional(Type.String({ description: "kasaya koyma vadesi: kabul + T+3 (ISO 8601 UTC)" })),
  history: Type.Optional(Type.Array(Type.Object({ status: VaultRequestStatus, ts: IsoTs, note: Type.Optional(Type.String()) }))),
});
export type VaultRequest = Static<typeof VaultRequest>;

/** Günlük kasa ekstresi (rezerv kanıtı, V ≥ A): alt kalemler, hareketler, fiş referansları, imza. */
export const VaultStatement = Type.Object({
  date: Type.String({ description: "YYYY-MM-DD" }),
  opening: Type.Object({ in_vault_mg: Type.Integer(), placing_mg: Type.Integer(), shipping_mg: Type.Integer() }),
  closing: Type.Object({ in_vault_mg: Type.Integer(), placing_mg: Type.Integer(), shipping_mg: Type.Integer() }),
  total_mg: Type.Integer({ description: "V = kasada + kasaya konuluyor + sevkiyatta (gün sonu)" }),
  movements: Type.Array(Type.Object({
    seq: Type.Integer(),
    type: Type.String(),
    in_vault_mg: Type.Integer(), placing_mg: Type.Integer(), shipping_mg: Type.Integer(),
    related_id: Type.Optional(Type.String()),
    doc_id: Type.Optional(Type.String()),
    ts: IsoTs,
  })),
  slips: Type.Array(Type.Object({ doc_id: Type.String(), type: Type.String(), related_id: Type.String(), created_ts: IsoTs })),
  hash: Type.String(),
  signature: Type.String(),
});
export type VaultStatement = Static<typeof VaultStatement>;

// ---------- Fiziksel teslimat (10) ----------
export const DeliveryStatus = Type.Union([
  Type.Literal("REQUESTED"), Type.Literal("QUOTED"), Type.Literal("APPROVED"), Type.Literal("PREPARING"),
  Type.Literal("READY"), Type.Literal("SHIPPED"), Type.Literal("DELIVERED"), Type.Literal("CANCELLED"), Type.Literal("FAILED"),
]);
export type DeliveryStatus = Static<typeof DeliveryStatus>;

export const DeliveryRequestBody = Type.Object({
  qty_mg: Type.Integer({ minimum: 1, description: "standart külçe toplamı" }),
  address_ref: Type.String({ description: "adres referansı; müşteri adı taşımaz, KZ tarafında çözülür" }),
  insured_party_ref: Type.String({ description: "taşıma sigortası lehtarı referansı" }),
  ref: Type.String({ description: "Kanzasset referans numarası" }),
});

/** Lojistik Teklifi: rafineri taşıyıcıdan aldığı fiyatı girer, KZ onaylar (varsayılan geçerlilik 24 sa). */
export const LogisticsQuote = Type.Object({
  quote_id: Type.String(),
  carrier: Type.String(),
  amount_cents: Type.Integer({ minimum: 0 }),
  ccy: Ccy,
  valid_until: IsoTs,
  doc_id: Type.Optional(Type.String()),
});
export type LogisticsQuote = Static<typeof LogisticsQuote>;

export const Delivery = Type.Object({
  delivery_id: Type.String(),
  qty_mg: Type.Integer(),
  address_ref: Type.String(),
  insured_party_ref: Type.String(),
  ref: Type.String(),
  status: DeliveryStatus,
  quote: Type.Optional(LogisticsQuote),
  carrier: Type.Optional(Type.String()),
  tracking_no: Type.Optional(Type.String()),
  shipping_doc_id: Type.Optional(Type.String({ description: "Sevkiyat Fişi" })),
  pod_doc_id: Type.Optional(Type.String({ description: "Teslimat Kaydı" })),
  reject_reason: Type.Optional(Type.String()),
  requested_ts: IsoTs,
  history: Type.Optional(Type.Array(Type.Object({ status: DeliveryStatus, ts: IsoTs, note: Type.Optional(Type.String()) }))),
});
export type Delivery = Static<typeof Delivery>;

// ---------- Rafinasyon (11) ----------
export const CatalogItem = Type.Object({
  item_id: Type.String(),
  name: Type.String(),
  weight_mg: Type.Integer({ minimum: 1, description: "ürünün saf gramajı" }),
  fineness: Type.String({ description: "ayar, ör. 999.9" }),
  unit_price_cents: Type.Integer({ minimum: 0, description: "kalem başına tarife (işçilik)" }),
  ccy: Ccy,
  lead_time_days: Type.Integer({ minimum: 0 }),
  active: Type.Boolean(),
});
export type CatalogItem = Static<typeof CatalogItem>;
export const Catalog = Type.Object({ version: Type.Integer(), items: Type.Array(CatalogItem), updated_ts: IsoTs });
export type Catalog = Static<typeof Catalog>;

export const RefiningStatus = Type.Union([
  Type.Literal("REQUESTED"), Type.Literal("QUOTED"), Type.Literal("APPROVED"), Type.Literal("IN_PRODUCTION"),
  Type.Literal("READY"), Type.Literal("SHIPPED"), Type.Literal("DELIVERED"), Type.Literal("CANCELLED"), Type.Literal("FAILED"),
]);
export type RefiningStatus = Static<typeof RefiningStatus>;

export const RefiningRequestBody = Type.Object({
  items: Type.Array(Type.Object({ item_id: Type.String(), qty: Type.Integer({ minimum: 1 }) }), { minItems: 1 }),
  address_ref: Type.String(),
  insured_party_ref: Type.String(),
  ref: Type.String(),
});

/** Rafinasyon Teklifi: ürün bedeli + lojistik, üretim süresi (varsayılan geçerlilik 48 sa). */
export const RefiningQuote = Type.Object({
  quote_id: Type.String(),
  product_cents: Type.Integer({ minimum: 0 }),
  logistics_cents: Type.Integer({ minimum: 0 }),
  ccy: Ccy,
  lead_time_days: Type.Integer({ minimum: 0 }),
  carrier: Type.Optional(Type.String()),
  valid_until: IsoTs,
  doc_id: Type.Optional(Type.String()),
});
export type RefiningQuote = Static<typeof RefiningQuote>;

export const Refining = Type.Object({
  refining_id: Type.String(),
  items: Type.Array(Type.Object({ item_id: Type.String(), name: Type.String(), qty: Type.Integer(), weight_mg: Type.Integer() })),
  total_mg: Type.Integer({ description: "ürünlerin toplam saf gramı" }),
  address_ref: Type.String(),
  insured_party_ref: Type.String(),
  ref: Type.String(),
  status: RefiningStatus,
  quote: Type.Optional(RefiningQuote),
  carrier: Type.Optional(Type.String()),
  tracking_no: Type.Optional(Type.String()),
  shipping_doc_id: Type.Optional(Type.String()),
  pod_doc_id: Type.Optional(Type.String()),
  reject_reason: Type.Optional(Type.String()),
  requested_ts: IsoTs,
  history: Type.Optional(Type.Array(Type.Object({ status: RefiningStatus, ts: IsoTs, note: Type.Optional(Type.String()) }))),
});
export type Refining = Static<typeof Refining>;

/** Teklif geçerlilik süreleri (Parametreler): lojistik 24 sa, rafinasyon 48 sa. */
export const QUOTE_RULES = { deliveryValidHours: 24, refiningValidHours: 48 } as const;

// ---------- Olay zarfı (06) ----------
export const EVENT_TYPES = [
  "order.filled", "order.rejected", "order.cancelled",
  "vault.in_accepted", "vault.in_placing", "vault.in_placed", "vault.in_overdue", "vault.in_rejected",
  "vault.out_accepted", "vault.out_rejected",
  "delivery.quoted", "delivery.approved", "delivery.preparing", "delivery.ready", "delivery.shipped", "delivery.delivered", "delivery.cancelled", "delivery.failed",
  "catalog.updated",
  "refining.quoted", "refining.approved", "refining.in_production", "refining.ready", "refining.shipped", "refining.delivered", "refining.cancelled", "refining.failed",
  "settlement.requested", "settlement.opened", "settlement.statement", "settlement.reconciled", "settlement.mismatch", "settlement.payment_notice", "settlement.settled",
  "price.halt", "price.resume",
  "account.reconcile",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const EventEnvelope = Type.Object({
  event_id: Type.String({ description: "tekil; KZ tekrarı bununla ayıklar" }),
  type: Type.String(),
  ts: IsoTs,
  seq: Type.Optional(Type.Integer({ description: "hesap seq; metal hareketi varsa" })),
  data: Type.Unknown(),
  account: Type.Optional(Account),
});
export type EventEnvelope = Static<typeof EventEnvelope>;
/** Olay teslimi: KZ olay adresine POST, imza başlıkları REST ile aynı (path = olay adresinin yolu). 2xx değilse üstel bekleme. */
export const EVENT_DELIVERY = { path: "/api/events", retryScheduleMs: [60_000, 300_000, 1_800_000, 7_200_000], giveUpAfterMs: 86_400_000 } as const;

// ---------- Yardımcılar ----------
/** HMAC imza metni: ts + method + path + body */
export function signingString(ts: string, method: string, path: string, body = ""): string {
  return `${ts}${method.toUpperCase()}${path}${body}`;
}

export const CONTRACT_VERSION = "2.0.0";
