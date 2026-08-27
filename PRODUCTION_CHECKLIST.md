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
- [ ] Sunucu yeniden başlatıldıktan sonra danışman hesabı ve lisans bilgisi korunuyor.
- [ ] Veritabanı için düzenli yedek/geri yükleme yöntemi doğrulandı.

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
10. [ ] Yıllık lisansı etkinleştir ve online kullanımın tekrar açıldığını doğrula. *(Staging hesabında lisans etkinleştirme API çağrısı başarılı; `plan=annual` doğrulandı. Arayüzde kullanımın tekrar açılması bekleniyor.)*
11. [ ] Lisans yenilemesinin mevcut bitiş tarihinin üzerine bir yıl eklediğini doğrula.
12. [ ] Lisans hareketinin `license_events` kaydında oluştuğunu doğrula.
13. [ ] Danışmanın uygulamayı PWA olarak kurabildiğini doğrula.
14. [ ] 121 kartı cihazda hazırla ve internet kesikken cihaz modunun açıldığını doğrula.

## Pilot dönemde manuel lisans verme

Ödeme entegrasyonu tamamlanana kadar yıllık lisans backend yönetim endpointi üzerinden verilebilir.

Yerel yönetim ortamında:

```bash
export PERSONA_API_URL="https://API-ADRESI"
export ADMIN_LICENSE_SECRET="HOSTINGDE-TUTULAN-SECRET"
npm run license:grant -- danisman@example.com
```

`ADMIN_LICENSE_SECRET` hiçbir zaman GitHub'a, frontend koduna, ekran görüntüsüne veya müşteriye gönderilmez.

## Oturum yaşam döngüsü

Varsayılanlar:

- oda azami ömrü: 6 saat
- iki tarafın da ayrıldığı boş oda temizleme süresi: 30 dakika
- temizlik kontrol aralığı: 15 dakika
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
