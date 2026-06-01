package com.sospos.messenger.db

import android.content.Context
import com.sospos.messenger.crypto.E2EEncryption
import com.sospos.messenger.crypto.KeyManager
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

object ApiClient {
    private val client = OkHttpClient()
    private val JSON   = "application/json; charset=utf-8".toMediaType()

    private fun server() = Prefs.serverUrl.trimEnd('/')
    private fun key()    = Prefs.apiKey
    private fun deviceId() = Prefs.deviceId

    private fun req(path: String) = Request.Builder()
        .url("${server()}/api/tools/sms-bridge$path")
        .header("x-api-key", key())
        .header("x-device-id", deviceId())

    // ── Key exchange ──────────────────────────────────────────────────────────

    fun fetchServerKey(ctx: Context, callback: (Boolean) -> Unit) {
        val r = Request.Builder()
            .url("${server()}/api/tools/sms-bridge/pubkey")
            .build()
        client.newCall(r).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) = callback(false)
            override fun onResponse(call: Call, response: Response) {
                val json = runCatching { JSONObject(response.body?.string() ?: "") }.getOrNull()
                val key  = json?.optString("publicKey") ?: ""
                if (key.isNotEmpty()) { KeyManager.storeServerKey(ctx, key); callback(true) }
                else callback(false)
            }
        })
    }

    // ── Pairing ───────────────────────────────────────────────────────────────

    fun linkDevice(ctx: Context, code: String, callback: (ok: Boolean, msg: String) -> Unit) {
        // Ensure device ID is set
        if (Prefs.deviceId.isEmpty()) {
            Prefs.deviceId = java.util.UUID.randomUUID().toString()
        }

        // Generate key pair if not already done
        val devicePubKey = KeyManager.getOrCreatePublicKey(ctx)

        android.util.Log.d("ApiClient", "Linking with device_id=${Prefs.deviceId}")
        android.util.Log.d("ApiClient", "Public key length=${devicePubKey.length}")

        val body = JSONObject()
            .put("pairing_code", code)
            .put("device_id",    Prefs.deviceId)
            .put("public_key",   devicePubKey)
            .toString().toRequestBody(JSON)

        val r = req("/link").post(body).build()
        client.newCall(r).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) = callback(false, e.message ?: "Network error")
            override fun onResponse(call: Call, response: Response) {
                val text = response.body?.string() ?: ""
                android.util.Log.d("ApiClient", "Link response: $text")
                val json = runCatching { JSONObject(text) }.getOrNull()
                if (response.isSuccessful && json?.optBoolean("ok") == true) {
                    val apiKey    = json.optString("api_key")
                    val serverKey = json.optString("server_key")
                    if (apiKey.isNotEmpty())    Prefs.apiKey = apiKey
                    if (serverKey.isNotEmpty()) KeyManager.storeServerKey(ctx, serverKey)
                    callback(true, "Linked!")
                } else {
                    callback(false, json?.optString("error") ?: "Failed (${response.code})")
                }
            }
        })
    }

    // ── Outbound SMS ──────────────────────────────────────────────────────────

    fun getPending(ctx: Context, callback: (List<PendingMessage>) -> Unit) {
        val r = req("/pending").get().build()
        client.newCall(r).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) = callback(emptyList())
            override fun onResponse(call: Call, response: Response) {
                val text = response.body?.string() ?: return callback(emptyList())
                val arr  = runCatching {
                    val msgs = JSONObject(text).getJSONArray("messages")
                    (0 until msgs.length()).mapNotNull { i ->
                        val obj       = msgs.getJSONObject(i)
                        val id        = obj.getInt("id")
                        val phone     = obj.getString("phone")
                        val rawMsg    = obj.getString("message")
                        val encrypted = obj.optInt("encrypted", 1) == 1

                        val plaintext = if (encrypted) {
                            val privKey = KeyManager.getPrivateKey(ctx)
                            if (privKey != null) {
                                runCatching { E2EEncryption.decrypt(rawMsg, privKey) }
                                    .getOrElse { null }
                            } else rawMsg // no key yet — try using raw (may fail)
                        } else rawMsg

                        if (plaintext != null) PendingMessage(id, phone, plaintext) else null
                    }
                }.getOrElse { emptyList() }
                callback(arr)
            }
        })
    }

    fun markSent(id: Int) {
        val body = JSONObject().put("id", id).toString().toRequestBody(JSON)
        runCatching { client.newCall(req("/mark-sent").post(body).build()).execute().close() }
    }

    fun markFailed(id: Int) {
        val body = JSONObject().put("id", id).toString().toRequestBody(JSON)
        runCatching { client.newCall(req("/mark-failed").post(body).build()).execute().close() }
    }

    // ── Incoming SMS forwarding ───────────────────────────────────────────────

    fun forwardIncoming(ctx: Context, from: String, message: String, callback: ((Boolean) -> Unit)? = null) {
        val serverKey = KeyManager.getServerKey(ctx)
        val bodyObj   = JSONObject().put("from", from).put("device_id", deviceId())

        if (serverKey != null) {
            val envelope = runCatching { E2EEncryption.encrypt(message, serverKey) }.getOrNull()
            if (envelope != null) bodyObj.put("encrypted_message", JSONObject(envelope))
            else bodyObj.put("message", message)
        } else {
            bodyObj.put("message", message)
        }

        val r = req("/incoming").post(bodyObj.toString().toRequestBody(JSON)).build()
        client.newCall(r).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) = callback?.invoke(false) ?: Unit
            override fun onResponse(call: Call, response: Response) {
                response.close(); callback?.invoke(response.isSuccessful)
            }
        })
    }

    // ── Health ────────────────────────────────────────────────────────────────

    fun ping(callback: (Boolean) -> Unit) {
        val r = Request.Builder().url("${server()}/health").build()
        client.newCall(r).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) = callback(false)
            override fun onResponse(call: Call, response: Response) { response.close(); callback(response.isSuccessful) }
        })
    }

    data class PendingMessage(val id: Int, val phone: String, val message: String)
}
