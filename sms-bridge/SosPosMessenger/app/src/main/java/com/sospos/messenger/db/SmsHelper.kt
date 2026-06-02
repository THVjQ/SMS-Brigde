package com.sospos.messenger.db

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.provider.ContactsContract
import android.provider.Telephony
import android.telephony.SmsManager

data class Conversation(
    val address: String,
    val contactName: String,
    val lastMessage: String,
    val lastTime: Long,
    val unreadCount: Int,
    val threadId: Long
)

data class SmsMessage(
    val id: Long,
    val address: String,
    val body: String,
    val date: Long,
    val type: Int // 1=inbox 2=sent
)

object SmsHelper {

    // ── Conversations list ────────────────────────────────────────────────────

    fun getConversations(ctx: Context): List<Conversation> {
        val list = mutableListOf<Conversation>()
        val uri = Uri.parse("content://sms/")
        val cursor = ctx.contentResolver.query(
            uri,
            arrayOf("address", "body", "date", "read", "thread_id"),
            null, null, "date DESC"
        ) ?: return list

        val seen = mutableSetOf<String>()
        cursor.use {
            val addrIdx = it.getColumnIndex("address")
            val bodyIdx = it.getColumnIndex("body")
            val dateIdx = it.getColumnIndex("date")
            val readIdx = it.getColumnIndex("read")
            val tidIdx  = it.getColumnIndex("thread_id")

            while (it.moveToNext()) {
                val addr = it.getString(addrIdx) ?: continue
                if (addr in seen) continue
                seen += addr

                list += Conversation(
                    address     = addr,
                    contactName = getContactName(ctx, addr),
                    lastMessage = it.getString(bodyIdx) ?: "",
                    lastTime    = it.getLong(dateIdx),
                    unreadCount = 0,
                    threadId    = it.getLong(tidIdx)
                )
            }
        }
        return list
    }

    // ── Messages in a thread ─────────────────────────────────────────────────

    fun getMessages(ctx: Context, address: String): List<SmsMessage> {
        val list = mutableListOf<SmsMessage>()
        val cursor = ctx.contentResolver.query(
            Uri.parse("content://sms/"),
            arrayOf("_id", "address", "body", "date", "type"),
            "address = ?", arrayOf(address),
            "date ASC"
        ) ?: return list

        cursor.use {
            val idIdx   = it.getColumnIndex("_id")
            val addrIdx = it.getColumnIndex("address")
            val bodyIdx = it.getColumnIndex("body")
            val dateIdx = it.getColumnIndex("date")
            val typeIdx = it.getColumnIndex("type")
            while (it.moveToNext()) {
                list += SmsMessage(
                    id      = it.getLong(idIdx),
                    address = it.getString(addrIdx) ?: "",
                    body    = it.getString(bodyIdx) ?: "",
                    date    = it.getLong(dateIdx),
                    type    = it.getInt(typeIdx)
                )
            }
        }
        return list
    }

    // ── Send SMS ─────────────────────────────────────────────────────────────

    fun send(ctx: Context, to: String, text: String) {
        val smsManager = ctx.getSystemService(SmsManager::class.java)
        val parts = smsManager.divideMessage(text)
        smsManager.sendMultipartTextMessage(to, null, parts, null, null)
        // Save to sent box so it shows in conversations
        val cv = ContentValues().apply {
            put("address", to)
            put("body",    text)
            put("date",    System.currentTimeMillis())
            put("type",    2) // sent
            put("read",    1)
        }
        runCatching { ctx.contentResolver.insert(Uri.parse("content://sms/sent"), cv) }
    }

    // ── Contact lookup ───────────────────────────────────────────────────────

    fun getContactName(ctx: Context, phone: String): String {
        val uri = Uri.withAppendedPath(
            ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
            Uri.encode(phone)
        )
        return runCatching {
            ctx.contentResolver.query(
                uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME),
                null, null, null
            )?.use { c ->
                if (c.moveToFirst()) c.getString(0) else phone
            } ?: phone
        }.getOrDefault(phone)
    }
}
