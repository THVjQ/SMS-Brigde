package com.sospos.messenger.receivers

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import androidx.core.app.NotificationCompat
import com.sospos.messenger.App
import com.sospos.messenger.R
import com.sospos.messenger.db.ApiClient
import com.sospos.messenger.db.AppDatabase
import com.sospos.messenger.db.Prefs
import com.sospos.messenger.db.SmsHelper
import com.sospos.messenger.ui.messages.ConversationActivity

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_DELIVER_ACTION) return
        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        val grouped = mutableMapOf<String, StringBuilder>()
        for (msg in messages) grouped.getOrPut(msg.originatingAddress ?: "") { StringBuilder() }.append(msg.messageBody)
        for ((sender, body) in grouped) handle(context, sender, body.toString())
    }

    private fun handle(ctx: Context, sender: String, body: String) {
        Thread {
            AppDatabase.get(ctx).writableDatabase.execSQL(
                "INSERT INTO incoming_log (sender, message) VALUES (?, ?)", arrayOf(sender, body)
            )
        }.start()
        if (Prefs.notifyIncoming) showNotification(ctx, sender, body)
        if (Prefs.forwardIncoming && Prefs.isLinked) {
            // forwardIncoming now encrypts automatically with server's public key
            ApiClient.forwardIncoming(ctx, sender, body)
        }
    }

    private fun showNotification(ctx: Context, sender: String, body: String) {
        val name = SmsHelper.getContactName(ctx, sender)
        val pi = PendingIntent.getActivity(ctx, sender.hashCode(),
            Intent(ctx, ConversationActivity::class.java).apply {
                putExtra("address", sender); putExtra("contact_name", name)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        NotificationCompat.Builder(ctx, App.CH_MESSAGES)
            .setContentTitle(name).setContentText(body)
            .setSmallIcon(R.drawable.ic_message).setAutoCancel(true)
            .setContentIntent(pi).setPriority(NotificationCompat.PRIORITY_HIGH)
            .build().also { ctx.getSystemService(NotificationManager::class.java).notify(sender.hashCode(), it) }
    }
}

class SmsReceiverFallback : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != "android.provider.Telephony.SMS_RECEIVED") return
        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        val grouped = mutableMapOf<String, StringBuilder>()
        for (msg in messages) grouped.getOrPut(msg.originatingAddress ?: "") { StringBuilder() }.append(msg.messageBody)
        for ((sender, body) in grouped) {
            if (Prefs.forwardIncoming && Prefs.isLinked) ApiClient.forwardIncoming(ctx, sender, body.toString())
        }
    }
}

class MmsReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) { /* MMS stub */ }
}
