package com.sospos.messenger.db

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class AppDatabase(context: Context) : SQLiteOpenHelper(context, "sospos.db", null, 3) {

    override fun onCreate(db: SQLiteDatabase) {
        // Local SMS conversations mirror (for display — actual SMS is in system provider)
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS conversations (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                address      TEXT NOT NULL UNIQUE,
                contact_name TEXT,
                last_message TEXT,
                last_time    INTEGER DEFAULT 0,
                unread_count INTEGER DEFAULT 0
            )
        """)

        // Notes
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS notes (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                title      TEXT NOT NULL DEFAULT '',
                body       TEXT NOT NULL DEFAULT '',
                pinned     INTEGER DEFAULT 0,
                color      TEXT DEFAULT '#FFFFFF',
                created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
                updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
            )
        """)

        // Outbound SMS queue (synced from server)
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS sms_queue (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                server_id  INTEGER,
                phone      TEXT NOT NULL,
                message    TEXT NOT NULL,
                status     TEXT DEFAULT 'pending',
                created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
            )
        """)

        // Incoming SMS forwarded to server log
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS incoming_log (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                sender      TEXT NOT NULL,
                message     TEXT NOT NULL,
                forwarded   INTEGER DEFAULT 0,
                received_at INTEGER DEFAULT (strftime('%s','now') * 1000)
            )
        """)
    }

    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) {
        onCreate(db)
    }

    companion object {
        @Volatile private var instance: AppDatabase? = null
        fun get(context: Context): AppDatabase =
            instance ?: synchronized(this) {
                instance ?: AppDatabase(context.applicationContext).also { instance = it }
            }
    }
}
