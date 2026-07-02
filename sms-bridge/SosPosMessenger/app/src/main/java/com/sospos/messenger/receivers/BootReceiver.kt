package com.sospos.messenger.receivers

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.sospos.messenger.services.SmsPollingService

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action in listOf(
                Intent.ACTION_BOOT_COMPLETED,
                "android.intent.action.QUICKBOOT_POWERON"
            )
        ) {
            // A receiver can't show a permission dialog — only start the service if
            // notifications were already granted (via MainActivity), otherwise skip.
            // startForeground() without this crashes with an uncatchable
            // CannotPostForegroundServiceNotificationException on Android 13+.
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, SmsPollingService::class.java)
                )
            }
        }
    }
}
