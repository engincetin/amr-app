# Test raporu

**21 Eylül 2026** · Sprint 1'den 6'ya. Bu rapor neyin test edildiğini, uçtan uca nelerin koşulduğunu ve bilinen eksikleri yazar.

---

## 1. Özet

| | amr-app | kz-treasury |
|---|---|---|
| Birim ve bütünleşme testi | **43** | **43** |
| Test dosyası | 5 | 6 |
| Başarısız | 0 | 0 |
| Tip denetimi (`tsc --noEmit`) | temiz (sunucu, web, sözleşme) | temiz (sunucu, web) |
| Derleme (`npm run build`) | temiz | temiz |

Toplam **86 test**, hepsi geçiyor. Testler `npm test` ile koşar (Node yerleşik test koşucusu).

Testlerdeki rakamlar dokümandaki örneklerle aynıdır: 70,104 g alış @ 142,00 → 9.954,77 USD; 50 g satış @ 141,80 → 7.090,00 USD; büyük alışta S 19.052,360 ve eksik 5.947,640 g; açılış alımı 20 kg.

---

## 2. Neler test edildi

### 2.1 amr-app (rafineri)

| Alan | Kapsam |
|---|---|
| Fiyat yayını (01) | tick yalnız fiyat değişince ve `seq` artar · `tradable` = merkez bağlı ve elle durdurulmamış · elle durdurma yeniden başlatmada kalıcı · merkez mesajının sözleşme fiyatına çevrilmesi |
| Kimlik ve imza | HMAC imza doğrulaması · REST imzasının ham gövde üzerinden hesaplanması · imza tutmazsa 401 |
| Emirler (03, 04) | fill ve bedel hesabı · Tahsis Belgesi · aynı `client_order_id` ile aynı cevap, farklı gövdede 409 · red sebepleri (STALE_QUOTE, PRICE_OUTSIDE_LIMIT, TRADING_HALTED, CURRENT_ACCOUNT_LIMIT) · cevapsız emirde kesin cevap ve geç fill |
| Kasa talimatları (05, 06) | fiş üretimi ve defter etkisi · iki kuralın hem istekte hem kabulde çalışması · `ref` tekilliği (çift mint koruması) · red · T+3 aşımı ve gecikmeli kapanış · otomatik kabul · günlük kasa ekstresi |
| Teslimat (10) | talep, teklif, onay (bedel cari hesaba), hazır (Sevkiyat Fişi), sevk, teslim · kasada yeterli gram kuralı · hazırdan iptalde külçenin kasaya dönmesi · sevkiyattan sonra iptal edilememesi · teklif süresinin dolması |
| Rafinasyon (11) | katalog tohumlama ve sürüm artışı · kalemlerin toplam saf grama çevrilmesi · pasif ürünün seçilememesi · teklif, onay, üretim, hazır, teslim · iptalin yalnız üretime kadar olması |
| Mahsuplaşma (12) | pencere açılışı ve ekstre taslağı · tek açık pencere kuralı · **kapsam** (yalnız USD seçilince altın ve diğer kurlar dokunulmaz) · mutabakat (eşit / farklı) · **altın teklifi ve onayı** (rafineri borçluyken teklif, Kanzasset borçluyken teklif edilemez) · altın bacağının kasa talimatıyla kapanması · para bacağı ve cari hesabın kapanması · kesim saatinin bir kez tetiklenmesi |
| Belgeler | PDF üretimi (A4, başlık, belge no, imza özeti) · Türkçe karakterlerin WinAnsi ile kodlanması |
| Roller ve onaylar | Denetçinin hiçbir elle aksiyon yapamaması · rol yetkilerinin doğruluğu · ikinci onayda aynı kullanıcının onaylayamaması · kullanıcı değişikliğinin denetim günlüğüne yazılması |

### 2.2 kz-treasury (Kanzasset)

