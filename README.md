# Persona Card Realtime Backend

Bu servis Persona Card V1 için danışman-danışan kart çalışma oturumlarını gerçek zamanlı yönetir.

## V1 rol modeli

- **Danışman:** oturum oluşturur, danışan bağlantısını paylaşır, seçimleri sıfırlar ve oturumu kapatır.
- **Danışan:** güvenli bağlantı ile oturuma katılır, kart seçer ve kendi seçimlerini kaldırır.

Danışman kart seçemez; danışan oturumu sıfırlayamaz veya kapatamaz.

## Güvenli oturum bağlantısı

Her oturum için ayrı danışman ve danışan tokenı üretilir. Oda kodu tek başına katılım için yeterli değildir.

## Veri yaklaşımı

V1'de oda ve kart seçimi bilgileri yalnızca sunucu belleğinde tutulur. Sunucu yeniden başlatıldığında oturumlar silinir. Bu bilinçli bir V1 tercihidir; kalıcı kullanıcı/lisans verileri ilerleyen ticari aşamada veritabanına taşınacaktır.

Kartların herhangi bir psikolojik anlamı veya yorum verisi backend üzerinde tutulmaz.

## Ortam değişkenleri

- `PORT`: servis portu
- `ALLOWED_ORIGINS`: virgülle ayrılmış izinli frontend origin listesi

## Health endpoint

`GET /health`

Servisin çalıştığını ve bellekteki aktif oda sayısını döndürür.
