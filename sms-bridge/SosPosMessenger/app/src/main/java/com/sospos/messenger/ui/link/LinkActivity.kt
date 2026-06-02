package com.sospos.messenger.ui.link

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import com.sospos.messenger.MainActivity
import com.sospos.messenger.R
import com.sospos.messenger.crypto.KeyManager
import com.sospos.messenger.db.ApiClient
import com.sospos.messenger.db.Prefs

class LinkActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Prefs.isLinked && Prefs.serverUrl.isNotEmpty()) { startMain(); return }
        setContentView(R.layout.activity_link)

        val etServer  = findViewById<EditText>(R.id.etServer)
        val etCode    = findViewById<EditText>(R.id.etCode)
        val btnLink   = findViewById<Button>(R.id.btnLink)
        val tvStatus  = findViewById<TextView>(R.id.tvStatus)
        val tvDevId   = findViewById<TextView>(R.id.tvDeviceId)
        val progress  = findViewById<ProgressBar>(R.id.progress)

        tvDevId.text = "Device ID: ${Prefs.deviceId}"

        // Pre-generate key pair on first load so it's ready
        KeyManager.getOrCreatePublicKey(this)

        btnLink.setOnClickListener {
            val server = etServer.text.toString().trim()
            val code   = etCode.text.toString().trim()
            if (server.isEmpty()) { tvStatus.text = "Enter your server URL"; return@setOnClickListener }
            if (code.isEmpty())   { tvStatus.text = "Enter the pairing code from the website"; return@setOnClickListener }

            Prefs.serverUrl = server
            progress.visibility = View.VISIBLE
            btnLink.isEnabled   = false
            tvStatus.text       = "Connecting…"

            ApiClient.ping { reachable ->
                if (!reachable) {
                    runOnUiThread { progress.visibility = View.GONE; btnLink.isEnabled = true; tvStatus.text = "❌ Can't reach server" }
                    return@ping
                }
                // linkDevice now sends device public key + gets server public key back
                ApiClient.linkDevice(this, code) { ok, msg ->
                    runOnUiThread {
                        progress.visibility = View.GONE; btnLink.isEnabled = true
                        if (ok) {
                            Prefs.isLinked = true
                            tvStatus.text = "✅ Linked & encrypted! Opening app…"
                            startMain()
                        } else {
                            tvStatus.text = "❌ $msg"
                        }
                    }
                }
            }
        }

        findViewById<TextView>(R.id.tvSkip).setOnClickListener {
            val server = etServer.text.toString().trim()
            val code   = etCode.text.toString().trim()
            if (server.isNotEmpty() && code.isNotEmpty()) {
                Prefs.serverUrl = server; Prefs.apiKey = code; Prefs.isLinked = true
                startMain()
            } else { tvStatus.text = "Fill in both fields to continue" }
        }
    }

    private fun startMain() { startActivity(Intent(this, MainActivity::class.java)); finish() }
}
