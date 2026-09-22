# Demo · yönetim sunumu (20 dakika)

Bu doküman toplantıda adım adım ne yapılacağını yazar: hangi ekran açılır, hangi düğmeye basılır, ekranda ne görünür, bir cümleyle ne söylenir.

İki uygulama aynı anda çalışır:

- **Rafineri (AMR uygulaması)** `http://localhost:4000` · ekranlar R1'den R11'e
- **Kanzasset (hazine çekirdeği)** `http://localhost:5000` · ekranlar K1'den K12'ye

Sunumda iki tarayıcı penceresi yan yana durur: solda rafineri, sağda Kanzasset. Aynı olayın iki tarafta birden göründüğünü göstermek sunumun ana fikridir.

---

## Sabah başlatma (3 komut)

Üç ayrı terminalde, sırayla:

```bash
# 1) Rafineri: mock merkez (fiyat kaynağı) + AMR sunucusu + ekranlar
cd amr-app && npm install && npm run build && npm run demo

# 2) Kanzasset: hazine çekirdeği + ekranlar
cd kz-treasury && npm install && npm run build && npm run demo:server

# 3) Senaryoları koştur (ekranlar gerçek veriyle dolar)
cd kz-treasury && npm run demo
```

Tek komutla Docker ile: `docker compose up --build` (kökte `docker-compose.yml`; bkz. README).

Kontrol: `http://localhost:4000` açıldığında üst şeritte **Yayın açık**, yan menünün altında **Merkez bağlı** ve **Kanzasset abone** yazmalı. Yazmıyorsa 1. komutun terminaline bakın.

**Sunumdan önce** senaryoları bir kez koşun (3. komut, ~2 dakika): ekranlar dolu gelir ve toplantıda boş tablo görünmez. İsterseniz sunum sırasında canlı koşmak için `DEMO_GAP_MS=5000 npm run demo` kullanın, adımlar arasında 5 saniye bekler.

---

## Akış (20 dakika)

### 0. Açılış · 1 dakika · R1 Genel bakış

**Aç:** rafineri `http://localhost:4000`.

**Göster:** yan menü (Kanzasset paneliyle aynı sıra ve adlar), üst şerit (yayın durumu, bildirim zili, kullanıcı), yan menünün altındaki bağlantı satırları, Genel bakış kartları (kasa hesabı, cari hesap, bekleyen işler).

> "Bu rafineride çalışan uygulama. Üstteki şerit günün durumunu tek bakışta veriyor: fiyat akıyor mu, Kanzasset bağlı mı, kasada ne kadar altın var, karşılıklı hesap nerede."

**Sağ pencerede aç:** Kanzasset `http://localhost:5000`.

> "Bu da Kanzasset tarafı. İki ayrı sistem, ortak veritabanı yok; aralarında sözleşmeli bir API ve fiyat soketi var."

---

### 1. Fiyat zinciri · 2 dakika · R2 → K11

**R2 Fiyat:** son tick listesi akıyor.

> "Fiyat rafinerinin merkezi uygulamasından geliyor, biz onu Kanzasset'e kendi soketimizle yayınlıyoruz. Gram başına, 999,9 ayar, üç kurda çift yönlü."

**K2 Fiyat:** aynı fiyat, yanında müşteri fiyatı (fiyat zinciri).

> "Kanzasset aynı fiyatı alıyor, üstüne marjını gömüyor ve müşteriye tek fiyat gösteriyor. Komisyon ayrı satır. Müşteri rafineri fiyatını görmüyor."

**Düğme:** R2'de **Yayını durdur** (gerekçe: "demo"). K1'de müşteri işlemleri kendiliğinden durar.

> "Yayın durursa müşteri tarafı da anında duruyor. Fiyat yoksa işlem yok."

**Düğme:** R2'de **Başlat**. K1 yeşile döner.

---

### 2. Stoktan alış ve satış · 2 dakika · K3 → R3

**K3 Emirler:** listenin başındaki alış emri (özet kartları rafineri tarafıyla aynı).

> "Müşteri 70 gram aldı. Kanzasset aynı gramla rafineride bir alış emri açtı: birebir, pozisyon taşımıyoruz."

**Satırı tıklayın:** zaman çizelgesi açılır.

> "Emir FOK: ya tamamı ya hiç. Fiyatın dayandığı tick numarası ve slippage limiti emirle gidiyor."

**R3 Emirler:** aynı emir rafineri tarafında.

> "Rafineri tarafında aynı emir, fill fiyatı ve Tahsis Belgesi ile duruyor. Alışta belge otomatik üretiliyor: gramlar Kanzasset adına ayrıldı demek."

---

### 3. Büyük alış · 4 dakika · K3 → R4 → K4 (sunumun en önemli parçası)

> "Şimdi ilginç kısım. Müşteri 15 kilo aldı ama hazine stoğu bu kadar düşemez."

