package com.sospos.messenger.receivers

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import com.sospos.messenger.services.SmsPollingService

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action in listOf(
                Intent.ACTION_BOOT_COMPLETED,
                "android.intent.action.QUICKBOOT_POWERON"
            )
        ) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, SmsPollingService::class.java)
            )
        }
    }
}
