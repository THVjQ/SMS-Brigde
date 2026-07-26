// db/accounts.js — tenancy primitives: accounts, their API keys, and the legacy upgrade path.
//
// An account owns one or more phones and one or more desktops. One person with three PCs and a
// phone is a single account holding four credentials; a second person is a separate account, and
// nothing crosses that boundary — not messages, not devices, not history, not stats.
//
// Only the SHA-256 of each key is stored. A database leak should not hand over working credentials:
// the key is a bearer token with full access to a person's message history.

const crypto  = require('node:crypto');
const db      = require('./database');
const migrate = require('./migrate');

db.exec(`CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  default_device_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.exec(`CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  key_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  device_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used DATETIME,
  revoked INTEGER DEFAULT 0
)`);
migrate.addColumn('api_keys', 'device_id', 'TEXT');
db.exec(`CREATE INDEX IF NOT EXISTS idx_api_keys_account ON api_keys(account_id, revoked)`);

const LEGACY_ACCOUNT_NAME = 'Default';

/** The account every pre-tenancy row belongs to. Created once, on first boot after the upgrade. */
function legacyAccountId() {
  const row = db.prepare('SELECT id FROM accounts ORDER BY id ASC LIMIT 1').get();
  if (row) return row.id;
  return db.prepare('INSERT INTO accounts (name) VALUES (?)').run(LEGACY_ACCOUNT_NAME).lastInsertRowid;
}

const hashKey = key => crypto.createHash('sha256').update(String(key), 'utf8').digest('hex');

/** Constant-time compare for the legacy env key, which is checked as a raw string. */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function findByKey(key) {
  return db.prepare('SELECT id, account_id FROM api_keys WHERE key_hash=? AND revoked=0').get(hashKey(key)) || null;
}

const touchKey = keyId => db.prepare("UPDATE api_keys SET last_used=CURRENT_TIMESTAMP WHERE id=?").run(keyId);

// ── Administration ───────────────────────────────────────────────────────────

function createAccount(name) {
  if (!name) throw new Error('account name required');
  const id = db.prepare('INSERT INTO accounts (name) VALUES (?)').run(name).lastInsertRowid;
  return { id, name };
}

function listAccounts() {
  return db.prepare(`SELECT a.id, a.name, a.default_device_id, a.created_at,
                            (SELECT COUNT(*) FROM api_keys k WHERE k.account_id=a.id AND k.revoked=0) AS active_keys,
                            (SELECT COUNT(*) FROM paired_devices d WHERE d.account_id=a.id) AS devices
                     FROM accounts a ORDER BY a.id`).all();
}

const getAccount = id => db.prepare('SELECT * FROM accounts WHERE id=?').get(id) || null;

/**
 * Mints a key for an account. The plaintext is returned exactly once and never stored — there is
 * no recovery path, only revoke-and-reissue.
 */
function mintKey(accountId, label, deviceId = null) {
  if (!getAccount(accountId)) throw new Error(`no such account: ${accountId}`);
  const key = crypto.randomBytes(32).toString('hex');
  const id  = db.prepare('INSERT INTO api_keys (account_id, key_hash, label, device_id) VALUES (?,?,?,?)')
                .run(accountId, hashKey(key), label || null, deviceId).lastInsertRowid;
  return { id, key, account_id: accountId, label: label || null, device_id: deviceId };
}

/**
 * A key belonging to one phone, replacing any it held before. Pairing is what establishes which
 * account a phone is in, so the phone must leave with a credential for *that* account — handing
 * back a server-wide key would let a phone paired into one account read another's queue. Re-pairing
 * revokes the previous key, so a phone that was wiped or handed on cannot keep polling.
 */
function mintDeviceKey(accountId, deviceId, label) {
  db.prepare('UPDATE api_keys SET revoked=1 WHERE account_id=? AND device_id=? AND revoked=0').run(accountId, deviceId);
  return mintKey(accountId, label || `Phone ${String(deviceId).slice(0, 8)}`, deviceId);
}

const listKeys = accountId =>
  db.prepare('SELECT id, label, device_id, created_at, last_used, revoked FROM api_keys WHERE account_id=? ORDER BY id').all(accountId);

const revokeKey = keyId => db.prepare('UPDATE api_keys SET revoked=1 WHERE id=?').run(keyId).changes > 0;

// ── Migration ────────────────────────────────────────────────────────────────

/**
 * Adds account_id everywhere and files every existing row under the legacy account, so an upgrade
 * does not orphan a working shop. Idempotent: the column guards are structural, the backfill runs
 * once via schema_migrations.
 */
function migrateToTenancy(tables) {
  for (const table of tables) migrate.addColumn(table, 'account_id', 'INTEGER');

  migrate.once('stage2-backfill-account-id', () => {
    const id = legacyAccountId();
    for (const table of tables) {
      const r = db.prepare(`UPDATE ${table} SET account_id=? WHERE account_id IS NULL`).run(id);
      if (r.changes) console.log(`[migrate] ${table}: ${r.changes} row(s) assigned to account ${id}`);
    }
  });

  for (const table of tables) {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_account ON ${table}(account_id)`);
  }
}

module.exports = {
  legacyAccountId, hashKey, safeEqual, findByKey, touchKey,
  createAccount, listAccounts, getAccount, mintKey, mintDeviceKey, listKeys, revokeKey,
  migrateToTenancy,
};
