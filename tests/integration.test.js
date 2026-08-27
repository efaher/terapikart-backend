const assert = require('assert');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = 3210;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ADMIN_SECRET = 'persona-card-test-admin-secret';
const TEST_EMAIL = `pilot-${Date.now()}@example.com`;
const TEST_PASSWORD = 'TestPass123!';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return;
    } catch {}
    await wait(150);
  }
  throw new Error('Backend did not become healthy in time');
}

async function request(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = {};
  try { data = await response.json(); } catch {}
  return { response, data };
}

function onceSocket(socket, eventName, predicate = () => true, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);

    function handler(data) {
      if (!predicate(data)) return;
      cleanup();
      resolve(data);
    }

    function cleanup() {
      clearTimeout(timer);
      socket.off(eventName, handler);
    }

    socket.on(eventName, handler);
  });
}

async function createRoom(socket, authToken, cardSet = 'personita') {
  const created = onceSocket(socket, 'roomCreated');
  socket.emit('createRoom', { cardSet, authToken });
  return created;
}

async function closeRoom(socket) {
  const closed = onceSocket(socket, 'roomClosed', (data) => data?.reason === 'closed');
  socket.emit('closeRoom');
  await closed;
}

async function connectClient(room, sockets) {
  const clientSocket = io(BASE_URL, { transports: ['websocket'], forceNew: true });
  sockets.push(clientSocket);
  await onceSocket(clientSocket, 'connect');
  const joined = onceSocket(clientSocket, 'joinedRoom', (data) => data?.role === 'client');
  clientSocket.emit('joinRoom', { roomID: room.roomID, token: room.clientToken });
  await joined;
  return clientSocket;
}

