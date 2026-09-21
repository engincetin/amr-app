/**
 * Fiziksel teslimat (Akışlar 10) ve rafinasyon (Akışlar 11) testleri · ekranlar R6, R7.
 * Kasa etkisi: READY kasada −x / sevkiyatta +x (V toplamı değişmez), DELIVERED sevkiyatta −x (V −x),
 * READY'den iptalde külçe kasaya döner. Onaylanan bedel cari hesaba kalem olur.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/index.ts";
import { openingBalance } from "../src/ledger.ts";
import { setSetting } from "../src/db.ts";

async function setup(openingMg = 20_000_000) {
  const { app, ctx } = await buildApp({ dbPath: ":memory:", autoconnect: false, dispatchEvents: false, sweepOverdue: false });
  openingBalance(ctx.db, openingMg);
  return { app, ctx, close: () => app.close() };
}
const V = (ctx: any) => { const a = ctx.orders.account(); return a.vault.in_vault_mg + a.vault.placing_mg + a.vault.shipping_mg; };
const usd = (ctx: any) => ctx.orders.account().current_account.money.find((m: any) => m.ccy === "USD").cents;

test("10 teslimat: talep → teklif → onay (bedel cari hesaba) → hazır (Sevkiyat Fişi) → sevk → teslim (V −x)", async () => {
  const s = await setup();
  try {
    const d = s.ctx.deliveries.request({ qty_mg: 1_000_000, address_ref: "ADR-77", insured_party_ref: "SIG-77", ref: "KZ-DL-0001" });
    assert.equal(d.status, "REQUESTED");

    const q = s.ctx.deliveries.quote(d.delivery_id, { carrier: "Brinks", amount_cents: 45_000, ccy: "USD" }, "masa");
    assert.equal(q.status, "QUOTED");
    assert.ok(q.quote?.doc_id?.startsWith("LT-"), `Lojistik Teklifi bekleniyordu: ${q.quote?.doc_id}`);
    assert.equal(usd(s.ctx), 0, "teklif tek başına cari hesabı etkilemez");

    const a = s.ctx.deliveries.approve(d.delivery_id, q.quote!.quote_id);
    assert.equal(a.status, "APPROVED");
    assert.equal(usd(s.ctx), -45_000, "lojistik bedeli Kanzasset borcu");

    s.ctx.deliveries.preparing(d.delivery_id, "kasa");
    const vBefore = V(s.ctx);
    const r = s.ctx.deliveries.ready(d.delivery_id, "kasa");
    assert.ok(r.shipping_doc_id?.startsWith("SF-"), `Sevkiyat Fişi bekleniyordu: ${r.shipping_doc_id}`);
    let acc = s.ctx.orders.account();
    assert.equal(acc.vault.in_vault_mg, 19_000_000);
    assert.equal(acc.vault.shipping_mg, 1_000_000);
    assert.equal(V(s.ctx), vBefore, "hazır adımı V toplamını değiştirmez: külçe hâlâ bizim");

    s.ctx.deliveries.shipped(d.delivery_id, "Brinks", "TRK-123", "kasa");
    const done = s.ctx.deliveries.delivered(d.delivery_id, "kasa");
    assert.equal(done.status, "DELIVERED");
    assert.ok(done.pod_doc_id?.startsWith("TK-"), `Teslimat Kaydı bekleniyordu: ${done.pod_doc_id}`);
    acc = s.ctx.orders.account();
    assert.equal(acc.vault.shipping_mg, 0);
    assert.equal(V(s.ctx), 19_000_000, "teslimde V −x");
  } finally { await s.close(); }
});

test("10 kural: kasada yeterli gram yoksa talep reddedilir (INSUFFICIENT_VAULT)", async () => {
  const s = await setup(500_000);
  try {
    assert.throws(() => s.ctx.deliveries.request({ qty_mg: 1_000_000, address_ref: "A", insured_party_ref: "S", ref: "KZ-DL-9" }), /kasada/);
  } finally { await s.close(); }
});

test("10 iptal: hazırdan iptalde külçe kasaya döner, sevkiyattan sonra iptal edilemez", async () => {
  const s = await setup();
  try {
    const d = s.ctx.deliveries.request({ qty_mg: 2_000_000, address_ref: "A", insured_party_ref: "S", ref: "KZ-DL-0002" });
    const q = s.ctx.deliveries.quote(d.delivery_id, { carrier: "Brinks", amount_cents: 1_000, ccy: "USD" }, "masa");
    s.ctx.deliveries.approve(d.delivery_id, q.quote!.quote_id);
    s.ctx.deliveries.ready(d.delivery_id, "kasa");
    assert.equal(s.ctx.orders.account().vault.shipping_mg, 2_000_000);

    const c = s.ctx.deliveries.cancel(d.delivery_id, "müşteri vazgeçti", "masa");
    assert.equal(c.status, "CANCELLED");
    const acc = s.ctx.orders.account();
    assert.equal(acc.vault.shipping_mg, 0);
    assert.equal(acc.vault.in_vault_mg, 20_000_000, "külçe kasaya döndü");

    const d2 = s.ctx.deliveries.request({ qty_mg: 1_000_000, address_ref: "A", insured_party_ref: "S", ref: "KZ-DL-0003" });
    const q2 = s.ctx.deliveries.quote(d2.delivery_id, { carrier: "Brinks", amount_cents: 1_000, ccy: "USD" }, "masa");
    s.ctx.deliveries.approve(d2.delivery_id, q2.quote!.quote_id);
    s.ctx.deliveries.ready(d2.delivery_id, "kasa");
    s.ctx.deliveries.shipped(d2.delivery_id, "Brinks", "TRK-9", "kasa");
    assert.throws(() => s.ctx.deliveries.cancel(d2.delivery_id, "geç kaldı", "masa"), /SHIPPED durumunda/);
  } finally { await s.close(); }
});

test("10 süresi dolan teklif onaylanamaz (QUOTE_EXPIRED)", async () => {
  const s = await setup();
  try {
    const d = s.ctx.deliveries.request({ qty_mg: 1_000_000, address_ref: "A", insured_party_ref: "S", ref: "KZ-DL-0004" });
    s.ctx.deliveries.quote(d.delivery_id, { carrier: "Brinks", amount_cents: 1_000, ccy: "USD", valid_hours: -1 }, "masa");
    assert.throws(() => s.ctx.deliveries.approve(d.delivery_id, undefined), /teklif süresi doldu/);
  } finally { await s.close(); }
});

test("11 katalog: varsayılan ürünler yüklenir, düzenlemede sürüm artar", async () => {
  const s = await setup();
  try {
    const c0 = s.ctx.catalog.get();
    assert.ok(c0.items.length >= 10, "katalog tohumlandı");
    assert.equal(c0.items.find((i) => i.item_id === "1kg")?.weight_mg, 1_000_000);
    const c1 = s.ctx.catalog.upsert({ item_id: "1kg", unit_price_cents: 99_000 }, "uretim");
    assert.equal(c1.version, c0.version + 1);
    assert.equal(c1.items.find((i) => i.item_id === "1kg")?.unit_price_cents, 99_000);
    const c2 = s.ctx.catalog.upsert({ item_id: "5g", active: false }, "uretim");
    assert.equal(c2.items.find((i) => i.item_id === "5g")?.active, false);
    assert.throws(() => s.ctx.refining.request({ items: [{ item_id: "5g", qty: 1 }], address_ref: "A", insured_party_ref: "S", ref: "KZ-RF-X" }), /pasif/);
  } finally { await s.close(); }
});

test("11 rafinasyon: kalemler → toplam saf gram → teklif → onay → üretim → hazır → teslim", async () => {
  const s = await setup();
  try {
    const r = s.ctx.refining.request({ items: [{ item_id: "100g", qty: 5 }, { item_id: "1kg", qty: 2 }], address_ref: "ADR-5", insured_party_ref: "SIG-5", ref: "KZ-RF-0001" });
    assert.equal(r.total_mg, 5 * 100_000 + 2 * 1_000_000, "toplam saf gram");
    assert.equal(r.status, "REQUESTED");

    const q = s.ctx.refining.quote(r.refining_id, { product_cents: 190_000, logistics_cents: 60_000, ccy: "USD", lead_time_days: 7 }, "uretim");
    assert.ok(q.quote?.doc_id?.startsWith("RT-"), `Rafinasyon Teklifi bekleniyordu: ${q.quote?.doc_id}`);

    s.ctx.refining.approve(r.refining_id, q.quote!.quote_id);
    assert.equal(usd(s.ctx), -250_000, "ürün bedeli + lojistik cari hesaba");

    s.ctx.refining.inProduction(r.refining_id, "uretim");
    const ready = s.ctx.refining.ready(r.refining_id, "uretim");
    assert.ok(ready.shipping_doc_id?.startsWith("SF-"));
    assert.equal(s.ctx.orders.account().vault.shipping_mg, 2_500_000);

    s.ctx.refining.shipped(r.refining_id, "Brinks", "TRK-77", "kasa");
    const done = s.ctx.refining.delivered(r.refining_id, "kasa");
    assert.equal(done.status, "DELIVERED");
    assert.equal(V(s.ctx), 20_000_000 - 2_500_000, "teslimde V −x");
  } finally { await s.close(); }
});

test("11 iptal üretime kadar: üretimdeyken iptal edilemez", async () => {
  const s = await setup();
  try {
    const r = s.ctx.refining.request({ items: [{ item_id: "10g", qty: 3 }], address_ref: "A", insured_party_ref: "S", ref: "KZ-RF-0002" });
    const q = s.ctx.refining.quote(r.refining_id, { product_cents: 1_000, logistics_cents: 500, ccy: "USD", lead_time_days: 2 }, "uretim");
    s.ctx.refining.approve(r.refining_id, q.quote!.quote_id);
    s.ctx.refining.inProduction(r.refining_id, "uretim");
    assert.throws(() => s.ctx.refining.cancel(r.refining_id, "vazgeçildi", "uretim"), /IN_PRODUCTION durumunda/);
  } finally { await s.close(); }
});

test("11 kural: kasada toplam saf gram yetmezse talep reddedilir", async () => {
  const s = await setup(1_000_000);
  try {
    assert.throws(() => s.ctx.refining.request({ items: [{ item_id: "1kg", qty: 2 }], address_ref: "A", insured_party_ref: "S", ref: "KZ-RF-0003" }), /kasada/);
  } finally { await s.close(); }
});

test("aynı ref ile tekrar gelen teslimat talebi aynı talebi döner", async () => {
  const s = await setup();
  try {
    const a = s.ctx.deliveries.request({ qty_mg: 1_000, address_ref: "A", insured_party_ref: "S", ref: "KZ-DL-TEK" });
    const b = s.ctx.deliveries.request({ qty_mg: 1_000, address_ref: "A", insured_party_ref: "S", ref: "KZ-DL-TEK" });
    assert.equal(a.delivery_id, b.delivery_id);
    assert.equal(s.ctx.deliveries.list().length, 1);
  } finally { await s.close(); }
});

test("teklif geçerlilik süreleri ayarlardan gelir (lojistik 24 sa, rafinasyon 48 sa)", async () => {
  const s = await setup();
  try {
    setSetting(s.ctx.db, "quote.delivery_valid_hours", "12");
    const d = s.ctx.deliveries.request({ qty_mg: 1_000, address_ref: "A", insured_party_ref: "S", ref: "KZ-DL-0005" });
    const q = s.ctx.deliveries.quote(d.delivery_id, { carrier: "X", amount_cents: 100, ccy: "USD" }, "masa");
    const hours = (Date.parse(q.quote!.valid_until) - Date.now()) / 3_600_000;
    assert.ok(hours > 11.9 && hours < 12.1, `12 saat bekleniyordu, ${hours}`);
  } finally { await s.close(); }
});
