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
  activateAnnualLicense,
  listLicenseEvents,
  createAccountToken,
  verifyEmailWithToken,
  resetPasswordWithToken,
  hasDatabase
} = require('./storage');
const {
  createRateLimiter,
  requestIp,
  normalizeKeyPart
} = require('./rate-limit');
const { createOfflineEntitlement } = require('./offline-entitlement');
const {
  mailConfigured,
  sendEmailVerification,
  sendPasswordReset
} = require('./mailer');

const PORT = process.env.PORT || 3001;
const ADMIN_LICENSE_SECRET = String(process.env.ADMIN_LICENSE_SECRET || '');
const REQUIRE_EMAIL_VERIFICATION = String(process.env.REQUIRE_EMAIL_VERIFICATION || '').trim().toLowerCase() === 'true';
const ROOM_MAX_AGE_MS = Number(process.env.ROOM_MAX_AGE_MS || 6 * 60 * 60 * 1000);
const ROOM_IDLE_CLEANUP_MS = Number(process.env.ROOM_IDLE_CLEANUP_MS || 30 * 60 * 1000);
const ROOM_CLEANUP_INTERVAL_MS = Number(process.env.ROOM_CLEANUP_INTERVAL_MS || 15 * 60 * 1000);
const AUTH_RATE_LIMIT_WINDOW_MS = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const AUTH_IP_RATE_LIMIT_MAX = Number(process.env.AUTH_IP_RATE_LIMIT_MAX || 60);
const LOGIN_RATE_LIMIT_MAX = Number(process.env.LOGIN_RATE_LIMIT_MAX || 10);
const REGISTER_RATE_LIMIT_MAX = Number(process.env.REGISTER_RATE_LIMIT_MAX || 8);
const ACCOUNT_ACTION_RATE_LIMIT_MAX = Number(process.env.ACCOUNT_ACTION_RATE_LIMIT_MAX || 5);
const ADMIN_RATE_LIMIT_MAX = Number(process.env.ADMIN_RATE_LIMIT_MAX || 10);
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
app.disable('x-powered-by');
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

const authIpLimiter = createRateLimiter({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: AUTH_IP_RATE_LIMIT_MAX,
  key: (req) => `auth-ip:${requestIp(req)}`,
  message: 'Çok fazla kimlik doğrulama isteği gönderildi. Lütfen bir süre sonra tekrar deneyin.'
});

const loginLimiter = createRateLimiter({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: LOGIN_RATE_LIMIT_MAX,
  key: (req) => `login:${requestIp(req)}:${normalizeKeyPart(req.body?.email)}`,
  message: 'Çok fazla giriş denemesi yapıldı. Lütfen bir süre sonra tekrar deneyin.'
});

const registerLimiter = createRateLimiter({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: REGISTER_RATE_LIMIT_MAX,
  key: (req) => `register:${requestIp(req)}`,
  message: 'Bu bağlantıdan kısa sürede çok fazla hesap oluşturma isteği gönderildi. Lütfen daha sonra tekrar deneyin.'
});

const accountActionLimiter = createRateLimiter({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: ACCOUNT_ACTION_RATE_LIMIT_MAX,
  key: (req) => `account-action:${requestIp(req)}:${normalizeKeyPart(req.body?.email || '')}`,
  message: 'Bu hesap işlemi kısa sürede çok fazla kez istendi. Lütfen bir süre sonra tekrar deneyin.'
});

