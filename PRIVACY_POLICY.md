# Privacy Policy

**Product:** SOS Messenger (Android app), SMS Bridge server, SOS Messenger browser extension, SOS SMS Sender userscript
**Last updated:** 26 July 2026

---

## 1. Overview

SOS Messenger is a self-hosted system for sending and receiving SMS from a browser, routed through a real Android phone. It has three parts:

| Part | What it is |
|---|---|
| **SOS Messenger** (Android app) | Replaces your default SMS/MMS app on a phone with a SIM card |
| **SMS Bridge server** | Node.js/Express relay — **you run this yourself**; SOS Phone Repairs does not operate a shared or central server |
| **Browser extension / userscript** | Chrome extension or Tampermonkey script that sends/receives messages via your server |

Because you host the server yourself, **whoever controls that server has the same level of access described in this policy** — there is no third-party or vendor-hosted backend involved.

---

## 2. Data Collected and Where It Lives

| Data type | Where it is stored | Sent anywhere? |
|---|---|---|
| SMS & MMS messages (on-device) | Android system SMS/MMS database on the phone | No |
| Contacts (name, number) | Read-only from the phone's contacts — never copied off-device | No |
| Recipient phone numbers (outbound sends) | Stored **in plaintext** in the server's SQLite database (`sms_messages.phone`) | Yes — server you control |
| Outbound message bodies | Sealed in the browser before sending; the server stores and relays ciphertext only (see §4) | Yes — server you control, ciphertext only |
| Inbound message bodies (SMS received on the phone) | Sealed on the phone for each registered desktop; the server stores and relays them untouched (see §4) | Yes — server you control, ciphertext only |
| Pairing codes, device public keys, desktop public keys | Server SQLite database, needed to link devices and route encrypted messages | Yes — server you control |
| Usernames and passwords | Server SQLite database. Passwords are stored **only as scrypt hashes** — never in plaintext, and not recoverable | Sent once when signing in |
| API keys | Issued by signing in or pairing, held by the browser or phone. Stored on the server **only as SHA-256 hashes** | Sent with every request as an auth header |
| Message queue metadata | Timing, message sizes, delivery status, and which device sent or received what | Yes — server you control, **never encrypted** |

No analytics SDK, crash-reporting SDK, or advertising SDK is included in the Android app, extension, or userscript.

---

## 3. Android App Permissions

| Permission | Why it is needed |
|---|---|
| `SEND_SMS`, `RECEIVE_SMS`, `READ_SMS`, `WRITE_SMS` | Send and receive text messages as the default SMS app |
| `RECEIVE_MMS` | Receive multimedia messages |
| `READ_CONTACTS`, `WRITE_CONTACTS` | Display contact names next to phone numbers |
| `CALL_PHONE`, `READ_PHONE_STATE`, `SEND_RESPOND_VIA_MESSAGE` | Place calls and handle "respond via message" from the dialer |
| `RECORD_AUDIO` | Record voice messages you choose to send |
| `CAMERA` | Take photos to attach to messages |
| `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_AUDIO` | Attach files from the gallery |
| `INTERNET`, `ACCESS_NETWORK_STATE`, `CHANGE_NETWORK_STATE` | Talk to your self-hosted SMS Bridge server and download MMS from the carrier's MMSC |
| `POST_NOTIFICATIONS`, `VIBRATE` | Show message notifications |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC` | Keep the bridge connection alive to poll for outbound messages |
| `RECEIVE_BOOT_COMPLETED` | Restore services after a device reboot |

The browser extension requests only the `storage` permission (to save your server URL/API key locally) plus host permissions for all URLs, since your server address is self-hosted and can be any domain or IP you choose.

---

## 4. Encryption — What Is and Isn't End-to-End

Messages are protected using **ECIES**: P-256 ECDH key agreement, HKDF-SHA256 key derivation, AES-256-GCM authenticated encryption, with a fresh ephemeral key pair per message.

**Outbound messages (browser → phone) are end-to-end encrypted.** The Tampermonkey script (v21+) looks up the target phone's public key and seals the message in your browser before it is sent. The server stores and relays ciphertext and holds no key that opens it.

**Inbound messages (phone → browser) are end-to-end encrypted.** Each desktop generates its own P-256 key pair and registers the public half (`POST /client-key`); the private half never leaves that browser profile. The phone encrypts each incoming SMS once per registered desktop and posts the resulting envelopes, which the server relays untouched.

### Two older paths where the server *can* read content

Both are accepted for compatibility, and both are labelled rather than hidden:

- **A Tampermonkey script older than v21** posts the message in plaintext and asks the server to encrypt it. The server sees the text in memory on the way through. Update the script to close this.
- **A phone app older than desktop-key support** encrypts inbound to the *server's* own key pair (`.keys/server.pem`), which the server decrypts when a client asks for it. Those messages are returned with `server_readable: true` and the Replies panel says so on each one. Update the phone app to close this.

### What is never encrypted

**Phone numbers and metadata.** Recipient numbers, timing, message sizes, delivery status and which device sent or received what are all stored in the clear, because the server needs them to route messages and show history. Anyone with access to the server can see who you texted and when, even when they cannot read a word of it.

### What isolation between accounts does and does not cover

Accounts are scoped in the database, and the isolation is tested: one account cannot list, target, poll, read or delete another's devices, messages, history or stats. But **whoever runs the server is not covered by that boundary.** They have the database and the filesystem, so they see all metadata for every account, and any content arriving over the two legacy paths above. If you are hosting for someone else, they are trusting you with that.

**API keys are bearer tokens.** Anyone holding one is that account until it is revoked.

---

## 5. Third-Party Services

None. No analytics, advertising, or external data-sharing service is used by the app, server, extension, or userscript. The only network communication is:

1. Between the browser (extension/userscript) and your self-hosted server
2. Between the Android app and your self-hosted server
3. Between the Android app and your mobile carrier's MMSC (standard MMS protocol)

---

## 6. Data Retention and Deletion

- **On the phone:** messages remain in the Android system SMS database until you delete them in the app (which supports a 30-day recycle bin for soft-deleted conversations/messages) or clear app data.
- **On the server:** sent messages are retained until manually cleared via the server's `clear-sent` endpoint (default: removes messages marked "sent" older than 30 days) or by deleting the SQLite database. There is no automatic retention limit unless you configure one.
- Uninstalling the Android app removes local app data but does **not** delete anything already stored on your server — clear the server database separately if required.

---

## 7. Children's Privacy

This system is a business messaging tool (SOS Phone Repairs customer communication) and is not directed at children. It performs no age verification.

---

## 8. Changes to This Policy

If this policy is updated, the new version will be published in this file with an updated "Last updated" date.

---

## 9. Contact

Questions, concerns, or security disclosures can be submitted via the GitHub repository:

**https://github.com/THVjQ/SMS-Brigde/issues**
