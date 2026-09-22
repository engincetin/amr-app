/**
 * Tek sayfalık API görüntüleyicisi (her iki taraf da kullanır).
 *
 * Bağımlılıksızdır ve dışarıdan dosya çekmez: rafineri ya da hazine ağı kapalı olsa da açılır.
 * Verilen OpenAPI belgelerini okur, uçları ve şemaları gezilebilir biçimde çizer.
 * Sözleşme paketinde durur ki iki repoda tek kopya olsun (kz-treasury `npm run contract:sync` ile alır).
 */

export interface DocsTab {
  /** Sekme kimliği (tekil). */
  id: string;
  /** Üst şeritte görünen ad. */
  label: string;
  /** Belgenin adresi; `raw` ise doğrudan yeni sekmede açılır. */
  url: string;
  raw?: boolean;
  heading?: string;
  /** Sayfa başındaki açıklama (HTML). */
  intro?: string;
  /** Sarı kutu (HTML). */
  note?: string;
  /** Belge yüklenemezse gösterilecek ipucu (HTML). */
  hint?: string;
}

export interface DocsViewerOptions {
  /** Tarayıcı sekmesi başlığı. */
  title: string;
  /** Üst şeritteki ad. */
  brand: string;
  tabs: DocsTab[];
}

export function docsViewerHtml(opts: DocsViewerOptions): string {
  return TEMPLATE
    .replace("__TITLE__", opts.title)
    .replace("__DOC__", JSON.stringify({ brand: opts.brand, tabs: opts.tabs }).replace(/</g, "\\u003c"));
}

const TEMPLATE = `<!doctype html>
<html lang="tr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
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
  <b id="brand"></b><span class="v" id="ver"></span>
  <span style="flex:1"></span>
  <span id="tabs"></span>
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

const DOC = __DOC__;
document.getElementById("brand").textContent = DOC.brand;
const tabsEl = document.getElementById("tabs");
for (const t of DOC.tabs) {
  const a = document.createElement("a");
  a.href = t.raw ? t.url : "#";
  a.textContent = t.label;
  if (t.raw) a.target = "_blank";
  else a.onclick = (e) => { e.preventDefault(); load(t.id); };
  a.id = "tab-" + t.id;
  tabsEl.appendChild(a);
  tabsEl.appendChild(document.createTextNode(" "));
}

async function load(which) {
  const tab = DOC.tabs.find((t) => t.id === which);
  for (const t of DOC.tabs) { const el = document.getElementById("tab-" + t.id); if (el && !t.raw) el.className = t.id === which ? "on" : ""; }
  M.innerHTML = "Yükleniyor…";
  try {
    const res = await fetch(tab.url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    renderOps(await res.json(), tab.heading, tab.intro, tab.note);
  } catch (e) {
    M.innerHTML = '<div class="err">Belge yüklenemedi: ' + esc(e.message) + (tab.hint ? "<br><br>" + tab.hint : "") + "</div>";
  }
}
load(DOC.tabs.find((t) => !t.raw).id);
</script>
</body></html>`;
