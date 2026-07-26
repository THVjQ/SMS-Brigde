// tools/sms-bridge/index.js — Encrypted SMS Bridge Tool
const express   = require('express');
const db        = require('../../db/database');
const migrate   = require('../../db/migrate');
const auth      = require('../../middleware/auth');
const rateLimit = require('../../middleware/rateLimit');
const E2E       = require('./crypto');

const router     = express.Router();
const serverKeys = E2E.loadOrCreateServerKeys();

// How long a phone may hold claimed messages before the reaper hands them back. Covers a phone that
// collects a batch and then loses power or signal before the SMS actually goes out. Overridable
// because a five-minute default is untestable in a suite that has to finish in seconds.
const CLAIM_TTL_MS    = parseInt(process.env.CLAIM_TTL_MS)    || 5 * 60 * 1000;
const REAPER_EVERY_MS = parseInt(process.env.REAPER_EVERY_MS) || 60 * 1000;
const PENDING_BATCH   = 10;

// ── Schema ───────────────────────────────────────────────────────────────────

db.exec(`CREATE TABLE IF NOT EXISTS sms_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL, message TEXT NOT NULL,
  encrypted INTEGER DEFAULT 1, status TEXT NOT NULL DEFAULT 'pending',
  source TEXT DEFAULT 'extension', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, sent_at DATETIME
)`);
db.exec(`CREATE TABLE IF NOT EXISTS pairing_codes (
  code TEXT PRIMARY KEY, used INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
db.exec(`CREATE TABLE IF NOT EXISTS paired_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL UNIQUE,
  label TEXT DEFAULT 'Phone', public_key TEXT,
  paired_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_seen DATETIME
)`);
db.exec(`CREATE TABLE IF NOT EXISTS incoming_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT, sender TEXT NOT NULL,
  message TEXT NOT NULL, encrypted INTEGER DEFAULT 1,
  received_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
db.exec(`CREATE TABLE IF NOT EXISTS bridge_config (
  key TEXT PRIMARY KEY, value TEXT
)`);

// Stage 1 — explicit routing. Every message names the phone that must send it, so two phones
// polling the same server no longer both deliver every message.
migrate.addColumn('sms_messages', 'target_device_id', 'TEXT');
migrate.addColumn('sms_messages', 'claimed_at',       'DATETIME');
migrate.addColumn('paired_devices', 'label',          "TEXT DEFAULT 'Phone'");
db.exec(`CREATE INDEX IF NOT EXISTS idx_sms_target ON sms_messages(status, target_device_id)`);

// Messages queued before targeting existed have no owner, so no phone can ever claim them. Left
// pending they are invisible debt; failing them makes the state legible and matches the pre-upgrade
// cleanup step. Runs once — a later untargeted row would be a bug, not backlog.
migrate.once('stage1-fail-untargeted-pending', () => {
  const r = db.prepare("UPDATE sms_messages SET status='failed' WHERE status='pending' AND target_device_id IS NULL").run();
  if (r.changes) console.log(`[migrate] ${r.changes} untargeted pending message(s) marked failed`);
});

// ── Small helpers ────────────────────────────────────────────────────────────

