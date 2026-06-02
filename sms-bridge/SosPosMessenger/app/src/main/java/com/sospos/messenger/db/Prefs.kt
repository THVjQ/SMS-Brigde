package com.sospos.messenger.db

import android.annotation.SuppressLint
import android.app.Application
import android.content.SharedPreferences

@SuppressLint("StaticFieldLeak")
object Prefs {
    private const val NAME = "sospos_prefs"
    private val app: Application by lazy {
        Class.forName("android.app.ActivityThread").getMethod("currentApplication").invoke(null) as Application
    }
    private val prefs: SharedPreferences get() = app.getSharedPreferences(NAME, android.content.Context.MODE_PRIVATE)

    var serverUrl: String get() = prefs.getString("server_url","") ?: ""; set(v){prefs.edit().putString("server_url",v).apply()}
    var apiKey: String get() = prefs.getString("api_key","") ?: ""; set(v){prefs.edit().putString("api_key",v).apply()}
    var deviceId: String get() = prefs.getString("device_id","") ?: ""; set(v){prefs.edit().putString("device_id",v).apply()}
    var isLinked: Boolean get() = prefs.getBoolean("is_linked",false); set(v){prefs.edit().putBoolean("is_linked",v).apply()}
    var pairingCode: String get() = prefs.getString("pairing_code","") ?: ""; set(v){prefs.edit().putString("pairing_code",v).apply()}
    var pollIntervalSeconds: Int get() = prefs.getInt("poll_interval",5); set(v){prefs.edit().putInt("poll_interval",v).apply()}
    var forwardIncoming: Boolean get() = prefs.getBoolean("forward_incoming",true); set(v){prefs.edit().putBoolean("forward_incoming",v).apply()}
    var notifyIncoming: Boolean get() = prefs.getBoolean("notify_incoming",true); set(v){prefs.edit().putBoolean("notify_incoming",v).apply()}
    fun init(ctx: android.content.Context) { }
}
