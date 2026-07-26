// tools/sms-bridge/repo.js — every database access the bridge makes.
//
// Account scoping is the entire security boundary, so it is enforced structurally rather than by
// remembering to add a WHERE clause in each handler: every function here takes accountId as its
// required first argument and refuses to run without one. A forgotten scope becomes a missing
// argument and fails loudly on the first call, instead of quietly returning another tenant's rows.
//
// The two deliberate exceptions are marked: consuming a pairing code (the caller is unauthenticated
// by design — the code itself carries the account) and the stale-claim reaper (maintenance across
// all accounts, and it only ever moves a row back to its own account's pending queue).

const db = require('../../db/database');

function requireAccount(accountId) {
  if (accountId === undefined || accountId === null || accountId === '') {
    throw new Error('repo: accountId is required — an unscoped query is a tenancy leak');
  }
  return accountId;
}

// ── Devices ──────────────────────────────────────────────────────────────────

const devices = {
  list(accountId) {
    requireAccount(accountId);
    return db.prepare(`SELECT id,device_id,label,public_key,paired_at,last_seen
                       FROM paired_devices WHERE account_id=? ORDER BY last_seen DESC`).all(accountId);
  },

  find(accountId, deviceId) {
    requireAccount(accountId);
    return db.prepare('SELECT * FROM paired_devices WHERE account_id=? AND device_id=?').get(accountId, deviceId) || null;
  },

  count(accountId) {
    requireAccount(accountId);
    return db.prepare('SELECT COUNT(*) AS n FROM paired_devices WHERE account_id=?').get(accountId).n;
  },

  /**
   * device_id is globally unique, so a phone re-pairing into a different account would otherwise
   * silently move between tenants. Reject that instead: it is either a mistake or an attack.
   */
  upsert(accountId, { device_id, public_key, label }) {
    requireAccount(accountId);
    const existing = db.prepare('SELECT account_id FROM paired_devices WHERE device_id=?').get(device_id);
    if (existing && existing.account_id !== accountId) {
      throw Object.assign(new Error('device_id already registered to another account'), { code: 'DEVICE_CONFLICT' });
    }
    db.prepare(`INSERT INTO paired_devices (device_id,public_key,label,account_id,last_seen)
      VALUES(?,?,COALESCE(?,'Phone'),?,CURRENT_TIMESTAMP)
      ON CONFLICT(device_id) DO UPDATE SET public_key=excluded.public_key, last_seen=CURRENT_TIMESTAMP`
    ).run(device_id, public_key || null, label || null, accountId);
    return devices.find(accountId, device_id);
  },

  touch(accountId, deviceId) {
    requireAccount(accountId);
    db.prepare('UPDATE paired_devices SET last_seen=CURRENT_TIMESTAMP WHERE account_id=? AND device_id=?')
      .run(accountId, deviceId);
  },

  remove(accountId, deviceId) {
    requireAccount(accountId);
    return db.prepare('DELETE FROM paired_devices WHERE account_id=? AND device_id=?').run(accountId, deviceId).changes > 0;
  },
};

// ── Account settings ─────────────────────────────────────────────────────────

const settings = {
  getDefaultDevice(accountId) {
    requireAccount(accountId);
    const row = db.prepare('SELECT default_device_id FROM accounts WHERE id=?').get(accountId);
    return row ? row.default_device_id : null;
  },

  setDefaultDevice(accountId, deviceId) {
    requireAccount(accountId);
    db.prepare('UPDATE accounts SET default_device_id=? WHERE id=?').run(deviceId || null, accountId);
  },
};

// ── Pairing codes ────────────────────────────────────────────────────────────

const codes = {
  create(accountId, code) {
    requireAccount(accountId);
    db.prepare('INSERT OR REPLACE INTO pairing_codes (code, account_id) VALUES (?,?)').run(code, accountId);
  },

  /**
   * UNSCOPED BY DESIGN. /link is unauthenticated — the code is the credential, and the account it
   * was minted under is what decides which tenant the phone joins. Redeeming is a single-shot
   * UPDATE so two racing redemptions cannot both win.
   */
  consume(code) {
    const normalised = String(code || '').trim().toUpperCase();
    const claimed = db.prepare("UPDATE pairing_codes SET used=1 WHERE code=? AND used=0 RETURNING account_id").all(normalised);
    return claimed.length ? claimed[0] : null;
  },

  expire(code) {
    db.prepare('DELETE FROM pairing_codes WHERE code=? AND used=0').run(code);
  },
};

// ── Outbound messages ────────────────────────────────────────────────────────

