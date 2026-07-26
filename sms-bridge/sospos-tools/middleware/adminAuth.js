// middleware/adminAuth.js — ADMIN_KEY gate for account management.
//
// Deliberately a different credential from any account key: an account key can send texts, an admin
// key can mint credentials for any account. Unset means the admin routes do not exist at all, which
// is the right default for a server reachable from the open internet.

const crypto = require('node:crypto');

const enabled = () => !!process.env.ADMIN_KEY;

module.exports = function adminAuth(req, res, next) {
  // 404 rather than 401 when disabled — an endpoint nobody configured should not advertise itself.
  if (!enabled()) return res.status(404).json({ error: `No route: ${req.method} ${req.path}` });

  const key = req.headers['x-admin-key'];
  if (!key) return res.status(401).json({ error: 'Unauthorized — missing admin key' });

  const a = Buffer.from(String(key), 'utf8');
  const b = Buffer.from(String(process.env.ADMIN_KEY), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Unauthorized — invalid admin key' });
  }
  next();
};

module.exports.enabled = enabled;
