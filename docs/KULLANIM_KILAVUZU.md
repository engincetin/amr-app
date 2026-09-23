# Kullanım kılavuzu · rafineri personeli

Bu kılavuz AMR uygulamasını günlük işte kullanan rafineri personeli içindir. Sade anlatılmıştır; iş kurallarının ayrıntısı `KZ_AMR_Akislar.md`, sistemin tasarımı `KZ_AMR_Sistemi.md` dosyalarındadır.

Uygulama adresi: `http://localhost:4000` (kurulumda değişir).

---

## 1. Ekranı tanıyalım

Solda ekran listesi (simge + ad; Kanzasset paneliyle aynı sıra), üstte sade bir **üst şerit** (yayın durumu, tema, bildirim zili, kullanıcı) ve yan menünün altında bağlantı satırları vardır. Günün sayıları **Genel bakış** ekranındadır. Nereye bakılır:

| Yer | Ne anlatır | Ne zaman endişelenmeli |
|---|---|---|
| Üst şerit: Yayın | Fiyat Kanzasset'e akıyor mu | "Yayın durdu" yazıyorsa Kanzasset işlem yapamaz; R2 Fiyat'a bakın |
| Yan menü altı: Merkez | Fiyat kaynağına bağlı mıyız | "Kopuk" ise R11 Ayarlar'dan yeniden bağlanın |
| Yan menü altı: Kanzasset | Karşı taraf soketimize abone mi | "Bağlı değil" ise emir gelmez |
| Genel bakış: Kasa hesabı | Kanzasset adına kasada duran gram | Beklenmedik düşüş varsa R4'teki hareketlere bakın |
| Genel bakış: Cari hesap | Karşılıklı açık hesap: gram ve para | Limit yüzdesi %80'i geçtiyse mahsuplaşma zamanı |
| Üst şerit: Kullanıcı | Hangi kullanıcı olarak çalışıyorsunuz | Düğmeler rolünüze göre çalışır |

**Kullanıcı seçimi:** üst şeritteki kullanıcı kutusundan kendinizi seçin. Rolünüz yetkinizi belirler:

| Rol | Ne yapar |
|---|---|
| Kasa operasyonu | Kasa taleplerini kabul eder, kasaya koymayı işler, sevkiyat ve teslim adımlarını yürütür |
| Üretim | Ürün kataloğunu yönetir, rafinasyon teklifi verir, üretimi yürütür |
| Masa | Merkez bağlantısı ve yayın, lojistik fiyatı, mahsuplaşma onayı ve ödeme |
| Yönetici | Hepsi, ayrıca parametreler, kullanıcılar ve API anahtarları |
| Denetçi | Her şeyi görür, hiçbir şeye dokunamaz |

Yetkiniz olmayan bir düğmeye bastığınızda uygulama size neden yapamadığınızı yazar.

---

## 2. Günlük işler

### 2.1 Sabah: yayını açmak

1. **R2 Fiyat** ekranını açın.
2. Merkez kutusunda **Bağlı** yazmıyorsa **R11 Ayarlar → Bağlantı** bölümünden **Bağlan** deyin.
3. Tick listesi akmaya başlayınca yayın açıktır; üst şeritte **Yayın açık** görünür.

Yayını durdurmanız gerekirse (örneğin merkezde sorun varsa) **Yayını durdur** deyin ve gerekçe yazın. Gerekçe Kanzasset'e gider ve müşteri tarafı anında durur. Sorun geçince **Başlat**.

### 2.2 Kasa talebi geldi (en sık iş) · R4

Kanzasset gram girişi ya da çıkışı istediğinde bildirim düşer.

