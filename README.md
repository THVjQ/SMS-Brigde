# SMS Bridge

A three-part system for sending and receiving SMS messages from a browser, routed through a real Android phone.

**Requires a self-hosted Node.js server** — this is not a cloud service. You need your own server (VPS, home server, or a free tier like Railway.app) to run the backend. The server acts as an encrypted relay between the browser extension and the Android app.

---

## Parts

| Folder | What it is |
|--------|-----------|
| `sospos-tools/` | Node.js/Express backend with a plugin system |
| `sms-extension/` | Chrome/Chromium extension |
| `SosPosMessenger/` | Android app (Kotlin) |

---

## Encryption

End-to-end encrypted using **ECIES** — P-256 ECDH key agreement, HKDF-SHA256 key derivation, AES-256-GCM authenticated encryption.

The server stores and relays ciphertext only and **cannot read message content**. Each message uses a fresh ephemeral key pair for forward secrecy.

---

## Requirements

- A server with **Node.js v18+** accessible from both your browser and phone
- **Android 8.0+** (API 26)
- **Chrome or Chromium** browser

---

## Quick start

See [`docs/2_INSTALLATION_GUIDE.md`](docs/2_INSTALLATION_GUIDE.md) for full setup instructions.

**Short version:**

```bash
# 1. Start the server
cd sospos-tools
cp .env.example .env   # edit API_KEY
npm install && npm start

# 2. Load the extension
# chrome://extensions → Developer mode → Load unpacked → sms-extension/

# 3. Build the Android APK
cd SosPosMessenger
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk

# 4. Pair the phone
# Extension → Pair tab → Generate code → enter on phone
```

---

## Documentation

| File | Contents |
|------|----------|
| [`docs/1_SYSTEM_DOCUMENTATION.md`](docs/1_SYSTEM_DOCUMENTATION.md) | Full technical breakdown — architecture, encryption, API reference, data flow |
| [`docs/2_INSTALLATION_GUIDE.md`](docs/2_INSTALLATION_GUIDE.md) | Step-by-step setup for server, extension, and APK |
| [`docs/3_APP_USER_GUIDE.md`](docs/3_APP_USER_GUIDE.md) | Android app user guide |
| [`docs/4_EXTENSION_USER_GUIDE.md`](docs/4_EXTENSION_USER_GUIDE.md) | Chrome extension user guide |

---

## Architecture

```
┌──────────────────┐    encrypted     ┌─────────────┐    encrypted    ┌─────────────────┐
│ Chrome Extension │ ───────────────► │   Server    │ ──────────────► │  Android Phone  │
│  (or Website)    │                  │  (Node.js)  │                  │   SMS Bridge    │
└──────────────────┘                  └─────────────┘                  └────────┬────────┘
                                             ▲                                   │
                                             │         encrypted                 │
                                             └───────────────────────────────────┘
                                                   Incoming SMS forwarded up
```

---

## License

MIT

