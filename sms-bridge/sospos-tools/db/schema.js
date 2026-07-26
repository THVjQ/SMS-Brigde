// db/schema.js — the bridge's tables and migrations, in one place.
//
// Extracted from the tool module because the admin CLI needs the same schema without mounting an
// HTTP router: `accounts list` counts each account's devices, and on a fresh database that table
// would not exist yet. Requiring this is now the only way to be sure the schema is present.
//
// Everything here is safe to run repeatedly. The TrueNAS Custom App restarts the container on every
// deploy, so startup code always runs against a database that already exists: additive columns are
// guarded by PRAGMA table_info, and anything that is not naturally idempotent goes through
// migrate.once().

const db       = require('./database');
const migrate  = require('./migrate');
const accounts = require('./accounts');

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
db.exec(`CREATE TABLE IF NOT EXISTS bridge_config (key TEXT PRIMARY KEY, value TEXT)`);

// ── Stage 1 — explicit routing ───────────────────────────────────────────────
// Every message names the phone that must send it, so two phones polling the same server no longer
// both deliver every message.

migrate.addColumn('sms_messages',   'target_device_id', 'TEXT');
migrate.addColumn('sms_messages',   'claimed_at',       'DATETIME');
migrate.addColumn('paired_devices', 'label',            "TEXT DEFAULT 'Phone'");
db.exec(`CREATE INDEX IF NOT EXISTS idx_sms_target ON sms_messages(status, target_device_id)`);

// Messages queued before targeting existed have no owner, so no phone can ever claim them. Left
// pending they are invisible debt; failing them makes the state legible.
migrate.once('stage1-fail-untargeted-pending', () => {
  const r = db.prepare("UPDATE sms_messages SET status='failed' WHERE status='pending' AND target_device_id IS NULL").run();
  if (r.changes) console.log(`[migrate] ${r.changes} untargeted pending message(s) marked failed`);
});

// ── Stage 2 — tenancy ────────────────────────────────────────────────────────
// Additive on top of Stage 1: account_id everywhere, every existing row filed under the legacy
// account so an upgrade does not orphan a working shop.

accounts.migrateToTenancy(['paired_devices', 'pairing_codes', 'sms_messages', 'incoming_messages']);

// ── Stage 3 — inbound the server cannot read ─────────────────────────────────
// Marks messages the phone addressed to the desktops' own keys, which are relayed untouched.
// Existing rows stay 0: they were encrypted to the server's key and the server does decrypt them.

migrate.addColumn('incoming_messages', 'e2e', 'INTEGER DEFAULT 0');

// The default target moves from a server-wide setting to a property of the account that owns it.
migrate.once('stage2-move-default-device-to-account', () => {
  const row = db.prepare("SELECT value FROM bridge_config WHERE key='default_device_id'").get();
  if (row && row.value) {
    db.prepare('UPDATE accounts SET default_device_id=? WHERE id=?').run(row.value, accounts.legacyAccountId());
    console.log(`[migrate] default device ${row.value} moved onto the legacy account`);
  }
});

module.exports = db;