const getConfig = key => (db.prepare('SELECT value FROM bridge_config WHERE key=?').get(key) || {}).value || null;
const setConfig = (key, value) =>
  db.prepare('INSERT INTO bridge_config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);

const findDevice = deviceId => db.prepare('SELECT * FROM paired_devices WHERE device_id=?').get(deviceId);

/**
 * Which phone should send this message. Explicit beats configured default beats "there is only one
 * phone" — deliberately never "whichever device we heard from last", which is a guess dressed up as
 * a routing decision.
 */
function resolveTarget(requestedDeviceId) {
  if (requestedDeviceId) {
    const device = findDevice(requestedDeviceId);
    return device
      ? { device }
      : { error: { status: 404, code: 'DEVICE_NOT_FOUND', message: `No paired device "${requestedDeviceId}"` } };
  }

  const configured = getConfig('default_device_id');
  if (configured) {
    const device = findDevice(configured);
    if (device) return { device };
    console.warn(`[sms-bridge] configured default device "${configured}" is no longer paired`);
  }

  const all = db.prepare('SELECT * FROM paired_devices').all();
  if (all.length === 1) return { device: all[0] };
  if (all.length === 0) {
    return { error: { status: 409, code: 'NO_DEVICES', message: 'No phone is paired with this server' } };
  }
  return { error: { status: 409, code: 'NO_DEFAULT_DEVICE',
    message: `${all.length} phones are paired — send must name a device_id, or set a default` } };
}

/** Requires x-device-id and that it names a paired device. */
function requireDevice(req, res) {
  const deviceId = req.headers['x-device-id'];
  if (!deviceId) {
    res.status(400).json({ error: 'x-device-id header required', code: 'DEVICE_ID_REQUIRED' });
    return null;
  }
  const device = findDevice(deviceId);
  if (!device) {
    res.status(403).json({ error: 'This device is not paired — pair it again from the PC', code: 'DEVICE_NOT_PAIRED' });
    return null;
  }
  return device;
}

// ── Public key ───────────────────────────────────────────────────────────────

router.get('/pubkey', (req, res) => res.json({ publicKey: serverKeys.publicKeyB64, curve: 'P-256', version: 1 }));

// ── Pairing ──────────────────────────────────────────────────────────────────

router.post('/generate-code', rateLimit({ name: 'generate-code', windowMs: 60_000, max: 10 }), auth, (req, res) => {
  const code = require('crypto').randomBytes(4).toString('hex').toUpperCase();
  db.prepare('INSERT OR REPLACE INTO pairing_codes (code) VALUES (?)').run(code);
  setTimeout(() => db.prepare("DELETE FROM pairing_codes WHERE code=? AND used=0").run(code), 15 * 60 * 1000).unref();
  res.json({ ok: true, code, expires_in: 900 });
});

// Unauthenticated by design — the pairing code is the credential. 4 bytes of entropy needs the
// throttle above it to stay meaningful.
router.post('/link', rateLimit({ name: 'link', windowMs: 60_000, max: 10 }), (req, res) => {
  const { pairing_code, device_id, public_key, label } = req.body;
  if (!pairing_code || !device_id) return res.status(400).json({ error: 'pairing_code and device_id required' });
  const row = db.prepare("SELECT * FROM pairing_codes WHERE code=? AND used=0").get(String(pairing_code).trim().toUpperCase());
  if (!row) return res.status(403).json({ error: 'Invalid or expired pairing code' });
  db.prepare("UPDATE pairing_codes SET used=1 WHERE code=?").run(row.code);
  db.prepare(`INSERT INTO paired_devices (device_id,public_key,label,last_seen)
    VALUES(?,?,COALESCE(?,'Phone'),CURRENT_TIMESTAMP)
    ON CONFLICT(device_id) DO UPDATE SET public_key=excluded.public_key, last_seen=CURRENT_TIMESTAMP`
  ).run(device_id, public_key || null, label || null);

  // First phone in becomes the default target, so a single-phone shop never has to configure one.
  if (!getConfig('default_device_id')) setConfig('default_device_id', device_id);

  res.json({ ok: true, api_key: process.env.API_KEY, server_key: serverKeys.publicKeyB64 });
});

router.get('/devices', auth, (req, res) => {
  res.json({
    devices: db.prepare(`SELECT id,device_id,label,public_key,paired_at,last_seen
                         FROM paired_devices ORDER BY last_seen DESC`).all(),
    default_device_id: getConfig('default_device_id'),
  });
});

// Lets a stale phone be removed without shell access to the container.
router.delete('/devices/:device_id', auth, (req, res) => {
  const { device_id } = req.params;
  const r = db.prepare('DELETE FROM paired_devices WHERE device_id=?').run(device_id);
  if (!r.changes) return res.status(404).json({ error: 'No such device' });

  // Anything still queued for it can never be delivered now.
  const orphaned = db.prepare(
    "UPDATE sms_messages SET status='failed' WHERE status IN ('pending','claimed') AND target_device_id=?"
  ).run(device_id);
  if (getConfig('default_device_id') === device_id) setConfig('default_device_id', null);

  res.json({ ok: true, deleted: device_id, failed_messages: orphaned.changes });
});

router.put('/devices/:device_id/default', auth, (req, res) => {
  if (!findDevice(req.params.device_id)) return res.status(404).json({ error: 'No such device' });
  setConfig('default_device_id', req.params.device_id);
  res.json({ ok: true, default_device_id: req.params.device_id });
});

// ── Outbound ─────────────────────────────────────────────────────────────────

router.post('/send', auth, (req, res) => {
  const { phone, message, encrypted_message, device_id } = req.body;
  if (!phone) return res.status(400).json({ error: '"phone" is required' });
  if (!message && !encrypted_message) return res.status(400).json({ error: '"message" or "encrypted_message" required' });

  const { device, error } = resolveTarget(device_id);
  if (error) return res.status(error.status).json({ error: error.message, code: error.code });

  // No plaintext fallback. Storing an unencryptable message anyway is precisely what let a broken
  // pairing keep looking like a working one.
  if (!device.public_key) {
    return res.status(409).json({
      code:  'NO_DEVICE_KEY',
      error: `Device "${device.label || device.device_id}" has no encryption key — re-pair it from the phone`,
    });
  }

  const storedMessage = encrypted_message
    ? (typeof encrypted_message === 'string' ? encrypted_message : JSON.stringify(encrypted_message))
    : JSON.stringify(E2E.encrypt(message, device.public_key));

  const result = db.prepare(
    'INSERT INTO sms_messages (phone,message,encrypted,source,target_device_id) VALUES(?,?,?,?,?)'
  ).run(String(phone).trim(), storedMessage, 1, 'extension', device.device_id);

  res.json({
    ok: true,
    id: result.lastInsertRowid,
    encrypted: true,
    target: { device_id: device.device_id, label: device.label || 'Phone' },
  });
});

// Claim rather than broadcast: rows are handed to exactly one phone and marked as taken in the same
// statement. SQLite serialises writers, so the UPDATE ... RETURNING cannot hand the same row twice.
const claimStmt = db.prepare(`
  UPDATE sms_messages SET status='claimed', claimed_at=CURRENT_TIMESTAMP
   WHERE id IN (SELECT id FROM sms_messages
                 WHERE status='pending' AND target_device_id=?
                 ORDER BY id ASC LIMIT ${PENDING_BATCH})
  RETURNING id, phone, message, encrypted`);

router.get('/pending', auth, (req, res) => {
  const device = requireDevice(req, res);
  if (!device) return;
  db.prepare('UPDATE paired_devices SET last_seen=CURRENT_TIMESTAMP WHERE device_id=?').run(device.device_id);
  res.json({ messages: claimStmt.all(device.device_id) });
});

router.post('/mark-sent', auth, (req, res) => {
  const device = requireDevice(req, res);
  if (!device) return;
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: '"id" required' });
  const r = db.prepare(
    "UPDATE sms_messages SET status='sent',sent_at=CURRENT_TIMESTAMP WHERE id=? AND target_device_id=?"
  ).run(id, device.device_id);
  if (!r.changes) return res.status(404).json({ error: 'No such message for this device' });
  res.json({ ok: true });
});

