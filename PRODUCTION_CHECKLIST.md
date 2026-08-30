# Persona Card V1.2 — Üretim ve Pilot Kontrol Listesi

Bu belge V1.2 yıllık profesyonel lisans sürümünün ticari pilot öncesi asgari teknik koşullarını tanımlar.

## Main'e birleştirmeden önce zorunlu

- [x] Kalıcı PostgreSQL veritabanı oluşturuldu. *(Staging doğrulandı.)*
- [x] `DATABASE_URL` yalnız hosting ortamında secret olarak tanımlandı. *(Render Blueprint ile bağlı.)*
- [x] Uzun ve rastgele `AUTH_SECRET` yalnız hosting ortamında tanımlandı. *(Render tarafından üretildi.)*
- [x] Ayrı ve uzun `ADMIN_LICENSE_SECRET` yalnız hosting ortamında tanımlandı. *(Render tarafından üretildi.)*
- [ ] `ALLOWED_ORIGINS` üretim frontend adreslerini içeriyor.
- [ ] HTTPS ve WebSocket bağlantısı gerçek üretim adresinden doğrulandı.
- [x] `/health` yanıtında `persistentAccounts: true` görülüyor. *(Staging: 2026-08-27.)*
- [x] Sunucu yeniden başlatıldıktan sonra danışman hesabı ve lisans bilgisi korunuyor. *(Render staging servisi yeniden başlatıldı; ardından hesap açıldı ve yıllık lisans bilgisi korunmuş olarak görüldü: 2026-08-29.)*
- [ ] Veritabanı için düzenli yedek/geri yükleme yöntemi doğrulandı.
- [x] Login/register/admin lisans endpointlerine uygulama-seviyesi rate limit eklendi ve otomatik test edildi. *(2026-08-29.)*
- [x] Rate-limit istemci IP kaynağı Render/Cloudflare için `CF-Connecting-IP` öncelikli olacak şekilde sertleştirildi. *(2026-08-29.)*
- [x] Rate-limit gerçek Render staging login endpointinde smoke test edildi. *(Sahte e-posta ile ilk 10 hatalı giriş 401, 11. istek 429 Too Many Requests: 2026-08-29.)*
- [x] Yeni fragment tabanlı danışan davet linki staging'de iki cihazla smoke test edildi. *(Token adres çubuğundan temizlendi; danışanın kart seçimi danışman ekranına realtime ulaştı: 2026-08-29.)*
- [x] Offline cihaz modu lisans yetkisi Ed25519 imzalı entitlement ile sertleştirildi ve gerçek cihazda internet tamamen kapalıyken doğrulandı. *(Yetki 29.09.2026 tarihine kadar geçerli; offline kart seçimi çalıştı: 2026-08-29.)*
- [x] Staging transactional e-posta sağlayıcısı Resend HTTPS API olarak yapılandırıldı; `efia.net.tr` alan adı doğrulandı ve `/health` yanıtında `mailConfigured: true` görüldü. *(2026-08-30.)*
- [x] Şifre sıfırlama gerçek e-posta smoke testi tamamlandı. *(Resend üzerinden bağlantı ulaştı; yeni şifre kaydedildi; eski şifre reddedildi ve yeni şifreyle giriş başarılı oldu: 2026-08-30.)*
- [x] E-posta doğrulama zorunluluğu staging'de etkinleştirildi ve `/health` yanıtında `emailVerificationRequired: true` görüldü. *(2026-08-30.)*
- [x] Doğrulanmamış danışmanın çevrimiçi çalışma başlatması engellendi; doğrulama bölümüne yönlendirme görüldü. Doğrulama e-postası sonrası aynı hesap çevrimiçi çalışma başlattı, danışan bağlantısından kart seçimi yapıldı ve oturum kapatıldı. *(2026-08-30.)*

## Pilot kabul senaryosu

