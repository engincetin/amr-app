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
};

export interface PriceLevel { ccy: "USD" | "EUR" | "AED"; bid: string; ask: string }
export interface Tick { seq: number; ts: string; tradable: boolean; prices: PriceLevel[] }
export interface Notification { id: number; type: string; title: string; body: string; created_ts: string; read_ts: string | null }
export interface AuditRow { id: number; ts: string; actor: string; action: string; before: string | null; after: string | null }
export interface SourceState { status: "DISCONNECTED" | "CONNECTING" | "CONNECTED"; url: string | null; lastPriceTs: string | null; lastError: string | null; connectedSince: string | null; reconnectAttempt: number; manual: boolean }
export interface PublishState { tradable: boolean; sourceConnected: boolean; manualHalt: boolean; haltReason: string | null; seq: number; lastTickTs: string | null; lastPrices: PriceLevel[] | null; subscribers: number }
export interface Overview {
  source: SourceState;
  publish: PublishState;
  subscribers: { client: string; connected_at: string }[];
  unread: number;
  settings: Record<string, string>;
  ts: string;
  account: { seq: number; vault: { in_vault_mg: number; placing_mg: number; shipping_mg: number }; current_account: { gold_mg: number; money: { ccy: string; cents: number }[] }; status: string };
}

export type BusEvent =
  | { kind: "tick"; seq: number; ts: string; tradable: boolean; prices: PriceLevel[] }
  | { kind: "source"; state: SourceState }
  | { kind: "publish"; state: PublishState }
  | { kind: "subscribers"; count: number }
  | { kind: "notification"; id: number; type: string; title: string; body: string; created_ts: string }
  | { kind: "heartbeat"; ts: string };

/** Canlı akış: overview'ı tutar, tick'leri biriktirir, bildirimleri sayar. */
export function useLive() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [lastEvent, setLastEvent] = useState<string>("");
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
      } else if (ev.kind === "subscribers" || ev.kind === "notification") {
        scheduleRefresh();
      }
    };
    const scheduleRefresh = () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(refresh, 300);
    };
    return () => es.close();
  }, []);

  return { overview, ticks, lastEvent, connected, refresh };
}

export const fmtG = (mg: number) => (mg / 1000).toLocaleString("tr-TR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
export const fmtMoney = (cents: number) => (cents / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString("tr-TR", { hour12: false }) : "");
export const ageSec = (iso: string | null | undefined) => (iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)) : null);
