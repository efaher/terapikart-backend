# Ticari Sürüm İçin Backend Notları

V1 backend bilinçli olarak hafif tutulmuştur. Ticari yayına geçmeden önce aşağıdaki teknik katmanlar ayrıca tamamlanacaktır:

- kalıcı veritabanı
- danışman kimlik doğrulama
- lisans/ödeme durumunun sunucu tarafında doğrulanması
- rate limiting ve kötüye kullanım koruması
- güvenli loglama ve izleme
- token süre sonu ve oturum zaman aşımı
- gizli anahtarların ortam değişkenlerinde yönetimi
- otomatik testler ve CI
- üretim CORS yapılandırması
- KVKK veri minimizasyonu ve saklama politikası

V1'de danışana ait terapi notu, tanı, serbest metin veya psikolojik yorum saklanmaz.
