package com.sospos.messenger.crypto

import android.content.Context
import android.content.SharedPreferences
import android.util.Log

object KeyManager {
    private const val PREF_FILE  = "e2e_keys"
    private const val KEY_PUB    = "device_public_key"
    private const val KEY_PRIV   = "device_private_key"
    private const val KEY_SERVER = "server_public_key"

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.applicationContext.getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE)

    fun getOrCreatePublicKey(ctx: Context): String {
        val p = prefs(ctx)
        if (!p.contains(KEY_PUB)) {
            Log.d("KeyManager", "Generating new key pair")
            val kp = E2EEncryption.generateKeyPair()
            val pubB64  = E2EEncryption.exportPublicKey(kp.public)
            val privB64 = E2EEncryption.exportPrivateKey(kp.private)
            p.edit().putString(KEY_PUB, pubB64).putString(KEY_PRIV, privB64).apply()
            Log.d("KeyManager", "Key generated, length=${pubB64.length}")
        }
        return p.getString(KEY_PUB, "") ?: ""
    }

    fun getPrivateKey(ctx: Context): String? = prefs(ctx).getString(KEY_PRIV, null)
    fun storeServerKey(ctx: Context, key: String) { prefs(ctx).edit().putString(KEY_SERVER, key).apply() }
    fun getServerKey(ctx: Context): String? = prefs(ctx).getString(KEY_SERVER, null)
    fun clearKeys(ctx: Context) { prefs(ctx).edit().clear().apply() }
}
