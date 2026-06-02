package com.sospos.messenger.ui.messages

import android.graphics.Color
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.sospos.messenger.R
import com.sospos.messenger.db.Conversation
import java.text.SimpleDateFormat
import java.util.*

class ConversationAdapter(
    private val onClick: (Conversation) -> Unit
) : RecyclerView.Adapter<ConversationAdapter.VH>() {

    private val items = mutableListOf<Conversation>()

    // SOS red palette — cycle through shades per contact
    private val avatarColors = listOf(
        "#C0392B", "#922B21", "#E74C3C", "#A93226",
        "#CB4335", "#7B241C", "#B03A2E", "#D35400"
    )

    fun setData(list: List<Conversation>) {
        items.clear()
        items.addAll(list)
        notifyDataSetChanged()
    }

    inner class VH(view: View) : RecyclerView.ViewHolder(view) {
        val avatar:  TextView = view.findViewById(R.id.tvAvatar)
        val name:    TextView = view.findViewById(R.id.tvName)
        val preview: TextView = view.findViewById(R.id.tvPreview)
        val time:    TextView = view.findViewById(R.id.tvTime)
        val unread:  TextView = view.findViewById(R.id.tvUnread)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        VH(LayoutInflater.from(parent.context).inflate(R.layout.item_conversation, parent, false))

    override fun getItemCount() = items.size

    override fun onBindViewHolder(h: VH, pos: Int) {
        val c = items[pos]

        // ── Avatar ─────────────────────────────────────────────────────────
        // Use first alphanumeric character of the display name
        val displayName = if (c.contactName.isNotEmpty() && c.contactName != c.address) {
            c.contactName
        } else {
            c.address
        }

        // Get first letter — for phone numbers use the last 2 digits instead
        val initial = when {
            displayName.first().isLetter() -> displayName.first().uppercaseChar().toString()
            displayName.any { it.isDigit() } -> displayName.filter { it.isDigit() }.takeLast(2)
            else -> "?"
        }

        h.avatar.text = initial

        // Cycle avatar colours based on address hash so same contact always gets same colour
        val colorIndex = Math.abs(c.address.hashCode()) % avatarColors.size
        try {
            h.avatar.setBackgroundColor(Color.parseColor(avatarColors[colorIndex]))
        } catch (e: Exception) {
            h.avatar.setBackgroundColor(Color.parseColor("#C0392B"))
        }

        // ── Name + preview ─────────────────────────────────────────────────
        h.name.text    = displayName
        h.preview.text = c.lastMessage.take(80).replace("\n", " ")
        h.time.text    = formatTime(c.lastTime)

        // ── Unread badge ───────────────────────────────────────────────────
        if (c.unreadCount > 0) {
            h.unread.visibility = View.VISIBLE
            h.unread.text       = if (c.unreadCount > 99) "99+" else c.unreadCount.toString()
        } else {
            h.unread.visibility = View.GONE
        }

        h.itemView.setOnClickListener { onClick(c) }
    }

    private fun formatTime(ms: Long): String {
        if (ms == 0L) return ""
        val now  = Calendar.getInstance()
        val then = Calendar.getInstance().also { it.timeInMillis = ms }

        return when {
            // Today — show time
            now.get(Calendar.DATE) == then.get(Calendar.DATE) &&
            now.get(Calendar.YEAR) == then.get(Calendar.YEAR) ->
                SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(ms))

            // This week — show day name
            now.get(Calendar.WEEK_OF_YEAR) == then.get(Calendar.WEEK_OF_YEAR) &&
            now.get(Calendar.YEAR) == then.get(Calendar.YEAR) ->
                SimpleDateFormat("EEE", Locale.getDefault()).format(Date(ms))

            // This year — show day + month
            now.get(Calendar.YEAR) == then.get(Calendar.YEAR) ->
                SimpleDateFormat("d MMM", Locale.getDefault()).format(Date(ms))

            // Older — show full date
            else ->
                SimpleDateFormat("d/MM/yy", Locale.getDefault()).format(Date(ms))
        }
    }
}
