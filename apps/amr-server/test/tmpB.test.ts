/**
 * İşletim uçları: API dokümanı, sağlık durumu ve istek günlüğü.
 * Bunlar iş kuralı değil, sunumda ve denetimde sorulan "belge var mı, sağlık ucu var mı, kim ne istedi" sorularının karşılığıdır.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/index.ts";
import { listRequests, logRequest, pruneRequests } from "../src/reqlog.ts";

async function setup() {
  const { app, ctx } = await buildApp({ dbPath: ":memory:", autoconnect: false, dispatchEvents: false, sweepOverdue: false, watchCutoff: false });
  return { app, ctx, close: () => app.close() };
}
test("istek günlüğü saklama süresi: süresi geçen satırlar silinir", async () => {
  const s = await setup();
  const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
  const base = { method: "GET", path: "/v1/account", status: 200, duration_ms: 3, channel: "KANZASSET" as const, actor: null, api_key: "kz-dev-key", idempotency_key: null, body_sha256: null, bytes: 0, ip: null, error: null };
  logRequest(s.ctx.db, { ...base, ts: old });
  logRequest(s.ctx.db, { ...base, ts: new Date().toISOString() });
  assert.equal(listRequests(s.ctx.db).length, 2);
  const deleted = pruneRequests(s.ctx.db, 90);
  assert.equal(deleted, 1, "90 günden eski satır silinir");
  assert.equal(listRequests(s.ctx.db).length, 1);
  await s.close();
});
