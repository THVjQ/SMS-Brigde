# SOS Messenger — Full System Documentation

**Version:** 2.3  
**Built for:** SOS Phone Repairs & Accessories  
**Last updated:** May 2026

---

## Overview

SOS Messenger is a three-part encrypted SMS bridge system that lets you send and receive SMS messages from a browser, routed through a real Android phone. All messages are end-to-end encrypted — the server cannot read message content.

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
├── .env                         Config — API key, port, CORS origin
├── .keys/server.pem             Auto-generated encryption key pair (keep safe)
├── sospos-tools.db              SQLite database — all messages, devices, notes
├── db/database.js               Shared database connection
├── middleware/auth.js            API key authentication middleware
└── tools/
    ├── loader.js                Auto-discovers and mounts tools on startup
    └── sms-bridge/
        ├── index.js             All SMS API routes
        └── crypto.js            ECIES encryption module (P-256 + AES-256-GCM)
```

### Database tables
| Table | Purpose |
|-------|---------|
| `sms_messages` | Outbound SMS queue (extension → phone) |
| `paired_devices` | Linked Android phones and their public keys |
| `pairing_codes` | One-time codes used during device linking |
| `incoming_messages` | SMS received by phone and forwarded to server |

### Plugin system
Any folder inside `tools/` that exports `{ name, router }` is automatically mounted at `/api/tools/<folder-name>`. To add a new tool, copy `tools/example-tool/` and restart the server.

### Encryption (server role)
- Holds its own P-256 key pair (auto-generated, stored in `.keys/server.pem`)
- Receives encrypted blobs from the extension — **cannot read them** (encrypted with phone's key)
- Decrypts incoming SMS forwarded from the phone (encrypted with server's key)
- Stores and relays ciphertext only

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
- ✅ **Confidentiality** — server cannot read message content
- ✅ **Integrity** — GCM auth tag detects any tampering in transit
- ✅ **Forward secrecy** — new ephemeral key per message; past sessions safe even if key is compromised
- ✅ **No third-party dependencies** — pure built-in crypto on all three platforms

---

## API Reference

All endpoints require header: `x-api-key: YOUR_API_KEY`  
Exception: `/health` and `/pubkey` are public.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | No | Server health check |
| GET | `/api/tools` | No | List all loaded tools |
| GET | `/api/tools/sms-bridge/pubkey` | No | Server's public encryption key |
| POST | `/api/tools/sms-bridge/generate-code` | Yes | Generate one-time pairing code |
| POST | `/api/tools/sms-bridge/link` | No | Link Android device + exchange keys |
| GET | `/api/tools/sms-bridge/devices` | Yes | List paired devices |
| POST | `/api/tools/sms-bridge/send` | Yes | Queue outbound SMS |
| GET | `/api/tools/sms-bridge/pending` | Yes | Phone polls for pending messages |
| POST | `/api/tools/sms-bridge/mark-sent` | Yes | Mark message delivered |
| POST | `/api/tools/sms-bridge/mark-failed` | Yes | Mark message failed |
| POST | `/api/tools/sms-bridge/incoming` | Yes | Phone forwards received SMS |
| GET | `/api/tools/sms-bridge/incoming` | Yes | Website reads received messages |
| GET | `/api/tools/sms-bridge/history` | Yes | Full outbound message history |
| GET | `/api/tools/sms-bridge/stats` | Yes | Message counts by status |

---

## Data Flow

### Sending an SMS
```
1. User types phone number + message in Chrome extension
2. Extension fetches phone's public key from server
3. Extension generates ephemeral ECDH key pair
4. Extension derives AES-256-GCM key via HKDF
5. Extension encrypts message → {v, epk, iv, tag, ct}
6. Extension POSTs envelope to server /send
7. Server stores encrypted blob (cannot read it)
8. Android app polls /pending every 5 seconds
9. App receives encrypted blob
10. App decrypts using its private key
11. App sends real SMS via Android SmsManager
12. App POSTs /mark-sent to server
```

### Receiving an SMS (forwarding to website)
```
1. SMS arrives on Android phone
2. SmsReceiver broadcast fires
3. App encrypts SMS body with server's public key
4. App POSTs encrypted blob to server /incoming
5. Server decrypts using its private key
6. Website fetches /incoming (plaintext, server-side decrypted)
```

---

## Multi-Phone Support

Multiple phones can be linked simultaneously. Each gets its own row in `paired_devices` with its own public key. When sending, the server encrypts the message for the most recently active device unless a specific `device_id` is specified.

Future enhancement: per-user accounts so each staff member has their own linked phone and message history.
