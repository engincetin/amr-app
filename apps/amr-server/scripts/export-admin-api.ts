/**
 * Panel API'si belgesi (admin-api.json).
 *
 * Uçlar elle listelenmez: sunucu ayağa kaldırılır, Fastify'ın yol tablosu okunur ve
 * her yola buradaki açıklama eşlenir. Yeni bir uç eklenip açıklaması yazılmazsa betik
 * hata verir; böylece belge ile kod arasındaki fark büyümeden fark edilir.
 *
 * Çalıştırma: npm run adminapi:export (repo kökünden)  ·  çıktı: repo kökünde admin-api.json
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CONTRACT_VERSION } from "@amr/contract";
import { buildApp } from "../src/index.ts";

interface Op { summary: string; description?: string; params?: { name: string; in: string; description?: string }[]; body?: Record<string, string>; returns?: string; approval?: boolean; perm?: string }

/** Her uç için tek cümlelik açıklama. Anahtar: "YÖNTEM /yol". */
const OPS: Record<string, Op> = {
  "GET /health": { summary: "Sağlık durumu: alt sistemler ayrı ayrı", description: "veritabanı, merkez bağlantısı, Kanzasset yayını, olay kuyruğu, kasa talimatları, açık mahsuplaşma penceresi. HTTP 503 yalnız iş göremez durumda.", returns: "{ status, uptime_s, balances, checks }" },
  "GET /docs": { summary: "API dokümanı (tek sayfalık görüntüleyici)" },
  "GET /openapi.json": { summary: "Kanzasset sözleşmesi belgesi" },
  "GET /admin-api.json": { summary: "Bu belge" },

  "GET /admin/vault/movements": { summary: "R4 kasa hesabı hareketleri", params: [{ name: "limit", in: "query" }] },
  "POST /admin/vault/:id/placing": { summary: "R4 kasaya konuluyor (kabul sonrası ilk adım)", perm: "vault.place" },
  "GET /admin/ticks": { summary: "R2 tick geçmişi", params: [{ name: "limit", in: "query" }] },
  "GET /admin/subscribers": { summary: "R2 fiyat soketine bağlı aboneler" },
  "POST /admin/settlement/request": { summary: "R8 Kanzasset adına pencere talebi (demo yardımcısı)", perm: "settlement.request" },
  "GET /admin/deliveries": { summary: "R6 teslimat listesi" },
  "GET /admin/deliveries/:id": { summary: "R6 teslimat ayrıntısı ve geçmişi" },
  "POST /admin/deliveries/:id/preparing": { summary: "R6 hazırlanıyor adımına al", perm: "delivery.steps" },
  "POST /admin/deliveries/:id/failed": { summary: "R6 teslimat başarısız (gerekçeli)", body: { reason: "gerekçe" }, perm: "delivery.steps" },
  "GET /admin/refining": { summary: "R7 rafinasyon listesi" },
  "GET /admin/refining/:id": { summary: "R7 rafinasyon ayrıntısı ve geçmişi" },
  "POST /admin/refining/:id/failed": { summary: "R7 rafinasyon başarısız (gerekçeli)", body: { reason: "gerekçe" }, perm: "refining.steps" },
  "GET /admin/overview": { summary: "R1 genel bakış: yayın, kaynak, hesaplar, kontroller, son olaylar", returns: "{ publish, source, account, checks, notifications }" },
  "GET /admin/stream": { summary: "Canlı akış (SSE): tick, bildirim, durum değişikliği", description: "ekranlar bu akışla tazelenir; istek günlüğüne yazılmaz" },
  "POST /admin/publish/halt": { summary: "R2 yayını durdur (gerekçeli)", body: { reason: "durdurma gerekçesi" }, perm: "publish.control" },
  "POST /admin/publish/resume": { summary: "R2 yayını başlat", perm: "publish.control" },
  "POST /admin/source/connect": { summary: "Merkeze bağlan (adres verilebilir)", body: { url: "merkez soket adresi" }, perm: "source.control" },
  "POST /admin/source/disconnect": { summary: "Merkez bağlantısını kes", perm: "source.control" },

  "GET /admin/orders": { summary: "R3 emir günlüğü", params: [{ name: "limit", in: "query" }] },
  "GET /admin/orders/:id": { summary: "R3 emir ayrıntısı" },

  "GET /admin/current-account": { summary: "R5 cari hesap hareketleri ve limit sayaçları", params: [{ name: "from", in: "query" }, { name: "to", in: "query" }] },

  "GET /admin/vault": { summary: "R4 kasa talimatları ve kasa hesabı hareketleri", params: [{ name: "limit", in: "query" }] },
  "POST /admin/vault/:id/accept": { summary: "R4 kasa talimatını kabul et (fiş üretilir, defter işlenir)", perm: "vault.accept" },
  "POST /admin/vault/:id/reject": { summary: "R4 kasa talimatını reddet (gerekçeli)", body: { reason: "red gerekçesi" }, perm: "vault.accept" },
  "POST /admin/vault/:id/placed": { summary: "R4 kasaya konuldu (giriş kapanır, T+3 vadesi biter)", perm: "vault.place" },
  "GET /admin/vault/statement": { summary: "R4 günlük kasa ekstresi (rezerv kanıtı)", params: [{ name: "date", in: "query" }] },

  "POST /admin/deliveries/:id/quote": { summary: "R6 lojistik teklifi gir", body: { fee_cents: "lojistik bedeli (cent)", valid_hours: "geçerlilik" }, perm: "delivery.steps" },
  "POST /admin/deliveries/:id/ready": { summary: "R6 külçe hazır (kasadan sevkiyata)", perm: "delivery.steps" },
  "POST /admin/deliveries/:id/shipped": { summary: "R6 taşıyıcıya verildi (takip no)", body: { tracking_no: "takip numarası" }, perm: "delivery.steps" },
  "POST /admin/deliveries/:id/delivered": { summary: "R6 teslim edildi (sevkiyattan düşer)", perm: "delivery.steps" },
  "POST /admin/deliveries/:id/cancel": { summary: "R6 teslimatı iptal et (külçe kasaya döner)", body: { reason: "iptal gerekçesi" }, perm: "delivery.steps" },
  "POST /admin/refining/:id/quote": { summary: "R7 rafinasyon teklifi gir", body: { fee_cents: "bedel (cent)", valid_hours: "geçerlilik" }, perm: "refining.steps" },
  "POST /admin/refining/:id/production": { summary: "R7 üretime al", perm: "refining.steps" },
  "POST /admin/refining/:id/ready": { summary: "R7 külçe hazır", perm: "refining.steps" },
  "POST /admin/refining/:id/shipped": { summary: "R7 taşıyıcıya verildi", body: { tracking_no: "takip numarası" }, perm: "refining.steps" },
  "POST /admin/refining/:id/delivered": { summary: "R7 teslim edildi", perm: "refining.steps" },
  "POST /admin/refining/:id/cancel": { summary: "R7 rafinasyonu iptal et (yalnız üretime kadar)", body: { reason: "iptal gerekçesi" }, perm: "refining.steps" },
  "GET /admin/catalog": { summary: "R7 külçe kataloğu" },
  "PUT /admin/catalog": { summary: "R7 katalog kalemini ekle ya da güncelle (sürüm artar, catalog.updated gider)", perm: "catalog.edit" },

  "GET /admin/settlements": { summary: "R8 mahsuplaşma pencereleri" },
  "POST /admin/settlements": { summary: "R8 mahsuplaşma penceresi aç", description: "trigger: CUTOFF (kesim saati, kendiliğinden de açılır), REQUEST_AMR ya da REQUEST_KZ. Açık pencere varsa o döner.", body: { trigger: "tetikleyici", reason: "gerekçe" }, perm: "settlement.request" },
  "GET /admin/settlements/:id": { summary: "R8 mahsuplaşma penceresi ayrıntısı ve geçmişi" },
  "POST /admin/settlements/:id/draft": { summary: "R8 ekstre taslağı üret (mutabakat adımı)", description: "rafineri ekstresi imzalanır ve Kanzasset'e gider; Kanzasset karşılaştırıp onaylar ya da MISMATCH der." },
  "POST /admin/settlements/:id/payment-notice": { summary: "R8 ödeme bildirimi (banka referansı)", body: { ccy: "kur", bank_ref: "banka referansı" }, perm: "settlement.payment", approval: true },
  "POST /admin/settlements/:id/payment-received": { summary: "R8 ödeme alındı (cari hesabı kapatır)", body: { ccy: "kur" }, perm: "settlement.payment" },

  "GET /admin/documents": { summary: "R9 belgeler listesi" },
  "GET /admin/documents/:id": { summary: "R9 belge içeriği (imzalı JSON)" },
  "GET /admin/documents/:id/pdf": { summary: "R9 belge PDF'i (A4)" },
  "GET /admin/events": { summary: "R9 olay teslimleri (webhook kuyruğu)" },
  "GET /admin/requests": { summary: "R9 istek günlüğü (VARA kanıtı)", description: "Kanzasset'in istekleri ve panelin değişiklikleri; gövdenin kendisi değil sha256 özeti saklanır.", params: [{ name: "limit", in: "query" }, { name: "channel", in: "query", description: "KANZASSET ya da PANEL" }, { name: "path", in: "query" }, { name: "errors", in: "query", description: "1 ise yalnız hatalar" }] },

  "GET /admin/logs": {
    summary: "R11 kayıtlar: beş kaynak tek biçimde, süzgeçli ve sayfalı",
    description: "Kaynaklar: requests (istek günlüğü), audit (denetim günlüğü), events (olay teslimleri), notifications (bildirimler), ticks (fiyat tick'leri). Satırlar zaman · kim · ne · sonuç olarak döner.",
    params: [{ name: "source", in: "query", description: "requests | audit | events | notifications | ticks" }, { name: "q", in: "query", description: "metin süzgeci" }, { name: "from", in: "query", description: "YYYY-AA-GG" }, { name: "to", in: "query", description: "YYYY-AA-GG" }, { name: "limit", in: "query" }, { name: "offset", in: "query" }],
    returns: "{ items, total, source }",
  },
  "GET /admin/notifications": { summary: "Bildirimler" },
  "POST /admin/notifications/:id/read": { summary: "Bildirimi okundu işaretle" },
  "GET /admin/settings": { summary: "R10 parametreler" },
  "PUT /admin/settings": { summary: "R10 parametre değişikliği", perm: "settings.write", approval: true },
  "GET /admin/audit": { summary: "R10 denetim günlüğü" },
  "GET /admin/users": { summary: "R10 kullanıcılar, roller ve yetki matrisi" },
  "PUT /admin/users": { summary: "R10 kullanıcı ekle ya da güncelle", perm: "users.write" },
  "POST /admin/approvals/:id/approve": { summary: "R10 onayla (isteyen kendi isteğini onaylayamaz)", body: { approver: "onaylayan kullanıcı" } },
  "POST /admin/approvals/:id/reject": { summary: "R10 onay isteğini reddet" },
  "GET /admin/clients": { summary: "R10 API istemcileri (Kanzasset anahtarları)" },
  "POST /admin/clients": { summary: "R10 API anahtarı ver", perm: "clients.write", approval: true },
  "POST /admin/clients/:key/revoke": { summary: "R10 API anahtarını iptal et", perm: "clients.write", approval: true },
};

