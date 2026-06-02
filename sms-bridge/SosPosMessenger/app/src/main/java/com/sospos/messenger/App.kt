package com.sospos.messenger

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import com.sospos.messenger.db.Prefs
import java.util.UUID

class App : Application() {

    override fun onCreate() {
        super.onCreate()
        Prefs.init(this)

        // Generate a permanent device ID on first launch
        if (Prefs.deviceId.isEmpty()) {
            Prefs.deviceId = UUID.randomUUID().toString()
        }

        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        val nm = getSystemService(NotificationManager::class.java)

        nm.createNotificationChannel(NotificationChannel(
            CH_MESSAGES, "Messages", NotificationManager.IMPORTANCE_HIGH
        ).apply { description = "Incoming SMS notifications" })

        nm.createNotificationChannel(NotificationChannel(
            CH_SERVICE, "Background Service", NotificationManager.IMPORTANCE_LOW
        ).apply { description = "Keeps the SMS bridge running" })
    }

    companion object {
        const val CH_MESSAGES = "ch_messages"
        const val CH_SERVICE  = "ch_service"
    }
}
