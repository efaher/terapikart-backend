# Persona Card Realtime Backend

Bu servis Persona Card'ın danışman hesaplarını, yıllık profesyonel lisans durumunu ve danışman-danışan kart çalışma oturumlarını yönetir.

## V1.2 ticari model

- Yeni danışman hesabı: 3 ücretsiz çevrimiçi çalışma.
- Ticari plan: `annual` yıllık profesyonel lisans.
- Aktif yıllık lisans boyunca çevrimiçi oturum oluşturma sınırı yoktur.
- Yenileme, mevcut lisans süresi bitmemişse bitiş tarihinin üzerine bir yıl ekler.
- Aylık, lifetime veya founder planları V1.2 ticari modelinin parçası değildir.

## Rol modeli

- **Danışman:** hesapla giriş yapar, oturum oluşturur, danışan bağlantısını paylaşır, seçimleri sıfırlar ve oturumu kapatır.
- **Danışan:** hesap açmadan güvenli bağlantıyla katılır, kart seçer ve seçimini kaldırır.

## Lisans etkinleştirme

Ödeme entegrasyonu bağlanana kadar yıllık lisans yalnızca sunucu tarafındaki yönetim anahtarıyla etkinleştirilebilir:

`POST /api/admin/licenses/annual`

İstek `Authorization: Bearer <ADMIN_LICENSE_SECRET>` başlığını ve danışman `email` alanını içerir. Bu endpoint son kullanıcı arayüzüne açılmaz. İleride ödeme sağlayıcısının başarılı ödeme webhook'u aynı lisans fonksiyonunu çağıracaktır.

## Veri yaklaşımı

- Danışman hesapları ve lisans süreleri PostgreSQL üzerinde kalıcı tutulur.
- Aktif kart çalışma odaları geçici bellekte tutulur; sunucu yeniden başladığında aktif odalar sonlanır.
- Danışana ait hesap, terapi notu, tanı veya psikolojik profil verisi tutulmaz.
- Kartlara herhangi bir psikolojik anlam veya otomatik yorum backend tarafından atanmaz.

## Ortam değişkenleri

- `PORT`
- `ALLOWED_ORIGINS`
- `DATABASE_URL`
- `DATABASE_SSL`
- `AUTH_SECRET`
- `ADMIN_LICENSE_SECRET`

Üretimde `DATABASE_URL`, `AUTH_SECRET` ve `ADMIN_LICENSE_SECRET` mutlaka kalıcı ve güvenli değerlerle tanımlanmalıdır.

## Health endpoint

`GET /health`

Servisin çalışmasını, aktif oda sayısını ve kalıcı hesap veritabanının bağlı olup olmadığını döndürür.