| Alan | Kapsam |
|---|---|
| Fiyatlama | marjın fiyata gömülmesi ve müşteri aleyhine yuvarlama · marj tavanının aşılamaması · emir fişinde komisyonun ayrı satır olması |
| KZ kaydı ve eşleşme (02) | fill'in kayda işlenmesi · bakiye bilgisiyle karşılaştırma · uyuşmazlıkta RECONCILE ve mint / kasa çıkışı blokesi · `seq` boşluğu · fotoğrafla çözüm |
| Emirler (03, 04) | slippage limitinin iki yönde doğru hesaplanması |
| Kasa talimatları (05, 06) | girişte fiş önce mint sonra · çıkışta burn önce talep sonra (A ≤ V hiç bozulmaz) · RECONCILE ve T+3'te mint blokesi ve blokenin kalkması · "kasaya konuluyor" tavanı ve yeniden deneme |
| Büyük alış / satış (07, 08) | eksik hesabı ve `mint_policy` · mint tamamlanınca tek seferde teslim · mint bloke iken teslimin beklemesi · tavan aşımında fazlanın yakılması · taban ve tavan aşılmadığında zincirin kurulmaması |
| Hazine alım satımı (09) | onay matrisi · maker-checker kuralları · açılış alımı zinciri (S = K = 20.000, A = V) · satım zinciri ve hedefin düşmesi · stok yetmezse talebin açılmaması · emir reddinde zincirin kurulmaması · tavanın hazine alımını da durdurması |
| Teslimat ve rafinasyon (10, 11) | emanet (E +x, C −x) ve arzın değişmemesi · burn anı (teslim / sevkiyat) · iptalde emanetin çözülmesi · müşteri tokeni yetmezse talebin açılmaması · müşteri fiyatının marj ve komisyon dahil hesaplanması · hazine stokunun ve hedefin etkilenmemesi (K2) |
| Mahsuplaşma (12) | mutabakatın eşit ve farklı durumları · altın bacağının yönü · **onaysız kasa girişi talebi gönderilmemesi** · kapsamın rafineriye iletilmesi · para bacağında borçlu ve alacaklı davranışı · ödemenin cari hesabı kapatması |

---

## 3. Uçtan uca koşum

İki sunucu (mock merkez + AMR + Kanzasset) birlikte ayağa kaldırılıp **gerçek HTTP ve webhook** üzerinden koşuldu. Senaryolar `kz-treasury` içindeki simülatörle sürülür: `npm run demo`.

| Senaryo | Sonuç |
|---|---|
| S0 açılış devri 20 kg | ✓ iki tarafta eşit, S = K |
| S1 stoktan alış 70,104 g | ✓ fill, Tahsis Belgesi, müşteri fiyatı ve komisyon |
| S2 stoktan satış 50 g | ✓ fill, önce ödeme |
| S3 büyük alış 15.000 g | ✓ fiyat fill'de kilitlendi, eksik 5.020,104 g kasa girişi, rafineride kabul, mint, **tek seferde teslim** |
| S4 büyük satış | ✓ tavan aşıldı, fazla yakıldı, kasa çıkışı kabul edildi |
| S5 kasa talimatları | ✓ elle giriş ve çıkış, fişler kesildi |
| S6 cevapsız emir | ✓ zaman aşımı → durum sorgusu → iptal, kesin cevap |
| S7 fiziksel teslimat | ✓ emanet, lojistik teklifi, onay, Sevkiyat Fişi, takip no, teslim, burn |
| S8 rafinasyon | ✓ katalog, teklif, onay, üretim, teslim, burn; müşteri fiyatı marj ve komisyon dahil |
| S9 mahsuplaşma | ✓ kesim tetiklendi, Kanzasset mutabakatı kendiliğinden yaptı (**EŞİT**), rafineri altını kasaya koymayı teklif etti, Kanzasset onayladı, kasa girişi fişiyle kapandı, para bacağı şirket hesabından ödeme ile kapandı, pencere **SETTLED**, Mahsuplaşma Ekstresi kesildi |
| S9c tek bacak | ✓ yalnız USD kapsamıyla pencere açıldı: USD sıfırlandı, altın (25 g) ve diğer kurlar dokunulmadan kaldı, pencere **SETTLED** |
| S9b eşleşme uyuşmazlığı | ✓ kayıt bilerek kaydırıldı → RECONCILE ve bloke → açıklama ile çözüldü |

**Koşum sonu (son koşum):**

```
S 19.990,000 g · T 10,000 g · K 20.000,000 g · A 21.920,104 g · E 0,000 g
kasada 15.900,000 · kasaya konuluyor 6.020,104 · sevkiyatta 0,000

K1  ✓  A 21.920,104 ≤ V 21.920,104
K2  ✓  S 19.990,000 + T 10,000 = K 20.000,000
Eşleşme: EŞİT
```

