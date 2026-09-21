/** Uygulama içi olay veriyolu: yönetim ekranlarına canlı akış (SSE) ve bildirimler için. */
import { EventEmitter } from "node:events";

export type BusEvent =
  | { kind: "tick"; seq: number; ts: string; tradable: boolean; prices: unknown }
  | { kind: "source"; state: unknown }
  | { kind: "publish"; state: unknown }
  | { kind: "subscribers"; count: number }
  | { kind: "notification"; id: number; type: string; title: string; body: string; created_ts: string }
  | { kind: "order"; order: unknown }
  | { kind: "vault"; request: unknown }
  | { kind: "account"; account: unknown }
  | { kind: "event"; event: { event_id: string; type: string; ts: string; status: string; error?: string | null } }
  | { kind: "heartbeat"; ts: string };

class Bus extends EventEmitter {
  publish(ev: BusEvent) {
    this.emit("event", ev);
  }
}
export const bus = new Bus();
bus.setMaxListeners(100);
