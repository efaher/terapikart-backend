const assert = require('assert');
const {
  createAdvisor,
  canCreateSession,
  consumeSessionCredit,
  activateAnnualLicense,
  listLicenseEvents
} = require('../storage');

async function run() {
  const email = `test-${Date.now()}@example.com`;
  const advisor = await createAdvisor({
    email,
    displayName: 'Test Danışman',
    passwordSalt: 'salt',
    passwordHash: 'hash'
  });

  assert.strictEqual(advisor.plan, 'trial');
  assert.strictEqual(advisor.trialSessionsRemaining, 3);
  assert.strictEqual(canCreateSession(advisor), true);

  const afterOne = await consumeSessionCredit(advisor.id);
  const afterTwo = await consumeSessionCredit(advisor.id);
  const afterThree = await consumeSessionCredit(advisor.id);
  const afterFour = await consumeSessionCredit(advisor.id);

  assert.strictEqual(afterOne.trialSessionsRemaining, 2);
  assert.strictEqual(afterTwo.trialSessionsRemaining, 1);
  assert.strictEqual(afterThree.trialSessionsRemaining, 0);
  assert.strictEqual(afterFour, null);

  const licensed = await activateAnnualLicense(advisor.id, { source: 'test-first', reference: 'TEST-ORDER-1' });
  assert.strictEqual(licensed.plan, 'annual');
  assert.ok(new Date(licensed.licenseUntil).getTime() > Date.now());
  assert.strictEqual(canCreateSession(licensed), true);

  const firstExpiry = new Date(licensed.licenseUntil).getTime();
  const renewed = await activateAnnualLicense(advisor.id, { source: 'test-renewal', reference: 'TEST-ORDER-2' });
  const renewedExpiry = new Date(renewed.licenseUntil).getTime();
  assert.ok(renewedExpiry > firstExpiry);

  const history = await listLicenseEvents(advisor.id);
  assert.strictEqual(history.length, 2);
  assert.strictEqual(history[0].source, 'test-renewal');
  assert.strictEqual(history[0].reference, 'TEST-ORDER-2');
  assert.strictEqual(history[1].source, 'test-first');
  assert.strictEqual(history[1].reference, 'TEST-ORDER-1');
  assert.strictEqual(history[1].previousLicenseUntil, null);
  assert.strictEqual(history[1].newLicenseUntil, licensed.licenseUntil);

  console.log('annual license and audit history tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
