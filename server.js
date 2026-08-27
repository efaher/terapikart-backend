const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');
const {
  createAuthToken,
  verifyAuthToken,
  hashPassword,
  verifyPassword
} = require('./auth');
const {
  initStorage,
  createAdvisor,
  findAdvisorByEmail,
  findAdvisorById,
  publicAdvisor,
  canCreateSession,
  consumeSessionCredit,
  hasDatabase
} = require('./storage');

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
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

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
    selectedCards: Array.from(room.selectedCards.values()).sort((a, b) => a.order - b.order),
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

function detachSocket(socket) {
  const session = getSocketSession(socket);
  if (!session) return;

  const { room, role } = session;
  if (role === 'advisor' && room.advisorSocketId === socket.id) room.advisorSocketId = null;
  if (role === 'client' && room.clientSocketId === socket.id) room.clientSocketId = null;

  socket.leave(room.id);
  socket.data.roomID = null;
  socket.data.role = null;
  emitRoomState(room);
}

function getBearerToken(req) {
  const value = String(req.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7).trim() : null;
}

async function authenticatedAdvisorFromToken(token) {
  const payload = verifyAuthToken(token);
  if (!payload) return null;
  return findAdvisorById(payload.sub);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

app.get('/', (req, res) => {
  res.json({
    name: 'Persona Card realtime backend',
    version: '1.1-advisor-accounts',
    status: 'ok',
    persistentAccounts: hasDatabase
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, rooms: rooms.size, persistentAccounts: hasDatabase });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const displayName = String(req.body?.displayName || '').trim();
    const password = String(req.body?.password || '');

    if (!validEmail(email)) return res.status(400).json({ code: 'INVALID_EMAIL', message: 'Geçerli bir e-posta adresi girin.' });
    if (displayName.length < 2 || displayName.length > 80) return res.status(400).json({ code: 'INVALID_NAME', message: 'Ad soyad alanını kontrol edin.' });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ code: 'INVALID_PASSWORD', message: 'Şifre en az 8 karakter olmalıdır.' });

    const { salt, hash } = hashPassword(password);
    const advisor = await createAdvisor({
      email,
      displayName,
      passwordSalt: salt,
      passwordHash: hash
    });
    const token = createAuthToken(advisor);

    return res.status(201).json({ token, advisor: publicAdvisor(advisor) });
  } catch (error) {
    if (error.code === 'EMAIL_EXISTS') {
      return res.status(409).json({ code: 'EMAIL_EXISTS', message: 'Bu e-posta adresiyle daha önce hesap oluşturulmuş.' });
    }
    console.error('[register]', error);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Hesap oluşturulamadı.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const advisor = await findAdvisorByEmail(email);

    if (!advisor || !verifyPassword(password, advisor.passwordSalt, advisor.passwordHash)) {
      return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'E-posta veya şifre hatalı.' });
    }

    const token = createAuthToken(advisor);
    return res.json({ token, advisor: publicAdvisor(advisor) });
  } catch (error) {
    console.error('[login]', error);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Giriş yapılamadı.' });
  }
});

app.get('/api/me', async (req, res) => {
  try {
    const advisor = await authenticatedAdvisorFromToken(getBearerToken(req));
    if (!advisor) return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Oturumunuz geçersiz veya süresi dolmuş.' });
    return res.json({ advisor: publicAdvisor(advisor), canCreateSession: canCreateSession(advisor) });
  } catch (error) {
    console.error('[me]', error);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Hesap bilgisi alınamadı.' });
  }
});

io.on('connection', (socket) => {
  socket.on('createRoom', async ({ cardSet, authToken } = {}) => {
    try {
      if (!CARD_SETS[cardSet]) {
        socket.emit('sessionError', { code: 'INVALID_CARD_SET', message: 'Geçersiz kart seti.' });
        return;
      }

      const advisor = await authenticatedAdvisorFromToken(authToken);
      if (!advisor) {
        socket.emit('sessionError', { code: 'AUTH_REQUIRED', message: 'Kart çalışması başlatmak için danışman hesabınıza giriş yapın.' });
        return;
      }

      if (!canCreateSession(advisor)) {
        socket.emit('sessionError', { code: 'LICENSE_REQUIRED', message: 'Ücretsiz kullanım hakkınız sona erdi. Lisansınızı etkinleştirin.' });
        return;
      }

      const updatedAdvisor = await consumeSessionCredit(advisor.id);
      if (!updatedAdvisor) {
        socket.emit('sessionError', { code: 'LICENSE_REQUIRED', message: 'Ücretsiz kullanım hakkınız sona erdi. Lisansınızı etkinleştirin.' });
        return;
      }

      detachSocket(socket);

      const roomID = createRoomId();
      const advisorToken = createToken();
      const clientToken = createToken();
      const room = {
        id: roomID,
        cardSet,
        advisorId: advisor.id,
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
        clientToken,
        advisor: publicAdvisor(updatedAdvisor)
      });
      emitRoomState(room);
    } catch (error) {
      console.error('[createRoom]', error);
      socket.emit('sessionError', { code: 'SERVER_ERROR', message: 'Oturum oluşturulamadı.' });
    }
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

    socket.emit('joinedRoom', { ...publicRoomState(room), role });
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

    room.selectedCards.set(key, { cardId: key, order: room.nextOrder++ });
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

  socket.on('leaveRoom', () => detachSocket(socket));

  socket.on('disconnect', () => {
    const session = getSocketSession(socket);
    if (!session) return;
    const { room, role } = session;
    if (role === 'advisor' && room.advisorSocketId === socket.id) room.advisorSocketId = null;
    if (role === 'client' && room.clientSocketId === socket.id) room.clientSocketId = null;
    emitRoomState(room);
  });
});

initStorage()
  .then(() => {
    server.listen(PORT, () => console.log(`Persona Card backend listening on port ${PORT}`));
  })
  .catch((error) => {
    console.error('[startup] Storage initialization failed', error);
    process.exit(1);
  });
