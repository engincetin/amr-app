/**
 * Merkez adaptörü: rafinerinin merkezi fiyat uygulamasına soketle bağlanır.
 * R2'den Bağlan / Kes ile yönetilir. Bağlantı beklenmedik biçimde kopunca üstel bekleme ile yeniden dener;
 * kullanıcı Kes dediyse denemez. Gelen fiyat AMR yayınına (publisher) aktarılır.
 *
 * Mock merkez mesaj biçimi: { type: "price", ts, prices: { USD: {bid, ask}, EUR, AED } }
 * Gerçek merkez netleşince yalnız `parse()` değişir.
 */
import WebSocket from "ws";
import type { PriceLevel } from "@amr/contract";
import { bus } from "./bus.ts";

export type SourceStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED";
export interface SourceState {
  status: SourceStatus;
  url: string | null;
  lastPriceTs: string | null;
  lastError: string | null;
  connectedSince: string | null;
  reconnectAttempt: number;
  manual: boolean; // kullanıcı Kes dedi → yeniden denemez
}

export class SourceConnection {
  state: SourceState = {
    status: "DISCONNECTED",
    url: null,
    lastPriceTs: null,
    lastError: null,
    connectedSince: null,
    reconnectAttempt: 0,
    manual: true,
  };
  private ws: WebSocket | null = null;
  private timer: NodeJS.Timeout | null = null;
  onPrice: (prices: PriceLevel[], ts: string) => void = () => {};
  onStatus: (state: SourceState, prev: SourceStatus) => void = () => {};

  connect(url: string) {
    this.state.url = url;
    this.state.manual = false;
    this.clearTimer();
    this.open();
  }

  disconnect() {
    this.state.manual = true;
    this.clearTimer();
    this.state.reconnectAttempt = 0;
    if (this.ws) {
      this.ws.removeAllListeners();
      try { this.ws.close(1000, "kes"); } catch { /* yok */ }
      this.ws = null;
    }
    this.setStatus("DISCONNECTED");
  }

  private open() {
    if (!this.state.url) return;
    this.setStatus("CONNECTING");
    const ws = new WebSocket(this.state.url);
    this.ws = ws;
    ws.on("open", () => {
      this.state.reconnectAttempt = 0;
      this.state.lastError = null;
      this.state.connectedSince = new Date().toISOString();
      this.setStatus("CONNECTED");
    });
    ws.on("message", (raw) => {
      const parsed = this.parse(raw.toString());
      if (!parsed) return;
      this.state.lastPriceTs = parsed.ts;
      this.onPrice(parsed.prices, parsed.ts);
    });
    ws.on("error", (err) => {
      this.state.lastError = err.message;
    });
    ws.on("close", (code, reason) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.state.connectedSince = null;
      this.state.lastError = this.state.lastError ?? `kapandı (${code} ${reason.toString()})`;
      this.setStatus("DISCONNECTED");
      if (!this.state.manual) this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    const attempt = ++this.state.reconnectAttempt;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt - 1, 5)); // 1, 2, 4, 8, 16, 32→30 sn
    this.clearTimer();
    this.timer = setTimeout(() => this.open(), delay);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private setStatus(s: SourceStatus) {
    const prev = this.state.status;
    this.state.status = s;
    if (prev !== s) {
      this.onStatus(this.state, prev);
      bus.publish({ kind: "source", state: { ...this.state } });
    }
  }

  /** Merkez mesajını sözleşmedeki fiyat satırlarına çevirir. Tanınmayan mesaj → null. */
  parse(text: string): { ts: string; prices: PriceLevel[] } | null {
    try {
      const m = JSON.parse(text);
      if (m?.type !== "price" || !m.prices) return null;
      const out: PriceLevel[] = [];
      for (const ccy of ["USD", "EUR", "AED"] as const) {
        const p = m.prices[ccy];
        if (!p) return null;
        out.push({ ccy, bid: String(p.bid), ask: String(p.ask) });
      }
      return { ts: String(m.ts ?? new Date().toISOString()), prices: out };
    } catch {
      return null;
    }
  }
}