const messages = {
  queue(accountId, { phone, message, encrypted, targetDeviceId, source = 'extension' }) {
    requireAccount(accountId);
    return db.prepare(`INSERT INTO sms_messages (phone,message,encrypted,source,target_device_id,account_id)
                       VALUES(?,?,?,?,?,?)`)
             .run(phone, message, encrypted ? 1 : 0, source, targetDeviceId, accountId).lastInsertRowid;
  },

  /**
   * Hands rows to exactly one phone and marks them taken in the same statement. SQLite serialises
   * writers, so a row cannot be issued twice even under concurrent polls.
   */
  claim(accountId, deviceId, limit) {
    requireAccount(accountId);
    return db.prepare(`
      UPDATE sms_messages SET status='claimed', claimed_at=CURRENT_TIMESTAMP
       WHERE id IN (SELECT id FROM sms_messages
                     WHERE status='pending' AND account_id=? AND target_device_id=?
                     ORDER BY id ASC LIMIT ?)
      RETURNING id, phone, message, encrypted`).all(accountId, deviceId, limit);
  },

  setStatus(accountId, deviceId, id, status) {
    requireAccount(accountId);
    const sentAt = status === 'sent' ? 'CURRENT_TIMESTAMP' : 'sent_at';
    return db.prepare(`UPDATE sms_messages SET status=?, sent_at=${sentAt}
                        WHERE id=? AND account_id=? AND target_device_id=?`)
             .run(status, id, accountId, deviceId).changes > 0;
  },

  failForDevice(accountId, deviceId) {
    requireAccount(accountId);
    return db.prepare(`UPDATE sms_messages SET status='failed'
                        WHERE status IN ('pending','claimed') AND account_id=? AND target_device_id=?`)
             .run(accountId, deviceId).changes;
  },

  byId(accountId, id) {
    requireAccount(accountId);
    return db.prepare(`SELECT ${messages.COLUMNS} FROM sms_messages WHERE id=? AND account_id=?`).get(id, accountId) || null;
  },

  history(accountId, { status, limit = 100 } = {}) {
    requireAccount(accountId);
    const capped = Math.min(parseInt(limit) || 100, 500);
    return status
      ? db.prepare(`SELECT ${messages.COLUMNS} FROM sms_messages WHERE account_id=? AND status=? ORDER BY id DESC LIMIT ?`)
          .all(accountId, status, capped)
      : db.prepare(`SELECT ${messages.COLUMNS} FROM sms_messages WHERE account_id=? ORDER BY id DESC LIMIT ?`)
          .all(accountId, capped);
  },

  stats(accountId) {
    requireAccount(accountId);
    const rows = db.prepare('SELECT status, COUNT(*) AS count FROM sms_messages WHERE account_id=? GROUP BY status').all(accountId);
    const stats = { pending: 0, claimed: 0, sent: 0, failed: 0 };
    for (const r of rows) stats[r.status] = r.count;
    return stats;
  },

  clearSent(accountId, days) {
    requireAccount(accountId);
    return db.prepare("DELETE FROM sms_messages WHERE account_id=? AND status='sent' AND sent_at<DATETIME('now',? || ' days')")
             .run(accountId, `-${days}`).changes;
  },

  /**
   * UNSCOPED BY DESIGN. Maintenance across all tenants; it only returns a row to the pending state
   * it already had, within the account that already owns it.
   */
  reapStaleClaims(ttlSeconds) {
    return db.prepare(`UPDATE sms_messages SET status='pending', claimed_at=NULL
                        WHERE status='claimed' AND claimed_at <= DATETIME('now', ?)`)
             .run(`-${ttlSeconds} seconds`).changes;
  },
};

messages.COLUMNS = 'id,phone,status,encrypted,source,target_device_id,created_at,claimed_at,sent_at';

// ── Inbound messages ─────────────────────────────────────────────────────────

const incoming = {
  /**
   * `e2e` marks a message the server cannot read: the phone addressed it to the desktops' keys and
   * this row is relayed untouched. Without the flag there is no way to tell it apart from a legacy
   * message encrypted to the server's own key, which the server does still decrypt.
   */
  add(accountId, { deviceId, sender, message, encrypted, e2e }) {
    requireAccount(accountId);
    return db.prepare('INSERT INTO incoming_messages (device_id,sender,message,encrypted,e2e,account_id) VALUES(?,?,?,?,?,?)')
             .run(deviceId || '', sender, message, encrypted ? 1 : 0, e2e ? 1 : 0, accountId).lastInsertRowid;
  },

  list(accountId, limit = 100) {
    requireAccount(accountId);
    return db.prepare('SELECT * FROM incoming_messages WHERE account_id=? ORDER BY id DESC LIMIT ?')
             .all(accountId, Math.min(parseInt(limit) || 100, 500));
  },
};

module.exports = { devices, settings, codes, messages, incoming, requireAccount };
