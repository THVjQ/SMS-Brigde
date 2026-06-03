package com.sospos.messenger

import android.content.Intent
import android.os.Bundle
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
    }

    private fun loadFragment(f: Fragment) {
        supportFragmentManager.beginTransaction()
            .replace(R.id.fragmentContainer, f)
            .commit()
    }
}