const adminLimiter = createRateLimiter({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: ADMIN_RATE_LIMIT_MAX,
  key: (req) => `admin-license:${requestIp(req)}`,
  message: 'Çok fazla lisans yönetim isteği gönderildi. Lütfen bir süre sonra tekrar deneyin.'
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

function touchRoom(room) {
  room.lastActivityAt = Date.now();
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
  touchRoom(room);
  io.to(room.id).emit('roomState', publicRoomState(room));
}

function getSocketSession(socket) {
  if (!socket.data.roomID || !socket.data.role) return null;
  const room = rooms.get(socket.data.roomID);
  if (!room) return null;
  return { room, role: socket.data.role };
}

function destroyRoom(room, reason = 'closed') {
  if (!room || !rooms.has(room.id)) return;

  io.to(room.id).emit('roomClosed', { roomID: room.id, reason });
  const socketIds = io.sockets.adapter.rooms.get(room.id);
  if (socketIds) {
    for (const socketId of [...socketIds]) {
      const participant = io.sockets.sockets.get(socketId);
      if (participant) {
        participant.leave(room.id);
        participant.data.roomID = null;
        participant.data.role = null;
      }
    }
  }
  rooms.delete(room.id);
}

function destroyAdvisorRooms(advisorId) {
  for (const room of [...rooms.values()]) {
    if (room.advisorId === advisorId) destroyRoom(room, 'replaced');
  }
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

async function ensureRoomCredit(room) {
  if (room.creditConsumed) return findAdvisorById(room.advisorId);
  if (room.creditConsumptionPromise) return room.creditConsumptionPromise;

  room.creditConsumptionPromise = (async () => {
    const advisor = await findAdvisorById(room.advisorId);
    if (!advisor || !canCreateSession(advisor)) return null;
    const updatedAdvisor = await consumeSessionCredit(advisor.id);
    if (!updatedAdvisor) return null;
    room.creditConsumed = true;
    return updatedAdvisor;
  })();

  try {
    return await room.creditConsumptionPromise;
  } finally {
    room.creditConsumptionPromise = null;
  }
}

function getBearerToken(req) {
  const value = String(req.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7).trim() : null;
}

async function authenticatedAdvisorFromToken(token) {
  const payload = verifyAuthToken(token);
  if (!payload) return null;
  const advisor = await findAdvisorById(payload.sub);
  if (!advisor) return null;
  if (Number(payload.ver) !== Number(advisor.authVersion || 1)) return null;
  return advisor;
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function adminAuthorized(req) {
  if (!ADMIN_LICENSE_SECRET) return false;
  const provided = getBearerToken(req);
  if (!provided) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(ADMIN_LICENSE_SECRET);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verificationBlocked(advisor) {
  return REQUIRE_EMAIL_VERIFICATION && !advisor?.emailVerifiedAt;
}

function mailUnavailable(res) {
  return res.status(503).json({
    code: 'MAIL_NOT_CONFIGURED',
    message: 'E-posta gönderim hizmeti henüz yapılandırılmadı.'
  });
}

app.get('/', (req, res) => {
  res.json({
    name: 'Persona Card realtime backend',
    version: '1.2-annual-license-pwa',
    status: 'ok',
    persistentAccounts: hasDatabase,
    emailVerificationRequired: REQUIRE_EMAIL_VERIFICATION,
    mailConfigured: mailConfigured()
  });
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    persistentAccounts: hasDatabase,
    emailVerificationRequired: REQUIRE_EMAIL_VERIFICATION,
    mailConfigured: mailConfigured()
  });
});

app.post('/api/auth/register', authIpLimiter, registerLimiter, async (req, res) => {
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

    return res.status(201).json({
      token,
      advisor: publicAdvisor(advisor),
      emailVerificationRequired: REQUIRE_EMAIL_VERIFICATION,
      mailConfigured: mailConfigured()
    });
  } catch (error) {
    if (error.code === 'EMAIL_EXISTS') {
      return res.status(409).json({ code: 'EMAIL_EXISTS', message: 'Bu e-posta adresiyle daha önce hesap oluşturulmuş.' });
    }
    console.error('[register]', error);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Hesap oluşturulamadı.' });
  }
});

app.post('/api/auth/login', authIpLimiter, loginLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const advisor = await findAdvisorByEmail(email);

    if (!advisor || !verifyPassword(password, advisor.passwordSalt, advisor.passwordHash)) {
      return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'E-posta veya şifre hatalı.' });
    }

    const token = createAuthToken(advisor);
    return res.json({
      token,
      advisor: publicAdvisor(advisor),
      emailVerificationRequired: REQUIRE_EMAIL_VERIFICATION,
      mailConfigured: mailConfigured()
    });
  } catch (error) {
    console.error('[login]', error);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Giriş yapılamadı.' });
  }
});

