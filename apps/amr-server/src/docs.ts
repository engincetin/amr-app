/**
 * API dokümanı (R9 yanında, tarayıcıdan açılır).
 *
 *   GET /openapi.json   sözleşmeden üretilen OpenAPI 3.1 belgesi (repo kökündeki dosya)
 *   GET /docs           tek sayfalık görüntüleyici
 *
 * Görüntüleyici bağımlılıksızdır ve dışarıdan dosya çekmez: rafineri ağı kapalı olsa da açılır.
 * Belge `npm run openapi:export` ile sözleşmeden üretilir; sunucu onu okuyup servis eder.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "./context.ts";

/** openapi.json repo kökünde durur; kurulumda yanına da konabilir. */
function findSpec(): string | null {
  const candidates = [
    process.env.OPENAPI_PATH,
    resolve(import.meta.dirname, "../../../openapi.json"),
    resolve(process.cwd(), "openapi.json"),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export async function docsRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/openapi.json", async (_req, reply) => {
    const p = findSpec();
    if (!p) return reply.code(404).send({ error: "openapi.json bulunamadı; npm run openapi:export çalıştırın" });
    return reply.header("content-type", "application/json; charset=utf-8").send(readFileSync(p, "utf8"));
  });

  /** Panel API'si sözleşmenin parçası değildir; ayrı belgede tutulur. */
  app.get("/admin-api.json", async (_req, reply) => {
    const p = [process.env.ADMIN_API_PATH, resolve(import.meta.dirname, "../../../admin-api.json"), resolve(process.cwd(), "admin-api.json")]
      .filter(Boolean).find((x) => existsSync(x as string)) as string | undefined;
    if (!p) return reply.code(404).send({ error: "admin-api.json bulunamadı" });
    return reply.header("content-type", "application/json; charset=utf-8").send(readFileSync(p, "utf8"));
  });

  app.get("/docs", async (_req, reply) => reply.header("content-type", "text/html; charset=utf-8").send(VIEWER));
  void ctx;
}

