const Database = require('better-sqlite3');
const fs       = require('fs');
const path     = require('path');
const { DATA_DIR, DB_FILE } = require('../config');

// The TrueNAS Custom App mounts a dataset at DB_DIR and restarts the container on every deploy, so
// anything written outside it is lost — including paired devices and the server keypair. DB_DIR was
// already set in docker-compose.truenas.yml but was never read here.
const LEGACY_FILE = path.join(__dirname, '..', 'sms-bridge.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

// One-time carry-forward, so an upgrade that starts honouring DB_DIR does not look like data loss.
// The WAL and shared-memory files come across too: a database whose most recent writes are still in
// the WAL would otherwise arrive silently truncated.
if (DB_FILE !== LEGACY_FILE && !fs.existsSync(DB_FILE) && fs.existsSync(LEGACY_FILE)) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(LEGACY_FILE + suffix)) fs.copyFileSync(LEGACY_FILE + suffix, DB_FILE + suffix);
  }
  console.log(`[db] Carried existing database forward: ${LEGACY_FILE} → ${DB_FILE}`);
}

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

console.log(`[db] ${DB_FILE}`);

module.exports = db;
