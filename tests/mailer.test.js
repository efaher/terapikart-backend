const assert = require('assert');

const MAIL_ENV_KEYS = [
  'MAIL_PROVIDER',
  'RESEND_API_KEY',
  'MAIL_FROM',
  'FRONTEND_URL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_PASS'
];

function loadMailer(env, fetchImpl) {
  const modulePath = require.resolve('../mailer');
  const previousEnv = Object.fromEntries(MAIL_ENV_KEYS.map((key) => [key, process.env[key]]));
  const previousFetch = global.fetch;

  MAIL_ENV_KEYS.forEach((key) => delete process.env[key]);
  Object.entries(env).forEach(([key, value]) => {
    if (value !== undefined && value !== null) process.env[key] = String(value);
  });
  if (fetchImpl) global.fetch = fetchImpl;
  delete require.cache[modulePath];
  const mailer = require('../mailer');

  return {
    mailer,
    restore() {
      delete require.cache[modulePath];
      MAIL_ENV_KEYS.forEach((key) => {
        if (previousEnv[key] === undefined) delete process.env[key];
        else process.env[key] = previousEnv[key];
      });
      global.fetch = previousFetch;
    }
  };
}

async function run() {
  let request = null;
  const mockFetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      async json() { return { id: 'email_test_123' }; }
    };
  };

  const configured = loadMailer({
    MAIL_PROVIDER: 'resend',
    RESEND_API_KEY: 're_test_secret',
    MAIL_FROM: 'Persona Card <noreply@efia.net.tr>',
    FRONTEND_URL: 'https://frontend.example'
  }, mockFetch);

  try {
    assert.strictEqual(configured.mailer.mailProvider(), 'resend');
    assert.strictEqual(configured.mailer.mailConfigured(), true);

    await configured.mailer.sendPasswordReset({
      email: 'advisor@example.com',
      displayName: 'Test Danışman',
      token: 'reset-token-123'
    });

    assert.ok(request, 'Resend fetch request should be made');
    assert.strictEqual(request.url, 'https://api.resend.com/emails');
    assert.strictEqual(request.options.method, 'POST');
    assert.strictEqual(request.options.headers.Authorization, 'Bearer re_test_secret');

    const body = JSON.parse(request.options.body);
    assert.strictEqual(body.from, 'Persona Card <noreply@efia.net.tr>');
    assert.deepStrictEqual(body.to, ['advisor@example.com']);
    assert.strictEqual(body.subject, 'Persona Card şifre sıfırlama');
    assert.ok(body.text.includes('#reset-password=reset-token-123'));
    assert.ok(body.html.includes('Şifremi sıfırla'));
  } finally {
    configured.restore();
  }

  const missingKey = loadMailer({
    MAIL_PROVIDER: 'resend',
    MAIL_FROM: 'Persona Card <noreply@efia.net.tr>',
    FRONTEND_URL: 'https://frontend.example',
    SMTP_HOST: 'mail.example.com',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    SMTP_USER: 'noreply@example.com',
    SMTP_PASSWORD: 'smtp-secret'
  });

  try {
    assert.strictEqual(missingKey.mailer.mailProvider(), 'resend');
    assert.strictEqual(missingKey.mailer.mailConfigured(), false, 'explicit resend mode must not silently fall back to SMTP');
  } finally {
    missingKey.restore();
  }

  console.log('Mailer tests passed: Resend HTTPS provider, payload and fail-closed configuration.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