**K3:** 15.000 g emrin satırı, **Akış** sütununda "büyük alış (07)".

**Satırı tıklayın:** zaman çizelgesinde sırayla: fiyat kilitlendi → eksik hesaplandı → kasa girişi istendi → mint → tek seferde teslim.

> "Fiyat ilk saniyede kilitlendi, yani fiyat riski yok. Eksik kısım için rafineriden kasa girişi istendi."

**R4 Kasa hesabı:** bekleyen talep kuyruğu (demo koşulduysa işlenmiş görünür; canlı göstermek için K4'ten yeni talep açın).

> "Rafineri tarafında talep kuyruğa düştü. Kasa operasyonu 'Kabul et' diyor."

**Düğme:** **Kabul et**. Ekranda Kasa Giriş Fişi numarası belirir.

> "Kabul anında Kasa Giriş Fişi kesildi. Bu fiş Kanzasset tarafında mint'in tek dayanağı: fiş yoksa mint yok."

**K4 Kasa hesabı:** aynı talimat, fiş numarası ve mint işlem referansı yan yana.

> "Fiş geldi, mint yapıldı, müşteriye teslim tek seferde yapıldı. Kısmi teslim yok."

**Göster:** K4 üstünde **Mint durumu** ve **kasaya konuluyor tavanı**.

> "Mint iki durumda bloke oluyor: iki defter uyuşmazsa ve külçe üç gün içinde kasaya konmazsa."

---

### 4. Kasa hesabı ve kontroller · 2 dakika · R4 → K2

**R4:** "Kasaya koyma kuyruğu (T+3)" tablosu, vade sayacı.

**Düğme:** **Kasaya konuldu**. Gram "kasaya konuluyor"dan "kasada"ya geçer.

> "Külçe fiziksel olarak kasaya konunca işaretleniyor. Vade en geç üç gün; geçerse uyarı düşüyor ve yeni mint duruyor."

**K5 Cari hesap:** eşleşme durumu **EŞİT**, K1 ve K2 kontrolleri yeşil.

> "Her harekette Kanzasset kendi kaydını rafinerinin bakiye bilgisiyle karşılaştırıyor. Birebir eşit olmak zorunda. Eşit değilse işlem duruyor."

---

### 5. Fiziksel teslimat · 3 dakika · K6 → R6

**K6 Fiziksel teslimat:** talep satırı, **Emanet** kartı.

> "Müşteri külçe istedi. Tokenler burn cüzdanına alındı: dolaşımdan çıktı ama henüz yakılmadı."

**R6 Fiziksel teslimat:** **Lojistik fiyatı gir** (taşıyıcı Brinks, tutar 450).

> "Rafineri taşıyıcıdan fiyat alıyor ve giriyor. Lojistik Teklifi belgesi oluşuyor, 24 saat geçerli."

**K6:** **Teklifi onayla**.

> "Kanzasset müşteri onayını aldıktan sonra onaylıyor. Masraf cari hesaba yazılıyor; Kanzasset bu işten komisyon almıyor, masrafı müşteriden aynen alıyor."

**R6:** sırayla **Hazırlığa al** → **Hazır** → **Taşıyıcıya ver** (takip no) → **Teslim edildi**.

> "Hazır olunca Sevkiyat Fişi kesiliyor ve külçe kasadan sevkiyat alanına geçiyor: kasa hesabı toplamı değişmiyor, külçe hâlâ Kanzasset'in. Teslimde kasa hesabı düşüyor ve Kanzasset aynı anda burn yapıyor."

**K6:** burn işlem referansı görünür, emanet sıfırlanır.

---

### 6. Rafinasyon · 2 dakika · R7 → K7

**R7 Rafinasyon:** alttaki **Ürün kataloğu**. Bir ürünün tarifesini **Düzenle** ile değiştirin.

> "Katalog rafineride duruyor: ürün, gramaj, ayar, tarife, üretim süresi. Değiştirdiğimizde Kanzasset'e olay gidiyor."

**K7 Rafinasyon:** katalog sürümü artmış.

> "Kanzasset güncel kataloğu çekti ve müşteriye bu listeyi gösteriyor."

**K7:** talep satırında müşteri fiyatı.

> "Rafineriye ürün bedeli ve lojistik ödeniyor. Müşteriye gösterilen fiyat marj ve komisyon dahil; o fark Kanzasset'te kalıyor."

---

### 7. Mahsuplaşma · 3 dakika · R8 → K8

**R8 Mahsuplaşma:** **Kesimi şimdi tetikle**.

> "Normalde her gün 17:00 Dubai'de kendiliğinden başlıyor, talep gelmese de. Şimdi elle tetikliyorum."

**Göster:** ekstre taslağı, altın bacağı, kur bazında para bacağı.

> "Gün boyunca biriken her şey burada: işlem listesi, net gram, kur bazında para. Ekstre imzalı."

**K8 Mahsuplaşma:** mutabakat kendiliğinden yapılmış, **mutabakat sağlandı**.

> "Kanzasset kendi kaydıyla karşılaştırdı, birebir tuttu. Tutmasaydı pencere fark listesiyle duracaktı ve ödeme yapılmayacaktı."

**K8:** **Altın bacağını başlat** → **R4**'te **Kabul et** → **K8**'de **Şirket hesabından öde**.

> "Altın bacağı kasa talimatıyla kapanıyor, para bacağı banka ödemesiyle. Ödeme yalnız şirket hesabından yapılıyor, müşteri hesabı asla ödemiyor."

**R8:** pencere **kapandı**, Mahsuplaşma Ekstresi belgesi.

> "Pencere kapandı, limit sayaçları sıfırlandı. Gün temiz."

---

### 8. Belgeler, roller ve parametreler · 1 dakika · R9 → R10

**R9 Belgeler:** tüm belgeler tek listede, **PDF** düğmesi.

> "Ürettiğimiz her belge burada: fişler, teklifler, ekstreler. Her birinin imzası ve Kanzasset'e gönderim zamanı tutuluyor. PDF olarak indiriliyor."

**Bir PDF açın.**

**R11 Ayarlar:** üst şeritten **Kullanıcı** seçiciyi gösterin, **Denetçi**'ye geçin.

> "Roller gerçek: Denetçi hiçbir düğmeye basamıyor, yalnız okuyor. Kasa operasyonu kasa taleplerini kabul ediyor, parametrelere dokunamıyor."

**Yönetici'ye dönün**, bir parametre değiştirip **Kaydet**.

> "Kritik değişiklikler iki kişi istiyor: biri isteyecek, başkası onaylayacak. Her aksiyon denetim günlüğüne yazılıyor."

---

## Kapanış cümlesi

> "Özetle: iki ayrı sistem, aralarında tek bir sözleşme. Rafineri tarafında token, cüzdan, müşteri adı yok; yalnız gram, fiş, fiyat ve para var. Her hareket iki defterde birden tutuluyor ve her adımda karşılaştırılıyor. Kontroller tutmadığı anda sistem kendini durduruyor."

---

## Sorulursa

| Soru | Cevap |
|---|---|
| Fiyat nereden geliyor? | Rafinerinin merkezi uygulamasından. Demoda yerini mock merkez tutuyor; gerçek arayüz gelince yalnız adaptör değişir. |
| Mint nasıl güvence altında? | Yalnız Kasa Giriş Fişi'ne karşı yapılıyor. Fiş rafinerinin kabulüyle oluşuyor, yani gramlar kasada Kanzasset adına ayrılmadan token basılamıyor. |
| İki defter ayrılırsa ne olur? | Hareket geçerli kalıyor (fiyat bağlayıcı), hesap RECONCILE'a düşüyor, mint ve kasa çıkışı bloke oluyor, insan çözüyor. K2 ekranında gösterilebilir. |
| Rafineri müşterimizi görüyor mu? | Hayır. Taleplerde yalnız gram, Kanzasset referansı ve adres referansı var. |
| Gerçek para hareketi var mı? | Demoda banka ve BitGo bacakları zaman çizelgesinde metin olarak duruyor; rafineri bacağı gerçek. |
| Bu sistem ne kadar hazır? | Sprint 1'den 5'e bütün akışlar çalışıyor ve testli. Kalanlar: gerçek merkez arayüzü, banka ve BitGo entegrasyonları, PDF imzasının kuruma göre ayarlanması. |

---

## Senaryolar (simülatör)

`npm run demo` şunları sırayla koşar; tek tek de çalıştırılabilir (`npm run demo -- S3 S7`):

| Kod | Senaryo |
|---|---|
| S0 | Açılış devri: 20 kg kasada, karşılığı token |
| S1 | Stoktan alış 70,104 g |
| S2 | Stoktan satış 50 g |
| S3 | Büyük alış 15.000 g: eksik kadar kasa girişi, mint, tek seferde teslim |
| S4 | Büyük satış: stok tavanı aşılır, fazla yakılır, kasa çıkışı |
| S5 | Kasa talimatları: elle giriş ve çıkış |
| S6 | Cevapsız emir: durum sorgusu, iptal, kesin cevap |
| S7 | Fiziksel teslimat uçtan uca |
| S8 | Rafinasyon: katalog, teklif, üretim, teslim |
| S9 | Mahsuplaşma: kesim, mutabakat, altın ve para bacağı; ardından uyuşmazlık ve çözümü |

Koşum sonunda K1 ve K2 kontrollerinin tuttuğu ve iki defterin eşit olduğu yazılır.

`DEMO_MANUAL=1 npm run demo` rafinerinin elle yaptığı adımları (kasa kabulü, lojistik fiyatı, teklif, sevkiyat) bırakır: bunları ekrandan siz yaparsınız, sunumda canlı göstermek için uygundur.
