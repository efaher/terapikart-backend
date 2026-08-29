# Persona Card Realtime Backend

Bu servis Persona Card'ın danışman hesaplarını, yıllık profesyonel lisans durumunu ve danışman-danışan kart çalışma oturumlarını yönetir.

## V1.2 ticari model

- Yeni danışman hesabı: 3 ücretsiz çevrimiçi çalışma.
- Ticari plan: `annual` yıllık profesyonel lisans.
- Aktif yıllık lisans boyunca çevrimiçi oturum oluşturma sınırı yoktur.
- Yenileme, mevcut lisans süresi bitmemişse mevcut bitiş tarihinin üzerine 1 yıl ekler.
- Danışan hesap açmaz; yalnızca geçici güvenli oturum bağlantısından katılır.

## Güvenlik omurgası

- Danışman parolaları `scrypt` ile hashlenir.
- Auth tokenları imzalı ve süreli olarak üretilir.
- `ADMIN_LICENSE_SECRET` yalnız backend ortamında tutulur.
- Login/register/admin lisans endpointleri uygulama-seviyesi rate limit ile korunur.
- Render üzerinde rate-limit istemci anahtarı için `CF-Connecting-IP` önceliklidir.
- Limit aşımında `429 RATE_LIMITED` ve `Retry-After` döner.
- Danışan/oda yetkileri Socket.IO tarafında rol bazlı uygulanır.
- PostgreSQL varsa hesap ve lisans verileri kalıcıdır.
- Yıllık lisans değişiklikleri `license_events` audit tablosuna aynı transaction içinde yazılır.

Varsayılan rate-limit değerleri:

- auth IP: 15 dakika / 60 istek
- login IP+e-posta: 15 dakika / 10 istek
- register IP: 15 dakika / 8 istek
- admin lisans IP: 15 dakika / 10 istek

Bu değerler `.env.example` içindeki environment variable'larla değiştirilebilir.

## Deneme hakkı kuralı

Ücretsiz kullanım oda oluşturulduğunda değil, danışan ilgili odaya ilk kez gerçekten katıldığında tüketilir. Danışan katılmadan açılıp kapatılan odalar deneme hakkı düşürmez.

## Oda yaşam döngüsü

Varsayılanlar:

- oda azami ömrü: 6 saat
- iki taraf da ayrıldıktan sonra boş oda temizleme: 30 dakika
- temizlik kontrolü: 15 dakika
- bir danışmanın aynı anda yalnız bir aktif odası bulunur

Yeni bir oda açılırsa aynı danışmana ait önceki oda `replaced` nedeni ile kapatılır.

## Yerel çalıştırma

```bash
npm install
npm test
npm start
```

Kalıcı hesaplar için `DATABASE_URL` gerekir. Ortam değişkenleri `.env.example` içinde listelenmiştir.

## Sağlık kontrolü

```text
GET /health
```

PostgreSQL bağlı üretim/staging ortamında beklenen alan:

```json
{
  "ok": true,
  "persistentAccounts": true
}
```

## Manuel yıllık lisans

Ödeme entegrasyonu tamamlanana kadar yıllık lisans yalnız yönetici secret'ı ile verilebilir:

```bash
export PERSONA_API_URL="https://API-ADRESI"
export ADMIN_LICENSE_SECRET="HOSTINGDE_TUTULAN_SECRET"
npm run license:grant -- danisman@example.com
```

Secret GitHub'a, frontend'e veya kullanıcıya verilmez.

## Staging / production

- `render.yaml`: ücretsiz staging Blueprint.
- `render.production.example.yaml`: ücretli production şablonu; otomatik kullanılmaz.
- `STAGING_DEPLOY.md`: staging kurulumu.
- `PRODUCTION_CHECKLIST.md`: pilot ve production kabul kontrolleri.
- `PRODUCTION_DEPLOY.md`: güvenli production cutover sırası.

Ücretsiz Render PostgreSQL ticari production için kullanılmaz.
