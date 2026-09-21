# amr-app · çalışma kuralları

Bu repo Ahlatcı Metal Refinery (AMR) tarafındaki uygulamadır. Kanzasset tarafı `kz-treasury` reposundadır. İki repo birlikte çalışır; bu dosya her iki repoyu birden değiştirirken de geçerlidir.

## Kaynak dokümanlar (önce bunlara bak)

- `docs/KZ_AMR_Akislar.md`: rafineri ile Kanzasset arasındaki akışlar (fiyat, bakiye bilgisi, stoktan alış / satış, kasa girişi / çıkışı, büyük alış / satış, hazine alım satımı, fiziksel teslimat, rafinasyon, mahsuplaşma). Rakamlı örnekler buradadır.
- `docs/KZ_AMR_Sistemi.md`: ekranlar (R1..R10, K1..K9), API, soket protokolü, veri modeli, kontroller, sprint planı.
- Akışlar ile kod çelişirse akışlar kazanır; önce dokümanı düzelt, sonra kodu.

## Değişmez kurallar

- Rafineri tarafında **mint, burn, token, cüzdan, müşteri adı yoktur**. Talepler gram + Kanzasset referansı taşır. Bu kelimeler `apps/amr-*` içinde geçmez.
- İki hesap: **Kasa Hesabı** `V` (kasada, kasaya konuluyor, sevkiyatta) ve **Cari Hesap** (`T` net gram, `P[ccy]` para). Kontroller: K1 `A ≤ V`, K2 `S + T = K`, K3 cari hesap limiti, K4 mint yalnız Kasa Giriş Fişi'ne karşı, K5 ödeme yalnız şirket banka hesabından.
- Tüm miktarlar **tam sayı**: gram mg, para cent. Fiyatlar ondalık string. Float ile para hesabı yapılmaz.
- Sözleşme tek kaynak: `packages/contract/src/index.ts`. Değişince `kz-treasury` içinde `npm run contract:sync`. İki tarafta ayrı şema yazılmaz.
- Kasa talimatları elle kabul edilir ("Kabul et"); otomatik kabul ayarlardan açılır. Kabulde **Kasa Giriş Fişi / Kasa Çıkış Fişi** üretilir; durumlar `REQUESTED → ACCEPTED → PLACING → PLACED` (en geç T+3), külçe seri numarası yok.
- Mahsuplaşma kesim saatinde (`settlement.cutoff_local`, `settlement.timezone`) talep gelmese de kendiliğinden başlar; iki taraf da talep edebilir; her adım iki tarafa bildirim düşürür.
- Terimler: "mahsuplaşma" (netleşme), "mutabakat" (ekstre karşılaştırma adımı), "KZ kaydı", "Eşleşme kuralı". "Ayna", "maksuplaşma" kullanılmaz.
- Metinlerde uzun tire (— –) kullanılmaz; iki nokta, virgül ya da ayrı cümle.

## Teknik

- Node 22.12+, `node:sqlite` (çalıştırırken `NODE_OPTIONS=--no-warnings`), TypeScript `tsx` ile, Fastify 5, `ws`, TypeBox, React 19 + Vite 6, SSE ile canlı ekran.
- Portlar: merkez 4100 (ws) / 4110 (kontrol), server 4000, web dev 4001. Kanzasset tarafı 5000 / 5001.
- Test: `npm test` (node test runner). Yeni iş kuralı gelince önce test.
- Panel API'si `/admin/*`, Kanzasset API'si `/v1/*` (HMAC). İkisi karışmaz.
- Statik web `apps/amr-web/dist` içinden `@fastify/static` ile (wildcard açık, SPA fallback `index.html`).

## Sprint durumu

Sprint 1 tamam: sözleşme, mock merkez, kaynak bağlantısı (R2 Bağlan / Kes), yayın (tick, heartbeat, halt / resume), HMAC, bildirimler, ayarlar, R1 / R2 / R10 ekranları. Sonraki: Sprint 2 (emirler, cari hesap, R3 / R5). Plan `README.md` sonunda.
