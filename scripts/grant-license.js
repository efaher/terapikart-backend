const email = String(process.argv[2] || '').trim().toLowerCase();
const apiUrl = String(process.env.PERSONA_API_URL || '').replace(/\/$/, '');
const adminSecret = String(process.env.ADMIN_LICENSE_SECRET || '');

if (!email || !email.includes('@')) {
  console.error('Kullanım: npm run license:grant -- kullanici@example.com');
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
  const response = await fetch(`${apiUrl}/api/admin/licenses/annual`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminSecret}`
    },
    body: JSON.stringify({ email })
  });

  let data = {};
  try { data = await response.json(); } catch {}

  if (!response.ok) {
    console.error(`Lisans verilemedi (${response.status}): ${data.message || 'Bilinmeyen hata'}`);
    process.exit(1);
  }

  const advisor = data.advisor || {};
  console.log('Yıllık lisans etkinleştirildi.');
  console.log(`Danışman: ${advisor.displayName || '-'} <${advisor.email || email}>`);
  console.log(`Plan: ${advisor.plan || '-'}`);
  console.log(`Geçerlilik: ${advisor.licenseUntil ? new Date(advisor.licenseUntil).toLocaleString('tr-TR') : '-'}`);
}

run().catch((error) => {
  console.error('Lisans işlemi sırasında bağlantı hatası:', error.message);
  process.exit(1);
});
