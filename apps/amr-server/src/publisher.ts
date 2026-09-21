/**
 * Fiyat yayını (01): merkezden gelen fiyatı Kanzasset'e /v1/prices soketiyle yayınlar.
 *  - yalnız fiyat değişince tick, saniyede en fazla ~1
 *  - 5 sn tick yoksa heartbeat
 *  - tradable = merkez bağlı && yayın elle durdurulmamış
 *  - halt / resume mesajları; resume sonrası snapshot
 *  - her tick sqlite'a yazılır (30 gün), seq kalıcıdır
 */
import type WebSocket from "ws";
import { PRICE_SOCKET, type PriceLevel, type WsServerMessage } from "@amr/contract";
import { type Db, getMeta, setMeta, insertTick, pruneTicks, getSetting, setSetting } from "./db.ts";
import { bus } from "./bus.ts";

export interface PublishState {
  tradable: boolean;
  sourceConnected: boolean;
  manualHalt: boolean;
  haltReason: string | null;
  seq: number;
  lastTickTs: string | null;
  lastPrices: PriceLevel[] | null;
  subscribers: number;
}

export interface Subscriber {
  ws: WebSocket;
  clientName: string;
  connectedAt: string;
  lastHeartbeatAt: string | null;
}

export class Publisher {
  private subs = new Set<Subscriber>();
  private lastSentAt = 0;
  private hbTimer: NodeJS.Timeout | null = null;
  state: PublishState;

  constructor(private db: Db) {
    this.state = {
      tradable: false,
      sourceConnected: false,
      manualHalt: getSetting(db, "publish.manual_halt", "0") === "1",
      haltReason: getSetting(db, "publish.halt_reason", "") || null,
      seq: getMeta(db, "price_seq", 0),
      lastTickTs: null,
      lastPrices: null,
      subscribers: 0,
    };
    this.hbTimer = setInterval(() => this.heartbeat(), 1000);
    pruneTicks(db);
  }

  stop() {
    if (this.hbTimer) clearInterval(this.hbTimer);
  }

  private computeTradable() {
    return this.state.sourceConnected && !this.state.manualHalt;
  }

  // ----- merkezden gelen fiyat -----
  onPrice(prices: PriceLevel[], _sourceTs: string) {
    const changed = JSON.stringify(prices) !== JSON.stringify(this.state.lastPrices);
    const now = Date.now();
    if (!changed) return;
    if (now - this.lastSentAt < PRICE_SOCKET.maxTickRateMs) {
      // saniyede en fazla ~1: son fiyatı tut, bir sonraki pencerede yayınla
      this.state.lastPrices = prices;
      return;
    }
    this.state.lastPrices = prices;
    this.emitTick();
  }

  private emitTick() {
    if (!this.state.lastPrices) return;
    const seq = ++this.state.seq;
    setMeta(this.db, "price_seq", seq);
    const ts = new Date().toISOString();
    this.state.lastTickTs = ts;
    this.lastSentAt = Date.now();
    const tradable = this.computeTradable();
    this.state.tradable = tradable;
    insertTick(this.db, seq, ts, tradable, this.state.lastPrices);
    this.broadcast({ type: "tick", seq, ts, tradable, prices: this.state.lastPrices });
    bus.publish({ kind: "tick", seq, ts, tradable, prices: this.state.lastPrices });
  }

  private heartbeat() {
    const now = Date.now();
    // bekleyen fiyat varsa (hız sınırı yüzünden) yayınla
    if (this.state.lastPrices && this.state.lastTickTs && now - this.lastSentAt >= PRICE_SOCKET.maxTickRateMs) {
      const lastSentPrices = this.lastBroadcastPrices;
      if (JSON.stringify(lastSentPrices) !== JSON.stringify(this.state.lastPrices)) this.emitTick();
    }
    if (now - this.lastSentAt >= PRICE_SOCKET.heartbeatMs && this.subs.size > 0) {
      const ts = new Date().toISOString();
      this.lastSentAt = now;
      this.broadcast({ type: "heartbeat", seq: this.state.seq, ts, tradable: this.computeTradable() });
      bus.publish({ kind: "heartbeat", ts });
    }
  }
  private lastBroadcastPrices: PriceLevel[] | null = null;
  /** yayın açıldı / durdu geçişi (olay üretimi için) */
  onTradableChange: ((tradable: boolean, reason?: string) => void) | null = null;

