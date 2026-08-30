const nodemailer = require('nodemailer');

const MAIL_PROVIDER = String(process.env.MAIL_PROVIDER || 'auto').trim().toLowerCase();
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || '').trim();
const RESEND_API_URL = 'https://api.resend.com/emails';

const SMTP_HOST = String(process.env.SMTP_HOST || '').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || '').trim().toLowerCase() === 'true';
const SMTP_USER = String(process.env.SMTP_USER || '').trim();
const SMTP_PASS = String(process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '');
const MAIL_FROM = String(process.env.MAIL_FROM || SMTP_USER || '').trim();
const FRONTEND_URL = String(process.env.FRONTEND_URL || '').replace(/\/$/, '');

const RESEND_READY = Boolean(RESEND_API_KEY && MAIL_FROM && FRONTEND_URL);
const SMTP_READY = Boolean(
  SMTP_HOST
  && Number.isFinite(SMTP_PORT)
  && SMTP_PORT > 0
  && SMTP_USER
  && SMTP_PASS
  && MAIL_FROM
  && FRONTEND_URL
);

function mailProvider() {
  if (MAIL_PROVIDER === 'resend' || MAIL_PROVIDER === 'smtp') return MAIL_PROVIDER;
  if (MAIL_PROVIDER !== 'auto') return 'invalid';
  return RESEND_API_KEY ? 'resend' : 'smtp';
}

function mailConfigured() {
  const provider = mailProvider();
  if (provider === 'resend') return RESEND_READY;
  if (provider === 'smtp') return SMTP_READY;
  return false;
}

// Safe startup diagnostic: values and secrets are never printed.
console.info('[mail] configuration', {
  provider: mailProvider(),
  resendApiKey: Boolean(RESEND_API_KEY),
  smtpHost: Boolean(SMTP_HOST),
  smtpPort: Number.isFinite(SMTP_PORT) && SMTP_PORT > 0,
  smtpUser: Boolean(SMTP_USER),
  smtpPassword: Boolean(SMTP_PASS),
  mailFrom: Boolean(MAIL_FROM),
  frontendUrl: Boolean(FRONTEND_URL),
  ready: mailConfigured()
});

function mailNotConfiguredError() {
  const error = new Error('MAIL_NOT_CONFIGURED');
  error.code = 'MAIL_NOT_CONFIGURED';
  return error;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let transporter = null;
function getTransporter() {
  if (!SMTP_READY) throw mailNotConfiguredError();
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      requireTLS: !SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      tls: { minVersion: 'TLSv1.2' },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      disableFileAccess: true,
      disableUrlAccess: true
    });
  }
  return transporter;
}

async function sendViaResend({ to, subject, text, html }) {
  if (!RESEND_READY) throw mailNotConfiguredError();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [to],
        subject,
        text,
        html
      }),
      signal: controller.signal
    });

    let data = {};
    try { data = await response.json(); } catch { data = {}; }

    if (!response.ok) {
      const error = new Error(data.message || `Resend API request failed (${response.status})`);
      error.code = 'RESEND_API_ERROR';
      error.status = response.status;
      if (data.name) error.resendCode = data.name;
      throw error;
    }

    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Resend API timeout');
      timeoutError.code = 'RESEND_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendMessage(message) {
  const provider = mailProvider();
  if (!mailConfigured()) throw mailNotConfiguredError();
  if (provider === 'resend') return sendViaResend(message);
  if (provider === 'smtp') {
    return getTransporter().sendMail({
      from: MAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html
    });
  }
  throw mailNotConfiguredError();
}

function fragmentUrl(key, token) {
  const url = new URL(FRONTEND_URL);
  const params = new URLSearchParams();
  params.set(key, token);
  url.hash = params.toString();
  return url.toString();
}

async function sendEmailVerification({ email, displayName, token }) {
  const link = fragmentUrl('verify-email', token);
  const safeName = escapeHtml(displayName || 'Merhaba');
  await sendMessage({
    to: email,
    subject: 'Persona Card e-posta doğrulama',
    text: `${displayName || 'Merhaba'},\n\nPersona Card hesabınızın e-posta adresini doğrulamak için aşağıdaki bağlantıyı açın:\n${link}\n\nBu bağlantı 24 saat geçerlidir. Bu isteği siz yapmadıysanız mesajı yok sayabilirsiniz.`,
    html: `<p>${safeName},</p><p>Persona Card hesabınızın e-posta adresini doğrulamak için aşağıdaki bağlantıyı açın:</p><p><a href="${escapeHtml(link)}">E-posta adresimi doğrula</a></p><p>Bu bağlantı 24 saat geçerlidir. Bu isteği siz yapmadıysanız mesajı yok sayabilirsiniz.</p>`
  });
}

async function sendPasswordReset({ email, displayName, token }) {
  const link = fragmentUrl('reset-password', token);
  const safeName = escapeHtml(displayName || 'Merhaba');
  await sendMessage({
    to: email,
    subject: 'Persona Card şifre sıfırlama',
    text: `${displayName || 'Merhaba'},\n\nPersona Card şifrenizi sıfırlamak için aşağıdaki bağlantıyı açın:\n${link}\n\nBu bağlantı 60 dakika geçerlidir. Bu isteği siz yapmadıysanız mesajı yok sayabilirsiniz.`,
    html: `<p>${safeName},</p><p>Persona Card şifrenizi sıfırlamak için aşağıdaki bağlantıyı açın:</p><p><a href="${escapeHtml(link)}">Şifremi sıfırla</a></p><p>Bu bağlantı 60 dakika geçerlidir. Bu isteği siz yapmadıysanız mesajı yok sayabilirsiniz.</p>`
  });
}

module.exports = {
  mailConfigured,
  mailProvider,
  sendEmailVerification,
  sendPasswordReset
};
