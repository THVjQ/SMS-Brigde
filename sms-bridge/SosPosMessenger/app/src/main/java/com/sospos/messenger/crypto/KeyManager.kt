package com.sospos.messenger.crypto

// ─────────────────────────────────────────────────────────────────────────────
//  KeyManager.kt
//
//  Manages the device's long-term P-256 key pair.
//  Storage: EncryptedSharedPreferences (backed by Android Keystore AES-256 key)
//  — The raw private key bytes never leave the encrypted storage.
//  — Key is generated once and persisted across app restarts.
// ─────────────────────────────────────────────────────────────────────────────

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

object KeyManager {

    private const val PREF_FILE     = "e2e_keys"
    private const val KEY_PRIV      = "device_private_key"
    private const val KEY_PUB       = "device_public_key"
    private const val KEY_SERVER    = "server_public_key"

    @Volatile private var prefs: SharedPreferences? = null

    private fun getPrefs(ctx: Context): SharedPreferences {
        return prefs ?: synchronized(this) {
            prefs ?: buildPrefs(ctx).also { prefs = it }
        }
    }

    private fun buildPrefs(ctx: Context): SharedPreferences {
        val master = MasterKey.Builder(ctx)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            ctx, PREF_FILE, master,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    // ── Key lifecycle ──────────────────────────────────────────────────────

    /**
     * Returns the device's public key as base64 DER SPKI.
     * Generates the key pair on first call.
     */
    fun getOrCreatePublicKey(ctx: Context): String {
        val p = getPrefs(ctx)
        if (!p.contains(KEY_PUB)) {
            generateAndStore(ctx)
        }
        return p.getString(KEY_PUB, "")!!
    }

    /** Returns the device's private key as base64 PKCS#8. */
    fun getPrivateKey(ctx: Context): String? =
        getPrefs(ctx).getString(KEY_PRIV, null)

    /** True if the device has a key pair. */
    fun hasKeys(ctx: Context): Boolean =
        getPrefs(ctx).contains(KEY_PUB)

    /** Store the server's public key (received during /link). */
    fun storeServerKey(ctx: Context, serverPublicKeyB64: String) {
        getPrefs(ctx).edit().putString(KEY_SERVER, serverPublicKeyB64).apply()
    }

    /** Returns the server's public key, or null if not yet linked. */
    fun getServerKey(ctx: Context): String? =
        getPrefs(ctx).getString(KEY_SERVER, null)

    /** Wipe all keys — called on unlink. */
    fun clearKeys(ctx: Context) {
        getPrefs(ctx).edit().clear().apply()
        prefs = null
    }

    // ── Internal ──────────────────────────────────────────────────────────

    private fun generateAndStore(ctx: Context) {
        val kp     = E2EEncryption.generateKeyPair()
        val pubB64 = E2EEncryption.exportPublicKey(kp.public)
        val privB64= E2EEncryption.exportPrivateKey(kp.private)
        getPrefs(ctx).edit()
            .putString(KEY_PUB,  pubB64)
            .putString(KEY_PRIV, privB64)
            .apply()
    }
}
