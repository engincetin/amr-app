# AMR uygulaması

Ahlatcı Metal Refinery (AMR) tarafında çalışan uygulama. Kanzasset'e fiyat soketi ve API verir, rafineri personeline ekranlar sunar. Kanzasset tarafı ayrı repodadır: `kz-treasury`.

İş kuralları ve akışlar: `docs/KZ_AMR_Akislar.html` · sistem tasarımı (ekranlar, API, soket, veri): `docs/KZ_AMR_Sistemi.html`.

## Ne yapar

- Merkezi uygulamanın (merkez) fiyat soketine bağlanır, fiyatı Kanzasset'e kendi soketiyle yayınlar (`/v1/prices`).
- Kanzasset için iki hesap tutar: **Kasa Hesabı** (kasada, kasaya konuluyor, sevkiyatta) ve **Cari Hesap** (net gram + kur bazında para).
- Kanzasset'ten gelen talepleri karşılar: emir (alış / satış), kasa talimatı (giriş / çıkış), fiziksel teslimat, rafinasyon, mahsuplaşma.
- Her durum değişikliğinde iki tarafa bildirim üretir. Fişler ve ekstreler indirilebilir.

Rafineri tarafında token, mint, burn, cüzdan, müşteri adı yoktur. Talepler yalnız gram ve Kanzasset referansı taşır.

## Yapı

```
packages/contract     @amr/contract   sözleşme: TypeBox şemaları, sabitler, imza kuralı (tek kaynak, kz-treasury'ye kopyalanır)
apps/mock-merkez      @amr/mock-merkez merkez taklidi: ws://localhost:4100/prices, kontrol http://localhost:4110/control/*
apps/amr-server       @amr/server     Fastify API + soket + SQLite (node:sqlite), rafineri paneli API'si, SSE
apps/amr-web          @amr/web        React 19 + Vite, rafineri ekranları R1..R10
scripts/kz-client.mjs                 soket test istemcisi (Kanzasset gibi bağlanır)
docs/                                 KZ_AMR_Akislar, KZ_AMR_Sistemi (md + html)
```

## Çalıştırma

Gereksinim: Node 22.12 veya üstü (`node:sqlite` için).

```bash
npm install
npm run dev          # merkez (4100/4110) + server (4000) + web (4001, Vite)
```

Tarayıcı: `http://localhost:4001` (geliştirme) ya da `npm run build && npm start` sonrası `http://localhost:4000`.

Tek tek: `npm run dev:merkez`, `npm run dev:server`, `npm run dev:web`.

Test: `npm test`. OpenAPI: `npm run openapi:export` → `packages/contract/openapi.json`.

## Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `4000` | API + soket + statik web |
| `DB_PATH` | `apps/amr-server/data/amr.db` | SQLite dosyası |
| `SOURCE_URL` | `ws://localhost:4100/prices` | merkez fiyat soketi (R2'den de değiştirilir) |
| `SOURCE_AUTOCONNECT` | `1` | açılışta merkeze bağlan |
| `KZ_API_KEY` / `KZ_API_SECRET` | `kz-dev-key` / `kz-dev-secret` | Kanzasset istemcisi (ilk açılışta yazılır) |
| `ADMIN_TOKEN` | boş | verilirse panel API'si `X-Admin-Token` ister |
| `LOG_LEVEL` | `info` | |
| `MERKEZ_WS_PORT` / `MERKEZ_HTTP_PORT` | `4100` / `4110` | mock merkez |
| `MERKEZ_INTERVAL_MS` / `MERKEZ_START_USD` | `1000` / `141.9` | mock merkez tick aralığı ve açılış fiyatı |

## Kanzasset'e verilen arayüz

- REST `/v1/*`: başlıklar `X-API-Key`, `X-Timestamp`, `X-Signature = HMAC-SHA256(secret, ts + METHOD + path + body)`, POST'ta `Idempotency-Key`. Zaman sapması en çok 5 dk.
- Soket `/v1/prices`: ilk mesaj `auth {api_key, ts, sig}` (imza `ts + "GET" + "/v1/prices"`), sonra `subscribed`, `snapshot`, `tick` (yalnız değişince, saniyede en çok 1), `heartbeat` (5 sn), `halt {reason}`, `resume` (+snapshot).
- Tüm miktarlar tam sayı: gram için mg, para için cent. Fiyatlar ondalık string.

Sözleşme `packages/contract/src/index.ts` içindedir. Değişiklik yalnız burada yapılır, sonra `kz-treasury` içinde `npm run contract:sync` çalıştırılır.

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
| 2 | emirler, bakiye bilgisi, cari hesap, K1..K3 kontrolleri | R3, R5 |
| 3 | kasa talimatları, Kasa Giriş / Çıkış Fişi (PDF), büyük alış / satış | R4 |
| 4 | fiziksel teslimat (lojistik teklifi, Sevkiyat Fişi, takip no), rafinasyon + katalog | R6, R7 |
| 5 | mahsuplaşma (kesim saati otomatik, talep iki yönlü), belgeler, kullanıcılar | R8, R9 |
| 6 | demo senaryoları S0..S9, kullanım kılavuzu, teslim paketi | |
