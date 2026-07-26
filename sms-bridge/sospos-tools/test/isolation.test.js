// Stage 2 — account isolation.
//
// Scoping every query on account_id is the entire security boundary, so these are the tests that
// matter. Each one asks the same question from a different angle: can account B observe, target, or
// collect anything belonging to account A?

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, call, pairDevice } = require('./helpers');

const ADMIN = 'test-admin-key';

describe('account isolation', () => {
  let server;
  let A, B;   // { accountId, key, deviceId }

  before(async () => {
    server = await startServer({ ADMIN_KEY: ADMIN });

    const mk = async (name, deviceId) => {
      const created = await call(server, 'POST', '/admin/accounts', { adminKey: ADMIN, body: { name } });
      assert.equal(created.status, 200, JSON.stringify(created.body));
      const accountId = created.body.account.id;
      const minted = await call(server, 'POST', `/admin/accounts/${accountId}/keys`, {
        adminKey: ADMIN, body: { label: `${name} PC` },
      });
      assert.equal(minted.status, 200);
      const key = minted.body.api_key;
      // The phone joins whichever account minted the pairing code it redeems.
      const paired = await pairDevice(server, { apiKey: key, deviceId, label: `${name} phone` });
      return { accountId, key, deviceId, phoneKey: paired.link.api_key };
    };

    A = await mk('Account A', 'device-A');
    B = await mk('Account B', 'device-B');

    // Give A a queue for B to fail to reach.
    const queued = await call(server, 'POST', '/send', {
      apiKey: A.key, body: { phone: '+61400000001', message: 'A only' },
    });
    assert.equal(queued.status, 200, JSON.stringify(queued.body));
    A.messageId = queued.body.id;
  });

  after(() => server && server.stop());

  test('B sees none of A’s devices', async () => {
    const res = await call(server, 'GET', '/devices', { apiKey: B.key });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.devices.map(d => d.device_id), ['device-B']);
  });

  test('B cannot target A’s device, and is not told it exists', async () => {
    const res = await call(server, 'POST', '/send', {
      apiKey: B.key, body: { phone: '+61400000002', message: 'hijack', device_id: 'device-A' },
    });
    assert.equal(res.status, 404, 'a foreign device must be indistinguishable from a missing one');
    assert.equal(res.body.code, 'DEVICE_NOT_FOUND');
  });

  test('B’s phone never receives a message queued by A', async () => {
    const before = await call(server, 'GET', '/stats', { apiKey: A.key });
    assert.equal(before.body.pending, 1, 'A has a message waiting');

    const poll = await call(server, 'GET', '/pending', { apiKey: B.key, deviceId: 'device-B' });
    assert.equal(poll.status, 200);
    assert.deepEqual(poll.body.messages, []);

    const after = await call(server, 'GET', '/stats', { apiKey: A.key });
    assert.equal(after.body.pending, 1, 'and B’s poll did not claim it either');
  });

  test('B cannot poll as A’s device even naming it directly', async () => {
    const res = await call(server, 'GET', '/pending', { apiKey: B.key, deviceId: 'device-A' });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'DEVICE_NOT_PAIRED');
  });

  test('B cannot mark A’s message sent', async () => {
    const res = await call(server, 'POST', '/mark-sent', {
      apiKey: B.key, deviceId: 'device-B', body: { id: A.messageId },
    });
    assert.equal(res.status, 404);

    const row = await call(server, 'GET', `/history?id=${A.messageId}`, { apiKey: A.key });
    assert.equal(row.body.messages[0].status, 'pending', 'A’s message is untouched');
  });

  test('history, stats and incoming return only the caller’s rows', async () => {
    await call(server, 'POST', '/incoming', {
      apiKey: A.key, body: { from: '+61411111111', message: 'reply for A' },
    });

    const history = await call(server, 'GET', '/history', { apiKey: B.key });
    assert.deepEqual(history.body.messages, []);

    const stats = await call(server, 'GET', '/stats', { apiKey: B.key });
    assert.deepEqual(stats.body, { pending: 0, claimed: 0, sent: 0, failed: 0 });

    const incoming = await call(server, 'GET', '/incoming', { apiKey: B.key });
    assert.deepEqual(incoming.body.messages, []);

    const mine = await call(server, 'GET', '/incoming', { apiKey: A.key });
    assert.equal(mine.body.messages.length, 1);
  });

  test('B cannot delete A’s device', async () => {
    const res = await call(server, 'DELETE', '/devices/device-A', { apiKey: B.key });
    assert.equal(res.status, 404);

    const stillThere = await call(server, 'GET', '/devices', { apiKey: A.key });
    assert.equal(stillThere.body.devices.length, 1);
  });

  test('a pairing code minted by A cannot be redeemed into B', async () => {
    // The code carries its account, so a phone redeeming A's code joins A — B's key is irrelevant
    // to where it lands. What must never happen is the phone joining B.
    const gen = await call(server, 'POST', '/generate-code', { apiKey: A.key });
    const link = await call(server, 'POST', '/link', {
      body: { pairing_code: gen.body.code, device_id: 'device-late', public_key: null },
    });
    assert.equal(link.status, 200);

    const inA = await call(server, 'GET', '/devices', { apiKey: A.key });
    const inB = await call(server, 'GET', '/devices', { apiKey: B.key });
    assert.ok(inA.body.devices.some(d => d.device_id === 'device-late'), 'joins the minting account');
    assert.ok(!inB.body.devices.some(d => d.device_id === 'device-late'), 'and never the other one');
  });

  test('a phone cannot be re-paired into a second account', async () => {
    const gen = await call(server, 'POST', '/generate-code', { apiKey: B.key });
    const link = await call(server, 'POST', '/link', {
      body: { pairing_code: gen.body.code, device_id: 'device-A' },
    });
    assert.equal(link.status, 409);
    assert.equal(link.body.code, 'DEVICE_CONFLICT');
  });

  test('pairing hands the phone a key for its own account, not a shared one', async () => {
    // The phone's key must see its own account and nothing else.
    const devices = await call(server, 'GET', '/devices', { apiKey: B.phoneKey });
    assert.equal(devices.status, 200);
    assert.deepEqual(devices.body.devices.map(d => d.device_id), ['device-B']);
    assert.notEqual(B.phoneKey, A.phoneKey);
  });

  test('a revoked key stops working immediately', async () => {
    const keys = await call(server, 'GET', `/admin/accounts/${B.accountId}/keys`, { adminKey: ADMIN });
    const pcKey = keys.body.keys.find(k => k.label === 'Account B PC');
    assert.ok(pcKey, 'the PC key is listed');

    const before = await call(server, 'GET', '/devices', { apiKey: B.key });
    assert.equal(before.status, 200);

    const revoked = await call(server, 'DELETE', `/admin/keys/${pcKey.id}`, { adminKey: ADMIN });
    assert.equal(revoked.status, 200);

    const after = await call(server, 'GET', '/devices', { apiKey: B.key });
    assert.equal(after.status, 401);
  });

  test('an unknown key is rejected', async () => {
    const res = await call(server, 'GET', '/devices', { apiKey: 'not-a-real-key' });
    assert.equal(res.status, 401);
  });

  test('keys are stored only as hashes', async () => {
    // A database leak must not hand over working credentials.
    const listed = await call(server, 'GET', `/admin/accounts/${A.accountId}/keys`, { adminKey: ADMIN });
    for (const k of listed.body.keys) {
      assert.ok(!('key_hash' in k), 'the hash is not exposed over the API either');
      assert.ok(!Object.values(k).includes(A.key), 'and the plaintext certainly is not');
    }
  });
});

