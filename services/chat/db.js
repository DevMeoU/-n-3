const { openDatabase } = require('../../shared/db');

async function createChatDatabase() {
  const db = openDatabase('chat-service');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reader_id INTEGER NOT NULL,
      staff_role TEXT NOT NULL CHECK (staff_role IN ('LIBRARIAN', 'ADMIN')),
      sender_id INTEGER NOT NULL,
      sender_name TEXT NOT NULL,
      sender_role TEXT NOT NULL CHECK (sender_role IN ('READER', 'LIBRARIAN', 'ADMIN')),
      body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(reader_id, staff_role, id);
    CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(reader_id, staff_role, read_at);
  `);
  return db;
}

module.exports = { createChatDatabase };
