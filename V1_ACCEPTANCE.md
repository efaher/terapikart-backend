# Persona Card Realtime Backend V1 Kabul Kriterleri

- [ ] Geçersiz kart seti ile oda oluşturulamıyor.
- [ ] Her oda için benzersiz oda kodu üretiliyor.
- [ ] Danışman ve danışan için farklı tokenlar üretiliyor.
- [ ] Oda kodu tek başına erişim sağlamıyor.
- [ ] Geçersiz token ile odaya girilemiyor.
- [ ] Aynı oturuma ikinci danışan bağlanamıyor.
- [ ] Yalnız danışan `selectCard` ve `deselectCard` işlemi yapabiliyor.
- [ ] En fazla 10 kart seçilebiliyor.
- [ ] Yalnız danışman `resetRoomCards` işlemi yapabiliyor.
- [ ] Yalnız danışman `closeRoom` işlemi yapabiliyor.
- [ ] Kart seçim sırası korunuyor.
- [ ] Danışan bağlantısı kesildiğinde danışmana bağlantı durumu iletiliyor.
- [ ] Danışman yeniden bağlandığında mevcut oturuma dönebiliyor.
- [ ] `GET /health` çalışıyor.
- [ ] İzin verilmeyen origin CORS tarafından reddediliyor.
