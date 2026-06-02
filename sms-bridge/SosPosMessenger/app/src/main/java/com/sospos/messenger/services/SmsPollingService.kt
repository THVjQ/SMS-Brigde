package com.sospos.messenger.services

import android.app.*
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.sospos.messenger.App
import com.sospos.messenger.R
import com.sospos.messenger.db.ApiClient
import com.sospos.messenger.db.Prefs
import com.sospos.messenger.db.SmsHelper
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

class SmsPollingService : Service() {

    private val executor = Executors.newSingleThreadScheduledExecutor()
    private var task: ScheduledFuture<*>? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIF_ID, buildNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        task?.cancel(false)
        task = executor.scheduleAtFixedRate(::poll, 0, Prefs.pollIntervalSeconds.toLong(), TimeUnit.SECONDS)
        return START_STICKY
    }

    private fun poll() {
        if (Prefs.serverUrl.isEmpty() || Prefs.apiKey.isEmpty()) return

        // getPending now returns already-decrypted PendingMessage objects
        ApiClient.getPending(applicationContext) { messages ->
            for (msg in messages) {
                try {
                    SmsHelper.send(applicationContext, msg.phone, msg.message)
                    ApiClient.markSent(msg.id)
                } catch (e: Exception) {
                    e.printStackTrace()
                    ApiClient.markFailed(msg.id)
                }
            }
        }
    }

    private fun buildNotification(): Notification =
        NotificationCompat.Builder(this, App.CH_SERVICE)
            .setContentTitle("SOS Messenger")
            .setContentText("🔒 Encrypted bridge active")
            .setSmallIcon(R.drawable.ic_message)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()

    override fun onDestroy() { task?.cancel(true); executor.shutdown(); super.onDestroy() }
    override fun onBind(intent: Intent?): IBinder? = null
    companion object { const val NOTIF_ID = 1001 }
}
