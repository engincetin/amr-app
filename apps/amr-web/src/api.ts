/** AMR sunucusu yönetim uçları ve canlı akış (SSE). */
import { useEffect, useRef, useState } from "react";

const token = new URLSearchParams(location.search).get("token") ?? localStorage.getItem("adminToken") ?? "";
if (token) localStorage.setItem("adminToken", token);

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { "x-admin-token": token } : {}), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error ?? msg; } catch { /* yok */ }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
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
}

export type BusEvent =
  | { kind: "tick"; seq: number; ts: string; tradable: boolean; prices: PriceLevel[] }
  | { kind: "source"; state: SourceState }
  | { kind: "publish"; state: PublishState }
  | { kind: "subscribers"; count: number }
  | { kind: "notification"; id: number; type: string; title: string; body: string; created_ts: string }
  | { kind: "order"; order: Order }
  | { kind: "vault"; request: VaultRequest }
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
      } else if (ev.kind === "vault" || ev.kind === "subscribers" || ev.kind === "notification") {
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
