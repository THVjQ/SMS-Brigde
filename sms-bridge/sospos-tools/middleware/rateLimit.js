// middleware/rateLimit.js — small fixed-window limiter, no dependencies.
//
// Aimed at /link and /generate-code. A pairing code is 4 bytes of entropy, which is ample against a
// person typing and useless against an unthrottled attacker on a publicly reachable endpoint —
// /link is unauthenticated by design, so brute force is the whole attack.

const buckets = new Map();   // key → { count, resetAt }

// Bounded so a spray of source addresses cannot grow the map without limit.
const MAX_BUCKETS = 10000;

function sweep(now) {
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}

/**
 * @param {object}  opts
 * @param {number}  opts.windowMs  width of the fixed window
 * @param {number}  opts.max       requests allowed per key per window
 * @param {string}  opts.name      shown in logs
 */
function rateLimit({ windowMs = 60_000, max = 10, name = 'endpoint' } = {}) {
  return function limiter(req, res, next) {
    const now = Date.now();
    if (buckets.size > MAX_BUCKETS) sweep(now);

    // Behind Cloudflare, req.ip is the tunnel's address for every caller, so prefer the forwarded
    // client address when present. Spoofable in general — this is throttling, not authentication.
    const fwd = (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const key = `${name}:${fwd || req.ip || 'unknown'}`;

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      console.warn(`[ratelimit] ${key} exceeded ${max}/${windowMs}ms`);
      return res.status(429).json({ error: `Too many requests — try again in ${retryAfter}s` });
    }
    next();
  };
}

module.exports = rateLimit;