/** Tek sayfa görüntüleyici: OpenAPI belgesini okur, uçları ve şemaları gezilebilir biçimde çizer. */
const VIEWER = `<!doctype html>
<html lang="tr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AMR uygulaması · API dokümanı</title>
<style>
:root{--ink:#14161a;--mut:#5c6470;--line:#e3e5e9;--bg:#fbfbfc;--card:#fff;--red:#D4202B;--ok:#1a7f37;--warn:#9a6b15}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{background:#14161a;color:#fff;padding:14px 20px;display:flex;gap:16px;align-items:baseline;flex-wrap:wrap;position:sticky;top:0;z-index:5}
header b{font-size:16px}header .v{color:#9aa3ad;font-size:13px}
header a{color:#9aa3ad;text-decoration:none;font-size:13px;border:1px solid #3a3f46;padding:3px 9px;border-radius:5px}
header a:hover,header a.on{color:#fff;border-color:#6b727a}
.wrap{display:grid;grid-template-columns:270px 1fr;gap:0;align-items:start}
nav{position:sticky;top:52px;max-height:calc(100vh - 52px);overflow:auto;border-right:1px solid var(--line);padding:14px 10px 40px}
nav .grp{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);margin:14px 8px 5px}
nav a{display:block;padding:4px 8px;border-radius:5px;color:var(--ink);text-decoration:none;font-size:13px;font-family:ui-monospace,monospace}
nav a:hover{background:#f0f1f3}
main{padding:20px 24px 80px;max-width:1000px}
h1{font-size:22px;margin:4px 0 6px}
.sub{color:var(--mut);max-width:78ch;margin:0 0 18px}
.op{background:var(--card);border:1px solid var(--line);border-radius:9px;margin:0 0 12px;overflow:hidden}
.op>summary{cursor:pointer;padding:11px 14px;display:flex;gap:10px;align-items:center;list-style:none}
.op>summary::-webkit-details-marker{display:none}
.op[open]>summary{border-bottom:1px solid var(--line)}
.m{font:600 11px ui-monospace,monospace;padding:3px 7px;border-radius:4px;color:#fff;letter-spacing:.04em}
.m.get{background:#1a6fb5}.m.post{background:var(--ok)}.m.put{background:var(--warn)}.m.delete{background:var(--red)}.m.ws{background:#6b4fb5}
.path{font-family:ui-monospace,monospace;font-weight:600;font-size:13.5px}
.sum{color:var(--mut);font-size:13px;flex:1;min-width:200px}
.body{padding:12px 14px}
h4{margin:12px 0 5px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut)}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--mut);font-weight:600}
code,.mono{font-family:ui-monospace,monospace;font-size:12.5px}
.req{color:var(--red);font-size:11px}
pre{background:#f6f7f8;border:1px solid var(--line);border-radius:6px;padding:10px;overflow:auto;font-size:12px;margin:5px 0}
.pill{display:inline-block;font-size:11px;padding:2px 7px;border-radius:99px;border:1px solid var(--line);background:#f6f7f8;color:var(--mut)}
.err{color:var(--red);padding:20px}
.schema{background:var(--card);border:1px solid var(--line);border-radius:9px;margin:0 0 10px}
.schema>summary{cursor:pointer;padding:9px 14px;font-family:ui-monospace,monospace;font-weight:600;font-size:13px;list-style:none}
.schema>summary::-webkit-details-marker{display:none}
.note{background:#fff8e6;border:1px solid #f0e0b0;border-radius:7px;padding:10px 12px;font-size:13px;margin:0 0 16px}
@media(max-width:900px){.wrap{grid-template-columns:1fr}nav{position:static;max-height:none;border-right:0;border-bottom:1px solid var(--line)}}
</style></head>
<body>
<header>
  <b>AMR uygulaması</b><span class="v" id="ver"></span>
  <span style="flex:1"></span>
  <a href="#" id="tab-v1" class="on">Kanzasset sözleşmesi (/v1)</a>
  <a href="#" id="tab-admin">Panel API'si (/admin)</a>
  <a href="/openapi.json" target="_blank">openapi.json</a>
</header>
<div class="wrap"><nav id="nav"></nav><main id="main">Yükleniyor…</main></div>
<script>
const M = document.getElementById("main"), N = document.getElementById("nav");
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let SPEC = null;

/** $ref çözer; çözülemezse olduğu gibi bırakır. */
function deref(o, spec, depth = 0) {
  if (!o || typeof o !== "object" || depth > 6) return o;
  if (o.$ref) {
    const parts = String(o.$ref).replace(/^#\\//, "").split("/");
    let t = spec; for (const p of parts) t = t?.[p];
    return t ? deref(t, spec, depth + 1) : o;
  }
  return o;
}

/** Şemayı kısa, okunur bir tipe çevirir. */
function typeOf(s, spec, depth = 0) {
  s = deref(s, spec, depth);
  if (!s || typeof s !== "object") return "?";
  if (depth > 4) return "…";
  if (s.anyOf || s.oneOf) return (s.anyOf || s.oneOf).map(x => typeOf(x, spec, depth + 1)).join(" | ");
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map(v => JSON.stringify(v)).join(" | ");
  if (s.type === "array") return typeOf(s.items, spec, depth + 1) + "[]";
  if (s.type === "object" || s.properties) {
    const keys = Object.keys(s.properties || {});
    return keys.length ? "{ " + keys.slice(0, 6).join(", ") + (keys.length > 6 ? ", …" : "") + " }" : "object";
  }
  return s.type || "?";
}

/** Nesne şemasını alan tablosuna çevirir. */
function fields(s, spec) {
  s = deref(s, spec);
  const props = s?.properties;
  if (!props) return "";
  const req = new Set(s.required || []);
  let h = '<table><tr><th>Alan</th><th>Tip</th><th>Açıklama</th></tr>';
  for (const [k, v0] of Object.entries(props)) {
    const v = deref(v0, spec);
    h += '<tr><td class="mono">' + esc(k) + (req.has(k) ? ' <span class="req">zorunlu</span>' : "") +
         '</td><td class="mono">' + esc(typeOf(v, spec)) + '</td><td>' + esc(v?.description || "") + "</td></tr>";
  }
  return h + "</table>";
}

function renderOps(spec, title, intro, note) {
  SPEC = spec;
  document.getElementById("ver").textContent = (spec.info?.title || "") + " " + (spec.info?.version || "");
  const groups = {};
  for (const [path, item] of Object.entries(spec.paths || {})) {
    const g = path.split("/").filter(Boolean)[1] || "genel";
    (groups[g] ||= []).push([path, item]);
  }
  let nav = "", body = '<h1>' + esc(title) + '</h1><p class="sub">' + intro + "</p>";
  if (note) body += '<div class="note">' + note + "</div>";

  for (const [g, entries] of Object.entries(groups)) {
    nav += '<div class="grp">' + esc(g) + "</div>";
    for (const [path, item] of entries) {
      for (const [method, op] of Object.entries(item)) {
        const id = (method + path).replace(/[^a-z0-9]/gi, "-");
        nav += '<a href="#' + id + '">' + method.toUpperCase() + " " + esc(path) + "</a>";
        body += '<details class="op" id="' + id + '"><summary><span class="m ' + method + '">' + method.toUpperCase() +
                '</span><span class="path">' + esc(path) + '</span><span class="sum">' + esc(op.summary || "") + "</span></summary><div class=\\"body\\">";
        if (op.description) body += "<p>" + esc(op.description) + "</p>";
        const ps = op.parameters || [];
        if (ps.length) {
          body += "<h4>Parametreler</h4><table><tr><th>Ad</th><th>Yer</th><th>Tip</th><th>Açıklama</th></tr>";
          for (const p of ps) body += '<tr><td class="mono">' + esc(p.name) + (p.required ? ' <span class="req">zorunlu</span>' : "") +
            '</td><td>' + esc(p.in) + '</td><td class="mono">' + esc(p.schema?.type || "") + "</td><td>" + esc(p.description || "") + "</td></tr>";
          body += "</table>";
        }
        const rb = op.requestBody?.content?.["application/json"]?.schema;
        if (rb) { body += "<h4>İstek gövdesi</h4>" + (fields(rb, spec) || '<p class="mono">' + esc(typeOf(rb, spec)) + "</p>"); }
        const rs = op.responses || {};
        if (Object.keys(rs).length) {
          body += "<h4>Cevaplar</h4><table><tr><th>Kod</th><th>Açıklama</th><th>Gövde</th></tr>";
          for (const [code, r] of Object.entries(rs)) {
            const sch = r.content?.["application/json"]?.schema;
            body += '<tr><td class="mono">' + esc(code) + "</td><td>" + esc(r.description || "") +
                    '</td><td class="mono">' + (sch ? esc(typeOf(sch, spec)) : (r.content ? Object.keys(r.content).join(", ") : "")) + "</td></tr>";
          }
          body += "</table>";
          const okSchema = (rs["200"]?.content?.["application/json"]?.schema);
          const f = okSchema ? fields(okSchema, spec) : "";
          if (f) body += "<h4>200 alanları</h4>" + f;
        }
        body += "</div></details>";
      }
    }
  }

  if (spec.webhooks) {
    nav += '<div class="grp">olaylar</div>';
    for (const [name, item] of Object.entries(spec.webhooks)) {
      for (const [method, op] of Object.entries(item)) {
        const id = "wh-" + name;
        nav += '<a href="#' + id + '">WEBHOOK ' + esc(name) + "</a>";
        body += '<details class="op" id="' + id + '"><summary><span class="m ws">OLAY</span><span class="path">' + esc(name) +
                '</span><span class="sum">' + esc(op.summary || "") + '</span></summary><div class="body">';
        if (op.description) body += "<p>" + esc(op.description) + "</p>";
        const rb = op.requestBody?.content?.["application/json"]?.schema;
        if (rb) body += "<h4>Zarf</h4>" + fields(rb, spec);
        body += "</div></details>";
      }
    }
  }

  const schemas = spec.components?.schemas || {};
  if (Object.keys(schemas).length) {
    nav += '<div class="grp">şemalar</div><a href="#schemas">Tüm şemalar</a>';
    body += '<h1 id="schemas" style="margin-top:28px">Şemalar</h1><p class="sub">Sözleşmedeki tipler. Miktarlar tam sayıdır (gram için mg, para için cent), fiyatlar ondalık dizedir.</p>';
    for (const [name, s] of Object.entries(schemas)) {
      body += '<details class="schema"><summary>' + esc(name) + "</summary><div class=\\"body\\">" +
              (fields(s, spec) || '<p class="mono">' + esc(typeOf(s, spec)) + "</p>") + "</div></details>";
    }
  }
  N.innerHTML = nav; M.innerHTML = body;
  if (location.hash) document.querySelector(location.hash)?.setAttribute("open", "");
}

async function load(which) {
  document.getElementById("tab-v1").className = which === "v1" ? "on" : "";
  document.getElementById("tab-admin").className = which === "admin" ? "on" : "";
  M.innerHTML = "Yükleniyor…";
  try {
    const res = await fetch(which === "v1" ? "/openapi.json" : "/admin-api.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const spec = await res.json();
    if (which === "v1") renderOps(spec, "Kanzasset sözleşmesi", "Kanzasset'in kullandığı uçlar. Kimlik ve bütünlük: <code>X-API-Key</code>, <code>X-Timestamp</code>, <code>X-Signature</code> (HMAC-SHA256: zaman damgası + yöntem + yol + ham gövde). Her <code>POST</code> için <code>Idempotency-Key</code>: aynı anahtarla gelen istek aynı cevabı alır, ikinci kez işlenmez.", "Bu belge <code>packages/contract/src/index.ts</code> dosyasından üretilir. Sözleşme değişince <code>npm run openapi:export</code> çalıştırılır ve Kanzasset tarafında <code>npm run contract:sync</code> yapılır.");
    else renderOps(spec, "Panel API'si", "Rafineri ekranlarının (R1'den R10'a) kullandığı iç uçlar. Kanzasset bu uçları kullanmaz. Aktör <code>X-User</code> başlığıyla gelir ve yetkisi rolüne göre denetlenir; <code>ADMIN_TOKEN</code> verilmişse ayrıca <code>X-Admin-Token</code> istenir.", "Kritik aksiyonlar ikinci onay ister: önce istek açılır (<code>202</code> ve onay numarası döner), sonra farklı bir kullanıcı onaylar.");
  } catch (e) {
    M.innerHTML = '<div class="err">Belge yüklenemedi: ' + esc(e.message) + (which === "admin" ? "<br><br>Panel API belgesi için <code>npm run openapi:export</code> çalıştırın." : "") + "</div>";
  }
}
document.getElementById("tab-v1").onclick = e => { e.preventDefault(); load("v1"); };
document.getElementById("tab-admin").onclick = e => { e.preventDefault(); load("admin"); };
load("v1");
</script>
</body></html>`;
