import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.ts";
import { Publisher } from "../src/publisher.ts";
import { SourceConnection } from "../src/source.ts";
import { hmacHex, verify } from "../src/auth.ts";
import { ensureApiClient } from "../src/db.ts";
import { signingString } from "@amr/contract";

const P = (usd: [string, string]) => [
  { ccy: "USD" as const, bid: usd[0], ask: usd[1] },
  { ccy: "EUR" as const, bid: "130.27", ask: "130.45" },
  { ccy: "AED" as const, bid: "520.79", ask: "521.52" },
];

test("tick yalnız fiyat değişince ve seq artar", () => {
  const db = openDb(":memory:");
  const pub = new Publisher(db);
  pub.setSourceConnected(true);
  const s0 = pub.snapshotState().seq;
  pub.onPrice(P(["141.80", "142.00"]), new Date().toISOString());
  assert.equal(pub.snapshotState().seq, s0 + 1);
  pub.onPrice(P(["141.80", "142.00"]), new Date().toISOString()); // aynı fiyat → tick yok
  assert.equal(pub.snapshotState().seq, s0 + 1);
  assert.equal(pub.snapshotState().tradable, true);
  pub.stop();
});

test("tradable = merkez bağlı && elle durdurulmamış", () => {
  const db = openDb(":memory:");
  const pub = new Publisher(db);
  assert.equal(pub.snapshotState().tradable, false);
  pub.setSourceConnected(true);
  assert.equal(pub.snapshotState().tradable, true);
  pub.halt("bakım");
  assert.equal(pub.snapshotState().tradable, false);
  assert.equal(pub.snapshotState().haltReason, "bakım");
  pub.resume();
  assert.equal(pub.snapshotState().tradable, true);
  pub.setSourceConnected(false);
  assert.equal(pub.snapshotState().tradable, false);
  pub.stop();
});

test("elle durdurma yeniden başlatmada kalıcıdır (sqlite)", () => {
  const db = openDb(":memory:");
  const p1 = new Publisher(db);
  p1.halt("test");
  p1.stop();
  const p2 = new Publisher(db);
  assert.equal(p2.snapshotState().manualHalt, true);
  p2.stop();
});

test("merkez mesajı sözleşme fiyatına çevrilir, tanınmayan mesaj atlanır", () => {
  const src = new SourceConnection();
  const ok = src.parse(JSON.stringify({ type: "price", ts: "2026-09-21T09:15:02.120Z", prices: { USD: { bid: 141.8, ask: 142 }, EUR: { bid: 130.27, ask: 130.45 }, AED: { bid: 520.79, ask: 521.52 } } }));
  assert.ok(ok);
  assert.equal(ok!.prices[0].ccy, "USD");
  assert.equal(ok!.prices[0].ask, "142");
  assert.equal(src.parse(JSON.stringify({ type: "hello" })), null);
  assert.equal(src.parse("bozuk"), null);
});

test("HMAC imza doğrulaması", () => {
  const db = openDb(":memory:");
  ensureApiClient(db, "k1", "Kanzasset", "s1");
  const ts = new Date().toISOString();
  const sig = hmacHex("s1", signingString(ts, "GET", "/v1/prices"));
  assert.equal(verify(db, "k1", ts, sig, "GET", "/v1/prices").ok, true);
  assert.equal(verify(db, "k1", ts, "00", "GET", "/v1/prices").ok, false);
  assert.equal(verify(db, "yok", ts, sig, "GET", "/v1/prices").ok, false);
  const old = new Date(Date.now() - 10 * 60_000).toISOString();
  assert.equal(verify(db, "k1", old, hmacHex("s1", signingString(old, "GET", "/v1/prices")), "GET", "/v1/prices").ok, false);
});
