const email = String(process.argv[2] || '').trim().toLowerCase();
const apiUrl = String(process.env.PERSONA_API_URL || '').replace(/\/$/, '');
const adminSecret = String(process.env.ADMIN_LICENSE_SECRET || '');
const requestedLimit = Number(process.argv[3] || 20);
const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.floor(requestedLimit), 100)) : 20;

if (!email || !email.includes('@')) {
  console.error('Kullanım: npm run license:events -- kullanici@example.com [limit]');
  process.exit(1);
}

if (!apiUrl) {
  console.error('PERSONA_API_URL ortam değişkeni tanımlı değil.');
  process.exit(1);
}

if (!adminSecret) {
  console.error('ADMIN_LICENSE_SECRET ortam değişkeni tanımlı değil.');
  process.exit(1);
}

async function run() {
  const url = new URL(`${apiUrl}/api/admin/licenses/events`);
  url.searchParams.set('email', email);
  url.searchParams.set('limit', String(limit));

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${adminSecret}` }
  });

  let data = {};
  try { data = await response.json(); } catch {}

  if (!response.ok) {
    console.error(`Lisans hareketleri alınamadı (${response.status}): ${data.message || 'Bilinmeyen hata'}`);
    process.exit(1);
  }

  const advisor = data.advisor || {};
  console.log(`Danışman: ${advisor.displayName || '-'} <${advisor.email || email}>`);
  console.log(`Plan: ${advisor.plan || '-'}`);
  console.log(`Lisans bitişi: ${advisor.licenseUntil ? new Date(advisor.licenseUntil).toLocaleString('tr-TR') : '-'}`);
  console.log('');

  const events = Array.isArray(data.events) ? data.events : [];
  if (!events.length) {
    console.log('Lisans hareketi bulunamadı.');
    return;
  }

  events.forEach((event, index) => {
    console.log(`${index + 1}. ${event.eventType || '-'} | ${event.createdAt ? new Date(event.createdAt).toLocaleString('tr-TR') : '-'}`);
    console.log(`   Önceki bitiş: ${event.previousLicenseUntil ? new Date(event.previousLicenseUntil).toLocaleString('tr-TR') : '-'}`);
    console.log(`   Yeni bitiş: ${event.newLicenseUntil ? new Date(event.newLicenseUntil).toLocaleString('tr-TR') : '-'}`);
    console.log(`   Kaynak: ${event.source || '-'}${event.reference ? ` | Ref: ${event.reference}` : ''}`);
  });
}

run().catch((error) => {
  console.error('Lisans hareketleri sorgulanırken bağlantı hatası:', error.message);
  process.exit(1);
});
