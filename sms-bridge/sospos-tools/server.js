require('dotenv').config();

const express = require('express');
const { loadTools, getRegistry } = require('./tools/loader');

const app  = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// CORS — open for all origins (set ALLOWED_ORIGIN in .env to restrict)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, ngrok-skip-browser-warning');
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
  console.log(`    Health:   http://localhost:${PORT}/health`);
  console.log(`    Registry: http://localhost:${PORT}/api/tools\n`);
});
