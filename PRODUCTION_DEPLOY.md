# Persona Card V1.2 — Production Geçiş Planı

Bu belge staging pilotu tamamlandıktan sonra V1.2'nin ticari production ortamına güvenli geçiş sırasını tanımlar.

## Temel kural

Staging kaynakları production olarak kullanılmaz. Production için ayrı web servisi ve ayrı ücretli PostgreSQL oluşturulur. `render.production.example.yaml` yalnız şablondur; maliyet onayı olmadan çalıştırılmaz.

## 1. Production backend'i main'e merge etmeden önce ayağa kaldır

1. `render.production.example.yaml` esas alınarak ayrı production web servisi ve PostgreSQL oluştur.
2. İlk doğrulama aşamasında servis branch'i `v1.2-annual-license-pwa` olarak kalabilir.
3. Render tarafından `AUTH_SECRET` ve `ADMIN_LICENSE_SECRET` üretilsin; değerler GitHub'a veya frontend'e yazılmasın.
4. `DATABASE_URL` yalnız Render environment üzerinden production PostgreSQL'e bağlansın.
5. `ALLOWED_ORIGINS` yalnız gerçek frontend adreslerini içersin.
6. Production transactional mail için `MAIL_PROVIDER=resend` kullanılsın; `RESEND_API_KEY` yalnız Render secret olarak tanımlansın.
7. `MAIL_FROM` doğrulanmış `efia.net.tr` alan adındaki gönderen adresi kullansın; `FRONTEND_URL` gerçek production frontend adresi olsun.
8. `REQUIRE_EMAIL_VERIFICATION=true` production ortamında açık olsun.
9. `/health` yanıtında `persistentAccounts: true`, `mailConfigured: true` ve `emailVerificationRequired: true` görülmeden ilerleme.

Not: `efia.net.tr` Resend gönderim alan adı staging pilotunda doğrulandı. API anahtarları ortam bazında secret tutulur; GitHub'a yazılmaz.

## 2. Production backend smoke test

- yeni test danışman hesabı oluştur
- doğrulama yapılmadan çevrimiçi çalışma başlatmanın engellendiğini doğrula
- doğrulama e-postasının ulaştığını ve bağlantı sonrası hesabın doğrulandığını doğrula
- giriş yap
- şifre sıfırlama e-postasını iste; yeni şifreyi kaydet ve eski şifrenin reddedildiğini doğrula
- oda oluştur ve ikinci cihazdan katıl
- realtime kart seçimini doğrula
- sunucuyu restart et
- hesabın/lisansın restart sonrası korunduğunu doğrula
- WebSocket bağlantısının HTTPS production adresinden çalıştığını doğrula

## 3. Yedek ve geri yükleme kanıtı

Production veritabanında aşağıdaki işlemler doğrulanmadan ticari kullanıcı alınmaz:

1. Render Recovery ekranından production veritabanı için yedek/recovery özelliğinin aktif olduğunu doğrula.
2. İlk production veri setinden mantıksal export oluştur.
3. Export'u güvenli bir yerde sakla.
4. Ayrı/geçici bir PostgreSQL instance üzerinde geri yükleme denemesi yap.
5. `advisors` ve `license_events` tablolarının geri geldiğini kontrol et.
6. Sonucu `PRODUCTION_CHECKLIST.md` içinde tarih ve notla işaretle.

Önerilen işletim politikası: büyük deploy/migration öncesi manuel export; ayrıca düzenli geri yükleme tatbikatı.

## 4. Backend PR #3 merge

Production backend V1.2 branch'inde doğrulandıktan sonra:

1. GitHub Actions başarılı olmalı.
2. Backend PR #3 `main`e merge edilir.
3. Render production servisinin branch'i `main` olarak değiştirilir.
4. Yeniden deploy sonrası `/health`, e-posta doğrulama, şifre sıfırlama ve giriş/oda smoke testi tekrarlanır.

## 5. Frontend production bağlantısı

Frontend PR #3, production backend hazır olmadan production'a deploy edilmez.

Netlify Production environment içinde şu değişken açıkça tanımlanmalıdır:

`PERSONA_CARD_BACKEND_URL=https://<production-backend-adresi>`

V1.2 build guard, Production context'inde bu değişken yoksa veya eski `https://terapikart.onrender.com` adresine ayarlıysa build'i bilerek durdurur.

Production backend tarafındaki `FRONTEND_URL` aynı production frontend adresini göstermelidir; şifre sıfırlama ve e-posta doğrulama bağlantıları bu adres üzerinden oluşturulur.

## 6. Frontend PR #3 merge

1. Production backend adresi Netlify Production environment'a girilir.
2. Frontend GitHub Actions başarılı olmalı.
3. Frontend PR #3 `main`e merge edilir.
4. Netlify production deploy tamamlanır.
5. Masaüstü + Android PWA smoke testi yapılır.
6. Doğrulanmamış test hesabının kart çalışması başlatamadığı doğrulanır.
7. E-posta doğrulamasından sonra danışan bağlantısı ikinci cihazda açılır ve realtime seçim doğrulanır.
8. Şifre sıfırlama bağlantısının production frontend'e döndüğü doğrulanır.

## 7. Go-live sonrası

- İlk gerçek kullanıcıdan önce kart görsellerinin dijital/ticari kullanım hakları belgelenmiş olmalı.
- Kullanıcı sözleşmesi, gizlilik/KVKK ve yıllık hizmet kapsamı yayımlanmış olmalı.
- Ödeme entegrasyonu tamamlanana kadar manuel lisans endpointi yalnız yönetici secret'ı ile kullanılmalı.
- `ADMIN_LICENSE_SECRET`, `AUTH_SECRET`, `RESEND_API_KEY` ve veritabanı kimlik bilgileri kullanıcıya, müşteriye veya frontend'e verilmemeli.
- Production backup/restore süreci periyodik olarak test edilmeli.
