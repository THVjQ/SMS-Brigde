package com.sospos.messenger.ui.notes

import android.content.ContentValues
import android.content.Intent
import android.os.Bundle
import android.view.*
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.sospos.messenger.R
import com.sospos.messenger.db.AppDatabase

data class Note(
    val id: Long,
    val title: String,
    val body: String,
    val pinned: Boolean,
    val color: String,
    val updatedAt: Long
)

class NotesFragment : Fragment() {

    private lateinit var recycler: RecyclerView
    private lateinit var swipe:    SwipeRefreshLayout
    private lateinit var adapter:  NotesAdapter
    private lateinit var tvEmpty:  TextView

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, b: Bundle?): View =
        inflater.inflate(R.layout.fragment_notes, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        recycler = view.findViewById(R.id.recyclerNotes)
        swipe    = view.findViewById(R.id.swipeRefresh)
        tvEmpty  = view.findViewById(R.id.tvEmpty)

        adapter = NotesAdapter(
            onOpen = { note ->
                startActivity(Intent(requireContext(), NoteEditActivity::class.java).apply {
                    putExtra("note_id", note.id)
                })
            },
            onPin = { note -> togglePin(note) }
        )

        recycler.layoutManager = LinearLayoutManager(requireContext())
        recycler.adapter        = adapter
        swipe.setOnRefreshListener { loadNotes() }
        swipe.setColorSchemeResources(R.color.md_primary)
        loadNotes()
    }

    override fun onResume() {
        super.onResume()
        loadNotes()
    }

    private fun loadNotes() {
        swipe.isRefreshing = true
        Thread {
            val db = AppDatabase.get(requireContext()).readableDatabase
            val cursor = db.rawQuery(
                "SELECT id, title, body, pinned, color, updated_at FROM notes ORDER BY pinned DESC, updated_at DESC",
                null
            )
            val notes = mutableListOf<Note>()
            cursor.use {
                while (it.moveToNext()) {
                    notes += Note(
                        id        = it.getLong(0),
                        title     = it.getString(1),
                        body      = it.getString(2),
                        pinned    = it.getInt(3) == 1,
                        color     = it.getString(4),
                        updatedAt = it.getLong(5)
                    )
                }
            }
            requireActivity().runOnUiThread {
                adapter.setData(notes)
                swipe.isRefreshing = false
                tvEmpty.visibility = if (notes.isEmpty()) View.VISIBLE else View.GONE
            }
        }.start()
    }

    private fun togglePin(note: Note) {
        Thread {
            val db = AppDatabase.get(requireContext()).writableDatabase
            db.execSQL("UPDATE notes SET pinned = ${if (note.pinned) 0 else 1} WHERE id = ${note.id}")
            requireActivity().runOnUiThread { loadNotes() }
        }.start()
    }

    fun openNewNote() {
        startActivity(Intent(requireContext(), NoteEditActivity::class.java))
    }
}
