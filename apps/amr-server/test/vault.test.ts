/**
 * Kasa talimatları testleri (Akışlar 05 Kasa girişi, 06 Kasa çıkışı, Kontroller · ekran R4).
 * Rakamlar dokümandaki örneklerle aynı: büyük alışta eksik 5.947,640 g kasa girişi (07),
 * büyük satışta 10.000 g kasa çıkışı (08), açılış devri 20 kg (09).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/index.ts";
import { setSetting } from "../src/db.ts";
import { openingBalance, postMovements } from "../src/ledger.ts";
import type { VaultRequest } from "@amr/contract";

async function setup(opts: { openingMg?: number } = {}) {
  const { app, ctx } = await buildApp({ dbPath: ":memory:", autoconnect: false, dispatchEvents: false, sweepOverdue: false });
  if (opts.openingMg) openingBalance(ctx.db, opts.openingMg);
  ctx.publisher.setSourceConnected(true);
  ctx.publisher.onPrice([{ ccy: "USD", bid: "141.80", ask: "142.00" }, { ccy: "EUR", bid: "130.30", ask: "130.48" }, { ccy: "AED", bid: "520.80", ask: "521.53" }], new Date().toISOString());
  /** Emir yerine doğrudan cari hesaba gram koyar (kasa talimatı testleri emir motorundan bağımsız olsun diye). */
  const seedGold = (mg: number) => postMovements(ctx.db, { current: [{ type: mg >= 0 ? "FILL_BUY" : "FILL_SELL", gold_mg: mg, ref: "test" }] });
  return { app, ctx, seedGold, close: () => app.close() };
}
const ok = (b: unknown) => b as VaultRequest;

test("kasa girişi 5.947,640 g: kabulde Kasa Giriş Fişi, T −5.947,640, kasaya konuluyor +5.947,640", async () => {
  const s = await setup({ openingMg: 20_000_000 });
  try {
    s.seedGold(5_947_640);
    const r = s.ctx.vault.request("IN", 5_947_640, "KZ-VI-1042");
    assert.equal(r.code, 200);
    assert.equal(ok(r.body).status, "REQUESTED");
    assert.equal(ok(r.body).doc_id, undefined, "fiş yalnız kabulde oluşur");

    const a = s.ctx.vault.accept(ok(r.body).request_id, "kasa");
    assert.equal(a.status, "ACCEPTED");
    assert.ok(a.doc_id?.startsWith("KGF-"), `Kasa Giriş Fişi bekleniyordu: ${a.doc_id}`);
    assert.ok(a.due_ts, "kasaya koyma vadesi (T+3) verilmeli");

    const acc = s.ctx.orders.account();
    assert.equal(acc.current_account.gold_mg, 0, "T sıfırlandı");
    assert.equal(acc.vault.placing_mg, 5_947_640);
    assert.equal(acc.vault.in_vault_mg, 20_000_000, "kasada henüz değişmez");
  } finally { await s.close(); }
});

test("kasaya konuluyor → kasaya konuldu: kasaya konuluyor −q, kasada +q (V toplamı değişmez)", async () => {
  const s = await setup({ openingMg: 20_000_000 });
  try {
    s.seedGold(5_947_640);
    const id = ok(s.ctx.vault.request("IN", 5_947_640, "KZ-VI-1042").body).request_id;
    s.ctx.vault.accept(id, "kasa");
    const vTotal = (a = s.ctx.orders.account()) => a.vault.in_vault_mg + a.vault.placing_mg + a.vault.shipping_mg;
    const before = vTotal();

    assert.equal(s.ctx.vault.placing(id, "kasa").status, "PLACING");
    const p = s.ctx.vault.placed(id, "kasa");
    assert.equal(p.status, "PLACED");
    assert.ok(p.placed_ts);

    const acc = s.ctx.orders.account();
    assert.equal(acc.vault.placing_mg, 0);
    assert.equal(acc.vault.in_vault_mg, 25_947_640, "20.000 + 5.947,640");
    assert.equal(vTotal(acc), before, "kasaya koyma V toplamını değiştirmez");
  } finally { await s.close(); }
});

test("kasa çıkışı 10.000 g: kabulde Kasa Çıkış Fişi, kasada −10.000, T +10.000 (çıkış kabulle biter)", async () => {
  const s = await setup({ openingMg: 20_000_000 });
  try {
    s.seedGold(-10_000_000); // 08: satış emri sonrası T −10.000
    const r = s.ctx.vault.request("OUT", 10_000_000, "KZ-VO-0311");
    const a = s.ctx.vault.accept(ok(r.body).request_id, "kasa");
    assert.equal(a.status, "ACCEPTED");
    assert.ok(a.doc_id?.startsWith("KCF-"), `Kasa Çıkış Fişi bekleniyordu: ${a.doc_id}`);
    assert.equal(a.due_ts, undefined, "çıkışta kasaya koyma vadesi yok");

    const acc = s.ctx.orders.account();
    assert.equal(acc.vault.in_vault_mg, 10_000_000);
    assert.equal(acc.current_account.gold_mg, 0, "T kapandı");
  } finally { await s.close(); }
});

test("kural: giriş için cari hesap altını yetersizse INSUFFICIENT_CURRENT_ACCOUNT", async () => {
  const s = await setup({ openingMg: 20_000_000 });
  try {
    s.seedGold(1_000_000);
    const r = s.ctx.vault.request("IN", 5_947_640, "KZ-VI-9001");
    assert.equal(r.code, 409);
    assert.equal((r.body as any).reject_reason, "INSUFFICIENT_CURRENT_ACCOUNT");
  } finally { await s.close(); }
});