app.post('/api/auth/email-verification/request', authIpLimiter, accountActionLimiter, async (req, res) => {
  try {
    if (!mailConfigured()) return mailUnavailable(res);
    const advisor = await authenticatedAdvisorFromToken(getBearerToken(req));
    if (!advisor) return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Oturumunuz geçersiz veya süresi dolmuş.' });
    if (advisor.emailVerifiedAt) return res.json({ ok: true, alreadyVerified: true });

    const verification = await createAccountToken(advisor.id, 'email_verification', 24 * 60);
    await sendEmailVerification({
      email: advisor.email,
      displayName: advisor.displayName,
      token: verification.token
    });
    return res.json({ ok: true, alreadyVerified: false });
  } catch (error) {
    console.error('[email-verification-request]', error);
    if (error.code === 'MAIL_NOT_CONFIGURED') return mailUnavailable(res);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Doğrulama e-postası gönderilemedi.' });
  }
});

app.post('/api/auth/email-verification/confirm', authIpLimiter, async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) return res.status(400).json({ code: 'INVALID_TOKEN', message: 'Doğrulama bağlantısı geçersiz.' });

    const advisor = await verifyEmailWithToken(token);
    if (!advisor) {
      return res.status(400).json({ code: 'INVALID_OR_EXPIRED_TOKEN', message: 'Doğrulama bağlantısı geçersiz veya süresi dolmuş.' });
    }

    const authToken = createAuthToken(advisor);
    return res.json({ token: authToken, advisor: publicAdvisor(advisor) });
  } catch (error) {
    console.error('[email-verification-confirm]', error);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'E-posta doğrulanamadı.' });
  }
});

app.post('/api/auth/password-reset/request', authIpLimiter, accountActionLimiter, async (req, res) => {
  try {
    if (!mailConfigured()) return mailUnavailable(res);
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!validEmail(email)) return res.status(400).json({ code: 'INVALID_EMAIL', message: 'Geçerli bir e-posta adresi girin.' });

    const advisor = await findAdvisorByEmail(email);
    if (advisor) {
      const reset = await createAccountToken(advisor.id, 'password_reset', 60);
      await sendPasswordReset({
        email: advisor.email,
        displayName: advisor.displayName,
        token: reset.token
      });
    }

    return res.json({
      ok: true,
      message: 'Bu e-posta adresiyle bir hesap varsa şifre sıfırlama bağlantısı gönderildi.'
    });
  } catch (error) {
    console.error('[password-reset-request]', error);
    if (error.code === 'MAIL_NOT_CONFIGURED') return mailUnavailable(res);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Şifre sıfırlama isteği tamamlanamadı.' });
  }
});

app.post('/api/auth/password-reset/confirm', authIpLimiter, async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');
    if (!token) return res.status(400).json({ code: 'INVALID_TOKEN', message: 'Şifre sıfırlama bağlantısı geçersiz.' });
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ code: 'INVALID_PASSWORD', message: 'Şifre en az 8 karakter olmalıdır.' });
    }

    const { salt, hash } = hashPassword(password);
    const advisor = await resetPasswordWithToken(token, salt, hash);
    if (!advisor) {
      return res.status(400).json({ code: 'INVALID_OR_EXPIRED_TOKEN', message: 'Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş.' });
    }

    return res.json({ ok: true, message: 'Şifreniz güncellendi. Yeni şifrenizle giriş yapabilirsiniz.' });
  } catch (error) {
    console.error('[password-reset-confirm]', error);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Şifre güncellenemedi.' });
  }
});

