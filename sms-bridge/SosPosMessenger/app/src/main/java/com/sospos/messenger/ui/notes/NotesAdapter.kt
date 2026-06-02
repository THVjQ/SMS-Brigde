package com.sospos.messenger.ui.notes

import android.graphics.Color
import android.view.*
import android.widget.ImageButton
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.sospos.messenger.R
import java.text.SimpleDateFormat
import java.util.*

class NotesAdapter(
    private val onOpen: (Note) -> Unit,
    private val onPin:  (Note) -> Unit
) : RecyclerView.Adapter<NotesAdapter.VH>() {

    private val items = mutableListOf<Note>()

    fun setData(list: List<Note>) { items.clear(); items.addAll(list); notifyDataSetChanged() }

    inner class VH(view: View) : RecyclerView.ViewHolder(view) {
        val card:    View        = view.findViewById(R.id.card)
        val title:   TextView   = view.findViewById(R.id.tvTitle)
        val preview: TextView   = view.findViewById(R.id.tvPreview)
        val date:    TextView   = view.findViewById(R.id.tvDate)
        val pinBtn:  ImageButton = view.findViewById(R.id.btnPin)
    }

    override fun onCreateViewHolder(p: ViewGroup, v: Int) =
        VH(LayoutInflater.from(p.context).inflate(R.layout.item_note, p, false))

    override fun getItemCount() = items.size

    override fun onBindViewHolder(h: VH, pos: Int) {
        val n = items[pos]
        h.title.text    = n.title.ifEmpty { "New Note" }
        h.preview.text  = n.body.lines().firstOrNull { it.isNotBlank() }?.take(80) ?: ""
        h.date.text     = SimpleDateFormat("d MMM yyyy", Locale.getDefault()).format(Date(n.updatedAt))
        h.pinBtn.setImageResource(
            if (n.pinned) R.drawable.ic_pin_filled else R.drawable.ic_pin_outline
        )
        runCatching { h.card.setBackgroundColor(Color.parseColor(n.color)) }
        h.itemView.setOnClickListener { onOpen(n) }
        h.pinBtn.setOnClickListener  { onPin(n)  }
    }
}
