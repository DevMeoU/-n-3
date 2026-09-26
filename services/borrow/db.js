const { openDatabase } = require('../../shared/db');

async function createBorrowDatabase() {
  const db = openDatabase('borrow-service');
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
      reject_reason TEXT,
      rental_fee INTEGER NOT NULL DEFAULT 0 CHECK (rental_fee >= 0),
      late_fee INTEGER NOT NULL DEFAULT 0 CHECK (late_fee >= 0),
      paid INTEGER NOT NULL DEFAULT 0 CHECK (paid IN (0, 1)),
      paid_at TEXT,
      pay_token TEXT,
      paid_rental INTEGER NOT NULL DEFAULT 0 CHECK (paid_rental IN (0, 1)),
      paid_amount INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
      renewed INTEGER NOT NULL DEFAULT 0 CHECK (renewed IN (0, 1))
    );
    CREATE INDEX IF NOT EXISTS idx_borrow_records_user ON borrow_records(user_id);
    CREATE INDEX IF NOT EXISTS idx_borrow_records_status_request ON borrow_records(status, request_date);
    CREATE INDEX IF NOT EXISTS idx_borrow_records_book ON borrow_records(book_id);
  `);
  // Migration cho DB cũ (try-ALTER để tương thích Turso)
  for (const sql of [
    'ALTER TABLE borrow_records ADD COLUMN rental_fee INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE borrow_records ADD COLUMN late_fee INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE borrow_records ADD COLUMN paid INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE borrow_records ADD COLUMN paid_at TEXT',
    'ALTER TABLE borrow_records ADD COLUMN pay_token TEXT',
    'ALTER TABLE borrow_records ADD COLUMN paid_rental INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE borrow_records ADD COLUMN paid_amount INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE borrow_records ADD COLUMN renewed INTEGER NOT NULL DEFAULT 0'
  ]) {
    try {
      await db.exec(sql);
    } catch (error) {
      if (!/duplicate column name/i.test(error.message)) throw error;
    }
  }
  return db;
}

module.exports = { createBorrowDatabase };
