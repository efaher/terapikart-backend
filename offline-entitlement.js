const crypto = require('crypto');

const DEFAULT_OFFLINE_TTL_SECONDS = 30 * 24 * 60 * 60;
const secretMaterial = String(
  process.env.OFFLINE_ENTITLEMENT_SECRET
  || process.env.AUTH_SECRET
  || crypto.randomBytes(32).toString('hex')
);

if (!process.env.OFFLINE_ENTITLEMENT_SECRET && !process.env.AUTH_SECRET) {
  console.warn('[offline-entitlement] No stable signing secret configured. Offline entitlements will be invalid after restart.');
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function derivePrivateKey() {
  const seed = crypto.createHash('sha256').update(`persona-card-offline-v1:${secretMaterial}`).digest();
  const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  return crypto.createPrivateKey({
    key: Buffer.concat([pkcs8Prefix, seed]),
    format: 'der',
    type: 'pkcs8'
  });
}

const privateKey = derivePrivateKey();
const publicKey = crypto.createPublicKey(privateKey);
const publicKeySpki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

function positiveSeconds(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function createOfflineEntitlement(advisor, { now = Date.now(), ttlSeconds } = {}) {
  if (!advisor || advisor.plan !== 'annual' || !advisor.licenseUntil) return null;

  const licenseUntilMs = new Date(advisor.licenseUntil).getTime();
  if (!Number.isFinite(licenseUntilMs) || licenseUntilMs <= now) return null;

  const issuedAt = Math.floor(now / 1000);
  const requestedTtl = positiveSeconds(
    ttlSeconds ?? process.env.OFFLINE_ENTITLEMENT_TTL_SECONDS,
    DEFAULT_OFFLINE_TTL_SECONDS
  );
  const offlineUntil = Math.min(
    Math.floor(licenseUntilMs / 1000),
    issuedAt + requestedTtl
  );

  const payload = base64urlJson({
    v: 1,
    sub: advisor.id,
    email: advisor.email,
    licenseUntil: Math.floor(licenseUntilMs / 1000),
    iat: issuedAt,
    exp: offlineUntil
  });
  const signature = crypto.sign(null, Buffer.from(payload), privateKey).toString('base64url');

  return {
    entitlement: `${payload}.${signature}`,
    publicKeySpki,
    offlineUntil: new Date(offlineUntil * 1000).toISOString()
  };
}

function verifyOfflineEntitlement(token, { now = Date.now() } = {}) {
  if (!token || typeof token !== 'string') return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;

  let valid = false;
  try {
    valid = crypto.verify(
      null,
      Buffer.from(payload),
      publicKey,
      Buffer.from(signature, 'base64url')
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const nowSeconds = Math.floor(now / 1000);
    if (data.v !== 1 || !data.sub || !data.exp || !data.licenseUntil) return null;
    if (data.exp <= nowSeconds || data.licenseUntil <= nowSeconds) return null;
    if (data.exp > data.licenseUntil) return null;
    return data;
  } catch {
    return null;
  }
}

module.exports = {
  createOfflineEntitlement,
  verifyOfflineEntitlement,
  publicKeySpki,
  DEFAULT_OFFLINE_TTL_SECONDS
};