router.post('/mark-failed', auth, (req, res) => {
  const device = requireDevice(req, res);
  if (!device) return;
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: '"id" required' });
  const r = db.prepare("UPDATE sms_messages SET status='failed' WHERE id=? AND target_device_id=?")
              .run(id, device.device_id);
  if (!r.changes) return res.status(404).json({ error: 'No such message for this device' });
  res.json({ ok: true });
});

// A phone that claims a batch and then dies must not take those messages down with it.
const reap = () => {
  const r = db.prepare(
    `UPDATE sms_messages SET status='pending', claimed_at=NULL
      WHERE status='claimed' AND claimed_at <= DATETIME('now', ?)`
  ).run(`-${Math.floor(CLAIM_TTL_MS / 1000)} seconds`);
  if (r.changes) console.log(`[sms-bridge] reaper returned ${r.changes} stale claim(s) to pending`);
};
setInterval(reap, REAPER_EVERY_MS).unref();
reap();   // also on boot, so a crash mid-delivery recovers immediately

// ── Incoming ─────────────────────────────────────────────────────────────────

router.post('/incoming', auth, (req, res) => {
  const { from, encrypted_message, message, device_id } = req.body;
  if (!from) return res.status(400).json({ error: '"from" required' });
  const stored = encrypted_message
    ? (typeof encrypted_message === 'string' ? encrypted_message : JSON.stringify(encrypted_message))
    : message;
  db.prepare('INSERT INTO incoming_messages (device_id,sender,message,encrypted) VALUES(?,?,?,?)')
    .run(device_id || '', from, stored, encrypted_message ? 1 : 0);
  res.json({ ok: true });
});

