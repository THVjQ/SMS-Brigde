# Privacy Policy

**Product:** SOS Messenger (Android app), SMS Bridge server, SOS Messenger browser extension, SOS SMS Sender userscript
**Last updated:** 2 July 2026

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
| Outbound message bodies | Encrypted at rest in the server database (see §4) | Yes — server you control, ciphertext only |
| Inbound message bodies (SMS received on the phone) | Encrypted at rest in the server database; decrypted transiently in server memory when the browser extension fetches them (see §4) | Yes — server you control |
| Pairing codes, device public keys | Server SQLite database, needed to link the app to the server | Yes — server you control |
| API key | Stored in the Android app, browser extension, and Tampermonkey script settings | Sent with every request as an auth header |

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

**Outbound messages (browser → phone) are genuinely end-to-end encrypted.** When you send a message from the extension or userscript, it is encrypted to the paired Android device's public key before it touches the database. The server does not hold the phone's private key and **cannot decrypt outbound message content.**

**Inbound messages (phone → browser) are end-to-end encrypted when both sides are up to date.** Each desktop client generates its own P-256 key pair and registers the public half with the server (`POST /client-key`); the private half never leaves that browser profile. The phone encrypts each incoming SMS once per registered desktop key and posts the resulting envelopes, which the server stores and relays untouched. The server holds no key that opens them.

**The older inbound path is still accepted, and the server can read those messages.** A phone running an app version that predates desktop keys encrypts to the *server's* own key pair (`.keys/server.pem` on the server host), and the server decrypts it in memory when a client asks for it. Such messages are returned with `server_readable: true` and the Replies panel labels them, so this state is visible rather than assumed away. Update the phone app to close the gap.

**Phone numbers are never encrypted** — they're stored in plaintext in the server database so the server can route messages and display history.

**Metadata is always visible to the server**, in both directions: phone numbers, timing, message sizes, and which device sent or received what.

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