Aynı koşumda **28 olay** Kanzasset'e gönderildi, **teslim edilemeyen yok**; **14 belge** üretildi (Tahsis Belgesi 3, Kasa Giriş Fişi 2, Kasa Çıkış Fişi 2, Lojistik Teklifi 1, Rafinasyon Teklifi 1, Sevkiyat Fişi 2, Teslimat Kaydı 2, Mahsuplaşma Ekstresi 1).

Ayrıca elle doğrulananlar: belge PDF indirme (`HTTP 200`, `application/pdf`, geçerli `xref`), rol kapısı (Denetçi ve Kasa mahsuplaşma talep edemiyor), ikinci onay (aynı kullanıcı onaylayamıyor, farklı kullanıcı onaylayınca değer uygulanıyor), katalog değişikliğinin olayla Kanzasset'e ulaşması.

Bütün ekranların görüntüleri senaryolar koşturulduktan sonra gerçek veriyle alındı: `docs/ekranlar` (R1'den R11'e, K1'den K12'ye).

---

## 4. Bilinen eksikler

Bunlar bilinerek bırakılmıştır; hiçbiri demoyu engellemez.

| Eksik | Durum | Not |
|---|---|---|
| **Docker imajları bu ortamda derlenemedi** | `Dockerfile`, `Dockerfile.merkez` ve `docker-compose.yml` yazıldı, yolları ve betikleri gerçek dosyalara karşı doğrulandı; ancak geliştirme ortamında Docker çalışmadığı için **imaj derlemesi denenmedi**. İlk kurulumda `docker compose up --build` çıktısı izlenmelidir. | Sunum için gerekli değil: üç komutluk npm yolu (DEMO.md) koşuldu ve çalışıyor. |
| Belge imzası | HMAC-SHA256 kullanıldı; doküman Ed25519 diyor. | Anahtar yönetimi rafineri kurulumuna bağlı; imza alanı ve doğrulama akışı hazır, algoritma değişimi tek dosyada (`ledger.ts`). |
| Banka ve BitGo bacakları | Simüle edilir (zaman çizelgesinde metin). Rafineri bacağı gerçektir. | Mint, burn ve ödeme adımları referans numarası üretir; gerçek entegrasyon Kanzasset tarafında yapılacak. |
| Gerçek merkez arayüzü | Mock merkez kullanılıyor. | Rafinerinin gerçek arayüzü gelince yalnız `source.ts` adaptörü değişir; defter, API ve ekranlar değişmez. |
| Veritabanı | SQLite (`node:sqlite`). Doküman üretimde Postgres diyor. | Şema tek dosyada ve hareket tablolarına dayanıyor; taşıma düz. |
| Oturum açma | Yok; kullanıcı üst şeritten seçilir ve `X-User` başlığıyla gider. | Yetki kontrolü sunucu tarafında ve gerçek kurallarla çalışıyor; yalnız kimlik doğrulama katmanı eksik. |
| K9'daki ikinci onay | Kanzasset parametre ekranında ikinci onay **ekran düzeyinde**; rafineri tarafındaki (R10) ikinci onay sunucuda zorlanıyor. | Kanzasset tarafı mevcut backoffice'e eklenirken oradaki onay altyapısına bağlanacak. |
| Arayüz testleri | Ekran bileşenleri için birim testi yok. | Ekranlar uçtan uca koşum ve görüntülerle doğrulandı. |
| Sürekli bütünleştirme (CI) | Repolarda iş akışı dosyası yok. | `npm test`, `tsc --noEmit` ve `npm run build` her iki repoda da tek komutla koşuyor; CI eklemek düz. |
| Mutabakatta özet karşılaştırma | Kanzasset kendi ekstresinin özetini değil, toplamlarını gönderip rafinerinin özetini onaylıyor (farklıysa kendi toplamlarıyla MISMATCH açıyor). | Doküman "iki ekstre karşılaştırılır" diyor; toplamlar birebir karşılaştırılıyor, satır satır ekstre karşılaştırması ileride eklenebilir. |

---

## 5. Nasıl koşulur

```bash
# testler
cd amr-app && npm test
cd kz-treasury && npm test

# tip denetimi ve derleme
npm run build                        # sözleşme + ekranlar
npx tsc -p apps/amr-server/tsconfig.json --noEmit

# uçtan uca (iki sunucu ayaktayken)
cd kz-treasury && npm run demo
```

Senaryolar başarıyla biterse çıkış kodu 0'dır ve son satırda "Tüm kontroller tutuyor, iki defter eşit." yazar.
