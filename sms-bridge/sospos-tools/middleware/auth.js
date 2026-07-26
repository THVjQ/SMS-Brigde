// middleware/auth.js — resolves a bearer API key to the account it belongs to.
//
// Every downstream query scopes on req.accountId, so this is the entire tenancy boundary. It was a
// single string comparison against process.env.API_KEY, which meant one credential for everybody
// and no way to revoke a compromised PC without re-keying the whole shop.

const accounts = require('../db/accounts');

// Deprecation notices are throttled: the legacy key is used on every poll, and a warning per
// request would bury everything else in the log.
const LEGACY_WARN_EVERY_MS = 60 * 60 * 1000;
let lastLegacyWarn = 0;

module.exports = function auth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'Unauthorized — missing API key' });

  const found = accounts.findByKey(key);
  if (found) {
    req.accountId = found.account_id;
    req.apiKeyId  = found.id;
    accounts.touchKey(found.id);
    return next();
  }

  // The pre-tenancy shared key keeps working, mapped to the account that owns the migrated rows,
  // so an upgrade does not take the shop offline until every client is reconfigured.
  if (process.env.API_KEY && accounts.safeEqual(key, process.env.API_KEY)) {
    req.accountId = accounts.legacyAccountId();
    req.legacyKey = true;
    const now = Date.now();
    if (now - lastLegacyWarn > LEGACY_WARN_EVERY_MS) {
      lastLegacyWarn = now;
      console.warn('[auth] deprecated: API_KEY from the environment is in use. Mint per-device keys ' +
                   'with `npm run accounts -- mint <account-id> "<label>"` so credentials can be revoked individually.');
    }
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized — invalid or revoked API key' });
};
