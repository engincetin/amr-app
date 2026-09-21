/**
 * Mahsuplaşma (Akışlar 12), belgeler (R9) ve kullanıcılar / roller (R10) testleri.
 * Örnek gün dokümandaki gibi: alışlar ve satışlar sonrası T net ve kur bazında para netleşir.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/index.ts";
import { openingBalance, postMovements, currentAccountBalance, getDocument } from "../src/ledger.ts";
import { setSetting } from "../src/db.ts";
import { documentPdf } from "../src/pdf.ts";

async function setup(openingMg = 20_000_000) {
  const { app, ctx } = await buildApp({ dbPath: ":memory:", autoconnect: false, dispatchEvents: false, sweepOverdue: false, watchCutoff: false });
  openingBalance(ctx.db, openingMg);
  return { app, ctx, close: () => app.close() };
}
/** Emir yerine doğrudan cari hesap hareketi. */
const trade = (ctx: any, goldMg: number, cents: number) =>
  postMovements(ctx.db, { current: [{ type: goldMg >= 0 ? "FILL_BUY" : "FILL_SELL", gold_mg: goldMg, ccy: "USD", amount_cents: cents, ref: "test" }] });

test("12 pencere: kesim tetiğiyle açılır, ekstre taslağı T ve kur bazında parayı verir", async () => {
  const s = await setup();
  try {
    trade(s.ctx, 15_947_640, -2_264_564_88);
    trade(s.ctx, -3_000_000, 425_400_00);
    const w = s.ctx.settlement.open("CUTOFF", "kesim saati");
    assert.equal(w.status, "DRAFT");
    assert.equal(w.statement?.gold_mg, 12_947_640);
    assert.equal(w.gold_leg?.direction, "VAULT_IN");
    assert.equal(w.gold_leg?.qty_mg, 12_947_640);
    const usd = w.money_leg.find((m) => m.ccy === "USD")!;
    assert.equal(usd.net_cents, -2_264_564_88 + 425_400_00, "net 1.839.164,88 USD Kanzasset borçlu");
    assert.equal(usd.direction, "KZ_TO_AMR");
    assert.ok(w.statement?.signature.match(/^[0-9a-f]{64}$/));
  } finally { await s.close(); }
});

test("12 açık pencere varken yeni talep aynı pencereyi döner", async () => {
  const s = await setup();
  try {
    const a = s.ctx.settlement.open("REQUEST_KZ");
    const b = s.ctx.settlement.open("REQUEST_AMR");
    assert.equal(a.settlement_id, b.settlement_id);
    assert.equal(s.ctx.settlement.list().length, 1);
  } finally { await s.close(); }
});

test("12 mutabakat: özet eşitse RECONCILED, farklıysa MISMATCH ve fark satırları", async () => {
  const s = await setup();
  try {
    trade(s.ctx, 1_000_000, -142_000);
    const w = s.ctx.settlement.open("CUTOFF");
    const bad = s.ctx.settlement.confirm(w.settlement_id, "farkli-ozet", { gold_mg: 999_000, money: [{ ccy: "USD", cents: -142_000 }] });
    assert.equal(bad.status, "MISMATCH");
    assert.equal(bad.diffs?.[0].field, "T (altın)");
    const ok = s.ctx.settlement.confirm(w.settlement_id, w.statement_hash!);
    assert.equal(ok.status, "RECONCILED");
    assert.equal(ok.diffs, undefined);
  } finally { await s.close(); }
});

test("12 altın ve para bacağı kapanınca SETTLED, ödeme cari hesabı kapatır", async () => {
  const s = await setup();
  try {
    trade(s.ctx, 0, -500_000); // yalnız para borcu
    const w = s.ctx.settlement.open("CUTOFF");
    s.ctx.settlement.confirm(w.settlement_id, w.statement_hash!);
    assert.equal(s.ctx.settlement.get(w.settlement_id)!.gold_leg?.direction, "NONE");

    const pn = s.ctx.settlement.paymentNotice(w.settlement_id, "USD", 500_000, "KZ_TO_AMR", "BANK-REF-1");
    assert.equal(pn.status, "PAYMENT_PENDING");
    const done = s.ctx.settlement.paymentReceived(w.settlement_id, "USD", "BANK-REF-1");
    assert.equal(done.status, "SETTLED");
    assert.ok(done.doc_id?.startsWith("ME-"), `Mahsuplaşma Ekstresi bekleniyordu: ${done.doc_id}`);
    assert.equal(currentAccountBalance(s.ctx.db).money.find((m) => m.ccy === "USD")!.cents, 0, "para tarafı kapandı");
  } finally { await s.close(); }
});

test("12 altın bacağı kasa talimatıyla kapanır: T sıfırlanmadan SETTLED olmaz", async () => {
  const s = await setup();
  try {
    trade(s.ctx, 7_000_000, 0);
    const w = s.ctx.settlement.open("CUTOFF");
    s.ctx.settlement.confirm(w.settlement_id, w.statement_hash!);
    // kasa girişi henüz kabul edilmedi: T duruyor, pencere kapanamaz
    const cur = s.ctx.settlement.markGoldLeg(w.settlement_id, "KZ-VI-9000");
    assert.notEqual(cur.status, "SETTLED", "T sıfırlanmadan kapanmaz");
    assert.equal(cur.gold_leg?.done, false);

    // kasa talimatı kabul edilince altın bacağı kendiliğinden kapanır ve pencere biter
    const vr = s.ctx.vault.request("IN", 7_000_000, "KZ-VI-9000");
    s.ctx.vault.accept((vr.body as any).request_id, "kasa");
    const after = s.ctx.settlement.get(w.settlement_id)!;
    assert.equal(after.gold_leg?.done, true, "kasa kabulü altın bacağını kapattı");
    assert.deepEqual(after.gold_leg?.requests, ["KZ-VI-9000"]);
    assert.equal(after.status, "SETTLED", "altın bacağı kapandı, para bacağı sıfır");
    assert.ok(after.doc_id?.startsWith("ME-"));
  } finally { await s.close(); }
});

