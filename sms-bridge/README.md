# SMS Bridge

A three-part system for sending and receiving SMS messages from a browser, routed through a real Android phone.

- **Parts:** Node.js/Express server, Chrome/Chromium extension, Android app (Kotlin), plus a companion [Tampermonkey script](https://github.com/THVjQ/sos-sms-sender) for SOS POS
- **Requires:** your own self-hosted server — this is not a cloud service. A VPS, home server, TrueNAS box, or a free tier like Railway.app all work.
- **Encryption:** ECIES — P-256 ECDH + HKDF-SHA256 + AES-256-GCM

---

## What it does, in one breath

The browser extension (or the Tampermonkey script on SOS POS) sends a message to your self-hosted server, which relays it to the SOS Messenger Android app on a paired phone, which sends it as a real SMS through your carrier — and the same path works in reverse for replies.

---

## Parts

| Folder | What it is |
|--------|-----------|
| `sospos-tools/` | Node.js/Express backend with a plugin system |
| `sms-extension/` | Chrome/Chromium extension |
| `SosPosMessenger/` | Android app (Kotlin) |

---

## Encryption

End-to-end encrypted using **ECIES** — P-256 ECDH key agreement, HKDF-SHA256 key derivation, AES-256-GCM authenticated encryption. Each message uses a fresh ephemeral key pair for forward secrecy.

The server stores and relays ciphertext only and **cannot read outbound message content** (browser → phone). Inbound messages (phone → browser) are decrypted server-side to relay them to the browser extension — see [`../PRIVACY_POLICY.md`](../PRIVACY_POLICY.md) for the full breakdown.

---

## Security — generate your own API key

Every request to the server is gated by a single `API_KEY`, configured in the server's `.env`/compose file and matched in the Android app, browser extension, and Tampermonkey script settings.

1. Generate one: `openssl rand -hex 32`
2. Set it as `API_KEY` in your server's `.env` or compose file
3. Enter the same value in the Android app Settings, the extension's Settings panel, and the Tampermonkey script's ⚙️ Bridge Settings

**Always generate a fresh, random key** — never commit it to this repo.

> An earlier default key was accidentally committed to `sms-extension/config.js` and made public. If a server you're running still uses that key, rotate it immediately.

---

## Requirements

- A server with **Node.js v18+** (or Docker), accessible from both your browser and phone
- **Android 8.0+** (API 26)
- **Chrome or Chromium** browser

---

## Quick start

See [`README-Files/2_INSTALLATION_GUIDE.md`](README-Files/2_INSTALLATION_GUIDE.md) for full setup instructions, or [`docker-compose.truenas.yml`](docker-compose.truenas.yml) for a TrueNAS SCALE Custom App deployment.

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
| [`README-Files/1_SYSTEM_DOCUMENTATION.md`](README-Files/1_SYSTEM_DOCUMENTATION.md) | Full technical breakdown — architecture, encryption, API reference, data flow |
| [`README-Files/2_INSTALLATION_GUIDE.md`](README-Files/2_INSTALLATION_GUIDE.md) | Step-by-step setup for server, extension, and APK |
| [`README-Files/3_APP_USER_GUIDE.md`](README-Files/3_APP_USER_GUIDE.md) | Android app user guide |
| [`README-Files/4_EXTENSION_USER_GUIDE.md`](README-Files/4_EXTENSION_USER_GUIDE.md) | Chrome extension user guide |

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

## Troubleshooting

**The TrueNAS Custom App fails with `[EFAULT] Failed 'up' action`.**
Almost always means the image can't be pulled. Check `docker images` on the box, or confirm `ghcr.io/thvjq/sms-bridge:latest` actually exists and is public — the GitHub Actions workflow in `.github/workflows/docker-publish.yml` builds and publishes it on every push to `main`.

**Android app / extension / script can't reach the server.**
Test the health endpoint directly: `curl http://<server-ip-or-hostname>:4000/health` should return `{"ok":true,...}`. If that fails, the server itself is down or unreachable — check port mappings and firewall/tunnel config before troubleshooting the client.

**"Authentication failed" / HTTP 401-403.**
The `API_KEY` doesn't match between the client (app/extension/script) and the server's `.env`/compose config. Re-generate and re-enter it in all three places.

**Using this from outside your home network (e.g. a shop).**
The server's LAN IP won't be reachable off-network. Options: port forwarding + dynamic DNS, a reverse proxy with TLS, a Cloudflare Tunnel (see Published application routes in your Cloudflare Zero Trust dashboard), or a VPN mesh like Tailscale.

---

## Privacy & data

See [`../PRIVACY_POLICY.md`](../PRIVACY_POLICY.md) for the full breakdown of what's collected, where it's stored, and the encryption model's actual guarantees (including the inbound-message caveat above). No analytics, advertising, or third-party SDKs are used anywhere in this system.

---

## Changelog

- **Android app rewrite** — full NexLink-derived SMS/MMS parity: block/pin/category filters, recycle bin, voice/image/status messages, real-time delivery receipts.
- **CI image publishing** — `ghcr.io/thvjq/sms-bridge` now auto-builds via GitHub Actions on every push to `main`, so `docker-compose.truenas.yml` always has an image to pull.
- **TrueNAS SCALE support** — added `docker-compose.truenas.yml` for Custom App deployment.
- **Initial release** — server, Chrome extension, and Android app with ECIES end-to-end encryption.

---

## License

MIT
