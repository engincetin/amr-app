/** AMR sunucusu yönetim uçları ve canlı akış (SSE). */
import { useEffect, useRef, useState } from "react";

const token = new URLSearchParams(location.search).get("token") ?? localStorage.getItem("adminToken") ?? "";
if (token) localStorage.setItem("adminToken", token);

/** Demoda aktif kullanıcı üst şeritten seçilir ve her istekte X-User ile gider. */
export const currentUser = { name: localStorage.getItem("amrUser") ?? "yonetici" };
export function setCurrentUser(u: string) { currentUser.name = u; localStorage.setItem("amrUser", u); }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", "x-user": currentUser.name, ...(token ? { "x-admin-token": token } : {}), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error ?? msg; } catch { /* yok */ }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  /** İstek günlüğü (VARA kanıtı): Kanzasset'in istekleri ve panelin değişiklikleri. */
  requests: (q: { limit?: number; channel?: string; path?: string; errors?: boolean } = {}) => {
    const p = new URLSearchParams();
    if (q.limit) p.set("limit", String(q.limit));
    if (q.channel) p.set("channel", q.channel);
    if (q.path) p.set("path", q.path);
    if (q.errors) p.set("errors", "1");
    return req<{ summary: RequestSummary; items: RequestLogRow[] }>(`/admin/requests${p.size ? `?${p}` : ""}`);
  },
  overview: () => req<Overview>("/admin/overview"),
  connect: (url: string) => req("/admin/source/connect", { method: "POST", body: JSON.stringify({ url }) }),
  disconnect: () => req("/admin/source/disconnect", { method: "POST", body: "{}" }),
  halt: (reason: string) => req("/admin/publish/halt", { method: "POST", body: JSON.stringify({ reason }) }),
  resume: () => req("/admin/publish/resume", { method: "POST", body: "{}" }),
  ticks: (limit = 50) => req<Tick[]>(`/admin/ticks?limit=${limit}`),
  notifications: () => req<{ unread: number; items: Notification[] }>("/admin/notifications"),
  markRead: (id: number) => req(`/admin/notifications/${id}/read`, { method: "POST", body: "{}" }),
  settings: () => req<Record<string, string>>("/admin/settings"),
  saveSettings: (s: Record<string, string>) => req<Record<string, string>>("/admin/settings", { method: "PUT", body: JSON.stringify(s) }),
  audit: () => req<AuditRow[]>("/admin/audit"),
  orders: (q: { day?: string; side?: string; status?: string; limit?: number } = {}) => {
    const u = new URLSearchParams(); for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") u.set(k, String(v));
    return req<Order[]>(`/admin/orders${u.size ? `?${u}` : ""}`);
  },
  order: (id: string) => req<Order>(`/admin/orders/${encodeURIComponent(id)}`),
  currentAccount: (limit = 200) => req<CurrentAccount>(`/admin/current-account?limit=${limit}`),
  requestSettlement: (reason: string) => req("/admin/settlement/request", { method: "POST", body: JSON.stringify({ reason }) }),
  vault: (q: { type?: string; status?: string; limit?: number } = {}) => {
    const u = new URLSearchParams(); for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") u.set(k, String(v));
    return req<VaultView>(`/admin/vault${u.size ? `?${u}` : ""}`);
  },
  vaultStatement: (date?: string) => req<VaultStatement>(`/admin/vault/statement${date ? `?date=${date}` : ""}`),
  vaultAccept: (id: string) => req<VaultRequest>(`/admin/vault/${encodeURIComponent(id)}/accept`, { method: "POST", body: "{}" }),
  vaultReject: (id: string, reason: string) => req<VaultRequest>(`/admin/vault/${encodeURIComponent(id)}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  vaultPlacing: (id: string) => req<VaultRequest>(`/admin/vault/${encodeURIComponent(id)}/placing`, { method: "POST", body: "{}" }),
  vaultPlaced: (id: string) => req<VaultRequest>(`/admin/vault/${encodeURIComponent(id)}/placed`, { method: "POST", body: "{}" }),
  // R6 fiziksel teslimat
  deliveries: () => req<{ items: Delivery[]; open: number }>("/admin/deliveries"),
  dlvQuote: (id: string, b: { carrier: string; amount: string; ccy: string }) => req<Delivery>(`/admin/deliveries/${id}/quote`, { method: "POST", body: JSON.stringify(b) }),
  dlvStep: (id: string, step: "preparing" | "ready" | "delivered") => req<Delivery>(`/admin/deliveries/${id}/${step}`, { method: "POST", body: "{}" }),
  dlvShipped: (id: string, carrier: string, tracking_no: string) => req<Delivery>(`/admin/deliveries/${id}/shipped`, { method: "POST", body: JSON.stringify({ carrier, tracking_no }) }),
  dlvCancel: (id: string, reason: string) => req<Delivery>(`/admin/deliveries/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }),
  dlvFailed: (id: string, reason: string) => req<Delivery>(`/admin/deliveries/${id}/failed`, { method: "POST", body: JSON.stringify({ reason }) }),
  // R7 katalog ve rafinasyon
  catalog: () => req<Catalog>("/admin/catalog"),
  catalogSave: (item: Partial<CatalogItem> & { item_id: string }) => req<Catalog>("/admin/catalog", { method: "PUT", body: JSON.stringify(item) }),
  refining: () => req<{ items: Refining[]; open: number }>("/admin/refining"),
  rfnQuote: (id: string, b: { product: string; logistics: string; ccy: string; lead_time_days: number }) => req<Refining>(`/admin/refining/${id}/quote`, { method: "POST", body: JSON.stringify(b) }),
  rfnStep: (id: string, step: "production" | "ready" | "delivered") => req<Refining>(`/admin/refining/${id}/${step}`, { method: "POST", body: "{}" }),
  rfnShipped: (id: string, carrier: string, tracking_no: string) => req<Refining>(`/admin/refining/${id}/shipped`, { method: "POST", body: JSON.stringify({ carrier, tracking_no }) }),
  rfnCancel: (id: string, reason: string) => req<Refining>(`/admin/refining/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }),
  // R8 mahsuplaşma
  settlements: () => req<{ items: Settlement[]; open: Settlement | null }>("/admin/settlements"),
  settlementOpen: (trigger: string, reason?: string) => req<Settlement>("/admin/settlements", { method: "POST", body: JSON.stringify({ trigger, reason }) }),
  settlementDraft: (id: string) => req<Settlement>(`/admin/settlements/${id}/draft`, { method: "POST", body: "{}" }),
  settlementNotice: (id: string, b: { ccy: string; amount_cents: number; direction: string; bank_ref: string; approval_id?: number; approver?: string }) =>
    req<Settlement & { needs_approval?: boolean; approval_id?: number }>(`/admin/settlements/${id}/payment-notice`, { method: "POST", body: JSON.stringify(b) }),
  settlementReceived: (id: string, ccy: string) => req<Settlement>(`/admin/settlements/${id}/payment-received`, { method: "POST", body: JSON.stringify({ ccy }) }),
  // R10 kullanıcılar
  users: () => req<UsersView>("/admin/users"),
  userSave: (u: { username: string; display_name?: string; role?: string; active?: boolean }) => req<AppUser>("/admin/users", { method: "PUT", body: JSON.stringify(u) }),
  approve: (id: number, approver: string) => req<{ ok: boolean }>(`/admin/approvals/${id}/approve`, { method: "POST", body: JSON.stringify({ approver }) }),
  rejectApproval: (id: number) => req<{ ok: boolean }>(`/admin/approvals/${id}/reject`, { method: "POST", body: "{}" }),
  clients: () => req<ApiClientRow[]>("/admin/clients"),
  clientCreate: (b: { name: string; event_url?: string; approval_id?: number; approver?: string }) =>
    req<{ api_key?: string; secret?: string; needs_approval?: boolean; approval_id?: number }>("/admin/clients", { method: "POST", body: JSON.stringify(b) }),
  clientRevoke: (key: string) => req<{ ok: boolean }>(`/admin/clients/${encodeURIComponent(key)}/revoke`, { method: "POST", body: "{}" }),
  document: (id: string) => req<Doc>(`/admin/documents/${encodeURIComponent(id)}`),
  documents: () => req<{ doc_id: string; type: string; related_id: string; created_ts: string; sent_ts: string | null }[]>("/admin/documents"),
  events: () => req<{ event_id: string; type: string; status: string; attempts: number; next_ts: string; last_error: string | null; created_ts: string; sent_ts: string | null }[]>("/admin/events"),
};

export interface PriceLevel { ccy: "USD" | "EUR" | "AED"; bid: string; ask: string }
export interface Tick { seq: number; ts: string; tradable: boolean; prices: PriceLevel[] }
export interface Notification { id: number; type: string; title: string; body: string; created_ts: string; read_ts: string | null }
export interface AuditRow { id: number; ts: string; actor: string; action: string; before: string | null; after: string | null }
export interface SourceState { status: "DISCONNECTED" | "CONNECTING" | "CONNECTED"; url: string | null; lastPriceTs: string | null; lastError: string | null; connectedSince: string | null; reconnectAttempt: number; manual: boolean }
export interface PublishState { tradable: boolean; sourceConnected: boolean; manualHalt: boolean; haltReason: string | null; seq: number; lastTickTs: string | null; lastPrices: PriceLevel[] | null; subscribers: number }
export interface Account { seq: number; vault: { in_vault_mg: number; placing_mg: number; shipping_mg: number }; current_account: { gold_mg: number; money: { ccy: string; cents: number }[] }; status: string }
export interface LimitUsage { gold: { used_mg: number; limit_mg: number; pct: number }; money: { ccy: string; used_cents: number; limit_cents: number; pct: number }[]; max_pct: number }
export interface Fill { px: string; qty_mg: number; amount_cents: number; ccy: string; trade_ts: string }
export interface Order {
  order_id: string; client_order_id: string; status: "RECEIVED" | "CANCEL_REQUESTED" | "FILLED" | "REJECTED" | "CANCELLED"; side: "BUY" | "SELL"; qty_mg: number; ccy: string;
  quote_seq: number; limit_px: string; fill?: Fill; reject_reason?: string; allocation_certificate?: { doc_id: string; url: string }; account?: Account;
  received_ts: string; decided_ts?: string; history?: { status: string; ts: string; note?: string }[];
}
export type VaultStatus = "REQUESTED" | "ACCEPTED" | "PLACING" | "PLACED" | "OVERDUE" | "REJECTED";
export interface VaultRequest {
  request_id: string; type: "IN" | "OUT"; qty_mg: number; ref: string; status: VaultStatus;
  doc_id?: string; reject_reason?: string; requested_ts: string; accepted_ts?: string; placing_ts?: string; placed_ts?: string; due_ts?: string;
  history?: { status: string; ts: string; note?: string }[];
}
export interface VaultMovementRow { id: number; seq: number; type: string; in_vault_mg: number; placing_mg: number; shipping_mg: number; related_id: string | null; doc_id: string | null; ts: string }
export interface VaultView {
  account: Account; pending: VaultRequest[]; placing_queue: VaultRequest[]; requests: VaultRequest[]; movements: VaultMovementRow[];
  accept_mode: string; accept_target_minutes: number; placement_due_days: number;
}
export interface VaultStatement {
  date: string;
  opening: { in_vault_mg: number; placing_mg: number; shipping_mg: number };
  closing: { in_vault_mg: number; placing_mg: number; shipping_mg: number };
  total_mg: number;
  movements: { seq: number; type: string; in_vault_mg: number; placing_mg: number; shipping_mg: number; related_id?: string; doc_id?: string; ts: string }[];
  slips: { doc_id: string; type: string; related_id: string; created_ts: string }[];
  hash: string; signature: string;
}
export type DeliveryStatus = "REQUESTED" | "QUOTED" | "APPROVED" | "PREPARING" | "READY" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "FAILED";
export interface LogisticsQuote { quote_id: string; carrier: string; amount_cents: number; ccy: string; valid_until: string; doc_id?: string }
export interface Delivery {
  delivery_id: string; qty_mg: number; address_ref: string; insured_party_ref: string; ref: string; status: DeliveryStatus;
  quote?: LogisticsQuote; carrier?: string; tracking_no?: string; shipping_doc_id?: string; pod_doc_id?: string; reject_reason?: string;
  requested_ts: string; history?: { status: string; ts: string; note?: string }[];
}
export type RefiningStatus = "REQUESTED" | "QUOTED" | "APPROVED" | "IN_PRODUCTION" | "READY" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "FAILED";
export interface RefiningQuote { quote_id: string; product_cents: number; logistics_cents: number; ccy: string; lead_time_days: number; carrier?: string; valid_until: string; doc_id?: string }
export interface Refining {
  refining_id: string; items: { item_id: string; name: string; qty: number; weight_mg: number }[]; total_mg: number;
  address_ref: string; insured_party_ref: string; ref: string; status: RefiningStatus;
  quote?: RefiningQuote; carrier?: string; tracking_no?: string; shipping_doc_id?: string; pod_doc_id?: string; reject_reason?: string;
  requested_ts: string; history?: { status: string; ts: string; note?: string }[];
}
export interface CatalogItem { item_id: string; name: string; weight_mg: number; fineness: string; unit_price_cents: number; ccy: string; lead_time_days: number; active: boolean }
export interface Catalog { version: number; items: CatalogItem[]; updated_ts: string }
export type SettlementStatus = "REQUESTED" | "OPEN" | "DRAFT" | "RECONCILED" | "MISMATCH" | "PAYMENT_PENDING" | "SETTLED";
export interface Settlement {
  settlement_id: string; trigger: string; status: SettlementStatus; window_from: string; window_to: string;
  statement?: { movements: Movement[]; gold_mg: number; money: { ccy: string; cents: number }[]; fees: { type: string; ccy: string; amount_cents: number }[]; hash: string; signature: string };
  statement_hash?: string; kz_statement_hash?: string;
  diffs?: { field: string; amr: string; kz: string }[];
  gold_leg?: { t_net_mg: number; direction: string; qty_mg: number; requests: string[]; done: boolean };
  money_leg: { ccy: string; net_cents: number; direction: string; paid: boolean; bank_ref?: string; notice_ts?: string; received_ts?: string }[];
  doc_id?: string; opened_ts: string; settled_ts?: string; history?: { status: string; ts: string; note?: string }[];
}
export interface AppUser { username: string; display_name: string; role: string; role_tr?: string; active: boolean; permissions?: string[] }
export interface UsersView {
  items: AppUser[];
  roles: { code: string; name: string; permissions: string[] }[];
  second_approval: string[];
  pending_approvals: { id: number; action: string; payload: string; requested_by: string; requested_ts: string }[];
}
export interface ApiClientRow { api_key: string; name: string; event_url: string | null; active: number; created_ts: string }
export interface Movement { id: number; seq: number; type: string; gold_mg: number; ccy?: string; amount_cents?: number; ref?: string; related_id?: string; ts: string }
export interface CurrentAccount { account: Account; limit: LimitUsage; movements: Movement[] }
export interface Doc { meta: { doc_id: string; type: string; related_id: string; hash: string; signature: string; created_ts: string; sent_ts?: string }; content: Record<string, unknown> }
export interface Overview {
  source: SourceState;
  publish: PublishState;
  subscribers: { client: string; connected_at: string }[];
  unread: number;
  settings: Record<string, string>;
  ts: string;
  account: Account;
  limit: LimitUsage;
  orders_today: { day: string; buy: { filled: number; mg: number; rejected: number }; sell: { filled: number; mg: number; rejected: number }; total: number };
  vault_pending: number;
  vault_overdue: number;
  deliveries_open: number;
  refining_open: number;
}

export type BusEvent =
  | { kind: "tick"; seq: number; ts: string; tradable: boolean; prices: PriceLevel[] }
  | { kind: "source"; state: SourceState }
  | { kind: "publish"; state: PublishState }
  | { kind: "subscribers"; count: number }
  | { kind: "notification"; id: number; type: string; title: string; body: string; created_ts: string }
  | { kind: "order"; order: Order }
  | { kind: "vault"; request: VaultRequest }
  | { kind: "delivery"; item: Delivery }
  | { kind: "refining"; item: Refining }
  | { kind: "catalog"; version: number }
  | { kind: "settlement"; item: Settlement }
  | { kind: "account"; account: Account }
  | { kind: "event"; event: { event_id: string; type: string; ts: string; status: string; error?: string | null } }
  | { kind: "heartbeat"; ts: string };

/** Canlı akış: overview'ı tutar, tick'leri biriktirir, bildirimleri sayar. */
export function useLive() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [lastEvent, setLastEvent] = useState<string>("");
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [connected, setConnected] = useState(false);
  const refreshTimer = useRef<number | null>(null);

  const refresh = async () => {
    try {
      const [o, t] = await Promise.all([api.overview(), api.ticks(50)]);
      setOverview(o);
      setTicks(t);
    } catch (e) { console.warn("overview", e); }
  };

  useEffect(() => {
    refresh();
    const es = new EventSource(`/admin/stream${token ? `?token=${token}` : ""}`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data) as BusEvent;
      setLastEvent(new Date().toISOString());
      if (ev.kind === "tick") {
        setTicks((prev) => [{ seq: ev.seq, ts: ev.ts, tradable: ev.tradable, prices: ev.prices }, ...prev].slice(0, 50));
        setOverview((o) => (o ? { ...o, publish: { ...o.publish, seq: ev.seq, lastTickTs: ev.ts, lastPrices: ev.prices, tradable: ev.tradable } } : o));
      } else if (ev.kind === "source") {
        setOverview((o) => (o ? { ...o, source: ev.state } : o));
        scheduleRefresh();
      } else if (ev.kind === "publish") {
        setOverview((o) => (o ? { ...o, publish: ev.state } : o));
      } else if (ev.kind === "account") {
        setOverview((o) => (o ? { ...o, account: ev.account } : o));
        scheduleRefresh();
      } else if (ev.kind === "order") {
        setLastOrder(ev.order);
        scheduleRefresh();
      } else if (ev.kind === "vault" || ev.kind === "delivery" || ev.kind === "refining" || ev.kind === "catalog" || ev.kind === "settlement" || ev.kind === "subscribers" || ev.kind === "notification") {
        scheduleRefresh();
      }
    };
    const scheduleRefresh = () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(refresh, 300);
    };
    return () => es.close();
  }, []);

  return { overview, ticks, lastEvent, lastOrder, connected, refresh };
}

export const fmtG = (mg: number) => (mg / 1000).toLocaleString("tr-TR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
export const fmtMoney = (cents: number) => (cents / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString("tr-TR", { hour12: false }) : "");
export const fmtDT = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("tr-TR", { hour12: false }) : "");
export const STATUS_TR: Record<string, string> = { RECEIVED: "alındı", CANCEL_REQUESTED: "iptal isteniyor", FILLED: "gerçekleşti", REJECTED: "reddedildi", CANCELLED: "iptal" };
export const REJECT_TR: Record<string, string> = { PRICE_OUTSIDE_LIMIT: "fiyat limit dışı (slippage)", STALE_QUOTE: "bayat quote_seq", TRADING_HALTED: "yayın durdu", CURRENT_ACCOUNT_LIMIT: "cari hesap limiti", DUPLICATE_ORDER: "tekrar emir", INVALID_QTY: "geçersiz miktar", INSUFFICIENT_CURRENT_ACCOUNT: "cari hesap altını yetersiz", INSUFFICIENT_VAULT: "kasada yetersiz", QUOTE_EXPIRED: "teklif süresi doldu", INTERNAL_ERROR: "iç hata" };
export const MOVE_TR: Record<string, string> = { OPENING: "açılış devri", FILL_BUY: "alış (fill)", FILL_SELL: "satış (fill)", VAULT_IN: "kasa girişi", VAULT_OUT: "kasa çıkışı", FEE_DELIVERY: "lojistik bedeli", FEE_REFINING: "rafinasyon bedeli", SETTLEMENT_PAYMENT: "mahsuplaşma ödemesi" };
export const VAULT_STATUS_TR: Record<string, string> = { REQUESTED: "talep edildi", ACCEPTED: "kabul edildi", PLACING: "kasaya konuluyor", PLACED: "kasaya konuldu", OVERDUE: "vade geçti (T+3)", REJECTED: "reddedildi" };
export const STL_STATUS_TR: Record<string, string> = { REQUESTED: "talep edildi", OPEN: "pencere açık", DRAFT: "ekstre taslağı", RECONCILED: "mutabakat sağlandı", MISMATCH: "fark var", PAYMENT_PENDING: "ödeme bekliyor", SETTLED: "kapandı" };
export const STL_TRIGGER_TR: Record<string, string> = { CUTOFF: "kesim saati", REQUEST_KZ: "Kanzasset talebi", REQUEST_AMR: "rafineri talebi", LIMIT: "cari hesap limiti" };
export const DOC_TYPE_TR: Record<string, string> = { ALLOCATION_CERTIFICATE: "Tahsis Belgesi", VAULT_IN_SLIP: "Kasa Giriş Fişi", VAULT_OUT_SLIP: "Kasa Çıkış Fişi", LOGISTICS_QUOTE: "Lojistik Teklifi", REFINING_QUOTE: "Rafinasyon Teklifi", SHIPPING_SLIP: "Sevkiyat Fişi", DELIVERY_RECORD: "Teslimat Kaydı", VAULT_STATEMENT: "Günlük Kasa Ekstresi", CURRENT_ACCOUNT_STATEMENT: "Cari Hesap Ekstresi", SETTLEMENT_STATEMENT: "Mahsuplaşma Ekstresi" };
export const DLV_STATUS_TR: Record<string, string> = { REQUESTED: "talep edildi", QUOTED: "teklif verildi", APPROVED: "onaylandı", PREPARING: "hazırlanıyor", IN_PRODUCTION: "üretimde", READY: "hazır", SHIPPED: "taşıyıcıda", DELIVERED: "teslim edildi", CANCELLED: "iptal", FAILED: "teslim edilemedi" };
export const VAULT_MOVE_TR: Record<string, string> = { OPENING: "açılış devri", IN_ACCEPTED: "giriş kabulü", PLACED: "kasaya konuldu", OUT_ACCEPTED: "çıkış kabulü", SHIP_READY: "sevkiyata çıktı", SHIP_RETURN: "kasaya döndü", DELIVERED: "teslim edildi" };
/** Kalan süre: artı ise "x sonra", eksi ise "x gecikti". */
export function untilText(iso: string | null | undefined): { text: string; late: boolean } | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  const late = ms < 0;
  const a = Math.abs(ms);
  const d = Math.floor(a / 86_400_000), h = Math.floor((a % 86_400_000) / 3_600_000), m = Math.floor((a % 3_600_000) / 60_000);
  const parts = d > 0 ? `${d} gün ${h} sa` : h > 0 ? `${h} sa ${m} dk` : `${m} dk`;
  return { text: late ? `${parts} gecikti` : `${parts} kaldı`, late };
}
export const ageSec = (iso: string | null | undefined) => (iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)) : null);

export interface RequestLogRow {
  id: number; ts: string; method: string; path: string; status: number; duration_ms: number;
  channel: "KANZASSET" | "PANEL"; actor: string | null; api_key: string | null;
  idempotency_key: string | null; body_sha256: string | null; bytes: number; ip: string | null; error: string | null;
}
export interface RequestSummary {
  last_24h: number; errors_24h: number; avg_ms: number; total: number; oldest_ts: string | null; retention_days: number;
}
