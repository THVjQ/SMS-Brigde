// tools/sms-bridge/index.js — Encrypted SMS Bridge Tool
const express    = require('express');
require('../../db/schema');   // tables + migrations, shared with the admin CLI
const accountsDb = require('../../db/accounts');
const auth       = require('../../middleware/auth');
const adminAuth  = require('../../middleware/adminAuth');
const rateLimit  = require('../../middleware/rateLimit');
const repo       = require('./repo');
const clientKeys = require('./clientKeys');
const E2E        = require('./crypto');

const router     = express.Router();
const serverKeys = E2E.loadOrCreateServerKeys();

// How long a phone may hold claimed messages before the reaper hands them back. Covers a phone that
// collects a batch and then loses power or signal before the SMS actually goes out. Overridable
// because a five-minute default is untestable in a suite that has to finish in seconds.
const CLAIM_TTL_MS    = parseInt(process.env.CLAIM_TTL_MS)    || 5 * 60 * 1000;
const REAPER_EVERY_MS = parseInt(process.env.REAPER_EVERY_MS) || 60 * 1000;
const PENDING_BATCH   = 10;
const CODE_TTL_MS     = 15 * 60 * 1000;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Which phone should send this message. Explicit beats configured default beats "there is only one
 * phone" — deliberately never "whichever device we heard from last", which is a guess dressed up as
 * a routing decision. Everything resolves within the caller's account: a device_id belonging to
 * another tenant reads exactly like one that does not exist, so ids cannot be probed for existence.
 */
function resolveTarget(accountId, requestedDeviceId) {
  if (requestedDeviceId) {
    const device = repo.devices.find(accountId, requestedDeviceId);
    return device
      ? { device }
      : { error: { status: 404, code: 'DEVICE_NOT_FOUND', message: `No paired device "${requestedDeviceId}"` } };
  }

  const configured = repo.settings.getDefaultDevice(accountId);
  if (configured) {
    const device = repo.devices.find(accountId, configured);
    if (device) return { device };
    console.warn(`[sms-bridge] account ${accountId}: default device "${configured}" is no longer paired`);
  }

  const all = repo.devices.list(accountId);
  if (all.length === 1) return { device: repo.devices.find(accountId, all[0].device_id) };
  if (all.length === 0) {
    return { error: { status: 409, code: 'NO_DEVICES', message: 'No phone is paired with this server' } };
  }
  return { error: { status: 409, code: 'NO_DEFAULT_DEVICE',
    message: `${all.length} phones are paired — send must name a device_id, or set a default` } };
}

/**
 * Requires x-device-id, and that the device belongs to the account the API key resolved to. A phone
 * from another tenant is rejected the same way an unknown one is.
 */
function requireDevice(req, res) {
  const deviceId = req.headers['x-device-id'];
  if (!deviceId) {
    res.status(400).json({ error: 'x-device-id header required', code: 'DEVICE_ID_REQUIRED' });
    return null;
  }
  const device = repo.devices.find(req.accountId, deviceId);
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
  // Minted against the authenticated caller's account — this is how a phone joins the right tenant,
  // and why the code must come from an authenticated endpoint.
  repo.codes.create(req.accountId, code);
  setTimeout(() => repo.codes.expire(code), CODE_TTL_MS).unref();
  res.json({ ok: true, code, expires_in: CODE_TTL_MS / 1000 });
});

