import type { Db } from "./db.ts";
import type { Publisher } from "./publisher.ts";
import type { SourceConnection } from "./source.ts";
import type { OrderEngine } from "./orders.ts";
import type { VaultDesk } from "./vault.ts";

export interface AppContext {
  db: Db;
  publisher: Publisher;
  source: SourceConnection;
  /** emir motoru (Sprint 2); buildApp içinde atanır */
  orders: OrderEngine;
  /** kasa talimatları (Sprint 3, R4); buildApp içinde atanır */
  vault: VaultDesk;
  /** bildirim oluşturur ve canlı akışa düşürür */
  notify: (type: string, title: string, body?: string, relatedId?: string) => number;
  /** elle aksiyon günlüğü */
  audit: (actor: string, action: string, before?: unknown, after?: unknown) => void;
}
