const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3001;
const DEFAULT_ORIGINS = [
  'https://personitacard.netlify.app',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000'
];

const allowedOrigins = (process.env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Origin not allowed by CORS'));
    },
    methods: ['GET', 'POST']
  }
});

const CARD_SETS = {
  personita: { total: 77 },
  terapi_sb: { total: 44 }
};

const MAX_SELECTED_CARDS = 10;
const rooms = new Map();

function createToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function createRoomId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  do {
    id = Array.from({ length: 8 }, () => alphabet[crypto.randomInt(0, alphabet.length)]).join('');
  } while (rooms.has(id));
  return id;
}

function publicRoomState(room) {
  return {
    roomID: room.id,
    cardSet: room.cardSet,
    selectedCards: Array.from(room.selectedCards.values())
      .sort((a, b) => a.order - b.order),
    advisorConnected: Boolean(room.advisorSocketId),
    clientConnected: Boolean(room.clientSocketId)
  };
}

function emitRoomState(room) {
  io.to(room.id).emit('roomState', publicRoomState(room));
}

function getSocketSession(socket) {
  if (!socket.data.roomID || !socket.data.role) return null;
  const room = rooms.get(socket.data.roomID);
  if (!room) return null;
  return { room, role: socket.data.role };
}

function detachSocket(socket, { removeSelections = false } = {}) {
  const session = getSocketSession(socket);
  if (!session) return;

  const { room, role } = session;
  if (role === 'advisor' && room.advisorSocketId === socket.id) {
    room.advisorSocketId = null;
  }
  if (role === 'client' && room.clientSocketId === socket.id) {
    room.clientSocketId = null;
    if (removeSelections) room.selectedCards.clear();
  }

  socket.leave(room.id);
  socket.data.roomID = null;
  socket.data.role = null;
  emitRoomState(room);
}

app.get('/', (req, res) => {
  res.json({
    name: 'Persona Card realtime backend',
    version: '1.0.0-v1',
    status: 'ok'
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

io.on('connection', (socket) => {
  socket.on('createRoom', ({ cardSet } = {}) => {
    if (!CARD_SETS[cardSet]) {
      socket.emit('sessionError', { code: 'INVALID_CARD_SET', message: 'Geçersiz kart seti.' });
      return;
    }

    detachSocket(socket);

    const roomID = createRoomId();
    const advisorToken = createToken();
    const clientToken = createToken();
    const room = {
      id: roomID,
      cardSet,
      advisorToken,
      clientToken,
      advisorSocketId: socket.id,
      clientSocketId: null,
      selectedCards: new Map(),
      nextOrder: 1,
      createdAt: Date.now()
    };

    rooms.set(roomID, room);
    socket.join(roomID);
    socket.data.roomID = roomID;
    socket.data.role = 'advisor';

    socket.emit('roomCreated', {
      ...publicRoomState(room),
      advisorToken,
      clientToken
    });
    emitRoomState(room);
  });

  socket.on('joinRoom', ({ roomID, token } = {}) => {
    const normalizedRoomID = String(roomID || '').trim().toUpperCase();
    const room = rooms.get(normalizedRoomID);

    if (!room || !token) {
      socket.emit('sessionError', { code: 'ROOM_NOT_FOUND', message: 'Oturum bulunamadı veya bağlantı geçersiz.' });
      return;
    }

    let role = null;
    if (token === room.advisorToken) role = 'advisor';
    if (token === room.clientToken) role = 'client';

    if (!role) {
      socket.emit('sessionError', { code: 'INVALID_TOKEN', message: 'Bu oturum bağlantısı geçersiz.' });
      return;
    }

    if (role === 'client' && room.clientSocketId && room.clientSocketId !== socket.id) {
      socket.emit('sessionError', { code: 'CLIENT_ALREADY_CONNECTED', message: 'Bu oturuma bir danışan zaten bağlı.' });
      return;
    }

    detachSocket(socket);
    socket.join(room.id);
    socket.data.roomID = room.id;
    socket.data.role = role;

    if (role === 'advisor') room.advisorSocketId = socket.id;
    if (role === 'client') room.clientSocketId = socket.id;

    socket.emit('joinedRoom', {
      ...publicRoomState(room),
      role
    });
    emitRoomState(room);
  });

  socket.on('selectCard', ({ cardId } = {}) => {
    const session = getSocketSession(socket);
    if (!session || session.role !== 'client') {
      socket.emit('sessionError', { code: 'NOT_ALLOWED', message: 'Kartları yalnızca danışan seçebilir.' });
      return;
    }

    const { room } = session;
    const numericCardId = Number(cardId);
    const cardSet = CARD_SETS[room.cardSet];

    if (!Number.isInteger(numericCardId) || numericCardId < 1 || numericCardId > cardSet.total) {
      socket.emit('sessionError', { code: 'INVALID_CARD', message: 'Geçersiz kart.' });
      return;
    }

    const key = String(numericCardId);
    if (room.selectedCards.has(key)) return;

    if (room.selectedCards.size >= MAX_SELECTED_CARDS) {
      socket.emit('sessionError', { code: 'MAX_CARDS', message: `En fazla ${MAX_SELECTED_CARDS} kart seçilebilir.` });
      return;
    }

    room.selectedCards.set(key, {
      cardId: key,
      order: room.nextOrder++
    });
    emitRoomState(room);
  });

  socket.on('deselectCard', ({ cardId } = {}) => {
    const session = getSocketSession(socket);
    if (!session || session.role !== 'client') {
      socket.emit('sessionError', { code: 'NOT_ALLOWED', message: 'Kart seçimini yalnızca danışan değiştirebilir.' });
      return;
    }

    session.room.selectedCards.delete(String(cardId));
    emitRoomState(session.room);
  });

  socket.on('resetRoomCards', () => {
    const session = getSocketSession(socket);
    if (!session || session.role !== 'advisor') {
      socket.emit('sessionError', { code: 'NOT_ALLOWED', message: 'Seçimleri yalnızca danışman sıfırlayabilir.' });
      return;
    }

    session.room.selectedCards.clear();
    session.room.nextOrder = 1;
    emitRoomState(session.room);
  });

  socket.on('closeRoom', () => {
    const session = getSocketSession(socket);
    if (!session || session.role !== 'advisor') {
      socket.emit('sessionError', { code: 'NOT_ALLOWED', message: 'Oturumu yalnızca danışman kapatabilir.' });
      return;
    }

    const { room } = session;
    io.to(room.id).emit('roomClosed', { roomID: room.id });
    rooms.delete(room.id);

    const sockets = io.sockets.adapter.rooms.get(room.id);
    if (sockets) {
      for (const socketId of sockets) {
        const participant = io.sockets.sockets.get(socketId);
        if (participant) {
          participant.leave(room.id);
          participant.data.roomID = null;
          participant.data.role = null;
        }
      }
    }
  });

  socket.on('leaveRoom', () => {
    detachSocket(socket);
  });

  socket.on('disconnect', () => {
    const session = getSocketSession(socket);
    if (!session) return;

    const { room, role } = session;
    if (role === 'advisor' && room.advisorSocketId === socket.id) room.advisorSocketId = null;
    if (role === 'client' && room.clientSocketId === socket.id) room.clientSocketId = null;
    emitRoomState(room);
  });
});

server.listen(PORT, () => {
  console.log(`Persona Card backend listening on port ${PORT}`);
});
