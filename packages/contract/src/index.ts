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
  client_order_id: Type.String(),
  side: Side,
  qty_mg: Type.Integer({ minimum: 1 }),
  ccy: Ccy,
  quote_seq: Type.Integer(),
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
export const OrderResponse = Type.Object({
  order_id: Type.String(),
  client_order_id: Type.String(),
  status: Type.Union([Type.Literal("FILLED"), Type.Literal("REJECTED"), Type.Literal("CANCELLED")]),
  fill: Type.Optional(Fill),
  reject_reason: Type.Optional(RejectReason),
  allocation_certificate: Type.Optional(Type.Object({ doc_id: Type.String(), url: Type.String() })),
  account: Type.Optional(Account),
});
export type OrderRequest = Static<typeof OrderRequest>;
export type OrderResponse = Static<typeof OrderResponse>;

// ---------- Kasa talimatı (05, 06) ----------
export const VaultRequestBody = Type.Object({
  qty_mg: Type.Integer({ minimum: 1 }),
  ref: Type.String({ description: "Kanzasset referans numarası" }),
});
export const VaultRequestStatus = Type.Union([
  Type.Literal("REQUESTED"),
  Type.Literal("ACCEPTED"),
  Type.Literal("PLACING"),
  Type.Literal("PLACED"),
  Type.Literal("REJECTED"),
]);
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
  placed_ts: Type.Optional(IsoTs),
  due_ts: Type.Optional(IsoTs),
});
export type VaultRequest = Static<typeof VaultRequest>;

// ---------- Olay zarfı (06) ----------
export const EventEnvelope = Type.Object({
  event_id: Type.String(),
  type: Type.String(),
  ts: IsoTs,
  seq: Type.Optional(Type.Integer()),
  data: Type.Unknown(),
  account: Type.Optional(Account),
});
export type EventEnvelope = Static<typeof EventEnvelope>;

// ---------- Yardımcılar ----------
/** HMAC imza metni: ts + method + path + body */
export function signingString(ts: string, method: string, path: string, body = ""): string {
  return `${ts}${method.toUpperCase()}${path}${body}`;
}

export const CONTRACT_VERSION = "2.0.0";