1. **R4 Kasa hesabı** ekranını açın.
2. **Bekleyen talepler** tablosunda talebi görün: tür, gram, Kanzasset referansı, hedef cevap süresi sayacı.
3. Gerçekten yapılabilir mi bakın (uygulama kuralı zaten kontrol eder: girişte Kanzasset'in cari hesabında yeterli gram, çıkışta kasada yeterli gram).
4. **Kabul et** deyin.
   - Kabul anında **Kasa Giriş Fişi** ya da **Kasa Çıkış Fişi** oluşur ve Kanzasset'e gider.
   - Fiş numarasına tıklayarak belgeyi görebilir, PDF indirebilirsiniz.
5. Yapamayacaksanız **Reddet** deyin ve gerekçe yazın. Gram yerinde kalır.

> **Neden önemli:** Kasa Giriş Fişi, Kanzasset tarafında token basmanın tek dayanağıdır. Fiş kesmeden gram hareket etmez.

### 2.3 Külçeyi kasaya koymak · R4

Kasa girişini kabul ettiğinizde gram "kasaya konuluyor" kalemine geçer. Külçe fiziksel olarak kasaya yerleşince:

1. **R4** → **Kasaya koyma kuyruğu** tablosu.
2. Taşıma başladıysa **Kasaya konuluyor** deyin (isteğe bağlı ara adım).
3. Külçe kasaya yerleşince **Kasaya konuldu** deyin. Gram "kasada" kalemine geçer.

**Vade en geç T+3'tür.** Vade sayacı kırmızıya dönerse geciktiniz demektir: uyarı düşer ve Kanzasset tarafında yeni token basımı durur. Geciken kaydı en kısa sürede kapatın.

### 2.4 Fiziksel teslimat · R6

Kanzasset müşterisi için külçe teslimatı istediğinde:

1. **R6 Fiziksel teslimat**, talebi bulun.
2. Anlaşmalı taşıyıcıdan fiyat alın, **Lojistik fiyatı gir**: taşıyıcı adı ve tutar. Teklif 24 saat geçerlidir.
3. Kanzasset onaylayınca durum **onaylandı** olur.
4. **Hazırlığa al** → külçeyi hazırlayın.
5. **Hazır** deyin: Sevkiyat Fişi kesilir, külçe kasadan sevkiyat alanına geçer. (Kasa hesabı toplamı değişmez; külçe hâlâ Kanzasset'indir.)
6. Taşıyıcı aldığında **Taşıyıcıya ver**: taşıyıcı ve takip numarası girin.
7. Teslim edildiğinde **Teslim edildi** deyin: Teslimat Kaydı kesilir ve kasa hesabı düşer.

Sevkiyattan önce iptal gerekirse **İptal** deyin; külçe kasaya döner. Sevkiyattan sonra iptal edilemez; teslim edilemezse **teslim edilemedi** olarak işaretlenir ve istisna olarak ele alınır.

Ekranda müşteri adı görünmez, yalnız adres ve sigorta lehtarı referansı vardır.

### 2.5 Rafinasyon · R7

**Katalog:** ekranın altındaki tabloda ürünler, gramajları, ayarları, tarifeleri ve üretim süreleri durur. **Düzenle** ile tarife ve süreyi değiştirin, **Pasife al** ile satıştan geçici kaldırın. **Yeni ürün** ile kataloğa ürün ekleyin: aynı gramajın başka ayarlısı da ayrı ürün olur (ör. 100 g 999,9 ve 100 g 999,5). **Sil** ürünü listeden tamamen çıkarır; eski taleplerin kalemleri kendi kayıtlarında durur. Her değişiklikte katalog sürümü artar ve Kanzasset güncel listeyi kendiliğinden çeker, K7 ekranında aynı liste görünür.

**Talepler:**

1. Talep gelince kalemleri ve toplam saf gramı görün.
2. **Teklif ver**: ürün bedeli ve lojistik, üretim süresi. Ekran katalog tarifesine göre öneri gösterir. Teklif 48 saat geçerlidir.
3. Kanzasset onaylayınca **Üretime al**.
4. Üretim bitince **Hazır** (Sevkiyat Fişi kesilir).
5. **Taşıyıcıya ver** (takip no) → **Teslim edildi**.

İptal yalnız üretime girmeden yapılabilir.

### 2.6 Mahsuplaşma · R8

Gün içinde biriken karşılıklı alacak ve borç kapatılır. Ekranın üstünde **alacak verecek durumu** her zaman görünür: altın ve üç kur, her birinde tutar ve kimin borçlu olduğu. Kapatılacak her kalem bir **bacaktır**; ekranda her bacak bir satırdır ve satırda o an yapılacak tek iş yazar.

- Pencere **kesim saatinde kendiliğinden açılır** (varsayılan 17:00 Dubai) ve kapsamı tümüdür.
- Gün içinde **Mahsuplaşma başlat** ile siz de açabilirsiniz. Düğme sihirbazı açar:
  1. **Ne kapatılacak:** bacaklar listelenir, işaretlediğiniz kapanır. İşaretlemedikleriniz dokunulmadan kalır.
  2. **Ne kadar:** her bacak için tutar girilir, varsayılan tamamıdır. Daha azını girerseniz kalanı cari hesapta durur ve sonraki pencereye kalır.
  3. **Gerekçe ve özet:** ne isteneceği tek ekranda özetlenir, gerekçe yazılır ve pencere açılır.
- Cari hesap limiti dolduğunda da açılır.

Pencere açıldıktan sonra:

1. **Ekstreyi çıkar** deyin: gün içi işlemler, net gram ve kur bazında para imzalı ekstre olur, Kanzasset'e gider.
2. Kanzasset kendi kaydıyla karşılaştırır. **Eşit** görünürse iki kayıt birebir tutmuş demektir; bacaklar ancak bundan sonra kapanır.
   - **Fark var** görünürse tablo farkı satır satır gösterir. Ödeme yapmayın; farkı çözün, sonra **Ekstreyi yeniden çıkar** deyin.
3. **Altın bacağı.** Rafineri gram borçluysa satırdaki **Kasaya koymayı teklif et** düğmesine basın; Kanzasset onaylayınca kasa girişi talebi gelir, R4'ten kabul edersiniz, fiş kesilir. Kanzasset gram borçluysa yapacağınız bir şey yoktur: çıkış talebini o gönderir, siz R4'ten kabul edersiniz. Rafineri kendi başına kasadan gram çıkaramaz.
4. **Para bacağı.** Her kur kendi satırında kapanır.
   - Ödeyen Kanzasset ise para geldiğinde **Ödeme alındı** deyin.
   - Ödeyen rafineri ise **Ödemeyi bildir** deyin ve banka referansını girin. Bu işlem ikinci onay ister: başka bir kullanıcı R11 Ayarlar'dan onaylar.
5. Kapsamdaki bütün bacaklar kapanınca pencere **kapandı** olur, Mahsuplaşma Ekstresi kesilir ve limit sayaçları sıfırlanır.

### 2.7 Belgeler · R9

Ürettiğiniz her belge burada toplanır: Tahsis Belgesi, kasa fişleri, teklifler, Sevkiyat Fişi, Teslimat Kaydı, ekstreler.

- Tipe ve belge numarasına göre arayın.
- **Görüntüle** ile içeriği, sha256 özetini ve imzayı görün.
- **PDF** ile indirin.
- **Kanzasset'e gönderim** sütunu belgenin karşı tarafça çekilip çekilmediğini gösterir.
- Alttaki **Olay teslimleri** tablosu Kanzasset'e giden bildirimlerin durumunu gösterir. "FAILED" varsa bağlantıyı kontrol edin.

---

## 3. Bir şeyler ters gittiğinde

| Belirti | Ne demek | Ne yapmalı |
|---|---|---|
| Yan menü altında "Merkez kopuk" | Fiyat kaynağına bağlantı gitti | R11 Ayarlar → **Bağlan**. Düzelmiyorsa merkez tarafına haber verin. Yayın kendiliğinden durur, emir kabul edilmez. |
| Üst şeritte "Yayın durdu" | Biri elle durdurmuş ya da merkez yok | R2 → **Yayını başlat**. Gerekçeyi bildirimlerden görebilirsiniz. |
| Cari hesap limiti %80 üstü | Açık hesap büyüdü | R8 → **Mahsuplaşma talep et**. Limit dolarsa yeni emirler reddedilir. |
| Kasa talebi reddedildi diyor | Kural tutmadı | Girişte Kanzasset'in cari hesabında yeterli gram yok; çıkışta kasada yeterli gram yok ("kasaya konuluyor" sayılmaz). Kanzasset ile konuşun. |
| T+3 sayacı kırmızı | Külçe vadesinde kasaya konmadı | R4 → **Kasaya konuldu**. Kapanana kadar Kanzasset yeni token basamaz. |
| "Fark var" (mahsuplaşmada) | İki kayıt tutmadı | Ödeme yapmayın. Fark satırlarına bakın, Kanzasset ile karşılaştırın, düzeltin, ekstreyi yeniden çıkarın. |
| Düğme çalışmıyor, "yetki yok" diyor | Rolünüzde bu iş yok | Üst şeritten doğru kullanıcıya geçin ya da yetkili kişiye haber verin. |
| "İkinci onay bekliyor" | Kritik işlem iki kişi ister | R10 → **Bekleyen onaylar**, başka bir kullanıcı **Onayla** desin. İsteyen kişi kendi isteğini onaylayamaz. |
| Olay teslimi FAILED | Kanzasset'e bildirim gitmedi | R9 → olay tablosundaki hataya bakın; Kanzasset tarafı ayakta mı kontrol edin. Sistem üstel bekleme ile yeniden dener. |

---

## 4. Yönetici işleri · R10

- **Parametreler:** kesim saati, kasa talimatı kabul biçimi (elle / otomatik), kasaya koyma vadesi, cari hesap limitleri, teklif geçerlilik süreleri. Değiştirip **Kaydet** deyin; ikinci onay istenir.
- **Kullanıcılar ve roller:** kullanıcı ekleyin, rol verin, pasife alın.
- **API istemcileri:** Kanzasset'in anahtarını üretin ya da iptal edin. Sır yalnız üretim anında bir kez gösterilir, not alın.
- **Denetim günlüğü:** kim, ne zaman, ne yaptı; önceki ve sonraki değer.

---

## 5. Hatırlanacak beş kural

1. **Fiş olmadan gram hareket etmez.** Kabul ettiğiniz an belge oluşur ve karşı tarafa gider.
2. **Kasaya koymayı geciktirmeyin.** T+3 geçerse karşı tarafta token basımı durur.
3. **Fark varken ödeme yapılmaz.** Mahsuplaşmada "fark var" görüyorsanız önce farkı çözün.
4. **Gerekçe isteyen her yerde gerekçe yazın.** Yayını durdurma, red, iptal: hepsi karşı tarafa gider ve günlükte kalır.
5. **Rolünüzle çalışın.** Denetçi hesabıyla açıp düğme aramayın; işi yapacak rolü seçin.
