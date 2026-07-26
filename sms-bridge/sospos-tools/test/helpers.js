// test/helpers.js — boots a real server against a throwaway database.
//
// Each suite gets its own DB_DIR, so tests never see each other's devices or messages and a failed
// run leaves nothing behind to poison the next one. The server is spawned as a child process
// because the tool module reads env and opens the database at require time.

const { spawn }   = require('node:child_process');
const fs          = require('node:fs');
const os          = require('node:os');
const path        = require('node:path');
const crypto      = require('node:crypto');

const SERVER_JS = path.join(__dirname, '..', 'server.js');

/** A P-256 SPKI public key in base64 — the same shape a phone uploads at /link. */
function generateDeviceKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    privateKey,
    publicKeyB64: Buffer.from(publicKey.export({ type: 'spki', format: 'der' })).toString('base64'),
  };
}

async function startServer(env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-bridge-test-'));
  const port    = 20000 + Math.floor(Math.random() * 20000);

  const child = spawn(process.execPath, [SERVER_JS], {
    env: { ...process.env, PORT: String(port), DB_DIR: dataDir, API_KEY: 'test-api-key', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  child.stdout.on('data', d => logs.push(d.toString()));
  child.stderr.on('data', d => logs.push(d.toString()));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${logs.join('')}`);
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`server did not start:\n${logs.join('')}`);
    await new Promise(r => setTimeout(r, 100));
  }

  return {
    base,
    dataDir,
    logs,
    api: `${base}/api/tools/sms-bridge`,
    stop() {
      child.kill('SIGKILL');
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Thin request helper: returns { status, body } and never throws on a non-2xx. */
async function call(server, method, path, { apiKey, deviceId, adminKey, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey   !== undefined) headers['x-api-key']   = apiKey;
  if (deviceId !== undefined) headers['x-device-id'] = deviceId;
  if (adminKey !== undefined) headers['x-admin-key'] = adminKey;

  const res  = await fetch(`${server.api}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { _raw: text }; }
  return { status: res.status, body: parsed };
}

/** Mints a code with `apiKey` and redeems it for `deviceId`, as the PC + phone would. */
async function pairDevice(server, { apiKey = 'test-api-key', deviceId, label, withKey = true } = {}) {
  const gen = await call(server, 'POST', '/generate-code', { apiKey });
  if (gen.status !== 200) throw new Error(`generate-code failed: ${JSON.stringify(gen.body)}`);

  const key = withKey ? generateDeviceKey() : null;
  const link = await call(server, 'POST', '/link', {
    body: { pairing_code: gen.body.code, device_id: deviceId, public_key: key && key.publicKeyB64, label },
  });
  if (link.status !== 200) throw new Error(`link failed: ${JSON.stringify(link.body)}`);
  return { code: gen.body.code, key, link: link.body };
}

module.exports = { startServer, call, pairDevice, generateDeviceKey };