test("kural: çıkış için kasada yetersizse INSUFFICIENT_VAULT; kasaya konuluyor sayılmaz", async () => {
  const s = await setup({ openingMg: 1_000_000 });
  try {
    s.seedGold(5_000_000);
    // 5.000 g kasaya konuluyor kalemine girsin: kasada hâlâ 1.000 g
    const inId = ok(s.ctx.vault.request("IN", 5_000_000, "KZ-VI-2001").body).request_id;
    s.ctx.vault.accept(inId, "kasa");
    assert.equal(s.ctx.orders.account().vault.placing_mg, 5_000_000);

    const r = s.ctx.vault.request("OUT", 3_000_000, "KZ-VO-2002");
    assert.equal(r.code, 409);
    assert.equal((r.body as any).reject_reason, "INSUFFICIENT_VAULT");
    assert.match((r.body as any).error, /kasaya konuluyor sayılmaz/);
  } finally { await s.close(); }
});

test("aynı ref ile tekrar gelen talep aynı talebi döner (çift mint koruması); farklı gövde 409", async () => {
  const s = await setup({ openingMg: 20_000_000 });
  try {
    s.seedGold(2_000_000);
    const a = ok(s.ctx.vault.request("IN", 1_000_000, "KZ-VI-3001").body);
    const b = ok(s.ctx.vault.request("IN", 1_000_000, "KZ-VI-3001").body);
    assert.equal(a.request_id, b.request_id);
    assert.equal(s.ctx.vault.list().length, 1);
    assert.equal(s.ctx.vault.request("IN", 500_000, "KZ-VI-3001").code, 409);
  } finally { await s.close(); }
});

test("red: gerekçeyle reddedilen talepte gram cari hesapta kalır", async () => {
  const s = await setup({ openingMg: 20_000_000 });
  try {
    s.seedGold(1_000_000);
    const id = ok(s.ctx.vault.request("IN", 1_000_000, "KZ-VI-4001").body).request_id;
    const r = s.ctx.vault.reject(id, "kasa kapasitesi dolu", "kasa");
    assert.equal(r.status, "REJECTED");
    assert.equal(r.reject_reason, "kasa kapasitesi dolu");
    assert.equal(s.ctx.orders.account().current_account.gold_mg, 1_000_000, "defter değişmez");
    assert.equal(s.ctx.orders.account().vault.placing_mg, 0);
  } finally { await s.close(); }
});

test("kabulde kural yeniden bakılır: araya giren satış gramı götürdüyse talep reddedilir", async () => {
  const s = await setup({ openingMg: 20_000_000 });
  try {
    s.seedGold(1_000_000);
    const id = ok(s.ctx.vault.request("IN", 1_000_000, "KZ-VI-5001").body).request_id;
    s.seedGold(-900_000); // talep ile kabul arasında satış
    const r = s.ctx.vault.accept(id, "kasa");
    assert.equal(r.status, "REJECTED");
    assert.match(r.reject_reason ?? "", /cari hesap altını/);
  } finally { await s.close(); }
});

test("T+3: vadesi geçen kasa girişi OVERDUE olur, kasaya konuldu ile gecikmeli kapanır", async () => {
  const s = await setup({ openingMg: 20_000_000 });
  try {
    setSetting(s.ctx.db, "vault.placement_due_days", "-1"); // vade dün dolmuş olsun
    s.seedGold(1_000_000);
    const id = ok(s.ctx.vault.request("IN", 1_000_000, "KZ-VI-6001").body).request_id;
    s.ctx.vault.accept(id, "kasa");

    const swept = s.ctx.vault.sweepOverdue();
    assert.equal(swept.length, 1);
    assert.equal(swept[0].status, "OVERDUE");
    assert.equal(s.ctx.vault.sweepOverdue().length, 0, "ikinci tarama tekrar işaretlemez");

    const p = s.ctx.vault.placed(id, "kasa");
    assert.equal(p.status, "PLACED");
    assert.equal(s.ctx.orders.account().vault.in_vault_mg, 21_000_000);
  } finally { await s.close(); }
});

test("otomatik kabul (vault.accept_mode = AUTO): talep gelir gelmez fiş oluşur", async () => {
  const s = await setup({ openingMg: 20_000_000 });
  try {
    setSetting(s.ctx.db, "vault.accept_mode", "AUTO");
    s.seedGold(1_000_000);
    const r = ok(s.ctx.vault.request("IN", 1_000_000, "KZ-VI-7001").body);
    assert.equal(r.status, "ACCEPTED");
    assert.ok(r.doc_id?.startsWith("KGF-"));
  } finally { await s.close(); }
});

test("günlük kasa ekstresi: açılış, kapanış, fiş referansları, imza (rezerv kanıtı V ≥ A)", async () => {
  const s = await setup({ openingMg: 20_000_000 });
  try {
    s.seedGold(5_947_640);
    const id = ok(s.ctx.vault.request("IN", 5_947_640, "KZ-VI-8001").body).request_id;
    s.ctx.vault.accept(id, "kasa");
    s.ctx.vault.placed(id, "kasa");

    const st = s.ctx.vault.statement();
    assert.equal(st.closing.in_vault_mg, 25_947_640);
    assert.equal(st.closing.placing_mg, 0);
    assert.equal(st.total_mg, 25_947_640);
    assert.equal(st.slips.length, 1);
    assert.equal(st.slips[0].type, "VAULT_IN_SLIP");
    assert.ok(st.movements.length >= 3, "açılış + kabul + konuldu");
    assert.match(st.signature, /^[0-9a-f]{64}$/);
  } finally { await s.close(); }
});
