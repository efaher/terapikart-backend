const assert = require('assert');
const {
  createOfflineEntitlement,
  verifyOfflineEntitlement,
  publicKeySpki
} = require('../offline-entitlement');

const NOW = Date.UTC(2026, 7, 29, 12, 0, 0);
const advisor = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'advisor@example.com',
  plan: 'annual',
  licenseUntil: new Date(NOW + 365 * 24 * 60 * 60 * 1000).toISOString()
};

const signed = createOfflineEntitlement(advisor, { now: NOW, ttlSeconds: 30 * 24 * 60 * 60 });
assert.ok(signed);
assert.ok(signed.entitlement.includes('.'));
assert.ok(publicKeySpki.length > 20);
assert.strictEqual(signed.publicKeySpki, publicKeySpki);

const verified = verifyOfflineEntitlement(signed.entitlement, { now: NOW + 1000 });
assert.ok(verified);
assert.strictEqual(verified.sub, advisor.id);
assert.strictEqual(verified.email, advisor.email);
assert.ok(verified.exp > Math.floor(NOW / 1000));
assert.ok(verified.exp <= verified.licenseUntil);

const tamperedParts = signed.entitlement.split('.');
const tamperedPayload = Buffer.from(JSON.stringify({ ...verified, exp: verified.exp + 999999 }), 'utf8').toString('base64url');
assert.strictEqual(verifyOfflineEntitlement(`${tamperedPayload}.${tamperedParts[1]}`, { now: NOW }), null);

assert.strictEqual(
  verifyOfflineEntitlement(signed.entitlement, { now: (verified.exp + 1) * 1000 }),
  null
);

assert.strictEqual(createOfflineEntitlement({ ...advisor, plan: 'trial' }, { now: NOW }), null);
assert.strictEqual(createOfflineEntitlement({ ...advisor, licenseUntil: new Date(NOW - 1000).toISOString() }, { now: NOW }), null);

const shortLicense = createOfflineEntitlement({
  ...advisor,
  licenseUntil: new Date(NOW + 2 * 24 * 60 * 60 * 1000).toISOString()
}, { now: NOW, ttlSeconds: 30 * 24 * 60 * 60 });
const shortVerified = verifyOfflineEntitlement(shortLicense.entitlement, { now: NOW });
assert.ok(shortVerified.exp <= shortVerified.licenseUntil);

console.log('Offline entitlement tests passed.');
