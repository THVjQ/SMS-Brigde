// tools/sms-bridge/clientKeys.js — the desktops' public keys, per account.
//
// Inbound used to be encrypted to the SERVER's key and decrypted in GET /incoming, so the server
// could read every customer reply while the code claimed otherwise. Closing that means the PC side
// owns a keypair and the phone encrypts to it.
//
// One key per desktop, not one per account: an account can hold three PCs, and each generates its
// own keypair in its own browser profile. A phone therefore encrypts one envelope per registered
// key and each PC opens its own. Fan-out costs a few hundred bytes per reply and avoids the only
// alternative, which is copying one private key between machines.

const crypto = require('node:crypto');
const db     = require('../../db/database');
const repo   = require('./repo');

db.exec(`CREATE TABLE IF NOT EXISTS client_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  key_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  label TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME,
  UNIQUE(account_id, key_id)
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_client_keys_account ON client_keys(account_id)`);

/**
 * Stable short name for a key: the first 8 bytes of SHA-256 over its DER, as hex. Computed
 * identically in the userscript and in NexLink so all three sides agree which envelope is whose,
 * without any of them having to be told.
 */
function keyIdFor(publicKeyB64) {
  return crypto.createHash('sha256').update(Buffer.from(publicKeyB64, 'base64')).digest('hex').slice(0, 16);
}

/** Rejects anything that is not a P-256 SPKI key, so a malformed key cannot be stored and then fail at encrypt time. */
function validate(publicKeyB64) {
  let key;
  try {
    key = crypto.createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' });
  } catch {
    throw Object.assign(new Error('public_key is not a valid SPKI key'), { code: 'BAD_KEY' });
  }
  const { namedCurve } = key.asymmetricKeyDetails || {};
  if (key.asymmetricKeyType !== 'ec' || namedCurve !== 'prime256v1') {
    throw Object.assign(new Error('public_key must be an EC P-256 key'), { code: 'BAD_KEY' });
  }
  return true;
}

function register(accountId, publicKeyB64, label) {
  repo.requireAccount(accountId);
  validate(publicKeyB64);
  const keyId = keyIdFor(publicKeyB64);
  db.prepare(`INSERT INTO client_keys (account_id,key_id,public_key,label,last_seen)
              VALUES (?,?,?,?,CURRENT_TIMESTAMP)
              ON CONFLICT(account_id,key_id) DO UPDATE SET last_seen=CURRENT_TIMESTAMP, label=COALESCE(excluded.label,label)`)
    .run(accountId, keyId, publicKeyB64, label || null);
  return { key_id: keyId, public_key: publicKeyB64, label: label || null };
}

function list(accountId) {
  repo.requireAccount(accountId);
  return db.prepare('SELECT key_id, public_key, label, created_at, last_seen FROM client_keys WHERE account_id=? ORDER BY id')
           .all(accountId);
}

function remove(accountId, keyId) {
  repo.requireAccount(accountId);
  return db.prepare('DELETE FROM client_keys WHERE account_id=? AND key_id=?').run(accountId, keyId).changes > 0;
}

module.exports = { register, list, remove, keyIdFor, validate };
