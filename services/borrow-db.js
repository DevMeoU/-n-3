const { openDatabase } = require('../lib/db');
const config = require('../lib/config');

async function createBorrowDatabase() {
  const db = openDatabase(config.dbPath('borrow-service'));
  await db.exec(`
    CREATE TABLE IF NOT EXISTS borrow_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      book_id INTEGER NOT NULL,
      book_title TEXT NOT NULL,
      request_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      approved_date TEXT,
      due_date TEXT,
      return_date TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'BORROWING', 'RETURNED', 'REJECTED')),
      note TEXT,
      reject_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_borrow_records_user ON borrow_records(user_id);
    CREATE INDEX IF NOT EXISTS idx_borrow_records_status_request ON borrow_records(status, request_date);
    CREATE INDEX IF NOT EXISTS idx_borrow_records_book ON borrow_records(book_id);
  `);
  return db;
}

module.exports = { createBorrowDatabase };
