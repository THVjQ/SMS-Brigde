# SOS Messenger — Chrome Extension User Guide

---

## Overview

The SOS Messenger Chrome extension lets you send SMS messages from your browser, routed through a paired Android phone. All messages are end-to-end encrypted — no one can read them in transit.

---

## Opening the Extension

Click the **SOS Messenger icon** in your Chrome toolbar (top right of browser).

If you don't see it, click the puzzle piece 🧩 icon to see all extensions, then pin SOS Messenger for easy access.

---

## Send Tab 📤

This is the main tab for sending SMS messages.

### Encryption status badge
At the top of the Send tab you'll see either:
- **🔒 Encrypted** — the phone's public key is loaded, messages are fully encrypted
- **⚠️ No device key** — the key hasn't been fetched yet, click ↻ to refresh

Click **↻** to refresh the encryption status at any time.

### Sending a message
1. Enter the recipient's **phone number** (e.g. `+61412 345 678`)
2. Type your **message**
3. Click **Send SMS 📱**

You'll see one of these responses:
- **✅ Sent 🔒 encrypted** — message queued and fully encrypted
- **✅ Queued** — message queued (no phone key yet, server-side only)
- **❌ [error]** — something went wrong (see Troubleshooting)

The Android phone picks up the message within 5 seconds and sends it as a real SMS.

### Settings (at the bottom of Send tab)
Click **⚙ Settings** to expand:

| Field | Description |
|-------|-------------|
| Server URL | The address of your SOS POS server |
| API Key | Your secret API key — keep this private |
| Save settings | Saves server URL and API key |
| Reset to defaults | Resets to the values set in `config.js` |

> **Tip:** Settings are pre-filled from `config.js` on first install. You normally won't need to change them unless the server moves.

---

## History Tab 📋

Shows all messages sent through the extension.

### Viewing history
Click the **History** tab — the list loads automatically.

Click **↻ Refresh** to load the latest messages.

### Message details
Each message shows:
- **Phone number** — who the message was sent to
- **Message content** — shows 🔒 [encrypted] if the message was encrypted (the server can't show you the content)
- **Status badge** — `sent`, `pending`, or `failed`
- **E2E badge** — shown if the message was end-to-end encrypted
- **Date and time** — full timestamp in Australian Eastern time

### Status meanings
| Status | Meaning |
|--------|---------|
| `pending` | Queued on server, waiting for phone to pick it up |
| `sent` | Phone received and sent the SMS successfully |
| `failed` | Phone tried to send but failed |

### Why messages show as [encrypted]
Messages encrypted with the phone's public key cannot be decrypted by the server — so the history shows `[encrypted]` instead of the original text. This is correct and expected behaviour. It means your message content is private.

---

## Pair Tab 🔗

Used to link Android phones to the server and manage connected devices.

### Server URL display
Shows the current server URL so you know what address to enter on the Android phone.

### Generating a pairing code
1. Click **Generate Pairing Code**
2. An 8-character code appears (e.g. `A3F9C21B`) along with a QR code
3. The code expires in **15 minutes**
4. On the Android phone: open SOS Messenger → Settings → Unlink & Re-pair → enter the code

### QR code
The QR code contains both the server URL and the pairing code encoded together. In a future update, scanning this QR code from the Android app will auto-fill the pairing screen.

### Linked devices
Shows all Android phones currently linked to the server.

| Indicator | Meaning |
|-----------|---------|
| 🔒 key OK | Phone's encryption key is loaded — full E2E encryption active |
| ⚠️ no key | Phone is linked but no encryption key — re-pair to fix |

Click **↻ Refresh** to update the device list. The list also auto-updates 12 seconds after generating a pairing code (enough time to complete pairing on the phone).

---

## Updating the default server (for IT/admin)

When moving from testing to production, edit `config.js` in the extension folder:

```javascript
const SOS_CONFIG = {
  serverUrl: 'https://app.sospos.com.au',  // ← update this
  apiKey:    'your-production-api-key',     // ← update this
  appName:   'SOS Messenger',
};
```

Then go to `chrome://extensions` → click the refresh icon on SOS Messenger.

Existing users can click **Reset to defaults** in Settings to pick up the new values.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Extension won't open / crashes | Go to chrome://extensions → click Errors on SOS Messenger to see what's wrong |
| "Could not reach server" | Check the server URL in Settings. Make sure the server is running. |
| "Not configured" | Open Settings, enter server URL and API key, click Save |
| Encryption badge shows ⚠️ No device key | Click ↻ to refresh. If still showing, go to Pair tab → check device shows 🔒 key OK. If not, re-pair the phone. |
| Message stuck on `pending` | The Android phone may not be running. Open SOS Messenger on the phone and check the background service is active. |
| Message shows `failed` | The phone tried to send but the SMS failed. Check the phone has signal and SMS permissions. |
| History not loading | Click ↻ Refresh. Check server connection in Settings. |
| Settings reset after browser restart | This is normal — settings are stored in Chrome's extension storage and persist across restarts. If they're gone, the extension may have been reinstalled. Re-enter server URL and API key. |
| Pair tab shows "Could not reach server" | Server URL or API key is wrong. Update in Settings tab → Save → try Pair tab again. |

---

## Privacy and Security

- Your API key is stored in Chrome's local extension storage — it does not leave your browser except when making API calls to your own server
- Message content is encrypted in your browser before being sent — the server never sees plaintext
- The QR code displayed in the Pair tab contains your server URL and a one-time code — do not share screenshots of it
- Pairing codes expire after 15 minutes and can only be used once
