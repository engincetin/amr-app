/**
 * Mahsuplaşma (Akışlar 12) · ekran R8.
 *
 * Gün içinde biriken karşılıklı alacak ve borçların tek seferde kapatılması.
 * Tetik: kesim saati (kendiliğinden) · iki taraftan birinin talebi · cari hesap limiti.
 *
 * Adımlar:
 *   1. Pencere kapanır, iki taraf da ekstre hazırlar (işlem listesi, T net, kur bazında para, hizmet bedelleri, imza).
 *   2. Mutabakat: Kanzasset kendi ekstresinin özetini gönderir; eşitse RECONCILED, değilse MISMATCH + farklar.
 *   3. Altın bacağı: T > 0 → kasa girişi, T < 0 → kasa çıkışı; sonuç T = 0.
 *   4. Para bacağı: kur bazında net; borçlu öder, alan taraf "ödeme alındı" der.
 *   5. Hepsi kapanınca SETTLED, limit sayaçları sıfırlanır.
 *
 * Aynı anda tek açık pencere olur: açık pencere varken yeni talep o pencereyi döner.
 */
import { randomUUID } from "node:crypto";
import type { Account, CurrentAccountStatement, Settlement, SettlementLeg, SettlementStatus, SettlementTrigger } from "@amr/contract";
import { CCYS } from "@amr/contract";
import type { AppContext } from "./context.ts";
import { getSetting, now, setSetting } from "./db.ts";
import { createDocument, currentAccountBalance, listCurrentAccountMovements, postMovements, signContent } from "./ledger.ts";
import { bus } from "./bus.ts";
import { enqueueEvent } from "./events.ts";

