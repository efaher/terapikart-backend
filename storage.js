const crypto = require('crypto');

const hasDatabase = Boolean(process.env.DATABASE_URL);
let pool = null;
const memoryAdvisors = new Map();
const memoryByEmail = new Map();
const memoryLicenseEvents = [];

if (hasDatabase) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
  });
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function cloneAdvisor(advisor) {
  return advisor ? { ...advisor } : null;
}

function cloneLicenseEvent(event) {
  return event ? { ...event } : null;
}

function publicAdvisor(advisor) {
  if (!advisor) return null;
  return {
    id: advisor.id,
    email: advisor.email,
    displayName: advisor.displayName,
    plan: advisor.plan,
    trialSessionsRemaining: advisor.trialSessionsRemaining,
    licenseUntil: advisor.licenseUntil || null,
    createdAt: advisor.createdAt
  };
}

function rowToAdvisor(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordSalt: row.password_salt,
    passwordHash: row.password_hash,
    plan: row.plan,
    trialSessionsRemaining: row.trial_sessions_remaining,
    licenseUntil: row.license_until ? new Date(row.license_until).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString()
  };
}

function rowToLicenseEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    advisorId: row.advisor_id,
    eventType: row.event_type,
    source: row.source,
    previousLicenseUntil: row.previous_license_until ? new Date(row.previous_license_until).toISOString() : null,
    newLicenseUntil: row.new_license_until ? new Date(row.new_license_until).toISOString() : null,
    reference: row.reference || null,
    createdAt: new Date(row.created_at).toISOString()
  };
}

async function initStorage() {
  if (!pool) {
    console.warn('[storage] DATABASE_URL is not configured. Advisor accounts are temporary and reset on restart.');
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS advisors (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'trial',
      trial_sessions_remaining INTEGER NOT NULL DEFAULT 3,
      license_until TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS license_events (
      id UUID PRIMARY KEY,
      advisor_id UUID NOT NULL REFERENCES advisors(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      source TEXT NOT NULL,
      previous_license_until TIMESTAMPTZ NULL,
      new_license_until TIMESTAMPTZ NOT NULL,
      reference TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS license_events_advisor_created_idx
      ON license_events (advisor_id, created_at DESC)
  `);
}

async function createAdvisor({ email, displayName, passwordSalt, passwordHash }) {
  const normalizedEmail = normalizeEmail(email);
  const id = crypto.randomUUID();
  const advisor = {
    id,
    email: normalizedEmail,
    displayName: String(displayName || '').trim(),
    passwordSalt,
    passwordHash,
    plan: 'trial',
    trialSessionsRemaining: 3,
    licenseUntil: null,
    createdAt: new Date().toISOString()
  };

  if (!pool) {
    if (memoryByEmail.has(normalizedEmail)) {
      const error = new Error('EMAIL_EXISTS');
      error.code = 'EMAIL_EXISTS';
      throw error;
    }
    memoryAdvisors.set(id, cloneAdvisor(advisor));
    memoryByEmail.set(normalizedEmail, id);
    return cloneAdvisor(advisor);
  }

  try {
    const result = await pool.query(
      `INSERT INTO advisors
        (id, email, display_name, password_salt, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, normalizedEmail, advisor.displayName, passwordSalt, passwordHash]
    );
    return rowToAdvisor(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      const duplicate = new Error('EMAIL_EXISTS');
      duplicate.code = 'EMAIL_EXISTS';
      throw duplicate;
    }
    throw error;
  }
}

async function findAdvisorByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!pool) {
    const id = memoryByEmail.get(normalizedEmail);
    return id ? cloneAdvisor(memoryAdvisors.get(id)) : null;
  }
  const result = await pool.query('SELECT * FROM advisors WHERE email = $1 LIMIT 1', [normalizedEmail]);
  return rowToAdvisor(result.rows[0]);
}

