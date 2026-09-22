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

test("istek günlüğü: Kanzasset istekleri ve panel değişiklikleri yazılır, ekran yenilemeleri yazılmaz", async () => {
  const s = await setup();
  // Kanzasset ucu (imzasız: 401 bekleriz, kanıt için yine de yazılır)
  await s.app.inject({ method: "GET", url: "/v1/account" });
  // panel okuması: yazılmaz
  await s.app.inject({ method: "GET", url: "/admin/settings" });
  // panel değişikliği: yazılır
  await s.app.inject({ method: "PUT", url: "/admin/settings", headers: { "x-user": "yonetici" }, payload: { "limit.warn_pct": "85" } });
  const r = (await s.app.inject({ method: "GET", url: "/admin/requests" })).json() as { summary: { total: number; retention_days: number }; items: { method: string; path: string; channel: string; status: number; body_sha256: string | null }[] };
  const paths = r.items.map((x) => `${x.method} ${x.path}`);
  assert.ok(paths.includes("GET /v1/account"), "Kanzasset isteği kanıttır");
  assert.ok(paths.includes("PUT /admin/settings"), "panel değişikliği kanıttır");
  assert.ok(!paths.includes("GET /admin/settings"), "ekran yenilemesi günlüğe girmez");
  assert.equal(r.summary.retention_days, 90);
  const put = r.items.find((x) => x.path === "/admin/settings")!;
  assert.match(put.body_sha256 ?? "", /^[0-9a-f]{64}$/, "gövde saklanmaz, sha256 özeti saklanır");
  await s.close();
});

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

test("ikinci onay verilince kritik aksiyon uygulanır (onay ile uygulama aynı yerde)", async () => {
  const s = await setup();
  s.ctx.users.seed();
  // 1) yönetici parametre değişikliği ister: uygulanmaz, onay numarası döner
  const asked = await s.app.inject({ method: "PUT", url: "/admin/settings", headers: { "x-user": "yonetici" }, payload: { "limit.warn_pct": "73" } });
  assert.equal(asked.statusCode, 202);
  const { approval_id } = asked.json() as { approval_id: number };
  assert.equal((await s.app.inject({ method: "GET", url: "/admin/settings" })).json<Record<string, string>>()["limit.warn_pct"], "80", "onaysız değişmez");

  // 2) aynı kullanıcı onaylayamaz
  const same = await s.app.inject({ method: "POST", url: `/admin/approvals/${approval_id}/approve`, payload: { approver: "yonetici" } });
  assert.equal(same.statusCode, 409);

  // 3) farklı kullanıcı onaylayınca sunucu uygular: ayrıca "bir daha gönder" gerekmez
  const ok = await s.app.inject({ method: "POST", url: `/admin/approvals/${approval_id}/approve`, payload: { approver: "masa" } });
  assert.equal(ok.statusCode, 200);
  assert.match((ok.json() as { applied: string }).applied, /parametreler güncellendi/);
  assert.equal((await s.app.inject({ method: "GET", url: "/admin/settings" })).json<Record<string, string>>()["limit.warn_pct"], "73");

  // 4) aynı onay ikinci kez kullanılamaz
  assert.equal((await s.app.inject({ method: "POST", url: `/admin/approvals/${approval_id}/approve`, payload: { approver: "kasa" } })).statusCode, 409);
  await s.close();
});

test("kayıtlar ucu: kaynak seçimi, metin süzme ve sayfalama", async () => {
  const s = await setup();
  await s.app.inject({ method: "GET", url: "/v1/account" });
  await s.app.inject({ method: "PUT", url: "/admin/settings", headers: { "x-user": "yonetici" }, payload: { "limit.warn_pct": "77" } });

  const all = (await s.app.inject({ method: "GET", url: "/admin/logs?source=requests&limit=50" })).json() as { items: { what: string }[]; total: number; source: string };
  assert.equal(all.source, "requests");
  assert.ok(all.total >= 2);

  const filtered = (await s.app.inject({ method: "GET", url: "/admin/logs?source=requests&q=account" })).json() as { items: { what: string }[]; total: number };
  assert.ok(filtered.items.every((x) => x.what.includes("account")), "süzgeç yalnız eşleşenleri döner");

  const page1 = (await s.app.inject({ method: "GET", url: "/admin/logs?source=requests&limit=1&offset=0" })).json() as { items: { what: string }[] };
  const page2 = (await s.app.inject({ method: "GET", url: "/admin/logs?source=requests&limit=1&offset=1" })).json() as { items: { what: string }[] };
  assert.notEqual(page1.items[0].what, page2.items[0].what, "sayfa geçişi eskiye gider");

  const audit = (await s.app.inject({ method: "GET", url: "/admin/logs?source=audit" })).json() as { source: string };
  assert.equal(audit.source, "audit");
  await s.close();
});
