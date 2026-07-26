// Sign-in, the approval queue, and the admin boundary.
//
// Signup is open because the alternative is the owner minting a credential by hand every time. What
// makes that safe is that a new account can do nothing until approved — so the tests that matter
// are the ones proving a pending account is genuinely inert, and that being a user is not the same
// as being an admin.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, call } = require('./helpers');

const PW = 'correct-horse-battery';

async function post(server, path, body, opts = {}) {
  return call(server, 'POST', path, { body, ...opts });
}

describe('registration and sign-in', () => {
  let server, admin;

  before(async () => {
    // The real limit is 10/minute; this suite makes far more sign-in calls than that in a second.
    // A dedicated test below exercises the throttle at its production setting.
    server = await startServer({ AUTH_RATE_MAX: '1000' });
    // First registration on an empty server becomes the administrator — otherwise nobody could ever
    // approve anyone, including themselves.
    const first = await post(server, '/auth/register', { username: 'owner', password: PW });
    assert.equal(first.status, 200);
    assert.equal(first.body.user.role, 'admin');
    assert.equal(first.body.user.status, 'active');
    assert.equal(first.body.pending, false);

    const login = await post(server, '/auth/login', { username: 'owner', password: PW });
    assert.equal(login.status, 200);
    admin = login.body.api_key;
  });

  after(() => server && server.stop());

  test('a later signup is pending, not active', async () => {
    const res = await post(server, '/auth/register', { username: 'person2', password: PW });
    assert.equal(res.status, 202);
    assert.equal(res.body.pending, true);
    assert.equal(res.body.user.status, 'pending');
    assert.equal(res.body.user.role, 'user');
  });

  test('a pending account cannot sign in', async () => {
    const res = await post(server, '/auth/login', { username: 'person2', password: PW });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'PENDING');
    assert.ok(!res.body.api_key, 'no credential is issued');
  });

  test('a wrong password and an unknown user look identical', async () => {
    const wrong   = await post(server, '/auth/login', { username: 'owner', password: 'not-the-password' });
    const missing = await post(server, '/auth/login', { username: 'nobody-here', password: PW });
    assert.equal(wrong.status, 401);
    assert.equal(missing.status, 401);
    assert.deepEqual(wrong.body, missing.body, 'the response must not reveal who has an account');
  });

  test('usernames are unique regardless of case', async () => {
    const res = await post(server, '/auth/register', { username: 'OWNER', password: PW });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'USERNAME_TAKEN');
  });

  test('weak passwords and bad usernames are refused', async () => {
    const weak = await post(server, '/auth/register', { username: 'shortpw', password: 'abc' });
    assert.equal(weak.body.code, 'WEAK_PASSWORD');
    const bad = await post(server, '/auth/register', { username: 'no spaces', password: PW });
    assert.equal(bad.body.code, 'BAD_USERNAME');
  });

  test('signing in yields a working, account-scoped key', async () => {
    const me = await call(server, 'GET', '/auth/me', { apiKey: admin });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.username, 'owner');
    assert.equal(me.body.is_admin, true);

    const devices = await call(server, 'GET', '/devices', { apiKey: admin });
    assert.equal(devices.status, 200);
  });

  test('approval lets them in, and their account is their own', async () => {
    const pending = await call(server, 'GET', '/admin/users?status=pending', { apiKey: admin });
    const person2 = pending.body.users.find(u => u.username === 'person2');
    assert.ok(person2, 'the request is queued for the admin');

    const approved = await call(server, 'POST', `/admin/users/${person2.id}/status`, {
      apiKey: admin, body: { status: 'active' },
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.user.status, 'active');

    const login = await post(server, '/auth/login', { username: 'person2', password: PW });
    assert.equal(login.status, 200);

    // Separate account from the owner's — a new signup is a new tenant.
    const me = await call(server, 'GET', '/auth/me', { apiKey: login.body.api_key });
    assert.notEqual(me.body.account_id, 1);
    assert.equal(me.body.is_admin, false);
  });

  test('a normal user cannot reach the admin routes, and is not told they exist', async () => {
    const login = await post(server, '/auth/login', { username: 'person2', password: PW });
    const res = await call(server, 'GET', '/admin/users', { apiKey: login.body.api_key });
    assert.equal(res.status, 404);
  });

  test('a normal user cannot approve themselves into admin', async () => {
    const login = await post(server, '/auth/login', { username: 'person2', password: PW });
    const me = await call(server, 'GET', '/auth/me', { apiKey: login.body.api_key });
    const res = await call(server, 'POST', `/admin/users/${me.body.user.id}/status`, {
      apiKey: login.body.api_key, body: { status: 'active' },
    });
    assert.equal(res.status, 404);
  });

  test('suspending revokes the keys they already hold', async () => {
    const login = await post(server, '/auth/login', { username: 'person2', password: PW });
    const theirKey = login.body.api_key;
    assert.equal((await call(server, 'GET', '/devices', { apiKey: theirKey })).status, 200);

    const me = await call(server, 'GET', '/auth/me', { apiKey: theirKey });
    await call(server, 'POST', `/admin/users/${me.body.user.id}/status`, {
      apiKey: admin, body: { status: 'suspended' },
    });

    const after = await call(server, 'GET', '/devices', { apiKey: theirKey });
    assert.equal(after.status, 401, 'a suspension that leaves working credentials is not a suspension');
  });

  test('the last active admin cannot lock everyone out', async () => {
    const me = await call(server, 'GET', '/auth/me', { apiKey: admin });
    const res = await call(server, 'POST', `/admin/users/${me.body.user.id}/status`, {
      apiKey: admin, body: { status: 'suspended' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'LAST_ADMIN');
  });

  test('a password change invalidates the old password only', async () => {
    const changed = await post(server, '/auth/change-password', {
      username: 'owner', password: PW, new_password: 'a-brand-new-password',
    });
    assert.equal(changed.status, 200);

    assert.equal((await post(server, '/auth/login', { username: 'owner', password: PW })).status, 401);
    assert.equal((await post(server, '/auth/login', { username: 'owner', password: 'a-brand-new-password' })).status, 200);
  });

  test('passwords are never stored in the clear', async () => {
    // Read the database directly — the only way to prove what is actually on disk.
    const run = require('node:child_process').spawnSync(process.execPath, ['-e', `
      process.env.DB_DIR = ${JSON.stringify(server.dataDir)};
      const db = require(${JSON.stringify(require.resolve('../db/database'))});
      console.error(JSON.stringify(db.prepare('SELECT username, password_hash FROM users').all()));
    `], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    // database.js logs its path on stdout; the payload goes to stderr to keep them apart.
    const rows = JSON.parse(run.stderr.trim().split('\n').pop());
    assert.ok(rows.length >= 2);
    for (const row of rows) {
      assert.ok(row.password_hash.startsWith('scrypt$'), `${row.username} hashed with scrypt`);
      assert.ok(!row.password_hash.includes(PW), 'and the password itself is nowhere in it');
    }
  });
});

describe('sign-in throttling', () => {
  test('repeated guesses are rate limited at the production setting', async () => {
    const server = await startServer();
    try {
      await post(server, '/auth/register', { username: 'owner', password: PW });
      const attempts = [];
      for (let i = 0; i < 14; i++) {
        attempts.push(await post(server, '/auth/login', { username: 'owner', password: `guess-${i}` }));
      }
      assert.ok(attempts.some(r => r.status === 429), 'password guessing must be throttled');
    } finally { server.stop(); }
  });
});

describe('the ADMIN_KEY break-glass path', () => {
  test('still works when nobody can sign in', async () => {
    const server = await startServer({ ADMIN_KEY: 'break-glass' });
    try {
      const res = await call(server, 'GET', '/admin/users', { adminKey: 'break-glass' });
      assert.equal(res.status, 200);
    } finally { server.stop(); }
  });

  test('is closed when unset', async () => {
    const server = await startServer();
    try {
      const res = await call(server, 'GET', '/admin/users', { adminKey: 'anything' });
      assert.equal(res.status, 401);
    } finally { server.stop(); }
  });
});