async function findAdvisorById(id) {
  if (!id) return null;
  if (!pool) return cloneAdvisor(memoryAdvisors.get(id));
  const result = await pool.query('SELECT * FROM advisors WHERE id = $1 LIMIT 1', [id]);
  return rowToAdvisor(result.rows[0]);
}

function hasActiveLicense(advisor) {
  if (!advisor || advisor.plan !== 'annual' || !advisor.licenseUntil) return false;
  return new Date(advisor.licenseUntil).getTime() > Date.now();
}

function canCreateSession(advisor) {
  return hasActiveLicense(advisor) || Number(advisor?.trialSessionsRemaining || 0) > 0;
}

async function consumeSessionCredit(advisorId) {
  const advisor = await findAdvisorById(advisorId);
  if (!advisor) return null;
  if (hasActiveLicense(advisor)) return advisor;
  if (advisor.trialSessionsRemaining <= 0) return null;

  if (!pool) {
    const updated = { ...advisor, trialSessionsRemaining: advisor.trialSessionsRemaining - 1 };
    memoryAdvisors.set(updated.id, cloneAdvisor(updated));
    return cloneAdvisor(updated);
  }

  const result = await pool.query(
    `UPDATE advisors
       SET trial_sessions_remaining = trial_sessions_remaining - 1
     WHERE id = $1 AND trial_sessions_remaining > 0
     RETURNING *`,
    [advisorId]
  );
  return rowToAdvisor(result.rows[0]);
}

function nextAnnualExpiry(currentExpiry) {
  const now = Date.now();
  const existing = currentExpiry ? new Date(currentExpiry).getTime() : 0;
  const base = Number.isFinite(existing) && existing > now ? existing : now;
  const expiry = new Date(base);
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
  return expiry.toISOString();
}

async function activateAnnualLicense(advisorId, { source = 'admin', reference = null } = {}) {
  const advisor = await findAdvisorById(advisorId);
  if (!advisor) return null;

  const previousLicenseUntil = advisor.licenseUntil || null;
  const newLicenseUntil = nextAnnualExpiry(previousLicenseUntil);
  const updated = {
    ...advisor,
    plan: 'annual',
    licenseUntil: newLicenseUntil
  };

  if (!pool) {
    memoryAdvisors.set(updated.id, cloneAdvisor(updated));
    memoryLicenseEvents.push({
      id: crypto.randomUUID(),
      advisorId,
      eventType: 'annual_activated',
      source,
      previousLicenseUntil,
      newLicenseUntil,
      reference: reference || null,
      createdAt: new Date().toISOString()
    });
    return cloneAdvisor(updated);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updateResult = await client.query(
      `UPDATE advisors
         SET plan = 'annual', license_until = $2
       WHERE id = $1
       RETURNING *`,
      [advisorId, newLicenseUntil]
    );

    if (!updateResult.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query(
      `INSERT INTO license_events
        (id, advisor_id, event_type, source, previous_license_until, new_license_until, reference)
       VALUES ($1, $2, 'annual_activated', $3, $4, $5, $6)`,
      [crypto.randomUUID(), advisorId, String(source || 'admin'), previousLicenseUntil, newLicenseUntil, reference || null]
    );
    await client.query('COMMIT');
    return rowToAdvisor(updateResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listLicenseEvents(advisorId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  if (!pool) {
    return memoryLicenseEvents
      .filter((event) => event.advisorId === advisorId)
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, safeLimit)
      .map(cloneLicenseEvent);
  }

  const result = await pool.query(
    `SELECT * FROM license_events
      WHERE advisor_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [advisorId, safeLimit]
  );
  return result.rows.map(rowToLicenseEvent);
}

module.exports = {
  initStorage,
  createAdvisor,
  findAdvisorByEmail,
  findAdvisorById,
  publicAdvisor,
  canCreateSession,
  consumeSessionCredit,
  activateAnnualLicense,
  listLicenseEvents,
  hasActiveLicense,
  hasDatabase
};