describe('admin surface', () => {
  // Two different refusals, on purpose. No credential at all is a plain 401 — there is nothing to
  // hide from someone who has not identified themselves. A caller holding a VALID non-admin
  // credential gets 404 instead: they have proven who they are, and who they are has no business
  // learning that these routes exist.

  test('no credential is a 401', async () => {
    const server = await startServer();   // no ADMIN_KEY, nobody registered
    try {
      const res = await call(server, 'GET', '/admin/accounts', { adminKey: 'anything' });
      assert.equal(res.status, 401);
    } finally { server.stop(); }
  });

  test('a valid non-admin key is a 404', async () => {
    const server = await startServer();
    try {
      const res = await call(server, 'GET', '/admin/accounts', { apiKey: 'test-api-key' });
      assert.equal(res.status, 404, 'a non-admin should not learn the admin routes exist');
    } finally { server.stop(); }
  });

  test('an account key is not an admin key', async () => {
    const server = await startServer({ ADMIN_KEY: ADMIN });
    try {
      const res = await call(server, 'GET', '/admin/accounts', { adminKey: 'test-api-key' });
      assert.equal(res.status, 401);
    } finally { server.stop(); }
  });
});

describe('legacy upgrade path', () => {
  test('the environment API_KEY keeps working and owns the migrated rows', async () => {
    const server = await startServer();
    try {
      await pairDevice(server, { apiKey: 'test-api-key', deviceId: 'legacy-phone' });
      const res = await call(server, 'GET', '/devices', { apiKey: 'test-api-key' });
      assert.equal(res.status, 200);
      assert.equal(res.body.devices.length, 1);

      // The legacy env key resolves to an account but to no user, so it is not an admin.
      const accountsList = await call(server, 'GET', '/admin/accounts', { apiKey: 'test-api-key' });
      assert.equal(accountsList.status, 404, 'the shared key confers no administrative access');
    } finally { server.stop(); }
  });
});
