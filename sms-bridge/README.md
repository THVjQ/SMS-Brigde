
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

End-to-end encrypted using **ECIES** — P-256 ECDH key agreement, HKDF-SHA256 key derivation, AES-256-GCM authenticated encryption. Each message uses a fresh ephemeral key pair for forward secrecy. The scheme is implemented three times — `node:crypto` on the server, JCA on Android, WebCrypto in the browser — and a cross-implementation test suite keeps them byte-compatible.

**Outbound (browser → phone).** The browser looks up the target phone's public key and seals the message itself. The server stores and relays ciphertext it cannot open.

**Inbound (phone → browser).** Each desktop generates its own key pair and registers the public half. The phone encrypts every reply once per registered desktop, and the server relays those envelopes untouched.

**Metadata is not encrypted, in either direction.** Phone numbers, timing, message sizes and which device sent what are all visible to the server, because it needs them to route.

Two paths remain where the server *can* read content, both from older clients and both labelled rather than hidden: a Tampermonkey script older than v21 posts plaintext for the server to encrypt, and a phone app older than desktop-key support encrypts inbound to the server's own key. Those inbound messages come back flagged `server_readable`. See [`PRIVACY_POLICY.md`](../PRIVACY_POLICY.md) for the full breakdown.

---

## Accounts and sign-in

The server is multi-tenant. An **account** owns phones and desktops; two people on one server never see each other's devices, messages, history or stats.

People sign in with a username and password from the browser script — logging in mints an API key for that browser behind the scenes, so nobody handles a key by hand. Signup is open, but a new account is `pending` and can do nothing until an administrator approves it from the 👤 panel.

- **The first account registered on a fresh server becomes the administrator.** Every later signup is pending.
- **A phone joins whichever account minted its pairing code**, and is issued its own key at pairing.
- **Every credential is individually revocable** — a lost phone or a compromised PC is revoked on its own.

Administration lives in the browser panel for an admin user, and in a CLI for when you are on the server anyway:

```bash
docker exec -it sms-bridge node scripts/accounts.js users
docker exec -it sms-bridge node scripts/accounts.js approve 3
docker exec -it sms-bridge node scripts/accounts.js adduser 1 someone --admin   # password on stdin
```

### The legacy shared key

`API_KEY` in the server environment still works, mapped to the account that owns all pre-accounts data, so an upgrade doesn't take a working install offline. It is a single credential for everything and cannot be revoked individually — mint per-device keys and remove it when you can. The server logs a deprecation warning while it is in use.

> An earlier default key was accidentally committed to `sms-extension/config.js` and made public. If a server you're running still uses that key, rotate it immediately.

---

## Requirements

- A server with **Node.js v18+** (or Docker), accessible from both your browser and phone
- **Android 8.0+** (API 26)
- **Chrome or Chromium** browser

---

## Quick start

See [`README-Files/2_INSTALLATION_GUIDE.md`](README-Files/2_INSTALLATION_GUIDE.md) for full setup instructions, or [`sms-bridge/docker-compose.truenas.yml`](docker-compose.truenas.yml) for a TrueNAS SCALE Custom App deployment.

**Short version:**

```bash
# 1. Start the server
cd sospos-tools
npm install
DB_DIR=./data npm start          # DB_DIR is where the database and keypair live

# 2. Run the tests (optional, but they document the guarantees)
npm test

# 3. Install the browser script
#    https://raw.githubusercontent.com/THVjQ/sos-sms-sender/main/sos-sms-sender.user.js
#    Open SOS POS → 💬 → ⚙️ Bridge Settings → server URL → create an account.
#    The first account on a fresh server becomes the administrator.

# 4. Pair the phone
#    💬 → 🔗 Pair Device → Generate, then enter the URL and code on the phone.
#    The phone needs no API key — pairing issues it one.
```

For a container deployment see [`sms-bridge/docker-compose.truenas.yml`](docker-compose.truenas.yml) and its `.env.example`. Upgrading is `docker compose pull && docker compose up -d` — a plain restart reuses the cached image and silently keeps running the old build.

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
  PC 1 ─┐
  PC 2 ─┼──► server ──► one chosen phone ──► customer      outbound: sealed in the browser,
  PC 3 ─┘   (relays)                                       relayed as ciphertext, 1 → 1

  PC 1 ◄─┐
  PC 2 ◄─┼── server ◄── phone ◄── customer reply           inbound: one envelope per PC,
  PC 3 ◄─┘   (relays)                                      relayed untouched, 1 → all