const APPROVAL_NOTE = "Kritik aksiyon: onay numarası olmadan gelirse 202 ve onay numarası döner; değişiklik ancak farklı bir kullanıcının onayıyla uygulanır (gövdeye approval_id ve approver eklenir).";

/** Fastify yolundaki :id gösterimini OpenAPI {id} gösterimine çevirir. */
const toOpenApiPath = (p: string) => p.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
const pathParams = (p: string) => [...p.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));

const routes: { method: string; url: string }[] = [];
const { app } = await buildApp({
  dbPath: ":memory:", autoconnect: false, dispatchEvents: false, sweepOverdue: false, watchCutoff: false, pruneRequests: false,
  onRoute: (r) => { for (const m of Array.isArray(r.method) ? r.method : [r.method]) routes.push({ method: m, url: r.url }); },
});
await app.close();

const paths: Record<string, Record<string, unknown>> = {};
const missing: string[] = [];
for (const r of routes) {
  if (r.method === "HEAD" || r.method === "OPTIONS") continue;
  if (r.url.startsWith("/v1")) continue; // sözleşme belgesi ayrı
  if (r.url === "/*" || r.url === "/") continue; // statik ekranlar
  const key = `${r.method} ${r.url}`;
  const op = OPS[key];
  if (!op) { missing.push(key); continue; }
  const params = [...pathParams(r.url), ...(op.params ?? []).map((p) => ({ schema: { type: "string" }, ...p }))];
  const entry: Record<string, unknown> = {
    summary: op.summary,
    description: [op.description, op.perm ? `Yetki: ${op.perm}.` : "", op.approval ? APPROVAL_NOTE : ""].filter(Boolean).join(" ") || undefined,
    ...(params.length ? { parameters: params } : {}),
    ...(op.body ? {
      requestBody: {
        content: { "application/json": { schema: { type: "object", properties: Object.fromEntries(Object.entries(op.body).map(([k, v]) => [k, { type: "string", description: v }])) } } },
      },
    } : {}),
    responses: {
      "200": { description: op.returns ?? "OK", content: { "application/json": { schema: { type: "object" } } } },
      ...(op.approval ? { "202": { description: "ikinci onay bekleniyor (onay numarası döner)", content: { "application/json": { schema: { type: "object" } } } } } : {}),
      ...(op.perm ? { "403": { description: "yetki yok" } } : {}),
    },
  };
  (paths[toOpenApiPath(r.url)] ||= {})[r.method.toLowerCase()] = entry;
}

