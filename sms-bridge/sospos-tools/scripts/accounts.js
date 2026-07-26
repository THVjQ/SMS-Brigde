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

const [, , command, ...args] = process.argv;

const usage = () => {
  console.log(`Usage: node scripts/accounts.js <command>

  list                       every account, with its device and active-key counts
  create <name>              create an account
  keys <account-id>          list an account's keys (never the keys themselves)
  mint <account-id> [label]  mint a key — printed once, then only its hash is kept
  revoke <key-id>            revoke a key immediately
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

    default:
      usage();
      process.exit(command ? 1 : 0);
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
