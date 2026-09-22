/**
 * Kullanıcılar, roller ve yetkiler (Sistem 09 · ekran R11).
 *
 * Roller ve gördükleri: Kasa operasyonu (R1, R4, R6, R7 talepleri, R9) · Üretim (R1, R7, R9) ·
 * Masa (R11 hariç hepsi) · Yönetici (hepsi) · Denetçi (hepsi, salt okunur).
 * Kritik aksiyonlarda iki kişi: parametre değişikliği, elle kasa talimatı, ödeme talimatı, RECONCILE düzeltmesi.
 *
 * Demoda oturum açma yoktur: üst şeritten kullanıcı seçilir ve `X-User` başlığıyla gelir.
 * Yetki kontrolü gerçek kurulumdakiyle aynı kurallarla çalışır.
 */
import type { AppContext } from "./context.ts";
import { now } from "./db.ts";

export type Role = "KASA" | "URETIM" | "MASA" | "YONETICI" | "DENETCI";

export const ROLE_TR: Record<Role, string> = {
  KASA: "Kasa operasyonu", URETIM: "Üretim", MASA: "Masa", YONETICI: "Yönetici", DENETCI: "Denetçi",
};

/** Yetki anahtarları: her elle aksiyon bir yetkiye bağlıdır. */
export type Permission =
  | "vault.accept" | "vault.place" | "delivery.steps" | "refining.steps" | "catalog.edit"
  | "publish.control" | "source.control" | "settlement.request" | "settlement.confirm" | "settlement.payment"
  | "settings.write" | "users.write" | "clients.write";

const MATRIX: Record<Role, Permission[]> = {
  KASA: ["vault.accept", "vault.place", "delivery.steps", "refining.steps"],
  URETIM: ["refining.steps", "catalog.edit"],
  MASA: ["publish.control", "source.control", "delivery.steps", "settlement.request", "settlement.confirm", "settlement.payment"],
  YONETICI: ["vault.accept", "vault.place", "delivery.steps", "refining.steps", "catalog.edit", "publish.control", "source.control", "settlement.request", "settlement.confirm", "settlement.payment", "settings.write", "users.write", "clients.write"],
  DENETCI: [],
};

/** Kritik aksiyonlar: ikinci onay ister (farklı kullanıcı). */
export const SECOND_APPROVAL: Permission[] = ["settings.write", "clients.write", "settlement.payment"];

export interface User { username: string; display_name: string; role: Role; active: boolean }

export function ensureUserTables(db: AppContext["db"]) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_ts TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      requested_ts TEXT NOT NULL,
      approved_by TEXT,
      approved_ts TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING'
    );
  `);
}

export class UserDesk {
  constructor(private ctx: AppContext) {}

  seed() {
    // eski veritabanlarında ad sonundaki "(demo)" eki kaldırılır
    this.ctx.db.prepare("UPDATE users SET display_name = TRIM(REPLACE(display_name, '(demo)', '')) WHERE display_name LIKE '%(demo)%'").run();
    const n = this.ctx.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
    if (n.n > 0) return;
    const rows: [string, string, Role][] = [
      ["masa", "Masa", "MASA"],
      ["kasa", "Kasa operasyonu", "KASA"],
      ["uretim", "Üretim", "URETIM"],
      ["yonetici", "Yönetici", "YONETICI"],
      ["denetci", "Denetçi", "DENETCI"],
    ];
    const ins = this.ctx.db.prepare("INSERT INTO users(username, display_name, role, active, created_ts) VALUES (?, ?, ?, 1, ?)");
    for (const [u, d, r] of rows) ins.run(u, d, r, now());
  }

  list(): User[] {
    return (this.ctx.db.prepare("SELECT username, display_name, role, active FROM users ORDER BY username").all() as any[])
      .map((u) => ({ ...u, active: u.active === 1 }));
  }
  get(username: string): User | undefined {
    const u = this.ctx.db.prepare("SELECT username, display_name, role, active FROM users WHERE username = ?").get(username) as any;
    return u ? { ...u, active: u.active === 1 } : undefined;
  }
  upsert(u: { username: string; display_name?: string; role?: Role; active?: boolean }, actor: string): User {
    const ex = this.get(u.username);
    if (ex) {
      this.ctx.db.prepare("UPDATE users SET display_name = ?, role = ?, active = ? WHERE username = ?")
        .run(u.display_name ?? ex.display_name, u.role ?? ex.role, (u.active ?? ex.active) ? 1 : 0, u.username);
    } else {
      this.ctx.db.prepare("INSERT INTO users(username, display_name, role, active, created_ts) VALUES (?, ?, ?, ?, ?)")
        .run(u.username, u.display_name ?? u.username, u.role ?? "DENETCI", (u.active ?? true) ? 1 : 0, now());
    }
    this.ctx.audit(actor, "users.upsert", ex, this.get(u.username));
    return this.get(u.username)!;
  }

  permissions(role: Role): Permission[] { return MATRIX[role] ?? []; }
  can(username: string | undefined, perm: Permission): boolean {
    const u = username ? this.get(username) : undefined;
    if (!u || !u.active) return false;
    return this.permissions(u.role).includes(perm);
  }

  /** Kritik aksiyon: birinci kullanıcı ister, ikinci kullanıcı onaylar. */
  requestApproval(action: string, payload: unknown, requestedBy: string): number {
    const r = this.ctx.db.prepare("INSERT INTO approvals(action, payload, requested_by, requested_ts) VALUES (?, ?, ?, ?)")
      .run(action, JSON.stringify(payload), requestedBy, now());
    this.ctx.notify("approval.requested", "İkinci onay bekleniyor", `${action} · isteyen ${requestedBy}`, String(r.lastInsertRowid));
    this.ctx.audit(requestedBy, `approval.request:${action}`, undefined, payload);
    return Number(r.lastInsertRowid);
  }
  pendingApprovals() {
    return this.ctx.db.prepare("SELECT * FROM approvals WHERE status = 'PENDING' ORDER BY id DESC").all() as any[];
  }
  /** Onaylayan istekten farklı olmalı. */
  approve(id: number, approver: string): { action: string; payload: unknown } {
    const a = this.ctx.db.prepare("SELECT * FROM approvals WHERE id = ? AND status = 'PENDING'").get(id) as any;
    if (!a) throw new Error("bekleyen onay yok");
    if (a.requested_by === approver) throw new Error("ikinci onay farklı bir kullanıcıdan gelmeli");
    this.ctx.db.prepare("UPDATE approvals SET status = 'APPROVED', approved_by = ?, approved_ts = ? WHERE id = ?").run(approver, now(), id);
    this.ctx.audit(approver, `approval.approve:${a.action}`, undefined, { id, requested_by: a.requested_by });
    return { action: a.action, payload: JSON.parse(a.payload) };
  }
  reject(id: number, actor: string) {
    this.ctx.db.prepare("UPDATE approvals SET status = 'REJECTED', approved_by = ?, approved_ts = ? WHERE id = ? AND status = 'PENDING'").run(actor, now(), id);
    this.ctx.audit(actor, "approval.reject", undefined, { id });
  }
}
