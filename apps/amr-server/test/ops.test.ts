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
