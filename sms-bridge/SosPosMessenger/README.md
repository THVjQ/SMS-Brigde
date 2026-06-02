# SOS Messenger — Android App

A full SMS + Notes app for Android that bridges to the SOS POS backend.

---

## Features
- **Messages tab** — Google Messages-style conversation list + chat bubbles
- **Notes tab** — Apple Notes-style notes with pinning, colours, full-screen editor
- **Settings tab** — server URL, test connection, set as default SMS app, unlink
- **Pairing screen** — enter a code from the website to link the phone
- **Background service** — polls server for outbound SMS, sends automatically
- **Incoming SMS** — received by the app, shown as notification, forwarded to website

---

## How to build

1. Install **Android Studio** (Hedgehog or newer)
2. Open this folder as a project (`File → Open`)
3. Wait for Gradle sync to finish
4. Connect your Android phone via USB with USB Debugging enabled
5. Click the green **Run ▶** button

---

## How pairing works

1. On the website/server, call `POST /api/tools/sms-bridge/generate-code` (requires API key)
   → returns `{ code: "ABC12345" }`
2. Open the app on the phone → enter your server URL + that code → tap **Link Phone**
3. The app sends its `device_id` + code to `/api/tools/sms-bridge/link`
4. Server validates code, marks it used, registers the device, returns the real API key
5. App stores the API key and is now fully linked

---

## File structure

```
app/src/main/
├── AndroidManifest.xml
├── java/com/sospos/messenger/
│   ├── App.kt                          ← Application class
│   ├── MainActivity.kt                 ← Bottom nav host
│   ├── db/
│   │   ├── AppDatabase.kt              ← SQLite helper
│   │   ├── Prefs.kt                    ← SharedPreferences wrapper
│   │   ├── ApiClient.kt               ← All API calls
│   │   └── SmsHelper.kt               ← Read/send SMS via Android provider
│   ├── ui/
│   │   ├── link/LinkActivity.kt        ← Pairing screen
│   │   ├── messages/
│   │   │   ├── MessagesFragment.kt     ← Conversation list
│   │   │   ├── ConversationAdapter.kt
│   │   │   ├── ConversationActivity.kt ← Chat thread
│   │   │   ├── BubbleAdapter.kt        ← Chat bubbles
│   │   │   └── SendActivity.kt         ← Default SMS app intent handler
│   │   ├── notes/
│   │   │   ├── NotesFragment.kt        ← Notes list
│   │   │   ├── NotesAdapter.kt
│   │   │   └── NoteEditActivity.kt    ← Full-screen note editor
│   │   └── settings/SettingsFragment.kt
│   ├── services/SmsPollingService.kt   ← Background polling
│   └── receivers/
│       ├── SmsReceiver.kt              ← Incoming SMS → notification + forward
│       └── BootReceiver.kt             ← Auto-start on reboot
└── res/
    ├── layout/                         ← All XML layouts
    ├── drawable/                       ← Icons + bubble shapes
    ├── values/colors.xml, themes.xml, strings.xml
    └── menu/bottom_nav.xml, menu_note.xml
```

---

## Setting as default SMS app

Tap **Set as Default SMS App** in Settings. Android will show a system dialog to confirm.
Being default is required for:
- Receiving SMS via `SMS_DELIVER` (guaranteed delivery, not a broadcast)
- Writing sent messages to the system SMS provider

---

## Server addon

See `PAIRING_SERVER_ADDON.js` — paste this code into `tools/sms-bridge/index.js` on your
server to add the `/generate-code`, `/link`, `/devices`, and `/incoming` endpoints.
