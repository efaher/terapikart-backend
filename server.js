const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const PORT = process.env.PORT || 3001; // Render için PORT ortam değişkeni

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "https://personitacard.netlify.app", // SONUNDAKİ EĞİK ÇİZGİ KALDIRILDI
        methods: ["GET", "POST"]
    }
});

let rooms = {}; // { roomID: { users: Set(), selectedCards: Map(), cardSet: string } } // Yorum güncellendi
const MAX_USERS_PER_ROOM = 3;

app.get('/', (req, res) => {
    res.send('Terapik Kartlar Backend Çalışıyor!');
});

io.on('connection', (socket) => {
    console.log('Yeni bir kullanıcı bağlandı:', socket.id);

    // DEĞİŞTİRİLDİ: 'joinRoom' olayı artık 'data' objesi alıyor ({roomID, cardSet})
    socket.on('joinRoom', (data) => {
        const roomID = data.roomID; // Oda ID'sini data'dan al
        const cardSetFromClient = data.cardSet; // Kart Seti bilgisini data'dan al

        // roomID veya cardSet yoksa hata işle (frontend doğru data göndermeli)
        if (!roomID || !cardSetFromClient) {
            console.warn(`Geçersiz joinRoom isteği: roomID=${roomID}, cardSet=${cardSetFromClient}`);
            socket.emit('errorJoiningRoom', 'Geçersiz oda veya kart seti bilgisi.'); // Frontend'e hata gönder
            return;
        }

        if (!rooms[roomID]) {
            // Oda yoksa oluştur ve kart setini kaydet
            rooms[roomID] = {
                users: new Set(),
                selectedCards: new Map(), // cardId -> { userId: socket.id }
                cardSet: cardSetFromClient // Odayı oluştururken kart setini kaydettik!
            };
            console.log(`Oda oluşturuldu: ${roomID} ile kart seti: ${cardSetFromClient}`);
        } else {
            // Oda varsa
            // Odaya katılan kullanıcının göndermeye çalıştığı set ile
            // Odanın zaten kurulu olduğu setin aynı olup olmadığını KONTROL EDELİM!
            if (rooms[roomID].cardSet && rooms[roomID].cardSet !== cardSetFromClient) {
                 // Eğer oda zaten farklı bir set ile kurulmuşsa
                 socket.emit('errorJoiningRoom', 'Bu oda farklı bir kart seti ile kurulmuş.'); // Frontend'e hata gönder
                 console.warn(`Kullanıcı ${socket.id} odaya ${roomID} katılmaya çalıştı, farklı set: ${cardSetFromClient}. Odanın seti: ${rooms[roomID].cardSet}`);
                 return; // Odaya katılmasına izin verme
            }
             // Oda varsa ve set aynıysa veya oda ilk kez kuruluyorsa (yukarıdaki if'te yakalanır) devam et
             console.log(`Kullanıcı ${socket.id} odaya katılıyor: ${roomID} (Set: ${rooms[roomID].cardSet})`);
        }


        // Kullanıcı sayısı limit kontrolü (Buraya taşındı)
        if (rooms[roomID].users.size >= MAX_USERS_PER_ROOM) {
            socket.emit('roomFull');
            console.log(`Oda dolu: ${roomID}, kullanıcı ${socket.id} katılamadı.`);
            return;
        }


        socket.join(roomID);
        rooms[roomID].users.add(socket.id);
        socket.currentRoom = roomID; // Kullanıcının mevcut odasını sakla

        console.log(`Kullanıcı ${socket.id} başarıyla odaya katıldı: ${roomID}. Odadaki kullanıcı sayısı: ${rooms[roomID].users.size}`);

        // Yeni katılan kullanıcıya odanın mevcut durumunu gönder
        socket.emit('currentSelectedCards', { // Obje olarak gönderiyoruz
            roomID: roomID, // Odanın ID'si
            cardSet: rooms[roomID].cardSet, // <<<<< Burası artık tanımlı olmalı
            selectedCards: Array.from(rooms[roomID].selectedCards.entries()).map(([cardId, data]) => ({ cardId, userId: data.userId })), // Mevcut seçili kartlar
            userCount: rooms[roomID].users.size // Kullanıcı sayısı bilgisini de ekleyelim
        });

        // Odadaki diğerlerine kullanıcı sayısı bilgisini gönder
        io.to(roomID).emit('userCountUpdate', rooms[roomID].users.size);
        // NOT: Frontend'de 'userCountUpdate' olayını dinleyip arayüzde göstermiyoruz henüz, isteğe bağlı.
    });


    // selectCard olayı artık data objesi almalı {roomID, cardId}
    socket.on('selectCard', (data) => {
         const roomID = data.roomID;
         const cardId = data.cardId; // cardId'yi data'dan al

        if (rooms[roomID] && rooms[roomID].users.has(socket.id)) {
            // Backend tarafında da her kullanıcının seçebileceği kişisel limiti kontrol etmek GEREKİR.
            // Şu an sadece odadaki toplam farklı kart limitini kontrol ediyoruz (10).
            // Kişisel limit kontrolü frontend'de yapılıyor, ama backend'de de olması daha güvenlidir.
            // MVP için sadece toplam 10 limitine bakalım.

            if (rooms[roomID].selectedCards.size < 10 || rooms[roomID].selectedCards.has(cardId)) {
                 // Eğer toplam kart sayısı 10'dan azsa VEYA bu kart zaten seçiliyse (üstüne seçebiliriz)
                 rooms[roomID].selectedCards.set(cardId, { userId: socket.id });
                 // Seçim bilgisini odadaki herkese gönder
                 io.to(roomID).emit('cardSelected', { cardId: cardId, userId: socket.id });
                 console.log(`Kullanıcı ${socket.id}, oda ${roomID} için kart seçti: ${cardId}`);
             } else {
                 // Toplam 10 kart limiti dolmuş ve yeni bir kart seçilmeye çalışılıyor
                 socket.emit('maxCardsReached'); // Frontend'e bilgi gönder
                 console.warn(`Kullanıcı ${socket.id}, oda ${roomID} için limit doluyken kart seçmeye çalıştı: ${cardId}`);
             }
        } else {
             console.warn(`Kullanıcı ${socket.id}, geçersiz odada (${roomID}) kart seçmeye çalıştı.`);
        }
    });


    // deselectCard olayı artık data objesi almalı {roomID, cardId}
    socket.on('deselectCard', (data) => {
         const roomID = data.roomID;
         const cardId = data.cardId; // cardId'yi data'dan al

        if (rooms[roomID] && rooms[roomID].users.has(socket.id) && rooms[roomID].selectedCards.has(cardId)) {
            // Sadece kendi seçtiği kartı iptal etmesine izin ver (Frontend'de de kontrol ediliyor, backend'de de edelim)
            if (rooms[roomID].selectedCards.get(cardId).userId === socket.id) {
                 rooms[roomID].selectedCards.delete(cardId);
                 // İptal bilgisini odadaki herkese gönder
                 io.to(roomID).emit('cardDeselected', { cardId: cardId, userId: socket.id }); // Kimin deselect ettiğini de gönderiyoruz
                 console.log(`Kullanıcı ${socket.id}, oda ${roomID} için kart seçimini iptal etti: ${cardId}`);
             } else {
                 console.warn(`Kullanıcı ${socket.id}, başkasının kartını (${cardId}) iptal etmeye çalıştı.`);
                 // Frontend'e hata gönderilebilir
             }
        } else {
             console.warn(`Kullanıcı ${socket.id}, geçersiz odada (${roomID}) veya seçili olmayan kartı (${cardId}) iptal etmeye çalıştı.`);
        }
    });

    // resetRoomCards olayı artık data objesi almalı {roomID}
    socket.on('resetRoomCards', (roomID) => { // roomID'yi doğrudan alıyor, data objesi değil (önceki frontend koduna göre)
        if (rooms[roomID]) {
            // Sadece admin yetkisi eklenecek ileride
            // MVP için şimdilik, bu olayı backend'e gönderen ilk kişi (frontend'de reset butonuna basan) sıfırlamayı tetikler.
            // Eğer sadece odayı kuran admin sıfırlasın istersek backend'de yetki kontrolü gerekir (Faz 2)

            rooms[roomID].selectedCards.clear();
            io.to(roomID).emit('roomCardsReset'); // Odaya ait herkese sıfırlama mesajı gönder
            console.log(`Oda ${roomID} için kartlar sıfırlandı (tetikleyen kullanıcı: ${socket.id}).`);
        } else {
             console.warn(`Geçersiz oda (${roomID}) için sıfırlama isteği geldi.`);
        }
    });

    // YENİ: leaveRoom olayı (Kullanıcı odadan ayrılma isteği gönderirse)
    socket.on('leaveRoom', (roomID) => {
        if (rooms[roomID] && rooms[roomID].users.has(socket.id)) {
            // Socket.IO odasından ayrıl
            socket.leave(roomID);
            // rooms objesinden kullanıcıyı sil
            rooms[roomID].users.delete(socket.id);
            socket.currentRoom = null; // Kullanıcının mevcut oda bilgisini temizle

            console.log(`Kullanıcı ${socket.id} odadan ayrıldı: ${roomID}. Kalan kullanıcı sayısı: ${rooms[roomID].users.size}`);

            // Bu kullanıcının seçtiği kartları temizle (isteğe bağlı ama iyi bir pratik)
            rooms[roomID].selectedCards.forEach((data, cardId) => {
                if (data.userId === socket.id) {
                    rooms[roomID].selectedCards.delete(cardId);
                    // Odadaki diğerlerine bu kartın iptal edildiğini bildir
                    io.to(roomID).emit('cardDeselected', { cardId: cardId, userId: socket.id });
                }
            });

            if (rooms[roomID].users.size === 0) {
                // Oda boşaldıysa odayı sil
                delete rooms[roomID];
                console.log(`Oda boşaldı ve silindi: ${roomID}`);
            } else {
                // Odada kalanlara kullanıcı sayısını güncelle
                io.to(roomID).emit('userCountUpdate', rooms[roomID].users.size);
            }
        } else {
            console.warn(`Kullanıcı ${socket.id}, olmayan bir odadan (${roomID}) ayrılmaya çalıştı.`);
        }
    });


    socket.on('disconnect', () => {
        console.log('Kullanıcı bağlantıyı kesti:', socket.id);
        const roomID = socket.currentRoom; // Bağlanırken kaydettiğimiz oda ID'sini kullan
        // Eğer kullanıcı bir odadaysa, odadan ayrılma mantığını çalıştır
        if (roomID && rooms[roomID]) {
            // Socket.IO odasından otomatik olarak zaten ayrılmıştır.
            // rooms objesinden kullanıcıyı sil
            rooms[roomID].users.delete(socket.id);
            socket.currentRoom = null; // Kullanıcının mevcut oda bilgisini temizle

            console.log(`Bağlantısı kesilen kullanıcı (${socket.id}) odadan ayrıldı: ${roomID}. Kalan kullanıcı sayısı: ${rooms[roomID].users.size}`);

             // Bu kullanıcının seçtiği kartları temizle (isteğe bağlı ama iyi bir pratik)
             rooms[roomID].selectedCards.forEach((data, cardId) => {
                 if (data.userId === socket.id) {
                     rooms[roomID].selectedCards.delete(cardId);
                     // Odadaki diğerlerine bu kartın iptal edildiğini bildir
                     io.to(roomID).emit('cardDeselected', { cardId: cardId, userId: socket.id });
                 }
             });


            if (rooms[roomID].users.size === 0) {
                // Oda boşaldıysa odayı sil
                delete rooms[roomID];
                console.log(`Oda boşaldı ve silindi: ${roomID}`);
            } else {
                // Odada kalanlara kullanıcı sayısını güncelle
                io.to(roomID).emit('userCountUpdate', rooms[roomID].users.size);
            }
        }
        // Eğer bir odada değilken bağlantısı kesildiyse, yapacak başka bir şey yok.
    });
});

server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor...`);
});