test("12 kesim saati: ayarlanan saat geçtiyse bir kez tetiklenir", async () => {
  const s = await setup();
  try {
    setSetting(s.ctx.db, "settlement.cutoff_local", "00:01");
    setSetting(s.ctx.db, "settlement.timezone", "Asia/Dubai");
    assert.equal(s.ctx.settlement.cutoffDue(), true, "saat geçmiş olmalı");
    assert.equal(s.ctx.settlement.cutoffDue(), false, "aynı pencere ikinci kez tetiklenmez");
  } finally { await s.close(); }
});

test("belge PDF'i üretilir: A4, başlık, belge no ve imza özeti içerir", async () => {
  const s = await setup();
  try {
    trade(s.ctx, 1_000_000, 0);
    const vr = s.ctx.vault.request("IN", 1_000_000, "KZ-VI-PDF");
    const acc = s.ctx.vault.accept((vr.body as any).request_id, "kasa");
    const doc = getDocument(s.ctx.db, acc.doc_id!)!;
    const pdf = documentPdf(doc);
    const text = pdf.toString("latin1");
    assert.ok(text.startsWith("%PDF-1.4"), "PDF başlığı");
    assert.ok(text.includes("%%EOF"));
    assert.ok(text.includes("/MediaBox [0 0 595 842]"), "A4");
    assert.ok(text.includes("AHLATCI METAL REFINERY"), "rafineri başlığı");
    assert.ok(text.includes(doc.meta.doc_id), "belge no");
    assert.ok(text.includes(doc.meta.hash.slice(0, 16)), "imza özeti");
    assert.ok(text.includes("WinAnsiEncoding"), "Türkçe karakter kodlaması");
    assert.ok(pdf.length > 800);
  } finally { await s.close(); }
});

test("PDF Türkçe karakterleri WinAnsi baytlarıyla yazar", async () => {
  const s = await setup();
  try {
    const doc = { meta: { doc_id: "TEST-1", type: "VAULT_IN_SLIP" as const, related_id: "x", hash: "a".repeat(64), signature: "b".repeat(64), created_ts: new Date().toISOString() }, content: { title: "Deneme", statement: "Gramlar kasa hesabında Kanzasset FZCO adına tutulmaktadır: değişiklik, şube, İzmir, çıkış, ölçü, ürün." } };
    const text = documentPdf(doc).toString("latin1");
    assert.ok(text.includes("\\375"), "ı harfi (0xFD)");
    assert.ok(text.includes("\\360"), "ğ harfi (0xF0)");
    assert.ok(text.includes("\\232"), "ş harfi (0x9A)");
    assert.ok(text.includes("\\335"), "İ harfi (0xDD)");
    assert.ok(text.includes("\\347"), "ç harfi (0xE7)");
    assert.ok(text.includes("\\366"), "ö harfi (0xF6)");
    assert.ok(text.includes("\\374"), "ü harfi (0xFC)");
  } finally { await s.close(); }
});

test("roller: Denetçi hiçbir elle aksiyon yapamaz, Kasa kasa talebini kabul eder", async () => {
  const s = await setup();
  try {
    assert.equal(s.ctx.users.can("denetci", "vault.accept"), false);
    assert.equal(s.ctx.users.can("kasa", "vault.accept"), true);
    assert.equal(s.ctx.users.can("kasa", "settings.write"), false);
    assert.equal(s.ctx.users.can("yonetici", "settings.write"), true);
    assert.equal(s.ctx.users.can("uretim", "catalog.edit"), true);
    assert.equal(s.ctx.users.can("masa", "publish.control"), true);
    assert.equal(s.ctx.users.can("bilinmeyen", "vault.accept"), false);
  } finally { await s.close(); }
});

test("ikinci onay: aynı kullanıcı onaylayamaz, farklı kullanıcı onaylayınca değer uygulanır", async () => {
  const s = await setup();
  try {
    const id = s.ctx.users.requestApproval("settings.update", { "limit.warn_pct": "70" }, "yonetici");
    assert.throws(() => s.ctx.users.approve(id, "yonetici"), /farklı bir kullanıcıdan/);
    const r = s.ctx.users.approve(id, "masa");
    assert.equal(r.action, "settings.update");
    assert.deepEqual(r.payload, { "limit.warn_pct": "70" });
    assert.equal(s.ctx.users.pendingApprovals().length, 0);
  } finally { await s.close(); }
});

test("kullanıcı ekleme ve rol değiştirme denetim günlüğüne yazılır", async () => {
  const s = await setup();
  try {
    const u = s.ctx.users.upsert({ username: "ayse", display_name: "Ayşe", role: "KASA" }, "yonetici");
    assert.equal(u.role, "KASA");
    const u2 = s.ctx.users.upsert({ username: "ayse", role: "YONETICI" }, "yonetici");
    assert.equal(u2.role, "YONETICI");
    assert.equal(u2.display_name, "Ayşe", "verilmeyen alan korunur");
    const log = s.ctx.db.prepare("SELECT action FROM audit_log WHERE action = 'users.upsert'").all() as any[];
    assert.equal(log.length, 2);
  } finally { await s.close(); }
});
