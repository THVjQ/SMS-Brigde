// db/users.js — usernames and passwords on top of the account layer.
//
// Accounts and API keys already existed; this adds the human-facing half. Logging in mints a normal
// API key for that browser, so every scoping, revocation and isolation guarantee underneath stays
// exactly as it was — a person just never has to see or handle a key.
//
// Signup is open, but a new user lands in `pending` and can do nothing until an admin approves it.
// The server is on a public URL, so open signup without a gate would let any passer-by queue SMS.
// `status` is the single field that gates everything, which is also what makes a payment provider a
// drop-in later: charging someone successfully would flip the same field.

const crypto   = require('node:crypto');
const db       = require('./database');
const migrate  = require('./migrate');
const accounts = require('./accounts');

db.exec(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',      -- 'admin' | 'user'
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'active' | 'denied' | 'suspended'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)`);

// Which user a key was minted for, so the admin panel can revoke one person's browsers.
migrate.addColumn('api_keys', 'user_id', 'INTEGER');

const STATUSES = ['pending', 'active', 'denied', 'suspended'];

// ── Password hashing ─────────────────────────────────────────────────────────
//
// scrypt from node:crypto — deliberately no new dependency. Parameters are stored alongside the
// hash so they can be raised later without invalidating existing passwords.

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const dk   = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt     = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual   = crypto.scryptSync(password, salt, expected.length,
      { N: Number(N), r: Number(r), p: Number(p) });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Rejects the passwords that make an account worth breaking into. */
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10) {
    throw Object.assign(new Error('Password must be at least 10 characters'), { code: 'WEAK_PASSWORD' });
  }
  if (password.length > 1024) {
    throw Object.assign(new Error('Password is too long'), { code: 'WEAK_PASSWORD' });
  }
}

function validateUsername(username) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    throw Object.assign(
      new Error('Username must be 3–32 characters: letters, numbers, dot, underscore or hyphen'),
      { code: 'BAD_USERNAME' });
  }
}

// ── Lookup ───────────────────────────────────────────────────────────────────

const byUsername = username =>
  db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(String(username || '').trim()) || null;

const byId = id => db.prepare('SELECT * FROM users WHERE id=?').get(id) || null;

const publicView = u => u && ({
  id: u.id, username: u.username, account_id: u.account_id,
  role: u.role, status: u.status, created_at: u.created_at, last_login: u.last_login,
});

// ── Registration and login ───────────────────────────────────────────────────

/**
 * Creates a person and the account they own, pending approval. Each signup gets its own account —
 * a new person is a new tenant, not a member of an existing one.
 */
function register(username, password, { role = 'user', status = 'pending', accountId = null } = {}) {
  validateUsername(username);
  validatePassword(password);
  if (byUsername(username)) {
    throw Object.assign(new Error('That username is taken'), { code: 'USERNAME_TAKEN' });
  }
  return db.transaction(() => {
    const account = accountId || accounts.createAccount(username).id;
    const id = db.prepare(
      'INSERT INTO users (account_id, username, password_hash, role, status) VALUES (?,?,?,?,?)'
    ).run(account, String(username).trim(), hashPassword(password), role, status).lastInsertRowid;
    return publicView(byId(id));
  })();
}

/**
 * Checks credentials and, on success, mints an API key for this browser.
 *
 * A wrong password and an unknown username produce the same 401 with the same timing cost, so the
 * endpoint cannot be used to work out who has an account here.
 */
function login(username, password, label) {
  const user = byUsername(username);
  if (!user) {
    // Spend the same work as a real verification so absence isn't detectable by response time.
    hashPassword(String(password || ''));
    throw Object.assign(new Error('Incorrect username or password'), { code: 'BAD_CREDENTIALS', status: 401 });
  }
  if (!verifyPassword(password, user.password_hash)) {
    throw Object.assign(new Error('Incorrect username or password'), { code: 'BAD_CREDENTIALS', status: 401 });
  }
  if (user.status !== 'active') {
    const message = {
      pending:   'Your account is waiting to be approved. You will be able to sign in once it is.',
      denied:    'This account was not approved.',
      suspended: 'This account is suspended.',
    }[user.status] || 'This account cannot sign in.';
    throw Object.assign(new Error(message), { code: user.status.toUpperCase(), status: 403 });
  }

  const minted = accounts.mintKey(user.account_id, label || `Login ${new Date().toISOString().slice(0, 10)}`);
  db.prepare('UPDATE api_keys SET user_id=? WHERE id=?').run(user.id, minted.id);
  db.prepare('UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE id=?').run(user.id);

  return { user: publicView(byId(user.id)), api_key: minted.key, key_id: minted.id };
}

function changePassword(username, currentPassword, newPassword) {
  const user = byUsername(username);
  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    throw Object.assign(new Error('Incorrect username or password'), { code: 'BAD_CREDENTIALS', status: 401 });
  }
  validatePassword(newPassword);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(newPassword), user.id);
  return true;
}

// ── Administration ───────────────────────────────────────────────────────────

function list(status) {
  return (status
    ? db.prepare('SELECT * FROM users WHERE status=? ORDER BY id').all(status)
    : db.prepare('SELECT * FROM users ORDER BY id').all()
  ).map(publicView);
}

/**
 * Moves a user between states. Anything other than `active` also revokes their keys — a suspension
 * that leaves working credentials behind is not a suspension.
 */
function setStatus(userId, status) {
  if (!STATUSES.includes(status)) throw new Error(`unknown status: ${status}`);
  const user = byId(userId);
  if (!user) return null;
  db.transaction(() => {
    db.prepare('UPDATE users SET status=? WHERE id=?').run(status, userId);
    if (status !== 'active') db.prepare('UPDATE api_keys SET revoked=1 WHERE user_id=?').run(userId);
  })();
  return publicView(byId(userId));
}

const isAdmin = user => !!user && user.role === 'admin' && user.status === 'active';

/** True until the first admin exists — the bootstrap window the CLI closes. */
const hasAdmin = () =>
  !!db.prepare("SELECT 1 FROM users WHERE role='admin' AND status='active'").get();

module.exports = {
  register, login, changePassword, list, setStatus, byUsername, byId, publicView,
  isAdmin, hasAdmin, hashPassword, verifyPassword, validatePassword, validateUsername, STATUSES,
};
