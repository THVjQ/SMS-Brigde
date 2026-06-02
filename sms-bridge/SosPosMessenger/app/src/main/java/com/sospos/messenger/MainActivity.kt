package com.sospos.messenger

import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.provider.Telephony
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.google.android.material.floatingactionbutton.FloatingActionButton
import com.sospos.messenger.services.SmsPollingService
import com.sospos.messenger.ui.messages.MessagesFragment
import com.sospos.messenger.ui.notes.NotesFragment
import com.sospos.messenger.ui.settings.SettingsFragment

class MainActivity : AppCompatActivity() {

    private val messagesFragment = MessagesFragment()
    private val notesFragment    = NotesFragment()
    private val settingsFragment = SettingsFragment()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val nav = findViewById<BottomNavigationView>(R.id.bottomNav)
        val fab = findViewById<FloatingActionButton>(R.id.fab)

        // Load default fragment
        loadFragment(messagesFragment)

        nav.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.nav_messages -> { loadFragment(messagesFragment); fab.show(); true }
                R.id.nav_notes    -> { loadFragment(notesFragment);    fab.show(); true }
                R.id.nav_settings -> { loadFragment(settingsFragment); fab.hide(); true }
                else -> false
            }
        }

        fab.setOnClickListener {
            val current = supportFragmentManager.findFragmentById(R.id.fragmentContainer)
            when (current) {
                is MessagesFragment -> messagesFragment.openNewConversation()
                is NotesFragment    -> notesFragment.openNewNote()
            }
        }

        // Start background polling service
        ContextCompat.startForegroundService(this, Intent(this, SmsPollingService::class.java))

        // Nudge user to set as default SMS app
        val defaultSmsApp = Telephony.Sms.getDefaultSmsPackage(this)
        if (defaultSmsApp != packageName) {
            showDefaultSmsPrompt()
        }
    }

    private fun loadFragment(f: Fragment) {
        supportFragmentManager.beginTransaction()
            .replace(R.id.fragmentContainer, f)
            .commit()
    }

    private fun showDefaultSmsPrompt() {
        AlertDialog.Builder(this)
            .setTitle("Set as Default SMS App")
            .setMessage(
                "SOS Messenger needs to be your default SMS app to send messages.\n\n" +
                "Tap Open Settings, then choose SOS Messenger under SMS app."
            )
            .setPositiveButton("Open Settings") { _, _ ->
                startActivity(Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS))
            }
            .setNegativeButton("Not Now", null)
            .show()
    }
}
