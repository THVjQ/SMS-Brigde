// Stage 1 — messages go to one named phone, exactly once.
//
// The failure this guards against is silent: two phones polling the same server both delivered
// every message, and a message encrypted to a device that no longer existed sat pending forever
// with no error at either end.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, call, pairDevice } = require('./helpers');

const KEY = 'test-api-key';

describe('device targeting and claim semantics', () => {
  let server;
  before(async () => { server = await startServer(); });
  after(() => server && server.stop());

  test('the first phone to pair becomes the default target', async () => {
    await pairDevice(server, { deviceId: 'phone-A', label: 'Phone A' });
    const devices = await call(server, 'GET', '/devices', { apiKey: KEY });
    assert.equal(devices.status, 200);
    assert.equal(devices.body.default_device_id, 'phone-A');
  });

  test('send without device_id resolves to the default', async () => {
    const res = await call(server, 'POST', '/send', {
      apiKey: KEY, body: { phone: '0400000000', message: 'hello' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.target.device_id, 'phone-A');
    assert.equal(res.body.encrypted, true);
  });

  test('send to a device with no key is refused, not stored in plaintext', async () => {
    await pairDevice(server, { deviceId: 'phone-keyless', withKey: false });
    const res = await call(server, 'POST', '/send', {
      apiKey: KEY, body: { phone: '0400000000', message: 'x', device_id: 'phone-keyless' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'NO_DEVICE_KEY');

    const history = await call(server, 'GET', '/history', { apiKey: KEY });
    assert.ok(history.body.messages.every(m => m.encrypted === 1),
      'a refused send must not leave an unencrypted row behind');
  });

  test('send to an unknown device is a 404', async () => {
    const res = await call(server, 'POST', '/send', {
      apiKey: KEY, body: { phone: '0400000000', message: 'x', device_id: 'does-not-exist' },
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'DEVICE_NOT_FOUND');
  });

  test('send is ambiguous when several phones are paired and no default resolves', async () => {
    const fresh = await startServer();
    try {
      await pairDevice(fresh, { deviceId: 'p1' });   // claims the default slot
      await pairDevice(fresh, { deviceId: 'p2' });
      await pairDevice(fresh, { deviceId: 'p3' });
      // Retiring the default leaves two phones and no way to infer between them.
      await call(fresh, 'DELETE', '/devices/p1', { apiKey: KEY });

      const res = await call(fresh, 'POST', '/send', { apiKey: KEY, body: { phone: '04', message: 'x' } });
      assert.equal(res.status, 409);
      assert.equal(res.body.code, 'NO_DEFAULT_DEVICE');
    } finally { fresh.stop(); }
  });

  test('/pending requires x-device-id', async () => {
    const res = await call(server, 'GET', '/pending', { apiKey: KEY });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'DEVICE_ID_REQUIRED');
  });

  test('/pending rejects a device that is not paired', async () => {
    const res = await call(server, 'GET', '/pending', { apiKey: KEY, deviceId: 'ghost' });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'DEVICE_NOT_PAIRED');
  });

  test('a phone never sees another phone’s queue', async () => {
    const res = await call(server, 'GET', '/pending', { apiKey: KEY, deviceId: 'phone-keyless' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.messages, []);
  });

  test('claiming hands a message over exactly once', async () => {
    const first = await call(server, 'GET', '/pending', { apiKey: KEY, deviceId: 'phone-A' });
    assert.equal(first.body.messages.length, 1);
    assert.equal(first.body.messages[0].phone, '0400000000');

    const second = await call(server, 'GET', '/pending', { apiKey: KEY, deviceId: 'phone-A' });
    assert.deepEqual(second.body.messages, [], 're-polling must not re-issue a claimed message');
  });

  test('concurrent polls from the same phone do not double-issue', async () => {
    const fresh = await startServer();
    try {
      await pairDevice(fresh, { deviceId: 'racer' });
      for (let i = 0; i < 5; i++) {
        await call(fresh, 'POST', '/send', { apiKey: KEY, body: { phone: '04', message: `m${i}` } });
      }
      const polls = await Promise.all(
        Array.from({ length: 8 }, () => call(fresh, 'GET', '/pending', { apiKey: KEY, deviceId: 'racer' }))
      );
      const ids = polls.flatMap(p => p.body.messages.map(m => m.id));
      assert.equal(ids.length, 5, 'every message issued');
      assert.equal(new Set(ids).size, 5, 'and none issued twice');
    } finally { fresh.stop(); }
  });

  test('mark-sent only accepts the device the message was routed to', async () => {
    const wrong = await call(server, 'POST', '/mark-sent', {
      apiKey: KEY, deviceId: 'phone-keyless', body: { id: 1 },
    });
    assert.equal(wrong.status, 404);

    const right = await call(server, 'POST', '/mark-sent', {
      apiKey: KEY, deviceId: 'phone-A', body: { id: 1 },
    });
    assert.equal(right.status, 200);

    const row = await call(server, 'GET', '/history?id=1', { apiKey: KEY });
    assert.equal(row.body.messages[0].status, 'sent');
  });

  test('deleting a device fails its undeliverable queue and clears the default', async () => {
    const fresh = await startServer();
    try {
      await pairDevice(fresh, { deviceId: 'doomed' });
      await call(fresh, 'POST', '/send', { apiKey: KEY, body: { phone: '04', message: 'never arrives' } });

      const del = await call(fresh, 'DELETE', '/devices/doomed', { apiKey: KEY });
      assert.equal(del.status, 200);
      assert.equal(del.body.failed_messages, 1);

      const devices = await call(fresh, 'GET', '/devices', { apiKey: KEY });
      assert.equal(devices.body.devices.length, 0);
      assert.equal(devices.body.default_device_id, null);

      const stats = await call(fresh, 'GET', '/stats', { apiKey: KEY });
      assert.equal(stats.body.pending, 0);
      assert.equal(stats.body.failed, 1);
    } finally { fresh.stop(); }
  });

  test('the reaper returns a stale claim to pending', async () => {
    // A phone that collects a batch and then loses power must not take those messages with it.
    const fresh = await startServer({ CLAIM_TTL_MS: '1000', REAPER_EVERY_MS: '200' });
    try {
      await pairDevice(fresh, { deviceId: 'flaky' });
      await call(fresh, 'POST', '/send', { apiKey: KEY, body: { phone: '04', message: 'stuck' } });

      const claim = await call(fresh, 'GET', '/pending', { apiKey: KEY, deviceId: 'flaky' });
      assert.equal(claim.body.messages.length, 1);
      // …and now the phone goes dark without calling /mark-sent.

      const before = await call(fresh, 'GET', '/stats', { apiKey: KEY });
      assert.equal(before.body.claimed, 1);

      await new Promise(r => setTimeout(r, 2000));

      const after = await call(fresh, 'GET', '/stats', { apiKey: KEY });
      assert.equal(after.body.claimed, 0);
      assert.equal(after.body.pending, 1);

      const retry = await call(fresh, 'GET', '/pending', { apiKey: KEY, deviceId: 'flaky' });
      assert.equal(retry.body.messages.length, 1, 'the message is deliverable again');
    } finally { fresh.stop(); }
  });

  test('a pairing code cannot be redeemed twice', async () => {
    const { code } = await pairDevice(server, { deviceId: 'phone-reuse' });
    const res = await call(server, 'POST', '/link', {
      body: { pairing_code: code, device_id: 'phone-thief' },
    });
    assert.equal(res.status, 403);
  });

  test('/link is rate limited', async () => {
    const fresh = await startServer();
    try {
      const codes = [];
      for (let i = 0; i < 12; i++) {
        codes.push(await call(fresh, 'POST', '/link', {
          body: { pairing_code: 'DEADBEEF', device_id: `brute-${i}` },
        }));
      }
      assert.ok(codes.some(r => r.status === 429), 'unauthenticated /link must be throttled');
    } finally { fresh.stop(); }
  });
});