export function ensureSettlementTables(db: AppContext["db"]) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settlements (
      settlement_id TEXT PRIMARY KEY,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      window_from TEXT NOT NULL,
      window_to TEXT NOT NULL,
      statement TEXT,
      statement_hash TEXT,
      kz_statement_hash TEXT,
      diffs TEXT,
      gold_leg TEXT,
      money_leg TEXT NOT NULL DEFAULT '[]',
      doc_id TEXT,
      opened_ts TEXT NOT NULL,
      settled_ts TEXT,
      history TEXT NOT NULL DEFAULT '[]',
      scope TEXT NOT NULL DEFAULT '',
      amounts TEXT
    );
  `);
  // eski veritabanları: kapsam sütunu sonradan eklendi (boş = bütün bacaklar)
  const cols = (db.prepare("PRAGMA table_info(settlements)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("scope")) db.exec("ALTER TABLE settlements ADD COLUMN scope TEXT NOT NULL DEFAULT ''");
  if (!cols.includes("amounts")) db.exec("ALTER TABLE settlements ADD COLUMN amounts TEXT");
}

/** Sihirbazda girilen tutarlar: verilmeyen bacak tamamıyla kapatılır. */
export interface RequestedAmounts { gold_mg?: number; money?: { ccy: string; cents: number }[] }
/** İstenen tutar bacağın tamamını aşamaz, eksi olamaz; verilmemişse tamamı. */
function clamp(want: number | undefined, full: number): number {
  if (want === undefined || want === null || !Number.isFinite(want)) return full;
  return Math.max(0, Math.min(full, Math.round(Math.abs(want))));
}

/** Kapsam boşsa bütün bacaklar. Sıra sabittir: önce altın, sonra kurlar. */
export const ALL_LEGS: SettlementLeg[] = ["GOLD", ...CCYS] as SettlementLeg[];
export function parseScope(raw?: string | string[] | null): SettlementLeg[] {
  const list = (Array.isArray(raw) ? raw : String(raw ?? "").split(",")).map((x) => String(x).trim().toUpperCase()).filter(Boolean);
  const picked = ALL_LEGS.filter((l) => list.includes(l));
  return picked.length ? picked : [...ALL_LEGS];
}

const g = (mg: number) => (mg / 1000).toLocaleString("tr-TR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const money = (c: number) => (c / 100).toFixed(2);

export class SettlementError extends Error {
  constructor(msg: string, public code = 409) { super(msg); this.name = "SettlementError"; }
}

export class SettlementDesk {
  constructor(private ctx: AppContext) {}

  /** Açık pencere (kapanmamış mahsuplaşma). Aynı anda en fazla bir tane olur. */
  openWindow(): Settlement | undefined {
    const r = this.ctx.db.prepare("SELECT * FROM settlements WHERE status != 'SETTLED' ORDER BY opened_ts DESC LIMIT 1").get() as any;
    return r ? this.toResponse(r) : undefined;
  }
  get(id: string): Settlement | undefined {
    const r = this.ctx.db.prepare("SELECT * FROM settlements WHERE settlement_id = ?").get(id) as any;
    return r ? this.toResponse(r) : undefined;
  }
  list(limit = 100): Settlement[] {
    return (this.ctx.db.prepare("SELECT * FROM settlements ORDER BY opened_ts DESC LIMIT ?").all(limit) as any[]).map((r) => this.toResponse(r));
  }

  /**
   * Pencere açar ve ekstre taslağını üretir. Açık pencere varsa onu döner (iki taraf da çağırabilir).
   * Tetik: CUTOFF (kesim saati) · REQUEST_KZ · REQUEST_AMR · LIMIT.
   */
  open(trigger: SettlementTrigger, note?: string, scope?: SettlementLeg[], amounts?: RequestedAmounts): Settlement {
    const existing = this.openWindow();
    if (existing) return existing;

    const db = this.ctx.db;
    const id = `stl_${randomUUID().slice(0, 8)}`;
    const to = now();
    const from = getSetting(db, "settlement.last_window_to", `${to.slice(0, 10)}T00:00:00.000Z`);
    const ts = to;
    const legs = scope?.length ? scope : [...ALL_LEGS];
    db.prepare("INSERT INTO settlements(settlement_id, trigger, status, window_from, window_to, opened_ts, history, scope, amounts) VALUES (?, ?, 'OPEN', ?, ?, ?, ?, ?, ?)")
      .run(id, trigger, from, to, ts, JSON.stringify([{ status: "OPEN", ts, note: note ?? `tetik: ${trigger}` }]), legs.join(","), amounts ? JSON.stringify(amounts) : null);

    this.ctx.notify("settlement.opened", "Mahsuplaşma penceresi açıldı", `${this.triggerText(trigger)} · kapsam ${this.scopeText(legs)}${note ? ` · ${note}` : ""}`, id);
    enqueueEvent(this.ctx, "settlement.opened", { settlement_id: id, trigger, window_from: from, window_to: to, scope: legs });
    return this.draft(id);
  }

  /** Ekstre taslağı: işlemler, T net, kur bazında para, hizmet bedelleri, imza. */
  draft(id: string): Settlement {
    const db = this.ctx.db;
    const row = this.requireRow(id, "OPEN", "DRAFT", "MISMATCH");
    const movements = listCurrentAccountMovements(db, { from: row.window_from, to: row.window_to, limit: 5000 });
    const bal = currentAccountBalance(db);
    const fees = movements.filter((m) => m.type === "FEE_DELIVERY" || m.type === "FEE_REFINING")
      .map((m) => ({ type: m.type, ccy: m.ccy!, amount_cents: m.amount_cents ?? 0 }));
    const base = { window_from: row.window_from, window_to: row.window_to, movements, gold_mg: bal.gold_mg, money: bal.money, fees };
    const { hash, signature } = signContent(db, base);
    const statement: CurrentAccountStatement = { ...base, hash, signature };

    // kapsam: yalnız seçilen bacaklar bu pencerede kapatılır, kalanı bir sonraki pencereye kalır
    const legs = parseScope(row.scope);
    const want: RequestedAmounts = row.amounts ? JSON.parse(row.amounts) : {};
    const goldIn = legs.includes("GOLD");
    const goldFull = goldIn ? Math.abs(bal.gold_mg) : 0;
    // istenen tutar bacağın tamamını aşamaz; verilmemişse tamamı kapatılır
    const goldWant = clamp(want.gold_mg, goldFull);
    const prevGold = JSON.parse(row.gold_leg ?? "null");
    const goldLeg = {
      t_net_mg: goldIn ? bal.gold_mg : 0,
      direction: goldIn && goldWant > 0 ? (bal.gold_mg > 0 ? "VAULT_IN" : "VAULT_OUT") : "NONE",
      qty_mg: goldFull,
      requested_mg: goldWant,
      settled_mg: prevGold?.settled_mg ?? 0,
      requests: (prevGold?.requests ?? []) as string[],
      done: goldWant === 0 || (prevGold?.settled_mg ?? 0) >= goldWant,
      ...(prevGold?.proposed_ts ? { proposed_ts: prevGold.proposed_ts } : {}),
      ...(prevGold?.approved_ts ? { approved_ts: prevGold.approved_ts } : {}),
    };
    const moneyLeg = CCYS.filter((ccy) => legs.includes(ccy as SettlementLeg)).map((ccy) => {
      const cents = bal.money.find((m) => m.ccy === ccy)?.cents ?? 0;
      const wanted = clamp(want.money?.find((m) => m.ccy === ccy)?.cents, Math.abs(cents));
      return {
        ccy,
        net_cents: cents,
        requested_cents: wanted,
        direction: wanted === 0 ? "NONE" : cents < 0 ? "KZ_TO_AMR" : "AMR_TO_KZ",
        paid: wanted === 0,
      };
    });

    db.prepare("UPDATE settlements SET status = 'DRAFT', statement = ?, statement_hash = ?, gold_leg = ?, money_leg = ?, history = ? WHERE settlement_id = ?")
      .run(JSON.stringify(statement), hash, JSON.stringify(goldLeg), JSON.stringify(moneyLeg), this.push(row, "DRAFT", `ekstre taslağı: T ${g(bal.gold_mg)} g · ${bal.money.map((m) => `${m.ccy} ${money(m.cents)}`).join(" · ")}`), row.settlement_id);

    const out = this.get(row.settlement_id)!;
    enqueueEvent(this.ctx, "settlement.statement", out, this.ctx.orders.account());
    bus.publish({ kind: "settlement", item: out });
    return out;
  }

  /** Mutabakat: Kanzasset ekstre özetini gönderir. Eşitse RECONCILED, değilse MISMATCH ve farklar. */
  confirm(id: string, kzHash: string, kzTotals?: { gold_mg?: number; money?: { ccy: string; cents: number }[] }): Settlement {
    const row = this.requireRow(id, "DRAFT", "MISMATCH", "RECONCILED");
    const statement: CurrentAccountStatement = JSON.parse(row.statement);
    if (kzHash === row.statement_hash) {
      this.ctx.db.prepare("UPDATE settlements SET status = 'RECONCILED', kz_statement_hash = ?, diffs = NULL, history = ? WHERE settlement_id = ?")
        .run(kzHash, this.push(row, "RECONCILED", "özetler eşit: mutabakat tamam"), row.settlement_id);
      // rafineri gram borçluysa "kasaya koyalım mı" teklifi mutabakatla aynı anda gider:
      // olay gövdesi teklifi de taşısın diye önce teklif işlenir, sonra reconciled olayı çıkar
      let out = this.get(row.settlement_id)!;
      if (out.gold_leg?.direction === "VAULT_IN" && !out.gold_leg.proposed_ts) out = this.proposeGold(row.settlement_id);
      this.ctx.notify("settlement.reconciled", "Mutabakat sağlandı", `${row.settlement_id} · altın ve para bacağı açılabilir`, row.settlement_id);
      enqueueEvent(this.ctx, "settlement.reconciled", out);
      bus.publish({ kind: "settlement", item: out });
      // kapsamdaki bacakların hepsi zaten sıfırsa yapacak iş yoktur: pencere burada kapanır
      return this.maybeSettle(row.settlement_id);
    }
    // fark satırları: KZ toplamları verdiyse alan alan karşılaştır
    const diffs: { field: string; amr: string; kz: string }[] = [];
    if (kzTotals) {
      if (kzTotals.gold_mg !== undefined && kzTotals.gold_mg !== statement.gold_mg) diffs.push({ field: "T (altın)", amr: g(statement.gold_mg), kz: g(kzTotals.gold_mg) });
      for (const m of statement.money) {
        const k = kzTotals.money?.find((x) => x.ccy === m.ccy);
        if (k && k.cents !== m.cents) diffs.push({ field: `para ${m.ccy}`, amr: money(m.cents), kz: money(k.cents) });
      }
    }
    if (diffs.length === 0) diffs.push({ field: "ekstre özeti", amr: row.statement_hash ?? "", kz: kzHash });
    this.ctx.db.prepare("UPDATE settlements SET status = 'MISMATCH', kz_statement_hash = ?, diffs = ?, history = ? WHERE settlement_id = ?")
      .run(kzHash, JSON.stringify(diffs), this.push(row, "MISMATCH", `${diffs.length} fark satırı; ödeme bekler`), row.settlement_id);
    const out = this.get(row.settlement_id)!;
    this.ctx.notify("settlement.mismatch", "Mutabakatta fark var", `${row.settlement_id} · ${diffs.length} satır; düzeltilip yeniden ekstre çıkarılmalı`, row.settlement_id);
    enqueueEvent(this.ctx, "settlement.mismatch", out);
    bus.publish({ kind: "settlement", item: out });
    return out;
  }

  /**
   * Altın bacağı teklifi: rafineri bize gram borçluyken (T > 0) "kasaya koyalım mı" diye sorar.
   * Kanzasset onaylamadan kasa girişi talebi gelmez, fiş kesilmez, mint olmaz.
   */
  proposeGold(id: string): Settlement {
    const row = this.requireRow(id, "RECONCILED", "PAYMENT_PENDING");
    const leg = JSON.parse(row.gold_leg ?? "null");
    if (!leg || leg.direction !== "VAULT_IN") throw new SettlementError("altın bacağı kasa girişi değil: teklif yok");
    if (leg.proposed_ts) return this.get(id)!;
    leg.proposed_ts = now();
    this.ctx.db.prepare("UPDATE settlements SET gold_leg = ?, history = ? WHERE settlement_id = ?")
      .run(JSON.stringify(leg), this.push(row, row.status as SettlementStatus, `altın teklifi: ${g(leg.qty_mg)} g kasaya konsun mu`), id);
    this.ctx.notify("settlement.gold_proposed", "Altın bacağı teklifi gönderildi", `${g(leg.qty_mg)} g kasaya konsun mu · Kanzasset onayı bekleniyor`, id);
    enqueueEvent(this.ctx, "settlement.gold_proposed", { settlement_id: id, direction: leg.direction, qty_mg: leg.qty_mg, proposed_ts: leg.proposed_ts });
    const out = this.get(id)!;
    bus.publish({ kind: "settlement", item: out });
    return out;
  }

  /** Kanzasset teklifi onayladı: kasa girişi talebi artık gelebilir. */
  approveGold(id: string): Settlement {
    const row = this.requireRow(id, "RECONCILED", "PAYMENT_PENDING");
    const leg = JSON.parse(row.gold_leg ?? "null");
    if (!leg || leg.direction !== "VAULT_IN") throw new SettlementError("altın bacağı kasa girişi değil: onay yok");
    if (!leg.proposed_ts) leg.proposed_ts = now();
    if (leg.approved_ts) return this.get(id)!;
    leg.approved_ts = now();
    this.ctx.db.prepare("UPDATE settlements SET gold_leg = ?, history = ? WHERE settlement_id = ?")
      .run(JSON.stringify(leg), this.push(row, row.status as SettlementStatus, `Kanzasset altın teklifini onayladı: ${g(leg.qty_mg)} g · kasa girişi talebi bekleniyor`), id);
    this.ctx.notify("settlement.gold_approved", "Altın teklifi onaylandı", `${g(leg.qty_mg)} g · kasa girişi talebi bekleniyor`, id);
    enqueueEvent(this.ctx, "settlement.gold_approved", { settlement_id: id, qty_mg: leg.qty_mg, approved_ts: leg.approved_ts });
    const out = this.get(id)!;
    bus.publish({ kind: "settlement", item: out });
    return out;
  }

  /** Altın bacağı Kanzasset'in kasa talimatıyla kapanır; kasa talimatı kabul edilince buradan işaretlenir. */
  markGoldLeg(id: string, requestRef: string, qtyMg = 0): Settlement {
    const row = this.requireRow(id, "RECONCILED", "PAYMENT_PENDING");
    const leg = JSON.parse(row.gold_leg ?? "null");
    if (!leg) throw new SettlementError("altın bacağı yok");
    if (!leg.requests.includes(requestRef)) {
      leg.requests.push(requestRef);
      leg.settled_mg = (leg.settled_mg ?? 0) + qtyMg;
    }
    const t = currentAccountBalance(this.ctx.db).gold_mg;
    // kısmi mahsuplaşmada T sıfırlanmaz: ölçüt istenen miktarın kapanmasıdır
    leg.done = leg.requested_mg === 0 || leg.settled_mg >= leg.requested_mg || t === 0;
    this.ctx.db.prepare("UPDATE settlements SET gold_leg = ?, history = ? WHERE settlement_id = ?")
      .run(JSON.stringify(leg), this.push(row, row.status as SettlementStatus, `altın bacağı: ${requestRef} · kapanan ${g(leg.settled_mg)} / ${g(leg.requested_mg)} g · T ${g(t)} g${leg.done ? " · kapandı" : ""}`), row.settlement_id);
    return this.maybeSettle(row.settlement_id);
  }

  /**
   * Kasa talimatı kabul edildiğinde çağrılır: açık pencere mutabakat aşamasındaysa
   * altın bacağı bu talimatla ilerler ve T sıfırlandıysa pencere kapanmaya hazır olur.
   */
  onVaultAccepted(requestRef: string, qtyMg = 0): void {
    const w = this.openWindow();
    if (!w || (w.status !== "RECONCILED" && w.status !== "PAYMENT_PENDING")) return;
    try { this.markGoldLeg(w.settlement_id, requestRef, qtyMg); } catch { /* pencere uygun değilse atla */ }
  }

  /** Ödeme bildirimi: ödeyen taraf banka referansıyla bildirir. */
  paymentNotice(id: string, ccy: string, amountCents: number, direction: string, bankRef: string): Settlement {
    const row = this.requireRow(id, "RECONCILED", "PAYMENT_PENDING");
    const legs = JSON.parse(row.money_leg);
    const leg = legs.find((l: any) => l.ccy === ccy);
    if (!leg) throw new SettlementError(`kur yok: ${ccy}`);
    leg.bank_ref = bankRef;
    leg.notice_ts = now();
    this.ctx.db.prepare("UPDATE settlements SET status = 'PAYMENT_PENDING', money_leg = ?, history = ? WHERE settlement_id = ?")
      .run(JSON.stringify(legs), this.push(row, "PAYMENT_PENDING", `ödeme bildirimi ${ccy} ${money(amountCents)} · ${direction} · banka ref ${bankRef}`), row.settlement_id);
    const out = this.get(row.settlement_id)!;
    this.ctx.notify("settlement.payment_notice", "Ödeme bildirimi", `${ccy} ${money(amountCents)} · ${bankRef}`, row.settlement_id);
    enqueueEvent(this.ctx, "settlement.payment_notice", { settlement_id: row.settlement_id, ccy, amount_cents: amountCents, direction, bank_ref: bankRef });
    bus.publish({ kind: "settlement", item: out });
    return out;
  }

  /** Ödeme alındı: alan taraf onaylar; kur kapanır ve hepsi kapanınca pencere SETTLED olur. */
  paymentReceived(id: string, ccy: string, bankRef?: string): Settlement {
    const row = this.requireRow(id, "RECONCILED", "PAYMENT_PENDING");
    const legs = JSON.parse(row.money_leg);
    const leg = legs.find((l: any) => l.ccy === ccy);
    if (!leg) throw new SettlementError(`kur yok: ${ccy}`);
    if (leg.paid) return this.get(row.settlement_id)!;
    leg.paid = true;
    leg.received_ts = now();
    if (bankRef) leg.bank_ref = bankRef;
    // kısmi mahsuplaşmada yalnız istenen tutar kapanır, kalanı cari hesapta durur
    const amount = Math.sign(leg.net_cents) * Math.min(Math.abs(leg.net_cents), leg.requested_cents ?? Math.abs(leg.net_cents));
    this.ctx.db.prepare("UPDATE settlements SET money_leg = ?, history = ? WHERE settlement_id = ?")
      .run(JSON.stringify(legs), this.push(row, row.status as SettlementStatus, `ödeme alındı ${ccy} ${money(amount)}${Math.abs(amount) < Math.abs(leg.net_cents) ? ` (kısmi; net ${money(leg.net_cents)})` : ""}`), row.settlement_id);
    this.settleMoney(row.settlement_id, ccy, amount);
    return this.maybeSettle(row.settlement_id);
  }

  /** Kesim saati geldi mi (settlement.cutoff_local, settlement.timezone, windows_per_day). */
  cutoffDue(): boolean {
    const db = this.ctx.db;
    const cutoff = getSetting(db, "settlement.cutoff_local", "17:00");
    const tz = getSetting(db, "settlement.timezone", "Asia/Dubai");
    const perDay = Number(getSetting(db, "settlement.windows_per_day", "1"));
    const nowD = new Date();
    const local = new Intl.DateTimeFormat("tr-TR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(nowD);
    const day = new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(nowD);
    const [ch, cm] = cutoff.split(":").map(Number);
    const [lh, lm] = local.split(":").map(Number);
    const minutesNow = lh * 60 + lm;
    // gün içi pencereler: kesim saatinden geriye doğru eşit aralık
    const slots: number[] = [];
    const cut = ch * 60 + cm;
    for (let i = 0; i < Math.max(1, perDay); i++) slots.push(cut - i * Math.floor((24 * 60) / Math.max(1, perDay)));
    const lastKey = getSetting(db, "settlement.last_cutoff_key", "");
    for (const s of slots) {
      const norm = ((s % 1440) + 1440) % 1440;
      if (minutesNow >= norm) {
        const key = `${day}-${norm}`;
        if (key !== lastKey && !this.keyDone(key)) { setSetting(db, "settlement.last_cutoff_key", key); return true; }
      }
    }
    return false;
  }
  private keyDone(key: string) { return getSetting(this.ctx.db, "settlement.last_cutoff_key", "") === key; }

  // ---------- iç ----------

  /** Ödeme cari hesabın para tarafını kapatır: ters işaretli mahsuplaşma ödemesi kalemi. */
  private settleMoney(id: string, ccy: string, netCents: number) {
    if (netCents === 0) return;
    postMovements(this.ctx.db, { current: [{ type: "SETTLEMENT_PAYMENT", gold_mg: 0, ccy: ccy as any, amount_cents: -netCents, ref: id, related_id: id }] });
  }

  private maybeSettle(id: string): Settlement {
    const row = this.requireRow(id, "RECONCILED", "PAYMENT_PENDING");
    const legs = JSON.parse(row.money_leg);
    const gold = JSON.parse(row.gold_leg ?? "null");
    const moneyDone = legs.every((l: any) => l.paid || (l.requested_cents ?? Math.abs(l.net_cents)) === 0);
    // altın bacağı Kanzasset'in kasa talimatıyla kapanır: ölçüt canlı T'nin sıfırlanmasıdır
    const goldDone = !gold || gold.direction === "NONE" || (gold.requested_mg ?? 0) === 0
      || (gold.settled_mg ?? 0) >= gold.requested_mg || currentAccountBalance(this.ctx.db).gold_mg === 0;
    if (gold && goldDone && !gold.done) {
      gold.done = true;
      this.ctx.db.prepare("UPDATE settlements SET gold_leg = ? WHERE settlement_id = ?").run(JSON.stringify(gold), id);
    }
    if (!moneyDone || !goldDone) {
      bus.publish({ kind: "settlement", item: this.get(id)! });
      return this.get(id)!;
    }
    const ts = now();
    const statement: CurrentAccountStatement = JSON.parse(row.statement);
    const doc = createDocument(this.ctx.db, "SETTLEMENT_STATEMENT", id, {
      title: "Mahsuplaşma Ekstresi", settlement_id: id, trigger: row.trigger,
      window_from: row.window_from, window_to: row.window_to,
      scope: parseScope(row.scope).join(", "),
      gold_leg: gold ? `${gold.direction} ${g(gold.qty_mg)} g · talimatlar ${gold.requests.join(", ") || "yok"}` : "yok",
      money_leg: legs.map((l: any) => `${l.ccy} ${money(l.net_cents)} ${l.direction}${l.bank_ref ? ` (${l.bank_ref})` : ""}`).join(" · "),
      statement_hash: row.statement_hash, movements: statement.movements.length, settled_ts: ts,
    });
    this.ctx.db.prepare("UPDATE settlements SET status = 'SETTLED', settled_ts = ?, doc_id = ?, history = ? WHERE settlement_id = ?")
      .run(ts, doc.meta.doc_id, this.push(row, "SETTLED", "altın ve para bacağı kapandı · limit sayaçları sıfırlandı"), id);
    setSetting(this.ctx.db, "settlement.last_window_to", row.window_to);
    const out = this.get(id)!;
    this.ctx.notify("settlement.settled", "Mahsuplaşma kapandı", `${id} · limit sayaçları sıfırlandı`, id);
    enqueueEvent(this.ctx, "settlement.settled", out, this.ctx.orders.account());
    bus.publish({ kind: "settlement", item: out });
    bus.publish({ kind: "account", account: this.ctx.orders.account() });
    return out;
  }

  private requireRow(id: string, ...allowed: SettlementStatus[]): any {
    const r = this.ctx.db.prepare("SELECT * FROM settlements WHERE settlement_id = ?").get(id) as any;
    if (!r) throw new SettlementError(`mahsuplaşma yok: ${id}`, 404);
    if (allowed.length && !allowed.includes(r.status)) throw new SettlementError(`pencere ${r.status} durumunda; beklenen ${allowed.join(" / ")}`);
    return r;
  }
  private push(row: any, status: SettlementStatus, note: string) {
    return JSON.stringify([...JSON.parse(row.history), { status, ts: now(), note }]);
  }
  private scopeText(legs: SettlementLeg[]) {
    return legs.length === ALL_LEGS.length ? "tümü" : legs.map((l) => (l === "GOLD" ? "altın" : l)).join(" + ");
  }
  private triggerText(t: SettlementTrigger) {
    return { CUTOFF: "kesim saati", REQUEST_KZ: "Kanzasset talebi", REQUEST_AMR: "rafineri talebi", LIMIT: "cari hesap limiti" }[t] ?? t;
  }

  private toResponse(r: any): Settlement {
    const s: Settlement = {
      settlement_id: r.settlement_id, trigger: r.trigger, status: r.status,
      window_from: r.window_from, window_to: r.window_to,
      money_leg: JSON.parse(r.money_leg), opened_ts: r.opened_ts, history: JSON.parse(r.history),
      scope: parseScope(r.scope),
    };
    if (r.statement) s.statement = JSON.parse(r.statement);
    if (r.statement_hash) s.statement_hash = r.statement_hash;
    if (r.kz_statement_hash) s.kz_statement_hash = r.kz_statement_hash;
    if (r.diffs) s.diffs = JSON.parse(r.diffs);
    if (r.gold_leg) s.gold_leg = JSON.parse(r.gold_leg);
    if (r.doc_id) s.doc_id = r.doc_id;
    if (r.settled_ts) s.settled_ts = r.settled_ts;
    return s;
  }
}


/** Kesim saatini izler: saati gelince pencere kendiliğinden açılır (talep gelmese de). */
export class CutoffWatcher {
  private timer: NodeJS.Timeout | null = null;
  constructor(private desk: SettlementDesk, private everyMs = 60_000) {}
  start() { this.timer = setInterval(() => this.tick(), this.everyMs); }
  stop() { if (this.timer) clearInterval(this.timer); }
  tick() { if (this.desk.cutoffDue()) this.desk.open("CUTOFF", "kesim saati geldi"); }
}
