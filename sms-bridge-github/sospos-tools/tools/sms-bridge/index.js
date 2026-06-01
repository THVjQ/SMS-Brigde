// tools/sms-bridge/index.js — Encrypted SMS Bridge Tool
const express = require('express');
const db      = require('../../db/database');
const auth    = require('../../middleware/auth');
const E2E     = require('./crypto');

const router     = express.Router();
const serverKeys = E2E.loadOrCreateServerKeys();

// Schema
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

// Public key
router.get('/pubkey', (req, res) => res.json({ publicKey: serverKeys.publicKeyB64, curve: 'P-256', version: 1 }));

// Pairing
router.post('/generate-code', auth, (req, res) => {
  const code = require('crypto').randomBytes(4).toString('hex').toUpperCase();
  db.prepare('INSERT OR REPLACE INTO pairing_codes (code) VALUES (?)').run(code);
  setTimeout(() => db.prepare("DELETE FROM pairing_codes WHERE code=? AND used=0").run(code), 15*60*1000);
  res.json({ ok: true, code });
});

router.post('/link', (req, res) => {
  const { pairing_code, device_id, public_key } = req.body;
  if (!pairing_code || !device_id) return res.status(400).json({ error: 'pairing_code and device_id required' });
  const row = db.prepare("SELECT * FROM pairing_codes WHERE code=? AND used=0").get(pairing_code);
  if (!row) return res.status(403).json({ error: 'Invalid or expired pairing code' });
  db.prepare("UPDATE pairing_codes SET used=1 WHERE code=?").run(pairing_code);
  db.prepare(`INSERT INTO paired_devices (device_id,public_key,last_seen) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(device_id) DO UPDATE SET public_key=excluded.public_key, last_seen=CURRENT_TIMESTAMP`
  ).run(device_id, public_key || null);
  res.json({ ok: true, api_key: process.env.API_KEY, server_key: serverKeys.publicKeyB64 });
});

router.get('/devices', auth, (req, res) => {
  res.json({ devices: db.prepare('SELECT id,device_id,label,public_key,paired_at,last_seen FROM paired_devices ORDER BY last_seen DESC').all() });
});

// Outbound
router.post('/send', auth, (req, res) => {
  const { phone, message, encrypted_message, device_id } = req.body;
  if (!phone) return res.status(400).json({ error: '"phone" is required' });
  let storedMessage; let isEncrypted = 1;
  if (encrypted_message) {
    storedMessage = typeof encrypted_message === 'string' ? encrypted_message : JSON.stringify(encrypted_message);
  } else if (message) {
    const device = device_id
      ? db.prepare('SELECT public_key FROM paired_devices WHERE device_id=?').get(device_id)
      : db.prepare('SELECT public_key FROM paired_devices WHERE public_key IS NOT NULL ORDER BY last_seen DESC LIMIT 1').get();
    if (device && device.public_key) {
      storedMessage = JSON.stringify(E2E.encrypt(message, device.public_key));
    } else { storedMessage = message; isEncrypted = 0; }
  } else return res.status(400).json({ error: '"message" or "encrypted_message" required' });
  const result = db.prepare('INSERT INTO sms_messages (phone,message,encrypted,source) VALUES(?,?,?,?)').run(phone.trim(), storedMessage, isEncrypted, 'extension');
  res.json({ ok: true, id: result.lastInsertRowid, encrypted: isEncrypted === 1 });
});

router.get('/pending', auth, (req, res) => {
  const deviceId = req.headers['x-device-id'];
  if (deviceId) db.prepare('UPDATE paired_devices SET last_seen=CURRENT_TIMESTAMP WHERE device_id=?').run(deviceId);
  res.json({ messages: db.prepare("SELECT id,phone,message,encrypted FROM sms_messages WHERE status='pending' ORDER BY id ASC LIMIT 10").all() });
});

router.post('/mark-sent', auth, (req, res) => {
  const { id } = req.body; if (!id) return res.status(400).json({ error: '"id" required' });
  db.prepare("UPDATE sms_messages SET status='sent',sent_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  res.json({ ok: true });
});
router.post('/mark-failed', auth, (req, res) => {
  const { id } = req.body; if (!id) return res.status(400).json({ error: '"id" required' });
  db.prepare("UPDATE sms_messages SET status='failed' WHERE id=?").run(id);
  res.json({ ok: true });
});

// Incoming
router.post('/incoming', auth, (req, res) => {
  const { from, encrypted_message, message, device_id } = req.body;
  if (!from) return res.status(400).json({ error: '"from" required' });
  const stored = encrypted_message ? (typeof encrypted_message==='string'?encrypted_message:JSON.stringify(encrypted_message)) : message;
  db.prepare('INSERT INTO incoming_messages (device_id,sender,message,encrypted) VALUES(?,?,?,?)').run(device_id||'', from, stored, encrypted_message?1:0);
  res.json({ ok: true });
});

router.get('/incoming', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM incoming_messages ORDER BY id DESC LIMIT 100').all();
  const messages = rows.map(row => {
    if (!row.encrypted) return row;
    try { return { ...row, message: E2E.decrypt(JSON.parse(row.message), serverKeys.privateKey), decrypted:true }; }
    catch { return { ...row, message: '[decryption failed]', decrypted:false }; }
  });
  res.json({ messages });
});

router.get('/history', auth, (req, res) => {
  const { status, limit=100 } = req.query;
  let q = 'SELECT id,phone,status,encrypted,source,created_at,sent_at FROM sms_messages';
  const p = []; if (status) { q+=' WHERE status=?'; p.push(status); }
  q+=' ORDER BY id DESC LIMIT ?'; p.push(Math.min(parseInt(limit)||100,500));
  res.json({ messages: db.prepare(q).all(...p) });
});
router.get('/stats', auth, (req, res) => {
  const rows = db.prepare('SELECT status, COUNT(*) as count FROM sms_messages GROUP BY status').all();
  const stats = { pending:0, sent:0, failed:0 };
  for (const r of rows) stats[r.status]=r.count;
  res.json(stats);
});
router.delete('/clear-sent', auth, (req, res) => {
  const days = parseInt(req.query.days)||30;
  const r = db.prepare("DELETE FROM sms_messages WHERE status='sent' AND sent_at<DATETIME('now',? || ' days')").run(`-${days}`);
  res.json({ ok:true, deleted:r.changes });
});

module.exports = {
  name:'SMS Bridge', description:'E2E encrypted SMS bridge — ECIES P-256 + AES-256-GCM.', version:'2.0.0', router,
  endpoints:[
    {method:'GET',  path:'/pubkey',         auth:false},
    {method:'POST', path:'/generate-code',  auth:true},
    {method:'POST', path:'/link',           auth:false},
    {method:'GET',  path:'/devices',        auth:true},
    {method:'POST', path:'/send',           auth:true},
    {method:'GET',  path:'/pending',        auth:true},
    {method:'POST', path:'/mark-sent',      auth:true},
    {method:'POST', path:'/incoming',       auth:true},
    {method:'GET',  path:'/incoming',       auth:true},
    {method:'GET',  path:'/history',        auth:true},
  ],
};
