const nodemailer = require('nodemailer');

const SMTP_HOST = String(process.env.SMTP_HOST || '').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || '').trim().toLowerCase() === 'true';
const SMTP_USER = String(process.env.SMTP_USER || '').trim();
const SMTP_PASS = String(process.env.SMTP_PASS || '');
const MAIL_FROM = String(process.env.MAIL_FROM || SMTP_USER || '').trim();
const FRONTEND_URL = String(process.env.FRONTEND_URL || '').replace(/\/$/, '');

function mailConfigured() {
  return Boolean(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && MAIL_FROM && FRONTEND_URL);
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
  if (!mailConfigured()) {
    const error = new Error('MAIL_NOT_CONFIGURED');
    error.code = 'MAIL_NOT_CONFIGURED';
    throw error;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      requireTLS: !SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      tls: { minVersion: 'TLSv1.2' },
      disableFileAccess: true,
      disableUrlAccess: true
    });
  }
  return transporter;
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
  await getTransporter().sendMail({
    from: MAIL_FROM,
    to: email,
    subject: 'Persona Card e-posta doğrulama',
    text: `${displayName || 'Merhaba'},\n\nPersona Card hesabınızın e-posta adresini doğrulamak için aşağıdaki bağlantıyı açın:\n${link}\n\nBu bağlantı 24 saat geçerlidir. Bu isteği siz yapmadıysanız mesajı yok sayabilirsiniz.`,
    html: `<p>${safeName},</p><p>Persona Card hesabınızın e-posta adresini doğrulamak için aşağıdaki bağlantıyı açın:</p><p><a href="${escapeHtml(link)}">E-posta adresimi doğrula</a></p><p>Bu bağlantı 24 saat geçerlidir. Bu isteği siz yapmadıysanız mesajı yok sayabilirsiniz.</p>`
  });
}

async function sendPasswordReset({ email, displayName, token }) {
  const link = fragmentUrl('reset-password', token);
  const safeName = escapeHtml(displayName || 'Merhaba');
  await getTransporter().sendMail({
    from: MAIL_FROM,
    to: email,
    subject: 'Persona Card şifre sıfırlama',
    text: `${displayName || 'Merhaba'},\n\nPersona Card şifrenizi sıfırlamak için aşağıdaki bağlantıyı açın:\n${link}\n\nBu bağlantı 60 dakika geçerlidir. Bu isteği siz yapmadıysanız mesajı yok sayabilirsiniz.`,
    html: `<p>${safeName},</p><p>Persona Card şifrenizi sıfırlamak için aşağıdaki bağlantıyı açın:</p><p><a href="${escapeHtml(link)}">Şifremi sıfırla</a></p><p>Bu bağlantı 60 dakika geçerlidir. Bu isteği siz yapmadıysanız mesajı yok sayabilirsiniz.</p>`
  });
}

module.exports = {
  mailConfigured,
  sendEmailVerification,
  sendPasswordReset
};
