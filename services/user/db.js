const bcrypt = require('bcryptjs');
const { openDatabase } = require('../../shared/db');
const config = require('../../shared/config');

async function createUserDatabase() {
  const db = openDatabase(config.dbPath('user-service'));
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('READER', 'LIBRARIAN', 'ADMIN')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  `);

  const count = await db.get('SELECT COUNT(*) AS count FROM users');
  if (count.count === 0) {
    const hash = await bcrypt.hash('123456', 10);
    for (const user of [
      ['Nguyễn Văn An', 'reader', 'READER'],
      ['Trần Thị Bình', 'librarian', 'LIBRARIAN'],
      ['Quản trị viên', 'admin', 'ADMIN']
    ]) {
      await db.run('INSERT INTO users (full_name, username, password_hash, role) VALUES (?, ?, ?, ?)', [user[0], user[1], hash, user[2]]);
    }
  }
  return db;
}

module.exports = { createUserDatabase };
