const assert = require('assert');
const {
  hashPassword,
  verifyPassword,
  createAuthToken,
  verifyAuthToken
} = require('../auth');
const {
  createAdvisor,
  findAdvisorById,
  publicAdvisor,
  createAccountToken,
  verifyEmailWithToken,
  resetPasswordWithToken
} = require('../storage');

async function run() {
  const email = `account-security-${Date.now()}@example.com`;
  const oldPassword = 'OldPass123!';
  const newPassword = 'NewPass456!';
  const oldCredentials = hashPassword(oldPassword);

  let advisor = await createAdvisor({
    email,
    displayName: 'Account Security Test',
    passwordSalt: oldCredentials.salt,
    passwordHash: oldCredentials.hash
  });

  assert.strictEqual(advisor.authVersion, 1);
  assert.strictEqual(publicAdvisor(advisor).emailVerified, false);
  const oldAuthToken = createAuthToken(advisor);
  const oldPayload = verifyAuthToken(oldAuthToken);
  assert.strictEqual(oldPayload.ver, 1);

  const verification = await createAccountToken(advisor.id, 'email_verification', 60);
  assert.ok(verification.token);
  assert.ok(new Date(verification.expiresAt).getTime() > Date.now());

  advisor = await verifyEmailWithToken(verification.token);
  assert.ok(advisor.emailVerifiedAt);
  assert.strictEqual(publicAdvisor(advisor).emailVerified, true);
  assert.strictEqual(await verifyEmailWithToken(verification.token), null, 'verification token must be one-time');
  assert.strictEqual(await verifyEmailWithToken('invalid-token'), null);

  const reset = await createAccountToken(advisor.id, 'password_reset', 60);
  const newCredentials = hashPassword(newPassword);
  advisor = await resetPasswordWithToken(reset.token, newCredentials.salt, newCredentials.hash);
  assert.strictEqual(advisor.authVersion, 2);
  assert.strictEqual(verifyPassword(newPassword, advisor.passwordSalt, advisor.passwordHash), true);
  assert.strictEqual(verifyPassword(oldPassword, advisor.passwordSalt, advisor.passwordHash), false);
  assert.strictEqual(await resetPasswordWithToken(reset.token, newCredentials.salt, newCredentials.hash), null, 'reset token must be one-time');

  const persisted = await findAdvisorById(advisor.id);
  assert.strictEqual(persisted.authVersion, 2);
  assert.ok(persisted.emailVerifiedAt);
  assert.notStrictEqual(oldPayload.ver, persisted.authVersion, 'old auth token version must no longer match account');

  const newPayload = verifyAuthToken(createAuthToken(persisted));
  assert.strictEqual(newPayload.ver, 2);

  console.log('Account security tests passed: email verification, one-time reset and auth version rotation.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
