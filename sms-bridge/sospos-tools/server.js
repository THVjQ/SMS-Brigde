require('dotenv').config();

const express = require('express');
const path    = require('path');
const { loadTools, getRegistry } = require('./tools/loader');

const app  = express();
const PORT = process.env.PORT || 4000;
const WEB_DIR = path.join(__dirname, 'public');

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// CORS — open for all origins (set ALLOWED_ORIGIN in .env to restrict)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  // x-device-id is how a caller says which phone it is. Without it here, any browser-based client
  // that needs to identify a device is blocked by preflight — the userscript and the Android app
  // are unaffected (GM_xmlhttpRequest bypasses CORS, and the app is native).
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, x-device-id, x-admin-key, ngrok-skip-browser-warning');
  res.setHeader('Access-Control-Expose-Headers', 'X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Health check — no auth
app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Tool registry
app.get('/api/tools', (req, res) => {
  res.json({ tools: getRegistry(), count: getRegistry().length });
});

// Auto-load all tools from tools/ folder
loadTools(app);

// ── Web client ───────────────────────────────────────────────────────────────
//
// Served by this same app rather than a second container, which is what lets the browser talk to
// the API same-origin: no CORS preflight on every call, and no server URL for a person to paste in.
// It is mounted after the tools so a file can never shadow a route.
//
// index:false because the fallback below owns "/" — express.static would otherwise answer it before
// the no-store header is set, and a cached index.html is how a browser ends up running last
// month's client against this month's API.
//
// The assets are deliberately NOT given a max-age. They carry no version in their filenames, so a
// far-future cache would leave a browser running an old app.js against a redeployed API with no way
// to notice — and the whole bundle is well under 100 KB. ETag revalidation costs one 304 per load
// and can never serve a stale client.
app.use(express.static(WEB_DIR, {
  index: false,
  etag: true,
  setHeaders: res => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
}));

// Anything that is not an API path is the single-page client. Restricted to GET/HEAD so a mistyped
// POST still gets its 404 instead of a page.
app.get(/^(?!\/api\/|\/health).*/, (req, res, next) => {
  if (!req.accepts('html')) return next();
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(WEB_DIR, 'index.html'), err => err && next());
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: `No route: ${req.method} ${req.path}` });
});

// Error handler
app.use((err, req, res, _next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n🚀  SMS Bridge server running on port ${PORT}`);
  console.log(`    Web:      http://localhost:${PORT}/`);
  console.log(`    Health:   http://localhost:${PORT}/health`);
  console.log(`    Registry: http://localhost:${PORT}/api/tools\n`);
});
