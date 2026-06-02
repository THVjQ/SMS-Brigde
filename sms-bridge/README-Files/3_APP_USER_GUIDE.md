# SOS Messenger — Android App User Guide

---

## Overview

SOS Messenger is a full SMS app for Android that bridges your phone to the SOS POS system. It works like Google/Samsung Messages for everyday use, with the added ability to send and receive messages remotely from your browser.

---

## First Launch — Pairing Screen

When you open the app for the first time you'll see the pairing screen.

**You need:**
- The server URL (e.g. `https://app.sospos.com.au`)
- A pairing code generated from the Chrome extension or website

**Steps:**
1. Enter the **Server URL** — if you don't include `https://` it will be added automatically
2. Enter the **Pairing code** from the extension Pair tab
3. Tap **Link Phone**
4. You should see **✅ Linked & encrypted!**

> If the code has expired (15 minute limit), generate a new one from the Chrome extension Pair tab.

**Having trouble?**
- Make sure the server URL is correct and the server is running
- Check your internet connection
- Generate a fresh pairing code and try again
- Tap **Use without linking →** to skip pairing temporarily and configure manually later

---

## Main App — Three Tabs

After pairing, the app opens with a bottom navigation bar with three tabs.

---

## Messages Tab 💬

Works like Google/Samsung Messages.

### Conversation list
- Shows all SMS conversations on your phone
- Each row shows contact name (or number), message preview, and time
- Coloured avatar circle with the contact's initial
- Pull down to refresh

### Opening a conversation
Tap any conversation to open the chat thread.

### Chat thread
- **Blue bubbles** (right) = messages you sent
- **White bubbles** (left) = messages you received
- Type in the box at the bottom and tap the send button or press Enter

### Starting a new conversation
Tap the **+** button (bottom right) → enter a phone number → tap **Open Chat**.

### Setting as default SMS app
The app will prompt you on first launch to set it as the default SMS app. This is required to:
- Receive incoming SMS inside the app
- Have messages show up in the conversation list
- Forward incoming SMS to the website

If you missed the prompt: go to **Settings tab → Set as Default SMS App**.

---

## Notes Tab 📝

A built-in notes section for storing customer info, repair details, or anything else. Works like Apple Notes.

### Notes list
- Notes are shown as cards sorted by last edited (pinned notes always at top)
- Shows title, first line of content, and date
- Pull down to refresh

### Creating a note
Tap the **+** button (bottom right) to open a blank note.

### Editing a note
Tap any note card to open it in full-screen edit mode.

### Note editor
- **Title field** at the top (large text)
- **Body field** below — tap anywhere to start typing
- Auto-saves when you press back or navigate away — no save button needed

### Note options (three-dot menu or toolbar)
| Option | What it does |
|--------|-------------|
| Pin | Pins the note to the top of the list |
| Colour | Change the note background colour (Yellow, White, Blue, Green, Pink, Purple) |
| Delete | Permanently delete the note (asks for confirmation) |

### Pinning notes
Tap the pin icon on any note card to pin/unpin it. Pinned notes appear at the top of the list with a filled pin icon.

---

## Settings Tab ⚙️

### Server URL
The address of your SOS POS server. If you need to change it (e.g. moving from testing to production), update it here and tap **Save**.

### Test Connection
Tap **Ping** to check if the app can reach the server. Shows ✅ or ❌.

### Set as Default SMS App
Tap to open the Android system prompt to set SOS Messenger as your default SMS app. Required for receiving SMS.

### Forward incoming SMS to website
Toggle on/off whether received SMS messages are forwarded to the server (and viewable on the website). Default: on.

### Notify on incoming messages
Toggle on/off notifications when you receive a new SMS. Default: on.

### Device ID
Your phone's unique identifier. If you ever need to contact support, this helps identify which device is having issues.

### Unlink & Re-pair
Disconnects the phone from the server and takes you back to the pairing screen. Use this if:
- The server URL has changed
- You're moving to a new server
- Encryption keys need to be reset

---

## Background Service

The app runs a background service (shown as a persistent notification: **"SOS Messenger — Encrypted bridge active"**).

This service:
- Polls the server every 5 seconds for outbound messages to send
- Keeps the bridge running even when the app is closed
- Automatically restarts if the phone reboots

**Do not disable this notification** — it keeps the service alive. If you hide it, the bridge may stop working.

---

## Notifications

When you receive a new SMS:
- A notification appears showing the sender's name and message
- Tap the notification to open the conversation
- Notification sounds follow your phone's normal SMS settings

---

## Sending SMS remotely

When someone sends you a message via the Chrome extension or website:
1. The encrypted message arrives at your phone silently (no notification — it's outbound)
2. The background service picks it up within 5 seconds
3. Your phone sends it as a real SMS
4. The sender sees **✅ Sent** in their extension

The recipient receives it as a normal SMS from your phone number — they cannot tell it was sent remotely.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| App crashes on open | Uninstall and reinstall the APK |
| "Can't reach server" on pairing | Check internet connection and server URL |
| Messages not sending from extension | Check background service is running (look for notification) |
| Conversations list is empty | Set as default SMS app in Settings tab |
| Incoming SMS not appearing | Grant SMS permissions in Settings tab |
| Bridge stopped working | Go to Settings tab → tap Start polling |
| Need to change server | Settings tab → update Server URL → Save |
| Need to re-pair | Settings tab → Unlink & Re-pair → generate new code from extension |