```

The asymmetry is deliberate. An outbound message goes to exactly one phone — sending it from two would text the customer twice. A reply goes to every PC on the account, because whoever is at the counter needs to see it.

Messages are routed, not broadcast: `/send` names a target device, and `/pending` hands each row to exactly one phone via an atomic claim, so two phones on one account never deliver the same message. A claim left unsent is returned to the queue after five minutes, covering a phone that collects a batch and then loses power.

---

## Troubleshooting

**The TrueNAS Custom App fails with `[EFAULT] Failed 'up' action`.**
Almost always means the image can't be pulled. Check `docker images` on the box, or confirm `ghcr.io/thvjq/sms-bridge:latest` actually exists and is public — the GitHub Actions workflow in `.github/workflows/docker-publish.yml` builds and publishes it on every push to `main`.

**Android app / extension / script can't reach the server.**
Test the health endpoint directly: `curl http://<server-ip-or-hostname>:4000/health` should return `{"ok":true,...}`. If that fails, the server itself is down or unreachable — check port mappings and firewall/tunnel config before troubleshooting the client.

**"Authentication failed" / HTTP 401.**
The credential is wrong, revoked, or belongs to a suspended user. Sign in again from ⚙️ Bridge Settings. If you're still on the shared `API_KEY`, check it matches the server's config.

**HTTP 403 with `PENDING`.**
The account exists but hasn't been approved. An administrator approves it from the 👤 panel, or with `accounts.js approve <user-id>`.

**Sending fails with `NO_DEVICE_KEY`.**
The phone is registered but has no encryption key, so nothing can be sealed for it. On the phone: Computer Bridge → Unlink & re-pair, with a fresh code. The server refuses rather than falling back to plaintext.

**Sending fails with `NO_DEFAULT_DEVICE`.**
Two or more phones are paired and this PC hasn't been told which to use. Pick one in ⚙️ Bridge Settings.

**A message says "Delivered" nowhere, and stays unconfirmed.**
The row was queued but no phone collected it. Check the phone is on, has signal, and isn't being killed by battery optimisation — on Samsung, set NexLink to Unrestricted and remove it from Sleeping apps.

**Replies reach one PC but not another.**
The phone re-reads the list of desktops every five minutes. A PC that registered more recently than that hasn't been picked up yet; wait, or re-pair the phone to fetch the list immediately.

**The app deploys but loses everything on each update.**
`DB_DIR` must point at a mounted volume, and the mount source must exist. The compose file uses `create_host_path: false` on purpose, so a wrong path stops the deploy instead of silently creating a directory in the wrong place.

**Using this from outside your home network (e.g. a shop).**
The server's LAN IP won't be reachable off-network. Options: port forwarding + dynamic DNS, a reverse proxy with TLS, a Cloudflare Tunnel (see [Published application routes](https://one.dash.cloudflare.com/) in your Cloudflare Zero Trust dashboard), or a VPN mesh like Tailscale.

---

## Privacy & data

See [`PRIVACY_POLICY.md`](../PRIVACY_POLICY.md) for the full breakdown of what's collected, where it's stored, and the encryption model's actual guarantees (including the inbound-message caveat above). No analytics, advertising, or third-party SDKs are used anywhere in this system.

---

## Changelog

- **Sign-in and approvals** — username/password login, open signup gated by an admin approval queue, role-gated administration in the browser and a CLI. Logging in mints a per-browser key, so nobody handles credentials by hand.
- **Outbound sealed in the browser** — the Tampermonkey script encrypts to the phone's key itself instead of posting plaintext for the server to encrypt.
- **Inbound end-to-end** — desktops own key pairs and the phone encrypts one envelope per PC; the server relays ciphertext it cannot read. Replies no longer decrypted server-side.
- **Multi-tenancy** — accounts, per-credential API keys stored only as hashes, and an isolation test suite covering the boundary.
- **Message routing** — messages target a named phone and are claimed atomically, ending duplicate delivery when two phones poll one server. Stale claims are reaped back to the queue.
- **Pairing repaired** — the phone redeems a real pairing code and fails loudly; previously it sent the API key where a code was expected, got a 403, and enabled the bridge anyway.
- **State persistence** — the database and server keypair now honour `DB_DIR` instead of being written into the container and discarded on every deploy.
- **Android app rewrite** — full NexLink-derived SMS/MMS parity: block/pin/category filters, recycle bin, voice/image/status messages, real-time delivery receipts.
- **CI image publishing** — `ghcr.io/thvjq/sms-bridge` now auto-builds via GitHub Actions on every push to `main`, so `docker-compose.truenas.yml` always has an image to pull.
- **TrueNAS SCALE support** — added `docker-compose.truenas.yml` for Custom App deployment.
- **Initial release** — server, Chrome extension, and Android app with ECIES end-to-end encryption.

---

## License


MIT