router.get('/incoming', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM incoming_messages ORDER BY id DESC LIMIT 100').all();
  const messages = rows.map(row => {
    if (!row.encrypted) return row;
    try { return { ...row, message: E2E.decrypt(JSON.parse(row.message), serverKeys.privateKey), decrypted: true }; }
    catch { return { ...row, message: '[decryption failed]', decrypted: false }; }
  });
  res.json({ messages });
});

// ── Inspection ───────────────────────────────────────────────────────────────

router.get('/history', auth, (req, res) => {
  const { status, id, limit = 100 } = req.query;
  const cols = 'id,phone,status,encrypted,source,target_device_id,created_at,claimed_at,sent_at';

  // Single-id lookup is how a client confirms a specific send actually left the phone.
  if (id) {
    const row = db.prepare(`SELECT ${cols} FROM sms_messages WHERE id=?`).get(id);
    return res.json({ messages: row ? [row] : [] });
  }

  let q = `SELECT ${cols} FROM sms_messages`;
  const p = [];
  if (status) { q += ' WHERE status=?'; p.push(status); }
  q += ' ORDER BY id DESC LIMIT ?'; p.push(Math.min(parseInt(limit) || 100, 500));
  res.json({ messages: db.prepare(q).all(...p) });
});

router.get('/stats', auth, (req, res) => {
  const rows = db.prepare('SELECT status, COUNT(*) as count FROM sms_messages GROUP BY status').all();
  const stats = { pending: 0, claimed: 0, sent: 0, failed: 0 };
  for (const r of rows) stats[r.status] = r.count;
  res.json(stats);
});

router.delete('/clear-sent', auth, (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const r = db.prepare("DELETE FROM sms_messages WHERE status='sent' AND sent_at<DATETIME('now',? || ' days')").run(`-${days}`);
  res.json({ ok: true, deleted: r.changes });
});

module.exports = {
  name: 'SMS Bridge', description: 'E2E encrypted SMS bridge — ECIES P-256 + AES-256-GCM.', version: '2.1.0', router,
  endpoints: [
    { method: 'GET',    path: '/pubkey',                  auth: false },
    { method: 'POST',   path: '/generate-code',           auth: true  },
    { method: 'POST',   path: '/link',                    auth: false },
    { method: 'GET',    path: '/devices',                 auth: true  },
    { method: 'DELETE', path: '/devices/:device_id',      auth: true  },
    { method: 'PUT',    path: '/devices/:device_id/default', auth: true },
    { method: 'POST',   path: '/send',                    auth: true  },
    { method: 'GET',    path: '/pending',                 auth: true  },
    { method: 'POST',   path: '/mark-sent',               auth: true  },
    { method: 'POST',   path: '/mark-failed',             auth: true  },
    { method: 'POST',   path: '/incoming',                auth: true  },
    { method: 'GET',    path: '/incoming',                auth: true  },
    { method: 'GET',    path: '/history',                 auth: true  },
    { method: 'GET',    path: '/stats',                   auth: true  },
  ],
};
