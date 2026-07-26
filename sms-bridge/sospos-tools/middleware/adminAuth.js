// middleware/adminAuth.js — gate for account and user administration.
//
// Two ways in, and they exist for different reasons:
//
//   1. A logged-in user whose role is 'admin'. This is the normal path — the browser admin panel
//      just uses the key it already holds, so there is no second secret to distribute or store.
//   2. ADMIN_KEY from the environment, if set. A break-glass credential for bootstrapping the first
//      admin or recovering when no one can log in. Unset means this path does not exist.
//
// Deliberately NOT the same credential as an account key: an account key sends texts, an admin
// credential mints access for any account.

const crypto = require('node:crypto');
const auth   = require('./auth');
const users  = require('../db/users');

function envKeyMatches(presented) {
  if (!process.env.ADMIN_KEY || !presented) return false;
  const a = Buffer.from(String(presented), 'utf8');
  const b = Buffer.from(String(process.env.ADMIN_KEY), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = function adminAuth(req, res, next) {
  if (envKeyMatches(req.headers['x-admin-key'])) return next();

  // Otherwise fall through to normal key auth and require the resolved user to be an admin.
  if (!req.headers['x-api-key']) {
    return res.status(401).json({ error: 'Unauthorized — admin access required', code: 'ADMIN_REQUIRED' });
  }
  auth(req, res, () => {
    if (!users.isAdmin(req.user)) {
      // 404 rather than 403: a non-admin has no business learning these routes exist.
      return res.status(404).json({ error: `No route: ${req.method} ${req.path}` });
    }
    next();
  });
};

module.exports.envKeyMatches = envKeyMatches;
