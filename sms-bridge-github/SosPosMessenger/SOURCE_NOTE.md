# Android Source Files

The complete Android source is in `app/src/main/java/com/sospos/messenger/`.

Key files included in this repo:
- `crypto/E2EEncryption.kt` — ECIES encryption implementation
- `crypto/KeyManager.kt` — Device key pair management
- `db/Prefs.kt` — SharedPreferences wrapper
- `db/ApiClient.kt` — All server API calls with encryption

The remaining source files (UI activities, fragments, services, receivers) 
are part of the full project. Build the APK using:

```bash
./gradlew assembleDebug
```

APK output: `app/build/outputs/apk/debug/app-debug.apk`
