package com.sospos.messenger.ui.messages

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.inputmethod.EditorInfo
import android.widget.*
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.button.MaterialButton
import com.sospos.messenger.R
import com.sospos.messenger.db.AppDatabase
import com.sospos.messenger.db.SmsHelper

class ConversationActivity : AppCompatActivity() {

    private lateinit var recycler: RecyclerView
    private lateinit var adapter:  BubbleAdapter
    private lateinit var etInput:  EditText
    private lateinit var btnSend:  MaterialButton
    private lateinit var btnNotes: MaterialButton
    private lateinit var address:  String

    companion object {
        private const val REQ_SEND_SMS = 101
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_conversation)

        address = intent.getStringExtra("address") ?: ""
        val name = intent.getStringExtra("contact_name") ?: address

        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        toolbar.title    = name
        toolbar.subtitle = address
        setSupportActionBar(toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        toolbar.setNavigationOnClickListener { finish() }

        recycler  = findViewById(R.id.recyclerBubbles)
        etInput   = findViewById(R.id.etInput)
        btnSend   = findViewById(R.id.btnSend)
        btnNotes  = findViewById(R.id.btnNotes)

        adapter = BubbleAdapter()
        recycler.layoutManager = LinearLayoutManager(this).apply { stackFromEnd = true }
        recycler.adapter        = adapter

        loadMessages()

        btnSend.setOnClickListener { sendMessage() }
        btnNotes.setOnClickListener { showNotesDropdown() }
        etInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEND) { sendMessage(); true } else false
        }
    }

    override fun onResume() {
        super.onResume()
        loadMessages()
    }

    private fun sendMessage() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.SEND_SMS,
                        Manifest.permission.READ_SMS,
                        Manifest.permission.RECEIVE_SMS),
                REQ_SEND_SMS
            )
            return
        }

        val text = etInput.text.toString().trim()
        if (text.isEmpty() || address.isEmpty()) return
        etInput.text.clear()

        Thread {
            try {
                SmsHelper.send(this, address, text)
                runOnUiThread { loadMessages() }
            } catch (e: SecurityException) {
                runOnUiThread {
                    Toast.makeText(this,
                        "SMS blocked — set SOS Messenger as your default SMS app in Settings",
                        Toast.LENGTH_LONG).show()
                }
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(this, "Send error: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_SEND_SMS &&
                grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            sendMessage()
        }
    }

    private fun showNotesDropdown() {
        Thread {
            val db = AppDatabase.get(this).readableDatabase
            val cursor = db.rawQuery(
                "SELECT title, body FROM notes ORDER BY pinned DESC, updated_at DESC",
                null
            )
            data class NoteEntry(val title: String, val body: String)
            val notes = mutableListOf<NoteEntry>()
            cursor.use {
                while (it.moveToNext()) {
                    notes += NoteEntry(
                        title = it.getString(0).ifBlank { "Untitled" },
                        body  = it.getString(1)
                    )
                }
            }
            runOnUiThread {
                if (notes.isEmpty()) {
                    Toast.makeText(this, "No notes saved yet", Toast.LENGTH_SHORT).show()
                    return@runOnUiThread
                }
                val popup = ListPopupWindow(this)
                popup.anchorView = btnNotes
                popup.setAdapter(ArrayAdapter(
                    this,
                    android.R.layout.simple_list_item_1,
                    notes.map { it.title }
                ))
                popup.width   = resources.displayMetrics.widthPixels / 2
                popup.isModal = true
                popup.setOnItemClickListener { _, _, position, _ ->
                    etInput.setText(notes[position].body)
                    etInput.setSelection(etInput.text?.length ?: 0)
                    popup.dismiss()
                }
                popup.show()
            }
        }.start()
    }

    private fun loadMessages() {
        Thread {
            val msgs = SmsHelper.getMessages(this, address)
            runOnUiThread {
                adapter.setData(msgs)
                if (msgs.isNotEmpty()) recycler.scrollToPosition(msgs.size - 1)
            }
        }.start()
    }
}