app.get('/api/me', async (req, res) => {
  try {
    const advisor = await authenticatedAdvisorFromToken(getBearerToken(req));
    if (!advisor) return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Oturumunuz geçersiz veya süresi dolmuş.' });
    return res.json({
      advisor: publicAdvisor(advisor),
      canCreateSession: canCreateSession(advisor) && !verificationBlocked(advisor),
      emailVerificationRequired: REQUIRE_EMAIL_VERIFICATION,
      mailConfigured: mailConfigured()
    });
  } catch (error) {
    console.error('[me]', error);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Hesap bilgisi alınamadı.' });
  }
});

app.get('/api/offline-entitlement', async (req, res) => {
  try {
    const advisor = await authenticatedAdvisorFromToken(getBearerToken(req));
    if (!advisor) return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Oturumunuz geçersiz veya süresi dolmuş.' });
    if (verificationBlocked(advisor)) {
      return res.status(403).json({
        code: 'EMAIL_VERIFICATION_REQUIRED',
        message: 'Çevrimdışı cihaz modu için e-posta adresinizi doğrulayın.'
      });
    }

    const signed = createOfflineEntitlement(advisor);
    if (!signed) {
      return res.status(403).json({
        code: 'LICENSE_REQUIRED',
        message: 'Çevrimdışı cihaz modu için aktif yıllık lisans gerekir.'
      });
    }
    return res.json(signed);
  } catch (error) {
    console.error('[offline-entitlement]', error);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Çevrimdışı kullanım yetkisi hazırlanamadı.' });
  }
});

app.post('/api/admin/licenses/annual', adminLimiter, async (req, res) => {
  try {
    if (!adminAuthorized(req)) {
      return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Lisans yönetim yetkisi doğrulanamadı.' });
    }

    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!validEmail(email)) {
      return res.status(400).json({ code: 'INVALID_EMAIL', message: 'Geçerli bir danışman e-postası girin.' });
    }

    const advisor = await findAdvisorByEmail(email);
    if (!advisor) {
      return res.status(404).json({ code: 'ADVISOR_NOT_FOUND', message: 'Danışman hesabı bulunamadı.' });
    }

    const updated = await activateAnnualLicense(advisor.id);
    return res.json({ advisor: publicAdvisor(updated) });
  } catch (error) {
    console.error('[annual-license]', error);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Yıllık lisans etkinleştirilemedi.' });
  }
});

