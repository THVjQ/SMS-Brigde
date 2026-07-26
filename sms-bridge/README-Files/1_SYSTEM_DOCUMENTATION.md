# SOS Messenger — Full System Documentation

**Version:** 2.3  
**Built for:** SOS Phone Repairs & Accessories  
**Last updated:** May 2026

---

## Overview

SOS Messenger is a three-part encrypted SMS bridge system that lets you send and receive SMS messages from a browser, routed through a real Android phone. Messages are end-to-end encrypted in both directions — the server relays ciphertext and holds no key that opens it. (One exception: a phone running an app version older than desktop-key support still encrypts inbound to the server's own key. Those messages are returned flagged `server_readable`.)

```
┌─────────────────┐     encrypted      ┌──────────────┐     encrypted     ┌─────────────────┐
│ Chrome Extension│ ─────────────────► │    Server    │ ────────────────► │  Android Phone  │
│  (or Website)   │                    │  (Node.js)   │                    │  SOS Messenger  │
└─────────────────┘                    └──────────────┘                    └────────┬────────┘
                                              ▲                                     │
                                              │      encrypted                      │
                                              └─────────────────────────────────────┘
                                                    Incoming SMS forwarded up
```

---

## Part 1 — The Server (`sospos-tools`)

### What it does
The server is the central relay. It receives messages from the Chrome extension, queues them, and waits for the Android phone to pick them up. It also receives incoming SMS forwarded from the phone and makes them available to the website.

### Technology
- **Runtime:** Node.js (v18+)
- **Framework:** Express.js
- **Database:** SQLite (via better-sqlite3)
- **Architecture:** Plugin-based — tools auto-load from the `tools/` folder

### Key files
```
sospos-tools/
├── server.js                    Main entry point
├── config.js                    Where persistent state lives (honours DB_DIR)
├── .env                         Config — API_KEY, ADMIN_KEY, PORT, DB_DIR
├── $DB_DIR/.keys/server.pem     Server key pair. Losing it makes stored legacy
│                                inbound messages permanently unreadable.
├── $DB_DIR/sms-bridge.db        SQLite database
├── db/
│   ├── database.js              Shared connection; honours DB_DIR
│   ├── schema.js                Tables + idempotent migrations (shared with the CLI)
│   ├── migrate.js               PRAGMA-guarded column adds, run-once migrations
│   ├── accounts.js              Accounts and API keys (stored as SHA-256 hashes)
│   └── users.js                 Usernames, scrypt passwords, approval status
├── middleware/
│   ├── auth.js                  Resolves an API key to an account and user
│   ├── adminAuth.js             Admin gate — admin role, or ADMIN_KEY break-glass
│   └── rateLimit.js             Fixed-window limiter for auth and pairing
├── scripts/accounts.js          CLI for accounts, keys, users and approvals
├── test/                        node:test suites — run with `npm test`
└── tools/
    ├── loader.js                Auto-discovers and mounts tools on startup
    └── sms-bridge/
        ├── index.js             All SMS API routes
        ├── repo.js              Every DB access, account-scoped by construction
        ├── clientKeys.js        Desktop public keys, per account
        └── crypto.js            ECIES encryption module (P-256 + AES-256-GCM)
```

### Database tables
| Table | Purpose |
|-------|---------|
| `accounts` | A tenant — owns phones, desktops and messages |
| `users` | Sign-ins: username, scrypt password hash, role, approval status |
| `api_keys` | Credentials, stored as SHA-256 hashes only, individually revocable |
| `sms_messages` | Outbound SMS queue, each row targeting one device |
| `paired_devices` | Linked Android phones and their public keys |
| `pairing_codes` | One-time codes used during device linking; carry the account |
| `client_keys` | Desktop public keys — who inbound replies get encrypted to |
| `incoming_messages` | SMS received by a phone and relayed to the desktops |
| `schema_migrations` | Which run-once migrations have been applied |

Every table above carries an `account_id`. All database access goes through `repo.js`, where each
function takes the account id as a required first argument and throws without one — so a missed
scope fails immediately instead of quietly returning another tenant's rows.

### Plugin system
Any folder inside `tools/` that exports `{ name, router }` is automatically mounted at `/api/tools/<folder-name>`. To add a new tool, copy `tools/example-tool/` and restart the server.

### Encryption (server role)
- Relays ciphertext in both directions and **holds no key that opens it**
- Outbound: the browser seals the message to the phone's public key before sending
- Inbound: the phone seals one envelope per registered desktop key; the server passes them through
- Refuses to queue anything it cannot route or that has no key to seal to — there is no plaintext
  fallback anywhere, because every silent failure in this system traced back to one
- Still holds its own key pair (`$DB_DIR/.keys/server.pem`) solely to decrypt inbound from phone
  apps too old to know about desktop keys; those responses are flagged `server_readable`

---

## Part 2 — The Chrome Extension (`sms-extension`)

### What it does
A browser popup with three tabs: Send, History, and Pair. Lets you type a phone number and message, encrypts it with the Android phone's public key, and sends it to the server.

### Technology
- **Manifest:** Chrome Extension MV3
- **Encryption:** Web Crypto API (built into Chrome — no libraries needed)
- **QR codes:** qrcode.js (local, bundled)
- **Config:** `config.js` — edit this file to set default server URL and API key

### Key files
```
sms-extension/
├── manifest.json       Extension config — permissions, icons
├── config.js           DEFAULT server URL and API key — edit this to deploy
├── popup.html          UI layout — three tabs
├── popup.js            All logic — crypto, API calls, tab switching
├── qrcode.min.js       QR code generator (local, no CDN)
├── icon16.png          Toolbar icon (16px)
├── icon32.png          Toolbar icon (32px)
├── icon48.png          Popup header icon (48px)
└── icon128.png         Extension store icon (128px)
```

### Tabs
| Tab | Purpose |
|-----|---------|
| Send | Enter phone number + message, send encrypted SMS |
| History | View all messages sent via extension with status and timestamp |
| Pair | Generate pairing code + QR for linking Android phones |

### Encryption (extension role)
- Fetches the phone's P-256 public key from the server
- Generates a fresh ephemeral key pair per message (forward secrecy)
- Encrypts message using ECDH + HKDF + AES-256-GCM
- Sends encrypted blob to server — **server cannot read it**
- Falls back to server-side encryption if phone key not yet fetched

### Config file
`config.js` is the only file you need to edit when deploying:
```javascript
const SOS_CONFIG = {
  serverUrl: 'https://app.sospos.com.au',  // ← change this
  apiKey:    'your-api-key-here',           // ← change this
  appName:   'SOS Messenger',
};
```

---

## Part 3 — The Android App (`SosPosMessenger`)

### What it does
A full Android SMS app that:
- Works as a replacement for Samsung/Google Messages (can be set as default SMS app)
- Runs a background service that polls the server every 5 seconds for outbound messages
- Receives incoming SMS, shows notifications, and forwards them (encrypted) to the server
- Has a built-in Notes section for storing customer or repair information

### Technology
- **Language:** Kotlin
- **Min Android:** API 26 (Android 8.0)
- **UI:** Material Design 3
- **HTTP:** OkHttp
- **Database:** SQLite (local notes and message log)

### Key files
```
app/src/main/java/com/sospos/messenger/
├── App.kt                          Application class — initialisation
├── MainActivity.kt                 Bottom navigation host
├── crypto/
│   ├── E2EEncryption.kt            ECDH + AES-256-GCM encryption
│   └── KeyManager.kt               Manages device key pair (SharedPreferences)
├── db/
│   ├── AppDatabase.kt              Local SQLite — notes, incoming log, queue
│   ├── Prefs.kt                    SharedPreferences wrapper
│   ├── ApiClient.kt                All server API calls with encryption
│   └── SmsHelper.kt                Read/send SMS via Android system provider
├── ui/
│   ├── link/LinkActivity.kt        Pairing screen (first launch)
│   ├── messages/
│   │   ├── MessagesFragment.kt     Conversation list
│   │   ├── ConversationActivity.kt Chat thread with bubbles
│   │   ├── BubbleAdapter.kt        Message bubble renderer
│   │   └── SendActivity.kt         Default SMS app intent handler
│   ├── notes/
│   │   ├── NotesFragment.kt        Notes list
│   │   ├── NotesAdapter.kt         Notes card renderer
│   │   └── NoteEditActivity.kt     Full-screen note editor
│   └── settings/SettingsFragment.kt Settings — server URL, permissions, unlink
├── services/SmsPollingService.kt   Background service — polls server every 5s
└── receivers/
    ├── SmsReceiver.kt              Receives incoming SMS, forwards to server
    └── BootReceiver.kt             Auto-starts service on phone reboot
```

### Encryption (app role)
- Generates a P-256 key pair on first launch (stored in SharedPreferences)
- Sends public key to server during pairing
- Receives encrypted message blobs from server
- Decrypts them using its private key (never leaves the device)
- Encrypts incoming SMS with server's public key before forwarding

### Background service
`SmsPollingService` runs as a foreground service (shown in notification bar). It:
- Polls `/api/tools/sms-bridge/pending` every 5 seconds
- Decrypts any pending messages using the device private key
- Sends them as real SMS via Android's `SmsManager`
- Marks them as sent on the server
- Auto-restarts if killed by Android
- Starts automatically on phone reboot via `BootReceiver`

---

## Encryption Architecture

### Algorithm
**ECIES** — Elliptic Curve Integrated Encryption Scheme

| Component | Details |
|-----------|---------|
| Key agreement | ECDH with P-256 (secp256r1) |
| Key derivation | HKDF-SHA256 |
| Symmetric encryption | AES-256-GCM (12-byte IV, 16-byte auth tag) |
| Forward secrecy | Fresh ephemeral key pair per message |

### Wire format (JSON envelope)
```json
{
  "v":   1,
  "epk": "<base64 DER SPKI — sender's ephemeral public key>",
  "iv":  "<base64 12 bytes — AES-GCM nonce>",
  "tag": "<base64 16 bytes — GCM authentication tag>",
  "ct":  "<base64 — ciphertext>"
}
```

### Security properties
- ✅ **Confidentiality** — the server cannot read message content in either direction
- ✅ **Integrity** — GCM auth tag detects any tampering in transit
- ✅ **Forward secrecy** — new ephemeral key per message; past sessions safe even if a key leaks
- ✅ **No third-party dependencies** — built-in crypto on all three platforms
- ✅ **Cross-implementation tests** — the scheme is implemented three times (`node:crypto`, JCA,
  WebCrypto) and the suite proves each can open what the others seal
- ❌ **Metadata** — phone numbers, timing, sizes and delivery status are never encrypted
- ❌ **The server operator** — is outside the account boundary; they hold the database and filesystem

---

## API Reference

Authenticated endpoints take `x-api-key: <key>`, which resolves to an account and, if the key came
from signing in, to a user. Every response is scoped to that account. Paths below omit the
`/api/tools/sms-bridge` prefix.

**Public**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health check (no prefix) |
| GET | `/api/tools` | List loaded tools and their version |
| GET | `/pubkey` | Server's public key — legacy inbound only |
| POST | `/link` | Redeem a pairing code. Unauthenticated by design: the code is the credential, and it carries the account the phone joins. Rate limited. |

**Sign-in** — rate limited to 10/minute

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Request an account. First one on a fresh server becomes admin; the rest are `pending`. |
| POST | `/auth/login` | Exchange username + password for an API key for this browser |
| POST | `/auth/change-password` | Change a password given the current one |
| GET | `/auth/me` | Who the presented key belongs to, and whether they are an admin |

**Messaging** — require a valid key

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/generate-code` | Mint a one-time pairing code against the caller's account |
| GET | `/devices` | Paired phones, plus the account's default |
| DELETE | `/devices/:device_id` | Retire a phone; fails anything still queued for it |
| PUT | `/devices/:device_id/default` | Set the account's default target |
| POST | `/send` | Queue an outbound SMS to a named device. 404 unknown device, 409 if it has no key or the target is ambiguous. |
| GET | `/pending` | Phone claims its queued messages. Requires `x-device-id`. |
| POST | `/mark-sent` / `/mark-failed` | Confirm an outcome; only for the device the message was routed to |
| POST | `/incoming` | Phone relays a received SMS as per-desktop envelopes |
| GET | `/incoming` | Desktops read replies and decrypt their own envelope |
| POST | `/client-key` | Register this desktop's public key |
| GET | `/client-keys` | The desktop keys a phone must encrypt replies to |
| DELETE | `/client-keys/:key_id` | Remove a desktop key |
| GET | `/history` | Outbound history; `?id=` for one message, to confirm delivery |
| GET | `/stats` | Message counts by status |
| DELETE | `/clear-sent` | Prune sent messages older than `?days=` |

**Administration** — require an admin user, or the `ADMIN_KEY` break-glass header. A valid
non-admin key gets 404 rather than 403, so these routes are not advertised to people who cannot
use them.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/users` | Everyone; `?status=pending` is the approval queue |
| POST | `/admin/users/:id/status` | Approve, deny, suspend or reactivate. Anything but `active` revokes their keys. Refuses to remove the last admin. |
| GET / POST | `/admin/accounts` | List or create accounts |
| GET / POST | `/admin/accounts/:id/keys` | List keys, or mint one (plaintext shown once) |
| DELETE | `/admin/keys/:id` | Revoke a key immediately |

---

## Data Flow

### Sending an SMS
```
 1. User types phone number + message in the browser
 2. Browser fetches the target phone's public key from /devices
 3. Browser generates an ephemeral ECDH key pair
 4. Browser derives an AES-256-GCM key via HKDF
 5. Browser encrypts the message → {v, epk, iv, tag, ct}
 6. Browser POSTs the envelope to /send, naming the target device
 7. Server refuses if the device is unknown, keyless or ambiguous;
    otherwise stores the ciphertext with target_device_id set
 8. Android app polls /pending, which CLAIMS its own rows atomically —
    another phone on the same account can never receive them
 9. App decrypts using its private key
10. App sends the real SMS via Android SmsManager
11. App POSTs /mark-sent, accepted only for the device it was routed to
12. Browser polls /history?id= and reports delivered, failed, or
    explicitly still-unconfirmed — never a bare "queued"

A claim left unconfirmed for five minutes is returned to the queue by the reaper, covering a phone
that collects a batch and then loses power.
```

### Receiving an SMS (forwarding to the desktops)
```
1. SMS arrives on the Android phone
2. SmsReceiver broadcast fires
3. App reads the account's registered desktop keys (refreshed every 5 minutes,
   so a PC added after pairing starts receiving replies on its own)
4. App encrypts the body ONCE PER DESKTOP KEY, filed under each key's id
5. App POSTs the envelopes map to /incoming
6. Server stores it verbatim — it holds no key that opens any of them
7. Each desktop fetches /incoming and decrypts the envelope under its own key id
```

If no desktop key is known yet, or the network is down, the reply is queued on the phone in bounded
persistent storage and retried on every poll. It is never sent in plaintext, and — unlike before —
never silently dropped.

---

## Multi-Phone Support

Multiple phones can be linked simultaneously. Each gets its own row in `paired_devices` with its own public key. When sending, the server encrypts the message for the most recently active device unless a specific `device_id` is specified.

Future enhancement: per-user accounts so each staff member has their own linked phone and message history.
