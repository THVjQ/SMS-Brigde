# SOS Messenger — Installation Guide

**For:** Server · Android App · Chrome Extension

---

## What you need before starting

| Requirement | Notes |
|------------|-------|
| A server or computer to host the backend | Can be the same machine as your existing website |
| Node.js v18 or higher | Free — nodejs.org |
| Android Studio | Free — developer.android.com/studio (only needed to build APK) |
| Google Chrome or Chromium | For the extension |
| An Android phone (API 26 / Android 8+) | Samsung Galaxy recommended |

---

## Step 1 — Server Installation

### 1.1 Install Node.js

Download from **nodejs.org** — install the LTS version.

Verify:
```bash
node -v    # must be v18 or higher
npm -v
```

### 1.2 Extract and configure

Unzip `sospos-tools-encrypted.zip` on your server. Enter the folder:

```bash
cd sospos-tools
```

Copy the example config:

```bash
cp .env.example .env
```

Open `.env` and fill in the three values:

```
PORT=4000
API_KEY=<generate below>
ALLOWED_ORIGIN=https://app.sospos.com.au
```

Generate a secure API key (copy the output and paste it as your `API_KEY`):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Save this key.** You will need it in the Chrome extension and Android app.

### 1.3 Install and start

```bash
npm install
npm start
```

You should see:
```
🚀  SOS POS Tools running on port 4000
[crypto] Generated new server key pair → .keys/server.pem
[tools] Loaded "SMS Bridge" → /api/tools/sms-bridge
```

Test it:
```bash
curl http://localhost:4000/health
# Returns: {"ok":true}
```

### 1.4 Keep it running permanently (PM2)

```bash
npm install -g pm2
pm2 start server.js --name sospos-tools
pm2 save
pm2 startup
```

Run the command that `pm2 startup` prints to make it survive reboots.

### 1.5 Make it reachable from the internet

**Option A — nginx proxy (recommended)**

Add inside your existing nginx `server {}` block for `app.sospos.com.au`:

```nginx
location /api/tools/ {
    proxy_pass http://localhost:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}

location /health {
    proxy_pass http://localhost:4000;
}
```

Reload nginx:
```bash
sudo nginx -s reload
```

Test: `https://app.sospos.com.au/health` should return `{"ok":true}`

**Option B — ngrok (for testing only)**

```bash
ngrok http 4000
```

Note the `https://` URL it prints. This URL changes every restart on the free plan.

---

## Step 2 — Chrome Extension Installation

### 2.1 Configure defaults

Before loading the extension, open `config.js` in the `sms-extension` folder and update:

```javascript
const SOS_CONFIG = {
  serverUrl: 'https://app.sospos.com.au',   // ← your server URL
  apiKey:    'your-api-key-here',            // ← the key from Step 1.2
  appName:   'SOS Messenger',
};
```

Save the file.

### 2.2 Load into Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle, top right)
3. Click **Load unpacked**
4. Select the `sms-extension` folder
5. The SOS Messenger icon appears in your toolbar

### 2.3 Verify connection

Click the SOS Messenger toolbar icon → open **⚙ Settings** → check the server URL and API key are pre-filled from `config.js`.

If not, enter them manually and click **Save settings**.

---

## Step 3 — Android App Installation

### Option A — Install pre-built APK (easiest)

If you already have `SosPosMessenger.apk`:

1. Transfer the APK to the Android phone (USB, email, Google Drive, etc.)
2. On the phone go to **Settings → Security → Install unknown apps**
3. Allow installs from the source you used (Files, Chrome, etc.)
4. Open the APK file and tap **Install**
5. Open **SOS Messenger** from the app drawer

### Option B — Build from source (Android Studio)

Use this if you need to modify the app or build a fresh APK.

**Install Android Studio:**
Download from **developer.android.com/studio** and install with default settings. On first launch let it download the Android SDK (10–15 minutes).

**Open the project:**
1. Android Studio → **File → Open** → select the `SosPosMessenger` folder
2. Wait for Gradle sync to finish ("Gradle sync finished" shown at bottom)

**Build the APK:**
```bash
cd SosPosMessenger
./gradlew assembleDebug
```

APK location:
```
app/build/outputs/apk/debug/app-debug.apk
```

**Install directly to connected phone:**
```bash
./gradlew installDebug
```

Or plug in phone with USB debugging enabled and click ▶ Run in Android Studio.

### Troubleshooting Android Studio

| Problem | Fix |
|---------|-----|
| "SDK not found" | File → Project Structure → SDK Location → point to your SDK folder |
| Gradle sync fails | File → Settings → Build → Gradle → set JDK to bundled JDK |
| Java version error | `sudo alternatives --config java` → select Java 21 |
| `gradlew` not found | Copy from another project: `cp /path/to/other/project/gradlew .` |

---

## Step 4 — Pairing Phone to Server

This links the Android phone to your server and exchanges encryption keys.

### 4.1 Generate a pairing code

**In Chrome extension:**
1. Click the SOS Messenger toolbar icon
2. Go to the **Pair** tab
3. Click **Generate Pairing Code**
4. Note the 8-character code (e.g. `A3F9C21B`) — expires in 15 minutes

**Or via command line:**
```bash
curl -X POST https://app.sospos.com.au/api/tools/sms-bridge/generate-code \
  -H "x-api-key: YOUR_API_KEY"
```

### 4.2 Link the phone

1. Open **SOS Messenger** on your phone
2. The pairing screen appears on first launch
3. Enter:
   - **Server URL:** `https://app.sospos.com.au`
   - **Pairing code:** the 8-character code from above
4. Tap **Link Phone**
5. You should see: **✅ Linked & encrypted!**

### 4.3 Grant permissions

When prompted:
- Tap **Set as Default SMS App** → confirm the Android system dialog
- Grant **SMS permissions**

### 4.4 Verify encryption is working

In the Chrome extension → **Pair** tab → click **↻ Refresh** next to Linked devices.

The device should show **🔒 key OK** — confirming the phone's public encryption key was received.

The **Send** tab badge should show **🔒 Encrypted**.

---

## Step 5 — Send a test message

1. Click the SOS Messenger extension icon
2. Enter your own phone number and type `test`
3. Click **Send SMS 📱**
4. Status shows **✅ Sent 🔒 encrypted**
5. Your phone receives the SMS within a few seconds

---

## Moving to production (from ngrok to real server)

When you're ready to move from testing to `app.sospos.com.au`:

1. Copy the `sospos-tools` folder to your production server
2. Update `.env` — set `ALLOWED_ORIGIN=https://app.sospos.com.au`
3. Set up nginx proxy (Step 1.5 Option A)
4. Start the server with PM2
5. Update `config.js` in the extension with the new server URL
6. Re-pair all phones with a new pairing code

> **Important:** Copy `.keys/server.pem` from your test server to production if you want existing paired phones to keep working without re-pairing. If you start fresh, all phones need to re-pair.

---

## File checklist

### Server
- [ ] `sospos-tools/` folder on server
- [ ] `.env` configured with API key and ALLOWED_ORIGIN
- [ ] `npm install` completed
- [ ] Server running via PM2
- [ ] `/health` returns `{"ok":true}` from browser

### Chrome Extension
- [ ] `sms-extension/` folder on computer
- [ ] `config.js` updated with server URL and API key
- [ ] Loaded in Chrome via chrome://extensions
- [ ] Send tab shows server URL in Settings

### Android App
- [ ] APK installed on phone
- [ ] Paired with server (🔒 key OK in extension)
- [ ] Set as default SMS app
- [ ] SMS permissions granted
- [ ] Background service running (notification visible)