app.get('/api/admin/licenses/events', adminLimiter, async (req, res) => {
  try {
    if (!adminAuthorized(req)) {
      return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Lisans yönetim yetkisi doğrulanamadı.' });
    }

    const email = String(req.query?.email || '').trim().toLowerCase();
    if (!validEmail(email)) {
      return res.status(400).json({ code: 'INVALID_EMAIL', message: 'Geçerli bir danışman e-postası girin.' });
    }

    const advisor = await findAdvisorByEmail(email);
    if (!advisor) {
      return res.status(404).json({ code: 'ADVISOR_NOT_FOUND', message: 'Danışman hesabı bulunamadı.' });
    }

    const requestedLimit = Number(req.query?.limit || 50);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(Math.floor(requestedLimit), 100))
      : 50;
    const events = await listLicenseEvents(advisor.id, limit);
    return res.json({ advisor: publicAdvisor(advisor), events });
  } catch (error) {
    console.error('[license-events]', error);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Lisans hareketleri alınamadı.' });
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

      if (verificationBlocked(advisor)) {
        socket.emit('sessionError', { code: 'EMAIL_VERIFICATION_REQUIRED', message: 'Kart çalışması başlatmak için e-posta adresinizi doğrulayın.' });
        return;
      }

      if (!canCreateSession(advisor)) {
        socket.emit('sessionError', { code: 'LICENSE_REQUIRED', message: 'Ücretsiz kullanım hakkınız sona erdi. Yıllık lisansınızı etkinleştirin.' });
        return;
      }

      destroyAdvisorRooms(advisor.id);
      detachSocket(socket);

      const now = Date.now();
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
        creditConsumed: false,
        creditConsumptionPromise: null,
        createdAt: now,
        lastActivityAt: now
      };

      rooms.set(roomID, room);
      socket.join(roomID);
      socket.data.roomID = roomID;
      socket.data.role = 'advisor';

      socket.emit('roomCreated', {
        ...publicRoomState(room),
        advisorToken,
        clientToken,
        advisor: publicAdvisor(advisor)
      });
      emitRoomState(room);
    } catch (error) {
      console.error('[createRoom]', error);
      socket.emit('sessionError', { code: 'SERVER_ERROR', message: 'Oturum oluşturulamadı.' });
    }
  });

  socket.on('joinRoom', async ({ roomID, token } = {}) => {
    try {
      const normalizedRoomID = String(roomID || '').trim().toUpperCase();
      const room = rooms.get(normalizedRoomID);

      if (!room || !token) {
        socket.emit('sessionError', { code: 'ROOM_NOT_FOUND', message: 'Oturum bulunamadı veya bağlantı geçersiz.' });
        return;
      }

      if (Date.now() - room.createdAt >= ROOM_MAX_AGE_MS) {
        destroyRoom(room, 'expired');
        socket.emit('sessionError', { code: 'ROOM_EXPIRED', message: 'Bu kart çalışmasının süresi dolmuş.' });
        return;
      }

      let role = null;
      if (token === room.advisorToken) role = 'advisor';
      if (token === room.clientToken) role = 'client';

      if (!role) {
        socket.emit('sessionError', { code: 'INVALID_TOKEN', message: 'Bu oturum bağlantısı geçersiz.' });
        return;
      }

      if (role === 'client') {
        if (room.clientSocketId && room.clientSocketId !== socket.id) {
          socket.emit('sessionError', { code: 'CLIENT_ALREADY_CONNECTED', message: 'Bu oturuma bir danışan zaten bağlı.' });
          return;
        }

        const updatedAdvisor = await ensureRoomCredit(room);
        if (!updatedAdvisor) {
          socket.emit('sessionError', { code: 'SESSION_UNAVAILABLE', message: 'Bu kart çalışması şu anda kullanıma hazır değil. Danışmanınıza bilgi verin.' });
          return;
        }

        if (room.clientSocketId && room.clientSocketId !== socket.id) {
          socket.emit('sessionError', { code: 'CLIENT_ALREADY_CONNECTED', message: 'Bu oturuma bir danışan zaten bağlı.' });
          return;
        }

        if (room.advisorSocketId) {
          io.to(room.advisorSocketId).emit('advisorAccountUpdated', { advisor: publicAdvisor(updatedAdvisor) });
        }
      }

      detachSocket(socket);
      socket.join(room.id);
      socket.data.roomID = room.id;
      socket.data.role = role;

      if (role === 'advisor') room.advisorSocketId = socket.id;
      if (role === 'client') room.clientSocketId = socket.id;

      touchRoom(room);
      socket.emit('joinedRoom', { ...publicRoomState(room), role });
      emitRoomState(room);
    } catch (error) {
      console.error('[joinRoom]', error);
      socket.emit('sessionError', { code: 'SERVER_ERROR', message: 'Oturuma katılım tamamlanamadı.' });
    }
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
    destroyRoom(session.room, 'closed');
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

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    const tooOld = now - room.createdAt >= ROOM_MAX_AGE_MS;
    const abandoned = !room.advisorSocketId
      && !room.clientSocketId
      && now - room.lastActivityAt >= ROOM_IDLE_CLEANUP_MS;
    if (tooOld || abandoned) destroyRoom(room, 'expired');
  }
}, ROOM_CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

initStorage()
  .then(() => {
    server.listen(PORT, () => console.log(`Persona Card backend listening on port ${PORT}`));
  })
  .catch((error) => {
    console.error('[startup] Storage initialization failed', error);
    process.exit(1);
  });