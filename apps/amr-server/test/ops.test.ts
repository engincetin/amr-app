/**
 * İşletim uçları: API dokümanı, sağlık durumu ve istek günlüğü.
 * Bunlar iş kuralı değil, sunumda ve denetimde sorulan "belge var mı, sağlık ucu var mı, kim ne istedi" sorularının karşılığıdır.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/index.ts";

async function setup() {
  const { app, ctx } = await buildApp({ dbPath: ":memory:", autoconnect: false, dispatchEvents: false, sweepOverdue: false, watchCutoff: false });
  return { app, ctx, close: () => app.close() };
}

test("GET /docs tek sayfalık görüntüleyiciyi döner, dışarıdan dosya çekmez", async () => {
  const s = await setup();
  const res = await s.app.inject({ method: "GET", url: "/docs" });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"] as string, /text\/html/);
  const html = res.body;
  assert.ok(html.includes("/openapi.json"), "belgeyi sunucudan okur");
  assert.ok(!/src=["']https?:/.test(html) && !/href=["']https?:/.test(html), "CDN ya da dış bağlantı yok");
  await s.close();
});

test("GET /openapi.json sözleşme belgesini döner", async () => {
  const s = await setup();
  const res = await s.app.inject({ method: "GET", url: "/openapi.json" });
  assert.equal(res.statusCode, 200);
  const spec = res.json() as { openapi: string; paths: Record<string, unknown> };
  assert.match(spec.openapi, /^3\./);
  assert.ok(Object.keys(spec.paths).length >= 20, "uçlar belgede");
  assert.ok(spec.paths["/v1/orders"], "emir ucu belgede");
  await s.close();
});

test("GET /health alt sistemleri ayrı ayrı bildirir", async () => {
  const s = await setup();
  const res = await s.app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
  const h = res.json() as { status: string; checks: Record<string, { status: string; detail: string }>; uptime_s: number };
  assert.deepEqual(Object.keys(h.checks).sort(), ["database", "events", "publish", "settlement", "source", "vault"]);
  assert.equal(h.checks.database.status, "ok");
  assert.ok(typeof h.uptime_s === "number");
  // merkeze bağlı değiliz ve yayın kapalı: genel durum degraded, HTTP yine 200 (konteyner sağlıklı)
  assert.equal(h.checks.source.status, "degraded");
  assert.equal(h.status, "degraded");
  for (const c of Object.values(h.checks)) assert.ok(c.detail.length > 0, "her kontrol tek cümleyle anlatılır");
  await s.close();
});

test("GET /health yayın açıkken ok döner", async () => {
  const s = await setup();
  s.ctx.publisher.setSourceConnected(true);
  s.ctx.source.state.status = "CONNECTED";
  s.ctx.publisher.onPrice([{ ccy: "USD", bid: "141.80", ask: "142.00" }], new Date().toISOString());
  const h = (await s.app.inject({ method: "GET", url: "/health" })).json() as { status: string; checks: Record<string, { status: string }> };
  assert.equal(h.checks.publish.status, "ok");
  assert.equal(h.status, "ok");
  await s.close();
});
