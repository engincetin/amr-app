# AMR uygulaması

Ahlatcı Metal Refinery (AMR) tarafında çalışan uygulama. Kanzasset'e fiyat soketi ve API verir, rafineri personeline ekranlar sunar. Kanzasset tarafı ayrı repodadır: `kz-treasury`.

İş kuralları ve akışlar: `docs/KZ_AMR_Akislar.html` · sistem tasarımı (ekranlar, API, soket, veri): `docs/KZ_AMR_Sistemi.html`.

## Ne yapar

- Merkezi uygulamanın (merkez) fiyat soketine bağlanır, fiyatı Kanzasset'e kendi soketiyle yayınlar (`/v1/prices`).
- Kanzasset için iki hesap tutar: **Kasa Hesabı** (kasada, kasaya konuluyor, sevkiyatta) ve **Cari Hesap** (net gram + kur bazında para).
- Kanzasset'ten gelen talepleri karşılar: emir (alış / satış), kasa talimatı (giriş / çıkış), fiziksel teslimat, rafinasyon, mahsuplaşma.
- Her durum değişikliğinde iki tarafa bildirim üretir. Fişler ve ekstreler indirilebilir.

Belgeler imzalı JSON olarak üretilir (içerik + `sha256` + HMAC imza) ve aynı içerikten **A4 PDF** türetilir: `GET /v1/documents/{id}` ve `GET /v1/documents/{id}/pdf`. İmza HMAC'tir; Ed25519 anahtar yönetimi rafineri kurulumuna bırakılmıştır (bkz. `docs/KARARLAR.md`).

Rafineri tarafında token, mint, burn, cüzdan, müşteri adı yoktur. Talepler yalnız gram ve Kanzasset referansı taşır.

## Yapı

```
packages/contract     @amr/contract   sözleşme: TypeBox şemaları, sabitler, imza kuralı (tek kaynak, kz-treasury'ye kopyalanır)
apps/mock-merkez      @amr/mock-merkez merkez taklidi: ws://localhost:4100/prices, kontrol http://localhost:4110/control/*
apps/amr-server       @amr/server     Fastify API + soket + SQLite (node:sqlite), rafineri paneli API'si, SSE
apps/amr-web          @amr/web        React 19 + Vite, rafineri ekranları R1..R10
scripts/kz-client.mjs                 soket test istemcisi (Kanzasset gibi bağlanır)
docs/                                 KZ_AMR_Akislar, KZ_AMR_Sistemi (md + html), DEMO, KULLANIM_KILAVUZU, TEST_RAPORU, KARARLAR, ekranlar/
```

## Çalıştırma

Gereksinim: Node 22.12 veya üstü (`node:sqlite` için).

```bash
npm install
npm run dev          # merkez (4100/4110) + server (4000) + web (4001, Vite)
```

Tarayıcı: `http://localhost:4001` (geliştirme) ya da `npm run build && npm start` sonrası `http://localhost:4000`.

Tek tek: `npm run dev:merkez`, `npm run dev:server`, `npm run dev:web`.

Test: `npm test`. OpenAPI: `npm run openapi:export` → `openapi.json` (repo kökü).

## Tek komutla çalıştırma (Docker)

İki repo yan yana dururken (`amr-app` ve `kz-treasury` aynı klasörde):

```bash
cd amr-app && docker compose up --build
```

Üç servis kalkar: mock merkez (fiyat kaynağı), AMR uygulaması ve Kanzasset hazine çekirdeği. Rafineri ekranları `http://localhost:4000`, Kanzasset ekranları `http://localhost:5000`. Açılış devirleri iki tarafta da 20 kg'dır ve eşit olmak zorundadır: eşit değilse `S + T = K` kontrolü tutmaz. Veriler adlandırılmış birimlerde kalır; sıfırdan başlamak için `docker compose down -v`.

Senaryoları koşturmak için (servisler ayaktayken): `cd kz-treasury && npm run demo`.

Docker olmadan, sunum için üç komut: `docs/DEMO.md` → "Sabah başlatma".

## Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `4000` | API + soket + statik web |
| `DB_PATH` | `apps/amr-server/data/amr.db` | SQLite dosyası |
| `SOURCE_URL` | `ws://localhost:4100/prices` | merkez fiyat soketi (R2'den de değiştirilir) |
| `SOURCE_AUTOCONNECT` | `1` | açılışta merkeze bağlan |
| `KZ_API_KEY` / `KZ_API_SECRET` | `kz-dev-key` / `kz-dev-secret` | Kanzasset istemcisi (ilk açılışta yazılır) |
| `KZ_EVENT_URL` | `http://localhost:5000/api/events` | Kanzasset olay adresi (webhook) |
| `VAULT_OPENING_MG` | `0` | açılış devri: kasada Kanzasset adına duran gram, yalnız defter boşken (demo: `20000000`) |
| `vault.accept_mode` (ayar) | `MANUAL` | kasa talimatı kabulü: elle ("Kabul et") ya da `AUTO` · `vault.accept_target_minutes` hedef cevap süresi · `vault.placement_due_days` kasaya koyma vadesi (T+3) |
| `ADMIN_TOKEN` | boş | verilirse panel API'si `X-Admin-Token` ister |
| `log.retention_days` (ayar) | `90` | istek günlüğü saklama süresi (VARA kanıtı); R10'dan değişir |
| `LOG_LEVEL` | `info` | |
| `MERKEZ_WS_PORT` / `MERKEZ_HTTP_PORT` | `4100` / `4110` | mock merkez |
| `MERKEZ_INTERVAL_MS` / `MERKEZ_START_USD` | `1000` / `141.9` | mock merkez tick aralığı ve açılış fiyatı |

## Kanzasset'e verilen arayüz

- REST `/v1/*`: başlıklar `X-API-Key`, `X-Timestamp`, `X-Signature = HMAC-SHA256(secret, ts + METHOD + path + ham gövde)`, POST'ta `Idempotency-Key`. Zaman sapması en çok 5 dk.
- Soket `/v1/prices`: ilk mesaj `auth {api_key, ts, sig}` (imza `ts + "GET" + "/v1/prices"`), sonra `subscribed`, `snapshot`, `tick` (yalnız değişince, saniyede en çok 1), `heartbeat` (5 sn), `halt {reason}`, `resume` (+snapshot).
- Emirler: `POST /v1/orders` (FOK, `quote_seq`, `limit_px`, `time_limit_ms`) · `GET /v1/orders/{id}` · `POST /v1/orders/{id}/cancel` (kesin cevap). Fill cevabında bakiye bilgisi (`account`) ve alışta Tahsis Belgesi.
- Mahsuplaşma: `POST /v1/settlements` · `GET /v1/settlements/{id}` · `confirm` · `payment-notice` · `payment-received`. Belge PDF'i: `GET /v1/documents/{id}/pdf`.
- Teslimat ve rafinasyon: `POST /v1/deliveries` · `POST /v1/deliveries/{id}/approve|cancel` · `GET /v1/catalog` · `POST /v1/refining` · `POST /v1/refining/{id}/approve|cancel`. Her adımda `delivery.*` ve `refining.*` olayı gider.
- Kasa talimatları: `POST /v1/vault/in` · `POST /v1/vault/out` (gövde `qty_mg` + `ref`; `ref` tekildir, aynı ref aynı talebi döner) · `GET /v1/vault/requests/{id}`. Kabulde Kasa Giriş / Çıkış Fişi ve bakiye bilgisi olayla gider.
- Hesap: `GET /v1/account` (anlık fotoğraf) · `GET /v1/current-account/statement` · `GET /v1/vault/statement?date=` (günlük kasa ekstresi, rezerv kanıtı) · `GET /v1/documents/{id}`.
- Olaylar (webhook): her durum değişikliği KZ olay adresine POST edilir (`order.*`, `price.halt / resume`, `settlement.requested` ...), aynı imza başlıkları, 2xx değilse üstel bekleme ile tekrar.
- Tüm miktarlar tam sayı: gram için mg, para için cent. Fiyatlar ondalık string.

Sözleşme `packages/contract/src/index.ts` içindedir. Değişiklik yalnız burada yapılır, sonra `kz-treasury` içinde `npm run contract:sync` çalıştırılır. OpenAPI: `openapi.json` (repo kökü).

## Sağlık ve izleme

`GET /health`: alt sistemler ayrı ayrı (veritabanı, merkez bağlantısı, Kanzasset yayını, olay kuyruğu, kasa talimatları, açık mahsuplaşma penceresi). Her kontrolün `status` alanı `ok`, `degraded` ya da `down`, yanında tek cümlelik açıklama. Genel durum en kötü kontroldür. HTTP 503 yalnız `down` durumunda döner: merkez soketi koptuğunda servis `degraded` olur ama 200 döner, çünkü konteyner sağlıklıdır. Docker'da üç servis de bu uca bakar ve sıra ile kalkar (merkez, AMR, Kanzasset); durum `docker compose ps` ile görülür.

## İstek günlüğü (VARA kanıtı)

Kanzasset'ten gelen her `/v1` isteği ve panelden yapılan her değiştirici istek kalıcı olarak yazılır: zaman, uç, sonuç, süre, API anahtarı ya da kullanıcı, `Idempotency-Key` ve **gövdenin sha256 özeti**. Gövdenin kendisi saklanmaz: özet, "bu istek bu gövdeyle geldi" sorusunu cevaplar ama kayıt şişmez. Kanzasset kendi tarafında aynı özeti giden çağrı için tutar; iki özet birebir aynıdır, böylece tek taraflı kayda güvenmek gerekmez.

Okuma: R11 Kayıtlar ekranı (beş kaynak, metin ve tarih süzgeci, sayfa geçişi) ya da `GET /admin/logs?source=&q=&from=&to=&limit=&offset=`. Kısa liste R9 Belgeler ekranında da durur (`GET /admin/requests`). Saklama süresi `log.retention_days` parametresidir (varsayılan 90 gün, R10'dan değişir); süresi geçen satırlar dakikada bir taranıp silinir.

## API dokümanı

Sunucu ayaktayken `http://localhost:4000/docs`: tek sayfalık görüntüleyici, iki sekme (Kanzasset sözleşmesi `/v1` ve panel API'si `/admin`). Uçlar, parametreler, istek gövdeleri, cevaplar ve şemalar buradan gezilir. Ham belgeler: `GET /openapi.json` (`npm run openapi:export`) ve `GET /admin-api.json` (`npm run adminapi:export`). Panel belgesi çalışan sunucunun yol tablosundan üretilir: açıklaması olmayan uç kalırsa betik hata verir, böylece belge ile kod arasındaki fark büyümeden görülür. Görüntüleyici bağımlılıksızdır ve dışarıdan dosya çekmez, kapalı ağda da açılır. Rafineri ekranlarında sol menünün altındaki "API dokümanı" bağlantısı aynı sayfayı açar.

## Demo ayarları (R10 → parametreler)

`debug.order_delay_ms`: emir kararını geciktirir (cevapsız emir ve geç fill senaryoları) · `order.quote_max_age_ms`: quote_seq tazeliği · `limit.current_account_*`: cari hesap limitleri · `limit.warn_pct`: uyarı eşiği · `events.retry_schedule_ms`: olay tekrar takvimi.

## Mock merkez kontrolü (test)

```bash
curl -X POST localhost:4110/control/pause     # fiyat durur, bağlantı açık kalır
curl -X POST localhost:4110/control/resume
curl -X POST localhost:4110/control/kill      # bağlantıyı koparır (AMR yeniden bağlanır)
curl -X POST localhost:4110/control/jump -H 'content-type: application/json' -d '{"pct": 2}'
```

## Sprint planı

| Sprint | Kapsam | Ekranlar |
|---|---|---|
| 1 ✓ | iskelet, sözleşme, mock merkez, fiyat soketi, merkez bağlantısı, yayın durdur / başlat, bildirimler, ayarlar | R1, R2, R10 |
| 2 ✓ | emirler (fill / red / iptal, Tahsis Belgesi), bakiye bilgisi, cari hesap ve limit (K3), olaylar (webhook), cevapsız emir | R3, R5 |
| 3 ✓ | kasa talimatları (kabul / red, kasaya konuluyor / konuldu, T+3), Kasa Giriş / Çıkış Fişi, günlük kasa ekstresi, büyük alış / satış karşılığı | R4 |
| 4 ✓ | fiziksel teslimat (lojistik teklifi, Sevkiyat Fişi, takip no, teslimat kaydı), rafinasyon + katalog | R6, R7 |
| 5 ✓ | mahsuplaşma (kesim saati otomatik, talep iki yönlü, mutabakat, altın ve para bacağı), belgeler ve PDF, kullanıcılar ve roller, ikinci onay | R8, R9, R10 |
| 6 ✓ | demo senaryoları S0..S9, sunum senaryosu, kullanım kılavuzu, Docker, test raporu | |
| + | görsel dil (açılır kapanır yan menü, açık / koyu mod, responsive), kayıtlar ekranı, sağlık ve istek günlüğü, API dokümanı | R11 |
