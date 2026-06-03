package com.sospos.messenger.ui.messages

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Telephony
import android.text.Editable
import android.text.TextWatcher
import android.view.*
import android.widget.EditText
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.sospos.messenger.R
import com.sospos.messenger.db.Conversation
import com.sospos.messenger.db.SmsHelper

class MessagesFragment : Fragment() {

    private lateinit var recycler: RecyclerView
    private lateinit var swipe: SwipeRefreshLayout
    private lateinit var adapter: ConversationAdapter
    private var allConversations = listOf<Conversation>()

    private val smsObserver = object : ContentObserver(Handler(Looper.getMainLooper())) {
        override fun onChange(selfChange: Boolean) { loadConversations() }
    }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, b: Bundle?): View =
        inflater.inflate(R.layout.fragment_messages, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        recycler = view.findViewById(R.id.recyclerConversations)
        swipe    = view.findViewById(R.id.swipeRefresh)

        adapter = ConversationAdapter { conv ->
            startActivity(Intent(requireContext(), ConversationActivity::class.java).apply {
                putExtra("address",      conv.address)
                putExtra("contact_name", conv.contactName)
            })
        }

        recycler.layoutManager = LinearLayoutManager(requireContext())
        recycler.adapter        = adapter

        swipe.setOnRefreshListener { loadConversations() }
        swipe.setColorSchemeResources(R.color.md_primary)

        // Search
        val etSearch = view.findViewById<EditText>(R.id.etSearch)
        etSearch?.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, a: Int) {}
            override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) {
                filterConversations(s?.toString() ?: "")
            }
        })

        loadConversations()
    }

    override fun onResume() {
        super.onResume()
        requireContext().contentResolver.registerContentObserver(Telephony.Sms.CONTENT_URI, true, smsObserver)
        loadConversations()
    }

    override fun onPause() {
        super.onPause()
        requireContext().contentResolver.unregisterContentObserver(smsObserver)
    }

    private fun loadConversations() {
        if (ContextCompat.checkSelfPermission(requireContext(), Manifest.permission.READ_SMS)
            != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(
                Manifest.permission.READ_SMS,
                Manifest.permission.SEND_SMS,
                Manifest.permission.RECEIVE_SMS
            ), 100)
            return
        }

        val ctx = context ?: return
        swipe.isRefreshing = true
        Thread {
            val convs = SmsHelper.getConversations(ctx)
            allConversations = convs
            if (!isAdded) return@Thread
            activity?.runOnUiThread {
                adapter.setData(convs)
                swipe.isRefreshing = false
            }
        }.start()
    }

    private fun filterConversations(query: String) {
        if (query.isEmpty()) {
            adapter.setData(allConversations)
            return
        }
        val filtered = allConversations.filter {
            it.contactName.contains(query, ignoreCase = true) ||
            it.address.contains(query) ||
            it.lastMessage.contains(query, ignoreCase = true)
        }
        adapter.setData(filtered)
    }

    fun openNewConversation() {
        val input = EditText(requireContext()).apply {
            hint = "+61412 345 678"
            inputType = android.text.InputType.TYPE_CLASS_PHONE
        }
        AlertDialog.Builder(requireContext())
            .setTitle("New Message")
            .setView(input)
            .setPositiveButton("Open Chat") { _, _ ->
                val phone = input.text.toString().trim()
                if (phone.isNotEmpty()) {
                    startActivity(Intent(requireContext(), ConversationActivity::class.java).apply {
                        putExtra("address", phone)
                        putExtra("contact_name", SmsHelper.getContactName(requireContext(), phone))
                    })
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
}
