// db/migrate.js — idempotent schema helpers.
//
// The TrueNAS Custom App restarts the container on every deploy, so all startup code runs
// repeatedly against a database that already exists. SQLite has no `ALTER TABLE ... ADD COLUMN IF
// NOT EXISTS`, so every additive change is guarded by a PRAGMA table_info check rather than by a
// try/catch — a swallowed error hides the difference between "already applied" and "broken".

const db = require('./database');

function tableExists(table) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
}

function columns(table) {
  if (!tableExists(table)) return [];
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

function hasColumn(table, column) {
  return columns(table).includes(column);
}

/** Adds `table.column` if missing. `definition` is everything after the column name. */
function addColumn(table, column, definition) {
  if (!tableExists(table)) throw new Error(`addColumn: no such table "${table}"`);
  if (hasColumn(table, column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`[migrate] ${table}.${column} added`);
  return true;
}

/**
 * Runs `fn` exactly once across all deploys, keyed by `name`. For migrations that are not naturally
 * idempotent — backfills and one-off cleanups, where re-running would corrupt live data.
 */
function once(name, fn) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get(name)) return false;
  db.transaction(() => {
    fn();
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
  })();
  console.log(`[migrate] ${name} applied`);
  return true;
}

module.exports = { tableExists, columns, hasColumn, addColumn, once };
