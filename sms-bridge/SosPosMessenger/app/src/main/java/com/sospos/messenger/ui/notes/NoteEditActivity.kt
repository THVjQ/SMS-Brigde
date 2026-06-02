package com.sospos.messenger.ui.notes

import android.content.ContentValues
import android.graphics.Color
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.sospos.messenger.R
import com.sospos.messenger.db.AppDatabase

class NoteEditActivity : AppCompatActivity() {

    private var noteId:  Long   = -1
    private var pinned:  Boolean = false
    private var color:   String  = "#FFFDE7"  // default warm yellow like Apple Notes

    private lateinit var etTitle: EditText
    private lateinit var etBody:  EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_note_edit)

        etTitle = findViewById(R.id.etTitle)
        etBody  = findViewById(R.id.etBody)

        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        setSupportActionBar(toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        toolbar.setNavigationOnClickListener { saveAndFinish() }

        noteId = intent.getLongExtra("note_id", -1)
        if (noteId != -1L) loadNote()

        // Give focus to body if it's a new note
        if (noteId == -1L) etBody.requestFocus()
    }

    private fun loadNote() {
        Thread {
            val db = AppDatabase.get(this).readableDatabase
            val c  = db.rawQuery(
                "SELECT title, body, pinned, color FROM notes WHERE id = ?",
                arrayOf(noteId.toString())
            )
            c.use {
                if (it.moveToFirst()) {
                    val t = it.getString(0)
                    val b = it.getString(1)
                    pinned = it.getInt(2) == 1
                    color  = it.getString(3)
                    runOnUiThread {
                        etTitle.setText(t)
                        etBody.setText(b)
                        applyBackground()
                    }
                }
            }
        }.start()
    }

    private fun applyBackground() {
        runCatching { etBody.setBackgroundColor(Color.parseColor(color)) }
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.menu_note, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            R.id.action_pin -> { pinned = !pinned; Toast.makeText(this, if (pinned) "Pinned" else "Unpinned", Toast.LENGTH_SHORT).show(); true }
            R.id.action_color -> showColorPicker()
            R.id.action_delete -> confirmDelete()
            else -> super.onOptionsItemSelected(item)
        }
    }

    private fun showColorPicker(): Boolean {
        val colors = arrayOf("Yellow" to "#FFFDE7", "White" to "#FFFFFF",
            "Blue" to "#E3F2FD", "Green" to "#E8F5E9", "Pink" to "#FCE4EC", "Purple" to "#F3E5F5")
        MaterialAlertDialogBuilder(this)
            .setTitle("Note colour")
            .setItems(colors.map { it.first }.toTypedArray()) { _, i ->
                color = colors[i].second
                applyBackground()
            }
            .show()
        return true
    }

    private fun confirmDelete(): Boolean {
        if (noteId == -1L) { finish(); return true }
        MaterialAlertDialogBuilder(this)
            .setTitle("Delete note?")
            .setMessage("This can't be undone.")
            .setPositiveButton("Delete") { _, _ ->
                Thread {
                    AppDatabase.get(this).writableDatabase
                        .execSQL("DELETE FROM notes WHERE id = $noteId")
                    runOnUiThread { finish() }
                }.start()
            }
            .setNegativeButton("Cancel", null)
            .show()
        return true
    }

    private fun saveAndFinish() {
        val title = etTitle.text.toString().trim()
        val body  = etBody.text.toString().trim()

        if (title.isEmpty() && body.isEmpty()) { finish(); return }

        Thread {
            val db = AppDatabase.get(this).writableDatabase
            val now = System.currentTimeMillis()
            if (noteId == -1L) {
                db.execSQL(
                    "INSERT INTO notes (title, body, pinned, color, created_at, updated_at) VALUES (?,?,?,?,?,?)",
                    arrayOf(title, body, if (pinned) 1 else 0, color, now, now)
                )
            } else {
                db.execSQL(
                    "UPDATE notes SET title=?, body=?, pinned=?, color=?, updated_at=? WHERE id=?",
                    arrayOf(title, body, if (pinned) 1 else 0, color, now, noteId)
                )
            }
            runOnUiThread { finish() }
        }.start()
    }

    override fun onBackPressed() { saveAndFinish() }
}
