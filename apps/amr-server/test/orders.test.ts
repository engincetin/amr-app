/**
 * Emir motoru testleri (Akışlar 03, 04, Durum · Cevapsız emir, K3).
 * Rakamlar dokümandaki örneklerle aynı: 70,104 g × 142,00 = 9.954,77 USD · 50 g × 141,80 = 7.090,00 USD.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/index.ts";
import { setSetting } from "../src/db.ts";
import { hmacHex } from "../src/auth.ts";
import { signingString, type OrderRequest, type OrderResponse } from "@amr/contract";

async function setup() {
  const { app, ctx } = await buildApp({ dbPath: ":memory:", autoconnect: false, dispatchEvents: false });
  ctx.publisher.setSourceConnected(true);
  ctx.publisher.onPrice([{ ccy: "USD", bid: "141.80", ask: "142.00" }, { ccy: "EUR", bid: "130.30", ask: "130.48" }, { ccy: "AED", bid: "520.80", ask: "521.53" }], new Date().toISOString());
  const seq = ctx.publisher.snapshotState().seq;
  const order = (o: Partial<OrderRequest>): OrderRequest => ({ client_order_id: `kz-${Math.random().toString(36).slice(2, 8)}`, side: "BUY", qty_mg: 70_104, ccy: "USD", quote_seq: seq, limit_px: "143.42", tif: "FOK", time_limit_ms: 3000, ...o });
  return { app, ctx, seq, order, close: () => app.close() };
}

test("stoktan alış: 70,104 g @ 142,00 → 9.954,77 USD, Tahsis Belgesi, T +70,104, P[USD] −9.954,77", async () => {
  const s = await setup();
  try {
    const r = await s.ctx.orders.place(s.order({}));
    const b = r.body as OrderResponse;
    assert.equal(r.code, 200);
    assert.equal(b.status, "FILLED");
    assert.equal(b.fill?.px, "142.00");
    assert.equal(b.fill?.amount_cents, 995_477);
    assert.ok(b.allocation_certificate?.doc_id.startsWith("TB-"));
    assert.equal(b.account?.current_account.gold_mg, 70_104);
    assert.equal(b.account?.current_account.money.find((m) => m.ccy === "USD")?.cents, -995_477);
    assert.equal(b.account?.seq, 1);
  } finally { await s.close(); }
});

test("stoktan satış: 50 g @ 141,80 → 7.090,00 USD, T −50, P[USD] +7.090,00 (rafineri borçlu)", async () => {
  const s = await setup();
  try {
    const r = await s.ctx.orders.place(s.order({ side: "SELL", qty_mg: 50_000, limit_px: "140.38" }));
    const b = r.body as OrderResponse;
    assert.equal(b.status, "FILLED");
    assert.equal(b.fill?.px, "141.80");
    assert.equal(b.fill?.amount_cents, 709_000);
    assert.equal(b.allocation_certificate, undefined);
    assert.equal(b.account?.current_account.gold_mg, -50_000);
    assert.equal(b.account?.current_account.money.find((m) => m.ccy === "USD")?.cents, 709_000);
  } finally { await s.close(); }
});

test("aynı client_order_id: aynı cevap; farklı gövde ile DUPLICATE_ORDER (409)", async () => {
  const s = await setup();
  try {
    const o = s.order({});
    const a = (await s.ctx.orders.place(o)).body as OrderResponse;
    const b = (await s.ctx.orders.place(o)).body as OrderResponse;
    assert.equal(a.order_id, b.order_id);
    assert.equal(s.ctx.orders.list().length, 1);
    const c = await s.ctx.orders.place({ ...o, qty_mg: 1_000 });
    assert.equal(c.code, 409);
    assert.equal((c.body as any).reject_reason, "DUPLICATE_ORDER");
  } finally { await s.close(); }
});

test("red sebepleri: STALE_QUOTE, PRICE_OUTSIDE_LIMIT, TRADING_HALTED, CURRENT_ACCOUNT_LIMIT", async () => {
  const s = await setup();
  try {
    const stale = (await s.ctx.orders.place(s.order({ quote_seq: 999 }))).body as OrderResponse;
    assert.equal(stale.reject_reason, "STALE_QUOTE");
    const px = (await s.ctx.orders.place(s.order({ limit_px: "141.99" }))).body as OrderResponse; // ask 142,00 > limit
    assert.equal(px.reject_reason, "PRICE_OUTSIDE_LIMIT");
    const pxSell = (await s.ctx.orders.place(s.order({ side: "SELL", limit_px: "141.81" }))).body as OrderResponse; // bid 141,80 < taban
    assert.equal(pxSell.reject_reason, "PRICE_OUTSIDE_LIMIT");
    const big = (await s.ctx.orders.place(s.order({ qty_mg: 20_000_000, limit_px: "150.00" }))).body as OrderResponse; // limit 15 kg
    assert.equal(big.reject_reason, "CURRENT_ACCOUNT_LIMIT");
    s.ctx.publisher.halt("test");
    const halted = (await s.ctx.orders.place(s.order({}))).body as OrderResponse;
    assert.equal(halted.reject_reason, "TRADING_HALTED");
    assert.equal(s.ctx.orders.account().current_account.gold_mg, 0, "red hareket doğurmaz");
  } finally { await s.close(); }
});

test("cevapsız emir: gecikmeli kararda iptal → CANCELLED (kesin cevap); fill sonrası iptal → FILLED (geç fill)", async () => {
  const s = await setup();
  try {
    setSetting(s.ctx.db, "debug.order_delay_ms", "400");
    const o = s.order({});
    const placing = s.ctx.orders.place(o);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(s.ctx.orders.status(o.client_order_id)?.status, "RECEIVED");
    const c = s.ctx.orders.cancel(o.client_order_id);
    assert.equal(c?.status, "CANCELLED");
    assert.equal(((await placing).body as OrderResponse).status, "CANCELLED");
    assert.equal(s.ctx.orders.account().current_account.gold_mg, 0);

    setSetting(s.ctx.db, "debug.order_delay_ms", "0");
    const o2 = s.order({});
    const f = (await s.ctx.orders.place(o2)).body as OrderResponse;
    assert.equal(f.status, "FILLED");
    const late = s.ctx.orders.cancel(o2.client_order_id);
    assert.equal(late?.status, "FILLED", "işlenmiş emir iptal edilmez, mevcut sonuç döner");
  } finally { await s.close(); }
});

test("REST: HMAC ham gövde üzerinden; imza tutmazsa 401", async () => {
  const s = await setup();
  try {
    const body = JSON.stringify(s.order({}));
    const ts = new Date().toISOString();
    const headers = { "content-type": "application/json", "x-api-key": "kz-dev-key", "x-timestamp": ts, "x-signature": hmacHex("kz-dev-secret", signingString(ts, "POST", "/v1/orders", body)) };
    const ok = await s.app.inject({ method: "POST", url: "/v1/orders", headers, payload: body });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().status, "FILLED");
    const bad = await s.app.inject({ method: "POST", url: "/v1/orders", headers, payload: body.replace("70104", "70105") });
    assert.equal(bad.statusCode, 401);
    const acc = await s.app.inject({ method: "GET", url: "/v1/account", headers: { "x-api-key": "kz-dev-key", "x-timestamp": ts, "x-signature": hmacHex("kz-dev-secret", signingString(ts, "GET", "/v1/account")) } });
    assert.equal(acc.json().current_account.gold_mg, 70_104);
  } finally { await s.close(); }
});
