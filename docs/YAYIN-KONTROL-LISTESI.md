# Cargo Panic – Play Console kontrol listesi (alan alan)

Play Console'un arayüz adları zaman zaman değişebilir; her bölümün İngilizce
adı parantez içinde. Cevaplar bu sürüm (reklamsız, satın almasız, veri
toplamayan) için doğrudur. Ayrıntılı süreç: [`RELEASE.md`](RELEASE.md).

## 0. Hazırlık (bir kez)
- [ ] Yükleme anahtarını oluştur (RELEASE.md → "The upload key"), depoya koyma.
- [ ] GitHub → Settings → Secrets and variables → Actions → 4 gizli değeri gir:

  | Ad | Değer |
  | --- | --- |
  | `CARGO_PANIC_UPLOAD_KEYSTORE_BASE64` | `.jks` dosyasının base64'ü |
  | `CARGO_PANIC_KEYSTORE_PASSWORD` | Anahtar deposu şifresi |
  | `CARGO_PANIC_KEY_ALIAS` | `upload` |
  | `CARGO_PANIC_KEY_PASSWORD` | Anahtar şifresi (PKCS12'de depo şifresiyle aynı) |

- [ ] İlk sürüm (1.0.0, versionCode 73) hazır `.aab` olarak verildi. Sonraki sürümler: `package.json` sürümünü yükselt, main'e birleştir, sonra Actions → **Release bundle** → Run workflow (main) → çıkan `app-release.aab` dosyasını indir. Main'de yeni commit yoksa iş akışı yine 73 üretir ve Play bunu reddeder.
- [ ] `npm run store:pack` → `marketing/out/store/`: görsel zip'i, `translations.csv`, `release-notes.txt`.
- [ ] Videoyu YouTube'a yükle: Liste dışı (Unlisted) ya da Herkese açık, para kazanma kapalı, yerleştirmeye izin ver, yaş kısıtlaması yok. Bağlantıyı not al.

## 1. Uygulama oluştur (Create app)
| Alan | Yazılacak / seçilecek |
| --- | --- |
| Uygulama adı (App name) | `Cargo Panic: Warehouse Puzzle` |
| Varsayılan dil (Default language) | English (United States) – en-US |
| Uygulama mı oyun mu (App or game) | **Oyun (Game)** |
| Ücretsiz mi ücretli mi (Free or paid) | **Ücretsiz (Free)** |
| Beyanlar (Declarations) | Geliştirici Program Politikaları ✔, ABD ihracat yasaları ✔ |

## 2. Mağaza ayarları (Store settings)
| Alan | Değer |
| --- | --- |
| Kategori (Category) | Oyun → **Bulmaca (Puzzle)** |
| Etiketler (Tags) | Bulmaca (Puzzle) ve en çok 5 uygun etiket; örn. "Mantık/Logic", "Tek oyunculu/Single player", "Çevrimdışı/Offline" (listede ne varsa) |
| E-posta (Contact email) | Oyuncuların yazacağı e-posta adresin – bu adres mağaza sayfasında görünür, gizlilik politikası da buraya yönlendirir |
| Web sitesi (Website) | İsteğe bağlı: `https://keremcan534.github.io/cargo-panic/` |
| Telefon | Boş bırakılabilir |

## 3. Ana mağaza girişi (Main store listing) – her dil için
- [ ] **Uygulama adı / Kısa açıklama / Tam açıklama**: `fastlane/metadata/android/<dil>/title.txt`, `short_description.txt`, `full_description.txt` (ya da `translations.csv`). "Çeviri ekle / Translations → Add your own translation text" ile 9 dili ekle: tr-TR, de-DE, es-ES, fr-FR, it-IT, pl-PL, pt-BR, ru-RU, id.
- [ ] **Uygulama simgesi (App icon)**: `en-US/images/icon.png` (512×512 PNG).
- [ ] **Öne çıkan grafik (Feature graphic)**: `en-US/images/featureGraphic.jpg` (1024×500).
- [ ] **Telefon ekran görüntüleri (Phone screenshots)**: her dilin `images/phoneScreenshots/` klasöründeki 6 dosya, sırasıyla 1–6.
- [ ] **Video**: YouTube bağlantısı (oynatma listesi değil, tek video).
- [ ] Tablet görüntüleri zorunlu değil; boş bırakılabilir.

## 4. Uygulama içeriği (App content / Policy → App content)
| Bölüm | Cevap |
| --- | --- |
| Gizlilik politikası (Privacy policy) | `https://keremcan534.github.io/cargo-panic/privacy.html` |
| Uygulama erişimi (App access) | **Tüm işlevler özel erişim gerektirmeden kullanılabilir** (All functionality is available without special access) |
| Reklamlar (Ads) | **Hayır, uygulamam reklam içermiyor** (No, my app does not contain ads) |
| İçerik derecelendirmesi (Content rating) | Anketi başlat → e-posta → kategori **Oyun (Game)**. Şiddet: Hayır · Cinsellik/çıplaklık: Hayır · Küfür/kaba dil: Hayır · Uyuşturucu/alkol/tütün: Hayır · Kumar/simüle kumar: Hayır · Kullanıcılar arası etkileşim/içerik paylaşımı: Hayır · Konum paylaşımı: Hayır · Dijital satın alma: Hayır · Sınırsız internet erişimi: Hayır. Beklenen sonuç: herkes için (PEGI 3 / ESRB Everyone) – kesin derece IARC'nindir. |
| Hedef kitle ve içerik (Target audience) | Önerim: **13–15, 16–17, 18+**. 13 yaş altını seçersen Aileler politikası (Families) şartları devreye girer; bu sürüm (reklamsız, veri toplamayan) onlara da uyar ama ek inceleme olur – karar senin. "Çocukların ilgisini çekebilir mi?" sorusuna dürüst cevap ver (renkli bulmaca → "Evet" denebilir; o zaman ekstra açıklama ister). |
| Veri güvenliği (Data safety) | "Uygulamanız kullanıcı verisi topluyor ya da paylaşıyor mu?" → **Hayır**. (İlerleme yalnızca cihazda kalır; cihazdan çıkmayan veri "toplama" sayılmaz.) Gizlilik politikası bağlantısı yine gerekir. |
| Reklam kimliği (Advertising ID) | "Uygulamanız reklam kimliği kullanıyor mu?" → **Hayır** |
| Devlet uygulaması (Government apps) | Hayır |
| Finansal özellikler (Financial features) | Uygulamam bunların hiçbirini sunmuyor |
| Sağlık (Health) | Uygulamam sağlık özelliği içermiyor |
| Haber uygulaması (News apps) | Hayır |

## 5. Uygulama imzalama (App signing)
- [ ] **Play Uygulama İmzalama (Play App Signing)**: Google'ın oluşturduğu anahtarı kabul et (önerilen). Yüklediğin `.aab` senin yükleme anahtarınla imzalı olacak.

## 6. Test ve yayın sırası
1. [ ] **Dahili test (Internal testing)** → Yeni sürüm oluştur → `.aab` yükle → Sürüm notları: `release-notes.txt` içeriğini olduğu gibi yapıştır → Test kullanıcısı olarak kendini ekle → Play Store'dan kur ve dene.
2. [ ] **Kapalı test (Closed testing)** → Bir test kanalı (ör. "alpha") → aynı sürümü yükselt (Promote release) → **en az 12 test kullanıcısı** (Google Grubu ya da e-posta listesi) → katılım bağlantısını gönder → herkes kabul etsin ve **14 gün aralıksız** kalsın (çıkıp yeniden giren için 14 gün baştan başlar).
3. [ ] 14 gün sonra **Kontrol paneli (Dashboard) → Üretime erişim başvurusu (Apply for production)** → testle ilgili soruları cevapla.
4. [ ] Onay gelince **Üretim (Production)** → sürüm oluştur → aşamalı dağıtım (ör. %20) → incelemeye gönder.

## 7. Yayından önce son kontrol
- [ ] Gerçek bir telefonda: dikey kilit, tam ekran, ekran kararmıyor, geri tuşu duraklatıyor, arka plana alıp dönünce oyun duraklatılmış bekliyor, 2D ve 3D, akıcılık.
- [ ] Makine çevirilerini (de, es, fr, it, pl, pt-BR, ru, id – oyun içi ve mağaza metinleri) anadili konuşan birine okut.
- [ ] Gizlilik politikası sayfası açılıyor.
