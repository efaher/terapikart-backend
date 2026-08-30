const crypto = require('crypto');

const hasDatabase = Boolean(process.env.DATABASE_URL);
let pool = null;
const memoryAdvisors = new Map();
const memoryByEmail = new Map();
const memoryLicenseEvents = [];
const memoryAccountTokens = new Map();
const ACCOUNT_TOKEN_PURPOSES = new Set(['email_verification', 'password_reset']);

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
    emailVerified: Boolean(advisor.emailVerifiedAt),
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
    authVersion: Number(row.auth_version || 1),
    plan: row.plan,
    trialSessionsRemaining: row.trial_sessions_remaining,
    licenseUntil: row.license_until ? new Date(row.license_until).toISOString() : null,
    emailVerifiedAt: row.email_verified_at ? new Date(row.email_verified_at).toISOString() : null,
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

function accountTokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function validateAccountTokenPurpose(purpose) {
  if (!ACCOUNT_TOKEN_PURPOSES.has(purpose)) {
    const error = new Error('INVALID_TOKEN_PURPOSE');
    error.code = 'INVALID_TOKEN_PURPOSE';
    throw error;
  }
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
      auth_version INTEGER NOT NULL DEFAULT 1,
      plan TEXT NOT NULL DEFAULT 'trial',
      trial_sessions_remaining INTEGER NOT NULL DEFAULT 3,
      license_until TIMESTAMPTZ NULL,
      email_verified_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE advisors ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 1`);
  await pool.query(`ALTER TABLE advisors ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ NULL`);

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_tokens (
      id UUID PRIMARY KEY,
      advisor_id UUID NOT NULL REFERENCES advisors(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS account_tokens_advisor_purpose_created_idx
      ON account_tokens (advisor_id, purpose, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS account_tokens_hash_idx
      ON account_tokens (token_hash)
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
    authVersion: 1,
    plan: 'trial',
    trialSessionsRemaining: 3,
    licenseUntil: null,
    emailVerifiedAt: null,
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
        (id, email, display_name, password_salt, password_hash, auth_version)
       VALUES ($1, $2, $3, $4, $5, 1)
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
      .slice()
      .reverse()
      .filter((event) => event.advisorId === advisorId)
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

async function createAccountToken(advisorId, purpose, ttlMinutes) {
  validateAccountTokenPurpose(purpose);
  const advisor = await findAdvisorById(advisorId);
  if (!advisor) return null;

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = accountTokenHash(token);
  const expiresAt = new Date(Date.now() + Math.max(1, Number(ttlMinutes) || 60) * 60 * 1000).toISOString();
  const createdAt = new Date().toISOString();

  if (!pool) {
    for (const record of memoryAccountTokens.values()) {
      if (record.advisorId === advisorId && record.purpose === purpose && !record.consumedAt) {
        record.consumedAt = createdAt;
      }
    }
    memoryAccountTokens.set(tokenHash, {
      id: crypto.randomUUID(),
      advisorId,
      purpose,
      tokenHash,
      expiresAt,
      consumedAt: null,
      createdAt
    });
    return { token, expiresAt };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE account_tokens
          SET consumed_at = NOW()
        WHERE advisor_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [advisorId, purpose]
    );
    await client.query(
      `INSERT INTO account_tokens (id, advisor_id, purpose, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [crypto.randomUUID(), advisorId, purpose, tokenHash, expiresAt]
    );
    await client.query('COMMIT');
    return { token, expiresAt };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function validMemoryToken(rawToken, purpose) {
  const tokenHash = accountTokenHash(rawToken);
  const record = memoryAccountTokens.get(tokenHash);
  if (!record || record.purpose !== purpose || record.consumedAt) return null;
  if (new Date(record.expiresAt).getTime() <= Date.now()) return null;
  return record;
}

async function verifyEmailWithToken(rawToken) {
  if (!rawToken) return null;
  const purpose = 'email_verification';

  if (!pool) {
    const record = validMemoryToken(rawToken, purpose);
    if (!record) return null;
    const advisor = memoryAdvisors.get(record.advisorId);
    if (!advisor) return null;
    const now = new Date().toISOString();
    record.consumedAt = now;
    const updated = { ...advisor, emailVerifiedAt: advisor.emailVerifiedAt || now };
    memoryAdvisors.set(updated.id, cloneAdvisor(updated));
    return cloneAdvisor(updated);
  }

  const tokenHash = accountTokenHash(rawToken);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tokenResult = await client.query(
      `SELECT * FROM account_tokens
        WHERE token_hash = $1 AND purpose = $2
          AND consumed_at IS NULL AND expires_at > NOW()
        LIMIT 1 FOR UPDATE`,
      [tokenHash, purpose]
    );
    const record = tokenResult.rows[0];
    if (!record) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query('UPDATE account_tokens SET consumed_at = NOW() WHERE id = $1', [record.id]);
    const advisorResult = await client.query(
      `UPDATE advisors
          SET email_verified_at = COALESCE(email_verified_at, NOW())
        WHERE id = $1
        RETURNING *`,
      [record.advisor_id]
    );
    await client.query('COMMIT');
    return rowToAdvisor(advisorResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function resetPasswordWithToken(rawToken, passwordSalt, passwordHash) {
  if (!rawToken || !passwordSalt || !passwordHash) return null;
  const purpose = 'password_reset';

  if (!pool) {
    const record = validMemoryToken(rawToken, purpose);
    if (!record) return null;
    const advisor = memoryAdvisors.get(record.advisorId);
    if (!advisor) return null;
    record.consumedAt = new Date().toISOString();
    const updated = {
      ...advisor,
      passwordSalt,
      passwordHash,
      authVersion: Number(advisor.authVersion || 1) + 1
    };
    memoryAdvisors.set(updated.id, cloneAdvisor(updated));
    return cloneAdvisor(updated);
  }

  const tokenHash = accountTokenHash(rawToken);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tokenResult = await client.query(
      `SELECT * FROM account_tokens
        WHERE token_hash = $1 AND purpose = $2
          AND consumed_at IS NULL AND expires_at > NOW()
        LIMIT 1 FOR UPDATE`,
      [tokenHash, purpose]
    );
    const record = tokenResult.rows[0];
    if (!record) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query('UPDATE account_tokens SET consumed_at = NOW() WHERE id = $1', [record.id]);
    const advisorResult = await client.query(
      `UPDATE advisors
          SET password_salt = $2,
              password_hash = $3,
              auth_version = auth_version + 1
        WHERE id = $1
        RETURNING *`,
      [record.advisor_id, passwordSalt, passwordHash]
    );
    await client.query('COMMIT');
    return rowToAdvisor(advisorResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
  createAccountToken,
  verifyEmailWithToken,
  resetPasswordWithToken,
  hasActiveLicense,
  hasDatabase
};
