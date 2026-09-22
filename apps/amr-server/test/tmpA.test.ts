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
test("istek günlüğü: Kanzasset istekleri ve panel değişiklikleri yazılır, ekran yenilemeleri yazılmaz", async () => {
  const s = await setup();
  console.error('X1');
  // Kanzasset ucu (imzasız: 401 bekleriz, kanıt için yine de yazılır)
  await s.app.inject({ method: "GET", url: "/v1/account" });
  // panel okuması: yazılmaz
  await s.app.inject({ method: "GET", url: "/admin/settings" });
  // panel değişikliği: yazılır
  await s.app.inject({ method: "PUT", url: "/admin/settings", headers: { "x-user": "yonetici" }, payload: { "limit.warn_pct": "85" } });
  const r = (await s.app.inject({ method: "GET", url: "/admin/requests" })).json() as { summary: { total: number; retention_days: number }; items: { method: string; path: string; channel: string; status: number; body_sha256: string | null }[] };
  console.error("X2");
  const paths = r.items.map((x) => `${x.method} ${x.path}`);
  assert.ok(paths.includes("GET /v1/account"), "Kanzasset isteği kanıttır");
  assert.ok(paths.includes("PUT /admin/settings"), "panel değişikliği kanıttır");
  assert.ok(!paths.includes("GET /admin/settings"), "ekran yenilemesi günlüğe girmez");
  assert.equal(r.summary.retention_days, 90);
  const put = r.items.find((x) => x.path === "/admin/settings")!;
  assert.match(put.body_sha256 ?? "", /^[0-9a-f]{64}$/, "gövde saklanmaz, sha256 özeti saklanır");
  console.error("X3");
  await s.close();
});
