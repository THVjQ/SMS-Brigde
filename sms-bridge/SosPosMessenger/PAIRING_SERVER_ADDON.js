// tools/sms-bridge/pairing.js
// ─────────────────────────────────────────────────────────────────────────────
// Add these extra routes to sms-bridge/index.js for phone pairing + incoming forwarding.
// The website generates a pairing code, the phone submits it to link.
// ─────────────────────────────────────────────────────────────────────────────
//
// Add to server-side sospos-tools sms-bridge:

const PAIRING_ROUTES = `
// ── Pairing ───────────────────────────────────────────────────────────────────

db.exec(\`
  CREATE TABLE IF NOT EXISTS paired_devices (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id  TEXT NOT NULL UNIQUE,
    label      TEXT DEFAULT 'Phone',
    paired_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen  DATETIME
  )
\`);

db.exec(\`
  CREATE TABLE IF NOT EXISTS pairing_codes (
    code       TEXT PRIMARY KEY,
    used       INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
\`);

db.exec(\`
  CREATE TABLE IF NOT EXISTS incoming_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id   TEXT,
    sender      TEXT NOT NULL,
    message     TEXT NOT NULL,
    received_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
\`);

// POST /generate-code   — website calls this to create a one-time pairing code
router.post('/generate-code', auth, (req, res) => {
  const code = Math.random().toString(36).slice(2, 10).toUpperCase();
  db.prepare('INSERT OR REPLACE INTO pairing_codes (code) VALUES (?)').run(code);
  res.json({ ok: true, code });
});

// POST /link   — Android app calls this with the code + its device_id
router.post('/link', (req, res) => {
  const { pairing_code, device_id } = req.body;
  if (!pairing_code || !device_id) {
    return res.status(400).json({ error: 'pairing_code and device_id required' });
  }
  const row = db.prepare("SELECT * FROM pairing_codes WHERE code=? AND used=0").get(pairing_code);
  if (!row) return res.status(403).json({ error: 'Invalid or already used pairing code' });

  db.prepare("UPDATE pairing_codes SET used=1 WHERE code=?").run(pairing_code);
  db.prepare("INSERT OR REPLACE INTO paired_devices (device_id, last_seen) VALUES (?,CURRENT_TIMESTAMP)").run(device_id);

  res.json({ ok: true, api_key: process.env.API_KEY });
});

// GET /devices   — list all paired phones
router.get('/devices', auth, (req, res) => {
  const devices = db.prepare('SELECT * FROM paired_devices ORDER BY last_seen DESC').all();
  res.json({ devices });
});

// POST /incoming   — Android forwards received SMS here
router.post('/incoming', auth, (req, res) => {
  const { from, message, device_id } = req.body;
  if (!from || !message) return res.status(400).json({ error: 'from and message required' });
  db.prepare('INSERT INTO incoming_messages (device_id,sender,message) VALUES (?,?,?)').run(device_id||'',from,message);
  res.json({ ok: true });
});

// GET /incoming   — website polls this to see messages received by phone
router.get('/incoming', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM incoming_messages ORDER BY id DESC LIMIT 100').all();
  res.json({ messages: rows });
});
`;

module.exports = { PAIRING_ROUTES };