1. [x] Yeni danışman hesabı oluştur. *(Gerçek staging testi: 2026-08-27.)*
2. [x] Hesabın 3 ücretsiz çalışma ile başladığını doğrula.
3. [x] Danışan katılmadan oda açıp kapat; ücretsiz hakkın düşmediğini doğrula. *(İkinci gerçek pilot turunda doğrulandı.)*
4. [x] Danışana link gönder ve ikinci cihazdan katıl.
5. [x] Danışan katıldığında ücretsiz hakkın yalnız bir kez düştüğünü doğrula. *(3 → 2 → 1 → 0 gözlendi.)*
6. [x] Kart seçiminin danışman ekranına gerçek zamanlı düştüğünü doğrula.
7. [x] Danışanın seçimi kaldırabildiğini doğrula. *(İkinci gerçek pilot turunda doğrulandı.)*
8. [x] Danışmanın kart seçemediğini; danışanın oturumu sıfırlayıp kapatamadığını doğrula. *(Danışman oturumu başarıyla kapattı.)*
9. [x] Üç gerçek danışan katılımından sonra yeni online çalışma oluşturmanın engellendiğini doğrula. *(Sayaç 0; çevrimiçi oturum butonu pasif ve yıllık lisans mesajı görüldü.)*
10. [x] Yıllık lisansı etkinleştir ve online kullanımın tekrar açıldığını doğrula. *(Staging hesabında `plan=annual`; lisans 27.08.2027 tarihine kadar aktif göründü ve Android PWA üzerinden yeni çevrimiçi oda başarıyla oluşturuldu.)*
11. [x] Lisans yenilemesinin mevcut bitiş tarihinin üzerine bir yıl eklediğini doğrula. *(Yıllık lisans ikinci kez verildi; bitiş tarihi 27.08.2027 → 27.08.2028 olarak uzadı: 2026-08-29.)*
12. [x] Lisans hareketinin `license_events` kaydında oluştuğunu doğrula. *(PostgreSQL yolunda lisans güncellemesi ve `license_events` insert aynı transaction içinde; event insert başarısız olursa işlem rollback oluyor. Staging yenilemesi başarıyla commit edilip 27.08.2028 olarak kalıcılaştığı için audit kaydı transactional olarak doğrulandı: 2026-08-29.)*
13. [x] Danışmanın uygulamayı PWA olarak kurabildiğini doğrula. *(Android ana ekrana Persona Card olarak başarıyla kuruldu: 2026-08-27.)*
14. [x] 121 kartı cihazda hazırla ve internet kesikken cihaz modunun açıldığını doğrula. *(121 kart önbelleğe alındı; internet kapalıyken uygulama, kart galerisi ve yerel kart seçimi çalıştı.)*
15. [x] Gerçek şifre sıfırlama e-postasının ulaşmasını ve yeni şifrenin kullanılabildiğini doğrula. *(2026-08-30.)*
16. [x] E-posta doğrulaması zorunluyken doğrulanmamış hesabın çalışma başlatamadığını doğrula. *(2026-08-30.)*
17. [x] Doğrulama bağlantısından sonra aynı hesabın çalışma başlatabildiğini ve danışanla gerçek zamanlı kart seçimi yapılabildiğini doğrula. *(2026-08-30.)*

## Üretime geçişte kalan teknik engeller

Aşağıdaki maddeler staging kabulünden bağımsız olarak gerçek üretim geçişinden önce tamamlanmalıdır:

1. [ ] Staging'den ayrı, kalıcı üretim PostgreSQL veritabanını oluştur ve üretim `DATABASE_URL` secret'ını bağla.
2. [ ] Üretim veritabanında düzenli yedekleme yöntemini belirle ve gerçek geri yükleme provası yap.
3. [ ] Ayrı üretim backend servisini HTTPS/WSS üzerinde yayına al.
4. [ ] Üretim `ALLOWED_ORIGINS` değerini yalnız gerçek frontend origin(ler)i ile sınırla.
5. [ ] Üretim frontend'inde backend adresini gerçek üretim API adresine sabitle ve legacy backend kullanımını reddeden guard'ı doğrula.
6. [ ] Üretim cutover smoke testi yap: kayıt/giriş, e-posta doğrulama, şifre sıfırlama, oda oluşturma, güvenli danışan linki, realtime seçim, oturum kapatma ve lisans kontrolü.
7. [ ] Üretim PostgreSQL ve backend için ücretli kaynak açılması gerekiyorsa maliyet onayı alınmadan kaynak oluşturma.

Bu bölüm tamamlanmadan V1.2 branch'i production cutover için main'e birleştirilmez.

## Pilot dönemde manuel lisans verme

Ödeme entegrasyonu tamamlanana kadar yıllık lisans backend yönetim endpointi üzerinden verilebilir.

Yerel yönetim ortamında:

```bash
export PERSONA_API_URL="https://API-ADRESI"
export ADMIN_LICENSE_SECRET="HOSTINGDE_TUTULAN_SECRET"
npm run license:grant -- danisman@example.com
```

`ADMIN_LICENSE_SECRET` hiçbir zaman GitHub'a, frontend koduna, ekran görüntüsüne veya müşteriye gönderilmez.

## Oturum yaşam döngüsü

Varsayılanlar:

- oda azami ömrü: 6 saat
- iki tarafın da ayrıldığı boş oda temizleme süresi: 30 dakika
- temizlik kontrol aralığı: 15m
- bir danışmanın aynı anda yalnız bir aktif odası bulunur
- yeni oda açılırsa önceki oda `replaced` nedeni ile kapatılır
- deneme hakkı oda oluştururken değil, danışan ilk kez gerçekten katıldığında tüketilir

## Ticari üretimde kullanılmaması gereken durumlar

- yeniden başlatıldığında verileri silinen bellek tabanlı hesap modu
- kısa süre sonra otomatik silinen/sona eren ücretsiz deneme veritabanları
- GitHub repository içine yazılmış secret veya veritabanı parolası
- yedek/geri yükleme yöntemi olmayan veritabanı
- HTTPS'siz API veya WebSocket

## Ticari lansman öncesi kod dışı zorunluluklar

- Kart görsellerinin dijital ve ticari kullanım haklarının belgelenmesi
- Kullanıcı sözleşmesi ve yıllık hizmet/bakım kapsamının kesinleştirilmesi
- Gizlilik/KVKK metinlerinin hazırlanması
- Mesafeli satış ve ödeme akışının güncel mevzuata göre kurulması
- Destek ve hizmet sonlandırma/ön bildirim politikasının yazılı hale getirilmesi

Bu maddeler tamamlanmadan V1.2 ticari ürün olarak ilan edilmez.
