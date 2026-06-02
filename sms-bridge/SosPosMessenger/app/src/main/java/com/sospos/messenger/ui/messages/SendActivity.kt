package com.sospos.messenger.ui.messages

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.sospos.messenger.MainActivity

// This activity handles sms:// and smsto:// intent URIs
// Android requires a default SMS app to handle these
class SendActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val uri  = intent.data
        val addr = when {
            uri != null -> uri.schemeSpecificPart?.replace("//", "")?.split("?")?.first() ?: ""
            else        -> ""
        }
        val body = intent.getStringExtra("sms_body") ?: ""

        // Open the conversation
        val i = Intent(this, ConversationActivity::class.java).apply {
            putExtra("address",      addr)
            putExtra("contact_name", addr)
            putExtra("prefill",      body)
        }
        startActivity(i)
        finish()
    }
}
