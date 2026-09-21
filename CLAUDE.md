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

## Defter (ledger.ts) ve emir motoru (orders.ts)

- Bakiyeler hareket tablolarından türer (`current_account_movements`, `vault_movements`); bakiye tablosu yok, her okuma yeniden hesaplar. Her hareket demeti bir `account_seq` alır ve bakiye bilgisinde döner.
- Emir kararı sırası: tekrar (client_order_id + gövde özeti) · miktar · yayın açık mı · quote_seq tazeliği · limit_px · cari hesap limiti. Fill fiyatı o anki rafineri fiyatıdır (alışta ask, satışta bid). Alışta Tahsis Belgesi (`documents`, sha256 + HMAC imza).
- `debug.order_delay_ms` yalnız demo içindir (cevapsız emir / geç fill). Gecikme sırasında iptal gelirse CANCELLED, kesin cevap. Sunucu yeniden başlarsa açık emirler CANCELLED olur.
- Olaylar `webhook_deliveries` tablosundan `EventDispatcher` ile gider; KZ tarafı `event_id` ile tekrarı ayıklar.

## Kasa talimatları (vault.ts)

- `ref` (Kanzasset referansı) tekildir: aynı ref ile gelen istek aynı talebi döner, ikinci kez işlenmez. Çift mint buna bağlıdır.
- Kural kontrolleri hem istekte hem kabulde çalışır (araya emir girmiş olabilir): girişte cari hesap altını, çıkışta yalnız `kasada` bakılır, `kasaya konuluyor` sayılmaz.
- Kabulde fiş üretilir ve defter aynı demette işlenir; fiş olmadan gram hareket etmez. Çıkış kabulle biter, girişte `PLACING → PLACED` adımları vardır.
- `VaultOverdueWatcher` dakikada bir tarar: vadesi geçen giriş `OVERDUE` olur, `vault.in_overdue` gider. Durum `PLACED` ile kapanır.

## Sprint durumu

Sprint 1, 2 ve 3 tamam: sözleşme, mock merkez, kaynak bağlantısı, yayın, HMAC, bildirimler, ayarlar, defter, emirler, cari hesap ve limit, Tahsis Belgesi, olaylar, kasa talimatları ve fişler, günlük kasa ekstresi; ekranlar R1, R2, R3, R4, R5, R10. Belgeler imzalı JSON'dur, PDF çıktısı Sprint 6'dadır. Sonraki: Sprint 4 (fiziksel teslimat R6, rafinasyon R7). Plan `README.md` sonunda.
