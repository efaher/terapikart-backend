const assert = require('assert');
const { createRateLimiter, requestIp, normalizeKeyPart } = require('../rate-limit');

function createResponse() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    payload: null,
    setHeader(name, value) { headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

function invoke(limiter, req) {
  const res = createResponse();
  let nextCalled = false;
  limiter(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

const limiter = createRateLimiter({
  windowMs: 60_000,
  max: 2,
  key: (req) => `${requestIp(req)}:${normalizeKeyPart(req.body?.email)}`
});

const req = {
  headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
  body: { email: 'User@Example.com' }
};

let result = invoke(limiter, req);
assert.strictEqual(result.nextCalled, true);
assert.strictEqual(result.res.statusCode, 200);
assert.strictEqual(result.res.headers['X-RateLimit-Remaining'], '1');

result = invoke(limiter, req);
assert.strictEqual(result.nextCalled, true);
assert.strictEqual(result.res.headers['X-RateLimit-Remaining'], '0');

result = invoke(limiter, req);
assert.strictEqual(result.nextCalled, false);
assert.strictEqual(result.res.statusCode, 429);
assert.strictEqual(result.res.payload.code, 'RATE_LIMITED');
assert.ok(Number(result.res.headers['Retry-After']) >= 1);

const otherAccount = invoke(limiter, {
  headers: req.headers,
  body: { email: 'other@example.com' }
});
assert.strictEqual(otherAccount.nextCalled, true);

assert.strictEqual(requestIp(req), '203.0.113.10');
assert.strictEqual(normalizeKeyPart('  USER@EXAMPLE.COM  '), 'user@example.com');

console.log('Rate limit tests passed.');
