// config.js — SOS Messenger Extension Default Configuration
// ─────────────────────────────────────────────────────────────────────────────
// Edit this file to set the default server URL and API key.
// Users can still override these in the Settings panel,
// but new installs will start with these values pre-filled.
// ─────────────────────────────────────────────────────────────────────────────

const SOS_CONFIG = {
  // Your server URL — routed through the Cloudflare Tunnel to the TrueNAS box
  serverUrl: 'https://sosmessenger.thvjq.com.au',

  // Your API key — matches API_KEY in your server .env/compose file.
  // The previous key committed here was public — rotate it on the server,
  // then fill in the new key here locally. Do not commit a real key to
  // this repo.
  apiKey: '',

  // App name shown in the popup
  appName: 'SOS Messenger',
};