  // ----- merkez durumu -----
  setSourceConnected(connected: boolean, reason?: string) {
    const before = this.computeTradable();
    this.state.sourceConnected = connected;
    const after = this.computeTradable();
    this.state.tradable = after;
    if (before && !after) { this.broadcast({ type: "halt", ts: new Date().toISOString(), reason: reason ?? "merkez bağlantısı kopuk" }); this.onTradableChange?.(false, reason ?? "merkez bağlantısı kopuk"); }
    if (!before && after) { this.resumeBroadcast(); this.onTradableChange?.(true); }
    bus.publish({ kind: "publish", state: this.snapshotState() });
  }

  // ----- elle durdur / başlat (R2) -----
  halt(reason: string) {
    const before = this.computeTradable();
    this.state.manualHalt = true;
    this.state.haltReason = reason;
    setSetting(this.db, "publish.manual_halt", "1");
    setSetting(this.db, "publish.halt_reason", reason);
    this.state.tradable = false;
    this.broadcast({ type: "halt", ts: new Date().toISOString(), reason });
    if (before) this.onTradableChange?.(false, reason);
    bus.publish({ kind: "publish", state: this.snapshotState() });
  }
  resume() {
    const before = this.computeTradable();
    this.state.manualHalt = false;
    this.state.haltReason = null;
    setSetting(this.db, "publish.manual_halt", "0");
    setSetting(this.db, "publish.halt_reason", "");
    this.state.tradable = this.computeTradable();
    if (this.state.tradable) this.resumeBroadcast();
    if (!before && this.state.tradable) this.onTradableChange?.(true);
    bus.publish({ kind: "publish", state: this.snapshotState() });
  }
  private resumeBroadcast() {
    const ts = new Date().toISOString();
    this.broadcast({ type: "resume", seq: this.state.seq, ts });
    for (const s of this.subs) this.send(s.ws, this.snapshotMessage());
  }

  // ----- aboneler -----
  snapshotMessage(): WsServerMessage {
    return {
      type: "snapshot",
      seq: this.state.seq,
      ts: new Date().toISOString(),
      tradable: this.computeTradable(),
      prices: this.state.lastPrices ?? [],
    };
  }
  addSubscriber(ws: WebSocket, clientName: string): Subscriber {
    const sub: Subscriber = { ws, clientName, connectedAt: new Date().toISOString(), lastHeartbeatAt: null };
    this.subs.add(sub);
    this.state.subscribers = this.subs.size;
    this.send(ws, { type: "subscribed", ts: sub.connectedAt });
    this.send(ws, this.snapshotMessage());
    if (!this.computeTradable()) this.send(ws, { type: "halt", ts: new Date().toISOString(), reason: this.state.manualHalt ? (this.state.haltReason ?? "yayın durdu") : "merkez bağlantısı yok" });
    bus.publish({ kind: "subscribers", count: this.subs.size });
    ws.on("close", () => {
      this.subs.delete(sub);
      this.state.subscribers = this.subs.size;
      bus.publish({ kind: "subscribers", count: this.subs.size });
    });
    return sub;
  }
  listSubscribers() {
    return [...this.subs].map((s) => ({ client: s.clientName, connected_at: s.connectedAt }));
  }
  private broadcast(msg: WsServerMessage) {
    if (msg.type === "tick" || msg.type === "snapshot") this.lastBroadcastPrices = msg.prices;
    for (const s of this.subs) this.send(s.ws, msg);
  }
  private send(ws: WebSocket, msg: WsServerMessage) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }
  snapshotState(): PublishState {
    return { ...this.state, tradable: this.computeTradable(), subscribers: this.subs.size };
  }
}
