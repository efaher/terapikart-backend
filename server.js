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

let rooms = {}; // { roomID: { users: Set(), selectedCards: Map() } }
const MAX_USERS_PER_ROOM = 3;

app.get('/', (req, res) => {
    res.send('Terapik Kartlar Backend Çalışıyor!');
});

io.on('connection', (socket) => {
    console.log('Yeni bir kullanıcı bağlandı:', socket.id);

    socket.on('joinRoom', (roomID) => {
        if (!rooms[roomID]) {
            rooms[roomID] = {
                users: new Set(),
                selectedCards: new Map() // cardId -> { userId: socket.id }
            };
            console.log(`Oda oluşturuldu: ${roomID}`);
        }

        if (rooms[roomID].users.size >= MAX_USERS_PER_ROOM) {
            socket.emit('roomFull');
            console.log(`Oda dolu: ${roomID}, kullanıcı ${socket.id} katılamadı.`);
            return;
        }

        socket.join(roomID);
        rooms[roomID].users.add(socket.id);
        socket.currentRoom = roomID; // Kullanıcının mevcut odasını sakla

        console.log(`Kullanıcı ${socket.id} odaya katıldı: ${roomID}. Odadaki kullanıcı sayısı: ${rooms[roomID].users.size}`);

        // Yeni katılan kullanıcıya mevcut seçili kartları gönder
        socket.emit('currentSelectedCards', Array.from(rooms[roomID].selectedCards.entries()).map(([cardId, data]) => ({ cardId, userId: data.userId })));
        // Odadaki diğerlerine kullanıcı sayısını veya bilgisini gönder (isteğe bağlı)
        io.to(roomID).emit('userCountUpdate', rooms[roomID].users.size);
    });

    socket.on('selectCard', ({ roomID, cardId }) => {
        if (rooms[roomID] && rooms[roomID].users.has(socket.id)) {
            if (rooms[roomID].selectedCards.size < 10) { // En fazla 10 kart limiti
                rooms[roomID].selectedCards.set(cardId, { userId: socket.id });
                io.to(roomID).emit('cardSelected', { cardId, userId: socket.id });
                console.log(`Kullanıcı ${socket.id}, oda ${roomID} için kart seçti: ${cardId}`);
            } else {
                socket.emit('maxCardsReached');
            }
        }
    });

    socket.on('deselectCard', ({ roomID, cardId }) => {
        if (rooms[roomID] && rooms[roomID].users.has(socket.id) && rooms[roomID].selectedCards.has(cardId)) {
            rooms[roomID].selectedCards.delete(cardId);
            io.to(roomID).emit('cardDeselected', { cardId, userId: socket.id }); // Kimin deselect ettiğini de gönderebiliriz
            console.log(`Kullanıcı ${socket.id}, oda ${roomID} için kart seçimini iptal etti: ${cardId}`);
        }
    });

    socket.on('resetRoomCards', (roomID) => {
        if (rooms[roomID]) { // Sadece admin yetkisi eklenecek ileride
            rooms[roomID].selectedCards.clear();
            io.to(roomID).emit('roomCardsReset');
            console.log(`Oda ${roomID} için kartlar sıfırlandı.`);
        }
    });

    socket.on('disconnect', () => {
        console.log('Kullanıcı bağlantıyı kesti:', socket.id);
        const roomID = socket.currentRoom;
        if (roomID && rooms[roomID]) {
            rooms[roomID].users.delete(socket.id);
            console.log(`Kullanıcı ${socket.id} odadan ayrıldı: ${roomID}. Kalan kullanıcı sayısı: ${rooms[roomID].users.size}`);

            // Kullanıcının seçtiği kartları temizle (opsiyonel, kimin seçtiği bilgisiyle yapılabilir)
            // Bu MVP'de basitlik için tüm kartlar kalıyor, sadece kullanıcı ayrılıyor.
            // Gelişmiş versiyonda:
            // rooms[roomID].selectedCards.forEach((data, cardId) => {
            //     if (data.userId === socket.id) {
            //         rooms[roomID].selectedCards.delete(cardId);
            //         io.to(roomID).emit('cardDeselected', { cardId, userId: socket.id });
            //     }
            // });


            if (rooms[roomID].users.size === 0) {
                delete rooms[roomID];
                console.log(`Oda boşaldı ve silindi: ${roomID}`);
            } else {
                io.to(roomID).emit('userCountUpdate', rooms[roomID].users.size);
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor...`);
});