const extra = Object.keys(OPS).filter((k) => !routes.some((r) => `${r.method} ${r.url}` === k));
if (missing.length) {
  console.error("Açıklaması olmayan uçlar var, scripts/export-admin-api.ts içine ekleyin:\n  " + missing.join("\n  "));
  process.exit(1);
}
if (extra.length) console.warn("Uyarı: artık olmayan uçlar açıklamada duruyor:\n  " + extra.join("\n  "));

const doc = {
  openapi: "3.1.0",
  info: {
    title: "AMR paneli API'si",
    version: CONTRACT_VERSION,
    description:
      "Rafineri ekranlarının (R1..R10) kullandığı iç uçlar. Kanzasset bu uçları kullanmaz; Kanzasset sözleşmesi /v1 altındadır ve openapi.json ile belgelenir. " +
      "Aktör X-User başlığıyla gelir ve yetkisi rolüne göre denetlenir. ADMIN_TOKEN verilmişse ayrıca X-Admin-Token istenir. " +
      "Miktarlar tam sayı (gram için mg, para için cent), fiyatlar ondalık dizedir.",
  },
  paths,
};

const out = resolve(import.meta.dirname, "../../../admin-api.json");
writeFileSync(out, JSON.stringify(doc, null, 2));
console.log(`panel API belgesi yazıldı: ${out} · ${Object.keys(paths).length} yol`);
