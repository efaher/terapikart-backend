# Persona Card V1.2 Staging Dağıtımı

Bu ortam yalnızca V1.2 pilot testi içindir. Canlı satış ortamı değildir.

## Mimari

- Frontend: Netlify Deploy Preview (`persona_card` PR #3)
- Backend: Render Web Service (`persona-card-v12-staging-efaher`)
- Veritabanı: Render Postgres (`persona-card-v12-staging-db`)
- Bölge: Frankfurt

`render.yaml` aşağıdakileri otomatik oluşturur:

- V1.2 backend servisi
- PostgreSQL veritabanı
- `DATABASE_URL` bağlantısı
- rastgele `AUTH_SECRET`
- rastgele `ADMIN_LICENSE_SECRET`
- `/health` sağlık kontrolü

Secret değerleri GitHub'a yazılmaz.

## Kurulum

Render hesabında aşağıdaki Deploy to Render bağlantısı açılır ve Blueprint onaylanır:

https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fefaher%2Fterapikart-backend%2Ftree%2Fv1.2-annual-license-pwa

Blueprint başarılı olduğunda beklenen backend adresi:

https://persona-card-v12-staging-efaher.onrender.com

Sağlık kontrolü:

https://persona-card-v12-staging-efaher.onrender.com/health

Beklenen temel sonuç:

```json
{"ok":true,"persistentAccounts":true}
```

`persistentAccounts: true` görülmeden danışman hesabı pilotu yapılmaz.

## Frontend bağlantısı

Netlify PR #3 Deploy Preview, `netlify.toml` üzerinden staging backend'e yönlendirilir:

https://deploy-preview-3--personitacard.netlify.app

Canlı `https://personitacard.netlify.app` adresi ise mevcut production backend'i kullanmaya devam eder.

## Önemli: ücretsiz Postgres yalnız staging içindir

Render Free Postgres süreli bir test kaynağıdır ve yedekleme sağlamaz. Ticari yayına geçerken veritabanı ücretli/persistan plana yükseltilmeli ve yedekleme politikası doğrulanmalıdır.

## Pilot kabul sırası

1. `/health` -> `persistentAccounts: true`
2. Yeni danışman hesabı oluştur
3. Çıkış yap ve tekrar giriş yap; hesabın kalıcı olduğunu doğrula
4. Boş oda aç/kapat -> hak düşmemeli
5. Danışan linkten katılsın -> hak 3'ten 2'ye düşmeli
6. İki ayrı cihazda realtime kart seçimini doğrula
7. Üç gerçek katılımdan sonra dördüncü oturumun engellendiğini doğrula
8. Yıllık lisansı yönetim endpointi ile etkinleştir
9. Yeni oturumun tekrar açıldığını doğrula
10. PWA kurulumunu ve cihaz kart modunu doğrula

Bu adımlar tamamlanmadan V1.2 `main` dalına alınmaz.
