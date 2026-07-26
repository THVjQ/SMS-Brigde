#!/usr/bin/env node
// scripts/accounts.js — account and credential administration.
//
//   node scripts/accounts.js list
//   node scripts/accounts.js create "Person 2"
//   node scripts/accounts.js keys 1
//   node scripts/accounts.js mint 1 "Front counter PC"
//   node scripts/accounts.js revoke 7
//
// Run it inside the container so DB_DIR points at the mounted dataset:
//   docker exec -it sms-bridge node scripts/accounts.js list
//
// This talks to the database directly and needs no ADMIN_KEY — shell access to the container is
// already more authority than any API key confers.

require('../db/schema');   // ensures the tables exist even on a database the server has never opened
const accounts = require('../db/accounts');
const users    = require('../db/users');

/**
 * Reads a password from stdin when one is not given as an argument, so it never lands in shell
 * history:  echo -n 'secret' | node scripts/accounts.js adduser 1 luca --admin
 */
function readPassword(arg) {
  if (arg) return arg;
  const fs = require('node:fs');
  try {
    return fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  } catch {
    return '';
  }
}

const [, , command, ...args] = process.argv;

const usage = () => {
  console.log(`Usage: node scripts/accounts.js <command>

  list                       every account, with its device and active-key counts
  create <name>              create an account
  keys <account-id>          list an account's keys (never the keys themselves)
  mint <account-id> [label]  mint a key — printed once, then only its hash is kept
  revoke <key-id>            revoke a key immediately

  users [status]             list people; optionally filter pending/active/denied/suspended
  adduser <account-id> <username> [password] [--admin]
                             create a sign-in, active immediately. Omit the password to
                             read it from stdin and keep it out of shell history:
                               echo -n 'secret' | node scripts/accounts.js adduser 1 luca --admin
  passwd <username> [password]       set a password without knowing the old one
  approve <user-id>          approve a pending sign-up
  deny <user-id>             refuse one, revoking any keys it holds
  suspend <user-id>          revoke access from an active user
`);
};

function table(rows) {
  if (!rows.length) return console.log('  (none)');
  const cols = Object.keys(rows[0]);
  const width = c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length));
  const widths = Object.fromEntries(cols.map(c => [c, width(c)]));
  const line = r => '  ' + cols.map(c => String(r[c] ?? '').padEnd(widths[c])).join('  ');
  console.log(line(Object.fromEntries(cols.map(c => [c, c]))));
  console.log('  ' + cols.map(c => '-'.repeat(widths[c])).join('  '));
  for (const r of rows) console.log(line(r));
}

try {
  switch (command) {
    case 'list':
      table(accounts.listAccounts());
      break;

    case 'create': {
      if (!args[0]) { usage(); process.exit(1); }
      const account = accounts.createAccount(args.join(' '));
      console.log(`Created account ${account.id} "${account.name}".`);
      console.log(`Next: node scripts/accounts.js mint ${account.id} "Their PC"`);
      break;
    }

    case 'keys': {
      if (!args[0]) { usage(); process.exit(1); }
      if (!accounts.getAccount(args[0])) { console.error(`No account ${args[0]}.`); process.exit(1); }
      table(accounts.listKeys(args[0]));
      break;
    }

    case 'mint': {
      if (!args[0]) { usage(); process.exit(1); }
      const minted = accounts.mintKey(args[0], args.slice(1).join(' ') || null);
      console.log(`\nAPI key for account ${minted.account_id}${minted.label ? ` (${minted.label})` : ''}:\n`);
      console.log(`  ${minted.key}\n`);
      console.log('Only its SHA-256 is stored, so this cannot be shown again. Paste it into the');
      console.log(`client now. To revoke: node scripts/accounts.js revoke ${minted.id}\n`);
      break;
    }

    case 'revoke': {
      if (!args[0]) { usage(); process.exit(1); }
      if (!accounts.revokeKey(args[0])) { console.error(`No key ${args[0]}.`); process.exit(1); }
      console.log(`Key ${args[0]} revoked — it stops working on the next request.`);
      break;
    }

    case 'users':
      table(users.list(args[0]));
      break;

    case 'adduser': {
      const admin = args.includes('--admin');
      const rest  = args.filter(a => a !== '--admin');
      const [accountId, username, password] = rest;
      if (!accountId || !username) { usage(); process.exit(1); }
      if (!accounts.getAccount(accountId)) { console.error(`No account ${accountId}.`); process.exit(1); }
      const user = users.register(username, readPassword(password), {
        accountId: Number(accountId), role: admin ? 'admin' : 'user', status: 'active',
      });
      console.log(`Created ${admin ? 'admin' : 'user'} "${user.username}" on account ${user.account_id}, active.`);
      console.log('They can now sign in from the browser — no API key to copy.');
      break;
    }

    case 'passwd': {
      const [username, password] = args;
      if (!username) { usage(); process.exit(1); }
      const user = users.byUsername(username);
      if (!user) { console.error(`No user "${username}".`); process.exit(1); }
      const pw = readPassword(password);
      users.validatePassword(pw);
      require('../db/database')
        .prepare('UPDATE users SET password_hash=? WHERE id=?')
        .run(users.hashPassword(pw), user.id);
      console.log(`Password set for "${user.username}".`);
      break;
    }

    case 'approve':
    case 'deny':
    case 'suspend': {
      if (!args[0]) { usage(); process.exit(1); }
      const status = { approve: 'active', deny: 'denied', suspend: 'suspended' }[command];
      const user = users.setStatus(args[0], status);
      if (!user) { console.error(`No user ${args[0]}.`); process.exit(1); }
      console.log(`"${user.username}" is now ${user.status}.`);
      if (status !== 'active') console.log('Any keys they held have been revoked.');
      break;
    }

    default:
      usage();
      process.exit(command ? 1 : 0);
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