// Unauthenticated by design — the pairing code is the credential, and it carries the account the
// phone will join. 4 bytes of entropy needs the throttle above it to stay meaningful.
router.post('/link', rateLimit({ name: 'link', windowMs: 60_000, max: 10 }), (req, res) => {
  const { pairing_code, device_id, public_key, label } = req.body;
  if (!pairing_code || !device_id) return res.status(400).json({ error: 'pairing_code and device_id required' });

  const claimed = repo.codes.consume(pairing_code);
  if (!claimed) return res.status(403).json({ error: 'Invalid or expired pairing code' });

  const accountId = claimed.account_id || accountsDb.legacyAccountId();
  try {
    repo.devices.upsert(accountId, { device_id, public_key, label });
  } catch (e) {
    if (e.code === 'DEVICE_CONFLICT') {
      return res.status(409).json({ error: 'This phone is already paired to a different account', code: e.code });
    }
    throw e;
  }

  // First phone in becomes the account's default target, so a single-phone shop never configures one.
  if (!repo.settings.getDefaultDevice(accountId)) repo.settings.setDefaultDevice(accountId, device_id);

  // The phone leaves with its own key for the account it just joined. Returning the shared env key
  // here would hand a phone paired into one account a credential that reads every other account.
  const minted = accountsDb.mintDeviceKey(accountId, device_id, label && `Phone: ${label}`);

  // The keys the phone must encrypt replies to. `client_key` is the single-key form NexLink already
  // prefers; `client_keys` carries the whole set, which is what an account with several PCs needs.
  // `server_key` is retained only so an un-upgraded phone still has something to encrypt to — and
  // that path is exactly the one the server can read.
  const desktops = clientKeys.list(accountId);

  res.json({
    ok: true,
    api_key:     minted.key,
    client_keys: desktops.map(k => ({ key_id: k.key_id, public_key: k.public_key, label: k.label })),
    client_key:  desktops.length === 1 ? desktops[0].public_key : undefined,
    server_key:  serverKeys.publicKeyB64,
  });
});

router.get('/devices', auth, (req, res) => {
  res.json({
    devices: repo.devices.list(req.accountId),
    default_device_id: repo.settings.getDefaultDevice(req.accountId),
  });
});

// Lets a stale phone be retired without shell access to the container.
router.delete('/devices/:device_id', auth, (req, res) => {
  const { device_id } = req.params;
  if (!repo.devices.remove(req.accountId, device_id)) return res.status(404).json({ error: 'No such device' });

  // Anything still queued for it can never be delivered now.
  const failed = repo.messages.failForDevice(req.accountId, device_id);
  if (repo.settings.getDefaultDevice(req.accountId) === device_id) {
    repo.settings.setDefaultDevice(req.accountId, null);
  }
  res.json({ ok: true, deleted: device_id, failed_messages: failed });
});

router.put('/devices/:device_id/default', auth, (req, res) => {
  if (!repo.devices.find(req.accountId, req.params.device_id)) return res.status(404).json({ error: 'No such device' });
  repo.settings.setDefaultDevice(req.accountId, req.params.device_id);
  res.json({ ok: true, default_device_id: req.params.device_id });
});

// ── Outbound ─────────────────────────────────────────────────────────────────

router.post('/send', auth, (req, res) => {
  const { phone, message, encrypted_message, device_id } = req.body;
  if (!phone) return res.status(400).json({ error: '"phone" is required' });
  if (!message && !encrypted_message) return res.status(400).json({ error: '"message" or "encrypted_message" required' });

  const { device, error } = resolveTarget(req.accountId, device_id);
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

  const id = repo.messages.queue(req.accountId, {
    phone: String(phone).trim(), message: storedMessage, encrypted: true, targetDeviceId: device.device_id,
  });

  res.json({
    ok: true, id, encrypted: true,
    target: { device_id: device.device_id, label: device.label || 'Phone' },
  });
});

router.get('/pending', auth, (req, res) => {
  const device = requireDevice(req, res);
  if (!device) return;
  repo.devices.touch(req.accountId, device.device_id);
  res.json({ messages: repo.messages.claim(req.accountId, device.device_id, PENDING_BATCH) });
});

router.post('/mark-sent', auth, (req, res) => {
  const device = requireDevice(req, res);
  if (!device) return;
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: '"id" required' });
  if (!repo.messages.setStatus(req.accountId, device.device_id, id, 'sent')) {
    return res.status(404).json({ error: 'No such message for this device' });
  }
  res.json({ ok: true });
});

