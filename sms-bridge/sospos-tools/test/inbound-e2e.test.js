// Stage 3 — inbound the server cannot read.
//
// The claim in BridgeApiClient.kt was that inbound "encrypts to the browser CLIENT's public key and
// NEVER falls back to plaintext". The server only ever returned its own key, so replies were
// encrypted to the server and decrypted by it on the way out. These tests assert the property the
// comment always claimed: what the server stores, the server cannot open.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, call, pairDevice, generateDeviceKey } = require('./helpers');

const KEY = 'test-api-key';
const E2E = require('../tools/sms-bridge/crypto');
const { keyIdFor } = require('../tools/sms-bridge/clientKeys');

describe('end-to-end inbound', () => {
  let server, desktop;

  before(async () => {
    server  = await startServer();
    desktop = generateDeviceKey();   // stands in for the userscript's WebCrypto keypair
    await pairDevice(server, { deviceId: 'phone-A' });
  });
  after(() => server && server.stop());

  test('a desktop registers its public key', async () => {
    const res = await call(server, 'POST', '/client-key', {
      apiKey: KEY, body: { public_key: desktop.publicKeyB64, label: 'Front counter PC' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.key_id, keyIdFor(desktop.publicKeyB64));
  });

  test('a malformed or wrong-curve key is refused', async () => {
    const notAKey = await call(server, 'POST', '/client-key', { apiKey: KEY, body: { public_key: 'bm90LWEta2V5' } });
    assert.equal(notAKey.status, 400);
    assert.equal(notAKey.body.code, 'BAD_KEY');

    const wrongCurve = crypto.generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
    const b64 = Buffer.from(wrongCurve.publicKey.export({ type: 'spki', format: 'der' })).toString('base64');
    const res = await call(server, 'POST', '/client-key', { apiKey: KEY, body: { public_key: b64 } });
    assert.equal(res.status, 400, 'a P-384 key would fail at encrypt time on the phone');
  });

  test('the phone learns the desktop keys at pair time', async () => {
    const paired = await pairDevice(server, { deviceId: 'phone-B' });
    assert.equal(paired.link.client_keys.length, 1);
    assert.equal(paired.link.client_keys[0].public_key, desktop.publicKeyB64);
    assert.equal(paired.link.client_key, desktop.publicKeyB64, 'single-key form for the existing client');
  });

  test('the phone can fetch the desktop keys later', async () => {
    // The path that matters when a reply arrives before any PC has registered.
    const res = await call(server, 'GET', '/client-keys', { apiKey: KEY, deviceId: 'phone-A' });
    assert.equal(res.status, 200);
    assert.equal(res.body.keys.length, 1);
  });

  test('the server relays an inbound reply it cannot read', async () => {
    const plaintext = 'Yes, I will pick it up tomorrow';
    const keyId     = keyIdFor(desktop.publicKeyB64);

    // What the phone does: one envelope per registered desktop key.
    const envelopes = { [keyId]: E2E.encrypt(plaintext, desktop.publicKeyB64) };

    const posted = await call(server, 'POST', '/incoming', {
      apiKey: KEY, deviceId: 'phone-A', body: { from: '+61400000000', device_id: 'phone-A', envelopes },
    });
    assert.equal(posted.status, 200);
    assert.equal(posted.body.e2e, true);

    const res = await call(server, 'GET', '/incoming', { apiKey: KEY });
    const row = res.body.messages[0];
    assert.equal(row.e2e, 1);
    assert.ok(row.envelopes[keyId], 'the envelope is relayed under its key id');
    assert.equal(row.message, undefined, 'and no readable message is served alongside it');

    // The critical assertion: the server's own key does not open this.
    assert.throws(() => E2E.decrypt(row.envelopes[keyId], require('../tools/sms-bridge/crypto')
      .loadOrCreateServerKeys().privateKey), 'the server must not be able to decrypt an e2e reply');

    // The desktop's key does.
    assert.equal(E2E.decrypt(row.envelopes[keyId], desktop.privateKey), plaintext);
  });

  test('every registered desktop gets its own envelope', async () => {
    const second = generateDeviceKey();
    await call(server, 'POST', '/client-key', { apiKey: KEY, body: { public_key: second.publicKeyB64, label: 'Workshop PC' } });

    const keys = (await call(server, 'GET', '/client-keys', { apiKey: KEY })).body.keys;
    assert.equal(keys.length, 2);

    const plaintext = 'both PCs should see this';
    const envelopes = Object.fromEntries(keys.map(k => [k.key_id, E2E.encrypt(plaintext, k.public_key)]));
    await call(server, 'POST', '/incoming', { apiKey: KEY, body: { from: '+61400000001', envelopes } });

    const row = (await call(server, 'GET', '/incoming', { apiKey: KEY })).body.messages[0];
    assert.equal(E2E.decrypt(row.envelopes[keyIdFor(desktop.publicKeyB64)], desktop.privateKey), plaintext);
    assert.equal(E2E.decrypt(row.envelopes[keyIdFor(second.publicKeyB64)], second.privateKey), plaintext);
  });

  test('a legacy phone still works, and the row says the server can read it', async () => {
    const serverKeys = E2E.loadOrCreateServerKeys();
    const envelope   = E2E.encrypt('old app', serverKeys.publicKeyB64);
    const posted = await call(server, 'POST', '/incoming', {
      apiKey: KEY, body: { from: '+61400000002', encrypted_message: envelope },
    });
    assert.equal(posted.body.e2e, false);

    const row = (await call(server, 'GET', '/incoming', { apiKey: KEY })).body.messages[0];
    assert.equal(row.message, 'old app');
    assert.equal(row.server_readable, true, 'the legacy path is labelled, not disguised');
  });

  test('desktop keys are per account', async () => {
    // Nothing about one account's PCs should be visible to another, or a reply could be addressed
    // to a stranger's key.
    const other = await startServer({ ADMIN_KEY: 'admin' });
    try {
      const made = await call(other, 'POST', '/admin/accounts', { adminKey: 'admin', body: { name: 'B' } });
      const minted = await call(other, 'POST', `/admin/accounts/${made.body.account.id}/keys`, { adminKey: 'admin', body: {} });
      const bKey = minted.body.api_key;

      const mine = generateDeviceKey();
      await call(other, 'POST', '/client-key', { apiKey: KEY, body: { public_key: mine.publicKeyB64 } });

      const seenByB = await call(other, 'GET', '/client-keys', { apiKey: bKey });
      assert.deepEqual(seenByB.body.keys, []);
    } finally { other.stop(); }
  });
});
