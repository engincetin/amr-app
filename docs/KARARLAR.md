# Kararlar

Tasarım dokümanlarında (`KZ_AMR_Akislar.md`, `KZ_AMR_Sistemi.md`) karşılığı olmayan ve uygulama sırasında verilen kararlar. Her satır bir karar; gerekçesi kısa tutulur. İki repoda aynı tutulur.

- **Kasa talimatı `ref` tekildir:** aynı Kanzasset referansıyla gelen istek aynı talebi döner, ikinci kez işlenmez. Çift mint'i önler (05, 06).
- **`vault.in_overdue` olayı eklendi:** Kontroller "kasaya koyma gecikti → yeni mint bloke" diyor ama olay listesinde karşılığı yoktu; Kanzasset'in blokeyi zamanında koyabilmesi için olay eklendi.
- **Kasa talimatı kuralları kabulde yeniden bakılır:** talep ile kabul arasına emir girebilir; kural yalnız istekte bakılsa defter bozulabilirdi.
- **Belgeler imzalı JSON + PDF:** belge içeriği JSON olarak üretilir (sha256 + HMAC imza), PDF aynı içerikten türetilir. Doküman "PDF üretimi + Ed25519" diyor; imza HMAC ile yapıldı, Ed25519 anahtar yönetimi rafineri kurulumuna bırakıldı.
- **Katalog 10 standart külçeyle tohumlanır** (1 g, 2,5 g, 5 g, 10 g, 20 g, 50 g, 100 g, 250 g, 500 g, 1 kg): dokümandaki katalog örneği varsayılan olarak yüklenir, rafineri R7'den değiştirir.
- **Teslimat ve rafinasyon talebinde `ref` tekildir:** kasa talimatıyla aynı gerekçe.
- **Emanet (`E`) Kanzasset kaydında `stock.e_mg` olarak tutulur:** `A = S + C + E` bağıntısı için; müşteride dolaşan `C = A − S − E` olarak türetilir.
- **Büyük alışta mint bloke ise teslim bekler:** kısmi teslim yasak olduğu için emir "teslim bekliyor" durumunda kalır, bloke kalkınca tek seferde teslim edilir.
- **"Kasaya konuluyor" tavanı yoldaki talepleri de sayar:** yalnız yerleşmiş gram sayılsaydı arka arkaya gönderilen talepler tavanı aşabilirdi.
- **Envanter hedefi `K` hazine emrinin fill anında değişir:** zincirin başında ve sonunda `S + T = K` tutar; aksi hâlde hedef yalnız zincir bitince değişip kontrolü uzun süre bozardı.
- **Mahsuplaşma penceresi açıkken yeni pencere açılmaz:** aynı anda iki açık pencere ekstre ve ödeme eşleşmesini bozardı; açık pencere varsa o döner.
- **Mahsuplaşmada para bacağı kur bazında ayrı kapanır:** her kurun net tutarı ayrı ödeme bildirimi ve onayı ister; hepsi kapanınca pencere `SETTLED` olur.
- **Demo kullanıcıları sabittir** (Masa, Kasa operasyonu, Üretim, Yönetici, Denetçi): oturum açma yerine üst şeritten kullanıcı seçilir; yetki kontrolü aynı kurallarla çalışır.
- **İkinci onay aynı oturumda farklı kullanıcı seçilerek verilir:** demo için; gerçek kurulumda iki ayrı oturum olacaktır.
- **API dokümanı sunucudan servis edilir (`GET /docs`):** görüntüleyici bağımlılıksızdır ve dışarıdan dosya çekmez; rafineri ağı kapalı olduğunda da açılır.
- **`/health` alt sistemleri ayrı ayrı bildirir:** `ok`, `degraded`, `down`. HTTP 503 yalnız `down` durumunda döner; merkez soketi koptuğunda servis `degraded` olur ama 200 döner, çünkü konteyneri yeniden başlatmak soketi geri getirmez. Kanzasset tarafında bozuk kontrol (K1, K2) `down` sayılır: bu durumda işlem yapılmamalıdır.
- **Docker servisleri sağlık denetimine göre sıralanır:** merkez sağlıklı olunca AMR, AMR sağlıklı olunca Kanzasset kalkar; açılışta soket kopuk diye senaryo yarıda başlamaz.
- **Kanzasset tarafında denetim günlüğü ve ikinci onay sunucudadır:** günlük kalıcı durumda tutulur (sayfa yenilenince kaybolmaz), kritik aksiyonlarda istek ve onay iki ayrı çağrıdır, onay bir kez kullanılır ve isteyen kendi isteğini onaylayamaz. Aktör `X-User` başlığından gelir; demoda üst şeritten seçilir.
- **İstek günlüğünde gövde saklanmaz, sha256 özeti saklanır:** "bu istek bu gövdeyle geldi" kanıtlanır ama kayıt şişmez ve gereksiz veri taşınmaz. İki taraf aynı gövdenin özetini tuttuğu için günlükler birbirini doğrular.
- **İstek günlüğüne ekran yenilemeleri yazılmaz:** yalnız Kanzasset uçları (`/v1`), rafineri olayları ve panelin değiştirici istekleri yazılır; `GET` ile yapılan ekran okumaları gürültüdür. Saklama süresi parametredir (rafineride `log.retention_days`, Kanzasset'te `PUT /api/log-params`, varsayılan 90 gün).
- **Panel API belgeleri yol tablosundan üretilir:** `admin-api.json` ve `kz-api.json` çalışan sunucunun uçlarından üretilir, açıklamalar ayrı bir tabloda durur; açıklaması olmayan uç kalırsa betik hata verir. Elle liste tutulsaydı belge ile kod sessizce ayrışırdı.
- **API görüntüleyicisi sözleşme paketindedir:** iki repoda tek kopya olsun diye `packages/contract/src/docs-viewer.ts` içindedir ve `npm run contract:sync` ile Kanzasset tarafına geçer.