router.post('/mark-failed', auth, (req, res) => {
  const device = requireDevice(req, res);
  if (!device) return;
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: '"id" required' });
  if (!repo.messages.setStatus(req.accountId, device.device_id, id, 'failed')) {
    return res.status(404).json({ error: 'No such message for this device' });
  }
  res.json({ ok: true });
});

// A phone that claims a batch and then dies must not take those messages down with it.
const reap = () => {
  const n = repo.messages.reapStaleClaims(Math.floor(CLAIM_TTL_MS / 1000));
  if (n) console.log(`[sms-bridge] reaper returned ${n} stale claim(s) to pending`);
};
setInterval(reap, REAPER_EVERY_MS).unref();
reap();   // also on boot, so a crash mid-delivery recovers immediately

// ── Incoming ─────────────────────────────────────────────────────────────────

router.post('/incoming', auth, (req, res) => {
  const { from, envelopes, encrypted_message, message, device_id } = req.body;
  if (!from) return res.status(400).json({ error: '"from" required' });

  // Preferred path: one envelope per registered desktop key. The server stores the map verbatim and
  // holds no key that opens any of it.
  if (envelopes && typeof envelopes === 'object' && Object.keys(envelopes).length) {
    repo.incoming.add(req.accountId, {
      deviceId: device_id, sender: from, message: JSON.stringify(envelopes), encrypted: true, e2e: true,
    });
    return res.json({ ok: true, e2e: true });
  }

  // Legacy path: a phone that has not been updated encrypts to the server's key, which means the
  // server can read it. Accepted so an old app keeps working, and flagged so nobody has to guess.
  const stored = encrypted_message
    ? (typeof encrypted_message === 'string' ? encrypted_message : JSON.stringify(encrypted_message))
    : message;
  if (!stored) return res.status(400).json({ error: '"envelopes", "encrypted_message" or "message" required' });
  repo.incoming.add(req.accountId, {
    deviceId: device_id, sender: from, message: stored, encrypted: !!encrypted_message, e2e: false,
  });
  res.json({ ok: true, e2e: false });
});

router.get('/incoming', auth, (req, res) => {
  const messages = repo.incoming.list(req.accountId).map(row => {
    // End-to-end rows are relayed exactly as received. The caller picks the envelope matching its
    // own key_id and decrypts it locally.
    if (row.e2e) {
      let envelopes = null;
      try { envelopes = JSON.parse(row.message); } catch { /* corrupt row — reported below */ }
      const { message, ...rest } = row;
      return { ...rest, envelopes, e2e: 1 };
    }
    if (!row.encrypted) return row;
    // Legacy: encrypted to the server's own key, so the server is the one that opens it.
    try { return { ...row, message: E2E.decrypt(JSON.parse(row.message), serverKeys.privateKey), decrypted: true, server_readable: true }; }
    catch { return { ...row, message: '[decryption failed]', decrypted: false }; }
  });
  res.json({ messages });
});

// ── Desktop keys (Stage 3) ───────────────────────────────────────────────────

router.post('/client-key', auth, (req, res) => {
  const { public_key, label } = req.body;
  if (!public_key) return res.status(400).json({ error: '"public_key" is required' });
  try {
    res.json({ ok: true, ...clientKeys.register(req.accountId, public_key, label) });
  } catch (e) {
    if (e.code === 'BAD_KEY') return res.status(400).json({ error: e.message, code: e.code });
    throw e;
  }
});

// The phone reads this to learn who it must encrypt replies for.
router.get('/client-keys', auth, (req, res) => res.json({ keys: clientKeys.list(req.accountId) }));

router.delete('/client-keys/:key_id', auth, (req, res) => {
  if (!clientKeys.remove(req.accountId, req.params.key_id)) return res.status(404).json({ error: 'No such client key' });
  res.json({ ok: true, deleted: req.params.key_id });
});

// ── Inspection ───────────────────────────────────────────────────────────────

router.get('/history', auth, (req, res) => {
  const { status, id, limit } = req.query;

  // Single-id lookup is how a client confirms a specific send actually left the phone.
  if (id) {
    const row = repo.messages.byId(req.accountId, id);
    return res.json({ messages: row ? [row] : [] });
  }
  res.json({ messages: repo.messages.history(req.accountId, { status, limit }) });
});