async function run() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      AUTH_SECRET: 'persona-card-test-auth-secret-that-is-long-enough',
      ADMIN_LICENSE_SECRET: ADMIN_SECRET,
      ALLOWED_ORIGINS: 'http://127.0.0.1:3210',
      DATABASE_URL: '',
      ROOM_MAX_AGE_MS: String(6 * 60 * 60 * 1000),
      ROOM_IDLE_CLEANUP_MS: String(30 * 60 * 1000),
      ROOM_CLEANUP_INTERVAL_MS: String(15 * 60 * 1000)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let childOutput = '';
  child.stdout.on('data', (chunk) => { childOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { childOutput += chunk.toString(); });

  const sockets = [];
  try {
    await waitForHealth();

    let result = await request('/api/auth/register', {
      method: 'POST',
      body: { displayName: 'Pilot Danışman', email: TEST_EMAIL, password: TEST_PASSWORD }
    });
    assert.strictEqual(result.response.status, 201);
    assert.strictEqual(result.data.advisor.trialSessionsRemaining, 3);
    const authToken = result.data.token;
    assert.ok(authToken);

    result = await request('/api/auth/login', {
      method: 'POST',
      body: { email: TEST_EMAIL, password: 'wrong-password' }
    });
    assert.strictEqual(result.response.status, 401);

    result = await request('/api/auth/login', {
      method: 'POST',
      body: { email: TEST_EMAIL, password: TEST_PASSWORD }
    });
    assert.strictEqual(result.response.status, 200);
    assert.ok(result.data.token);

    result = await request('/api/me', { token: authToken });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.data.advisor.trialSessionsRemaining, 3);
    assert.strictEqual(result.data.canCreateSession, true);

    const advisorSocket = io(BASE_URL, { transports: ['websocket'], forceNew: true });
    sockets.push(advisorSocket);
    await onceSocket(advisorSocket, 'connect');

    // Opening and closing an unused room must not spend a trial session.
    let room = await createRoom(advisorSocket, authToken);
    assert.strictEqual(room.advisor.trialSessionsRemaining, 3);
    await closeRoom(advisorSocket);
    result = await request('/api/me', { token: authToken });
    assert.strictEqual(result.data.advisor.trialSessionsRemaining, 3);

    // Creating a new room replaces the advisor's previous unused room.
    const firstUnusedRoom = await createRoom(advisorSocket, authToken);
    const replaced = onceSocket(advisorSocket, 'roomClosed', (data) => data?.roomID === firstUnusedRoom.roomID && data?.reason === 'replaced');
    const secondUnusedRoomPromise = onceSocket(advisorSocket, 'roomCreated');
    advisorSocket.emit('createRoom', { cardSet: 'personita', authToken });
    assert.strictEqual((await replaced).reason, 'replaced');
    const secondUnusedRoom = await secondUnusedRoomPromise;
    assert.notStrictEqual(secondUnusedRoom.roomID, firstUnusedRoom.roomID);
    await closeRoom(advisorSocket);

    // A trial session is spent only when a client actually joins.
    for (const expectedRemaining of [2, 1, 0]) {
      room = await createRoom(advisorSocket, authToken);
      assert.strictEqual(room.advisor.trialSessionsRemaining, expectedRemaining + 1);
      const accountUpdated = onceSocket(
        advisorSocket,
        'advisorAccountUpdated',
        (data) => data?.advisor?.trialSessionsRemaining === expectedRemaining
      );
      const clientSocket = await connectClient(room, sockets);
      const updated = await accountUpdated;
      assert.strictEqual(updated.advisor.trialSessionsRemaining, expectedRemaining);
      await closeRoom(advisorSocket);
      clientSocket.disconnect();
    }

    const quotaError = onceSocket(advisorSocket, 'sessionError', (data) => data?.code === 'LICENSE_REQUIRED');
    advisorSocket.emit('createRoom', { cardSet: 'personita', authToken });
    assert.strictEqual((await quotaError).code, 'LICENSE_REQUIRED');

    result = await request('/api/me', { token: authToken });
    assert.strictEqual(result.data.advisor.trialSessionsRemaining, 0);
    assert.strictEqual(result.data.canCreateSession, false);

    result = await request('/api/admin/licenses/annual', {
      method: 'POST',
      token: 'wrong-admin-secret',
      body: { email: TEST_EMAIL }
    });
    assert.strictEqual(result.response.status, 401);

    result = await request('/api/admin/licenses/annual', {
      method: 'POST',
      token: ADMIN_SECRET,
      body: { email: TEST_EMAIL }
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.data.advisor.plan, 'annual');
    assert.ok(result.data.advisor.licenseUntil);
    const firstLicenseUntil = new Date(result.data.advisor.licenseUntil).getTime();

    result = await request('/api/me', { token: authToken });
    assert.strictEqual(result.data.canCreateSession, true);
    assert.strictEqual(result.data.advisor.plan, 'annual');

    room = await createRoom(advisorSocket, authToken, 'terapi_sb');
    assert.strictEqual(room.cardSet, 'terapi_sb');

    const clientSocket = await connectClient(room, sockets);

    const advisorSeesSelection = onceSocket(
      advisorSocket,
      'roomState',
      (data) => data?.roomID === room.roomID && data.selectedCards?.some((item) => item.cardId === '7')
    );
    clientSocket.emit('selectCard', { cardId: '7' });
    const selectedState = await advisorSeesSelection;
    assert.strictEqual(selectedState.selectedCards[0].cardId, '7');
    assert.strictEqual(selectedState.selectedCards[0].order, 1);

    const advisorRoleError = onceSocket(advisorSocket, 'sessionError', (data) => data?.code === 'NOT_ALLOWED');
    advisorSocket.emit('selectCard', { cardId: '8' });
    assert.strictEqual((await advisorRoleError).code, 'NOT_ALLOWED');

    const clientRoleError = onceSocket(clientSocket, 'sessionError', (data) => data?.code === 'NOT_ALLOWED');
    clientSocket.emit('resetRoomCards');
    assert.strictEqual((await clientRoleError).code, 'NOT_ALLOWED');

    const advisorSeesDeselection = onceSocket(
      advisorSocket,
      'roomState',
      (data) => data?.roomID === room.roomID && Array.isArray(data.selectedCards) && data.selectedCards.length === 0
    );
    clientSocket.emit('deselectCard', { cardId: '7' });
    await advisorSeesDeselection;

    await closeRoom(advisorSocket);

    result = await request('/api/admin/licenses/annual', {
      method: 'POST',
      token: ADMIN_SECRET,
      body: { email: TEST_EMAIL }
    });
    assert.strictEqual(result.response.status, 200);
    const renewedUntil = new Date(result.data.advisor.licenseUntil).getTime();
    const extensionDays = (renewedUntil - firstLicenseUntil) / (24 * 60 * 60 * 1000);
    assert.ok(extensionDays >= 364 && extensionDays <= 366, `Expected ~365 day extension, got ${extensionDays}`);

    console.log('Integration test passed: auth, fair trial usage, annual license, realtime selection and role enforcement.');
  } catch (error) {
    console.error(childOutput);
    throw error;
  } finally {
    for (const socket of sockets) socket.disconnect();
    child.kill('SIGTERM');
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
