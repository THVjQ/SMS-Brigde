package com.sospos.messenger.ui.messages

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.sospos.messenger.R
import com.sospos.messenger.db.SmsMessage
import java.text.SimpleDateFormat
import java.util.*

class BubbleAdapter : RecyclerView.Adapter<BubbleAdapter.VH>() {

    private val items = mutableListOf<SmsMessage>()

    fun setData(list: List<SmsMessage>) {
        items.clear()
        items.addAll(list)
        notifyDataSetChanged()
    }

    companion object {
        const val TYPE_INCOMING = 1
        const val TYPE_OUTGOING = 2
    }

    inner class VH(val view: View) : RecyclerView.ViewHolder(view) {
        val body: TextView = view.findViewById(R.id.tvBody)
        val time: TextView = view.findViewById(R.id.tvTime)
    }

    override fun getItemViewType(pos: Int) =
        if (items[pos].type == 1) TYPE_INCOMING else TYPE_OUTGOING

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val layout = if (viewType == TYPE_INCOMING) R.layout.item_bubble_incoming
                     else                           R.layout.item_bubble_outgoing
        return VH(LayoutInflater.from(parent.context).inflate(layout, parent, false))
    }

    override fun getItemCount() = items.size

    override fun onBindViewHolder(h: VH, pos: Int) {
        val m = items[pos]
        h.body.text = m.body
        h.time.text = SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(m.date))
    }
}