router.get('/stats', auth, (req, res) => res.json(repo.messages.stats(req.accountId)));

router.delete('/clear-sent', auth, (req, res) => {
  const days = parseInt(req.query.days) || 30;
  res.json({ ok: true, deleted: repo.messages.clearSent(req.accountId, days) });
});

// ── Account administration ───────────────────────────────────────────────────
//
// Behind ADMIN_KEY, which is a different credential from any account key. Absent that variable the
// routes 404 — see middleware/adminAuth. The CLI in scripts/accounts.js does the same work locally
// and is the expected way to use this at shop scale.

const adminLimit = rateLimit({ name: 'admin', windowMs: 60_000, max: 20 });

router.get('/admin/accounts', adminLimit, adminAuth, (req, res) => {
  res.json({ accounts: accountsDb.listAccounts() });
});

router.post('/admin/accounts', adminLimit, adminAuth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '"name" is required' });
  res.json({ ok: true, account: accountsDb.createAccount(name) });
});

router.get('/admin/accounts/:id/keys', adminLimit, adminAuth, (req, res) => {
  if (!accountsDb.getAccount(req.params.id)) return res.status(404).json({ error: 'No such account' });
  res.json({ keys: accountsDb.listKeys(req.params.id) });
});

router.post('/admin/accounts/:id/keys', adminLimit, adminAuth, (req, res) => {
  if (!accountsDb.getAccount(req.params.id)) return res.status(404).json({ error: 'No such account' });
  // The plaintext appears here and nowhere else, ever again.
  const minted = accountsDb.mintKey(req.params.id, req.body && req.body.label);
  res.json({ ok: true, id: minted.id, label: minted.label, api_key: minted.key,
             note: 'Store this now — only its hash is kept, so it cannot be shown again.' });
});

router.delete('/admin/keys/:id', adminLimit, adminAuth, (req, res) => {
  if (!accountsDb.revokeKey(req.params.id)) return res.status(404).json({ error: 'No such key' });
  res.json({ ok: true, revoked: Number(req.params.id) });
});

module.exports = {
  name: 'SMS Bridge', description: 'E2E encrypted SMS bridge — ECIES P-256 + AES-256-GCM.', version: '3.0.0', router,
  endpoints: [
    { method: 'GET',    path: '/pubkey',                     auth: false },
    { method: 'POST',   path: '/generate-code',              auth: true  },
    { method: 'POST',   path: '/link',                       auth: false },
    { method: 'GET',    path: '/devices',                    auth: true  },
    { method: 'DELETE', path: '/devices/:device_id',         auth: true  },
    { method: 'PUT',    path: '/devices/:device_id/default', auth: true  },
    { method: 'POST',   path: '/send',                       auth: true  },
    { method: 'GET',    path: '/pending',                    auth: true  },
    { method: 'POST',   path: '/mark-sent',                  auth: true  },
    { method: 'POST',   path: '/mark-failed',                auth: true  },
    { method: 'POST',   path: '/incoming',                   auth: true  },
    { method: 'GET',    path: '/incoming',                   auth: true  },
    { method: 'POST',   path: '/client-key',                 auth: true  },
    { method: 'GET',    path: '/client-keys',                auth: true  },
    { method: 'DELETE', path: '/client-keys/:key_id',        auth: true  },
    { method: 'GET',    path: '/history',                    auth: true  },
    { method: 'GET',    path: '/stats',                      auth: true  },
    { method: 'GET',    path: '/admin/accounts',             auth: 'admin' },
    { method: 'POST',   path: '/admin/accounts',             auth: 'admin' },
    { method: 'GET',    path: '/admin/accounts/:id/keys',    auth: 'admin' },
    { method: 'POST',   path: '/admin/accounts/:id/keys',    auth: 'admin' },
    { method: 'DELETE', path: '/admin/keys/:id',             auth: 'admin' },
  ],
};
