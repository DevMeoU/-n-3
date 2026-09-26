const { openDatabase } = require('../../shared/db');
const config = require('../../shared/config');

const seedBooks = [
  ['Clean Code', 'Robert C. Martin', 'Công nghệ', 5, 5],
  ['Lập trình Java cơ bản', 'Nguyễn Văn A', 'Công nghệ', 3, 2],
  ['Cơ sở dữ liệu', 'Abraham Silberschatz', 'Công nghệ', 4, 3],
  ['Đắc nhân tâm', 'Dale Carnegie', 'Kỹ năng', 6, 6],
  ['Nhà giả kim', 'Paulo Coelho', 'Văn học', 4, 4],
  ['Tư duy nhanh và chậm', 'Daniel Kahneman', 'Kinh tế', 3, 3],
  ['Khởi nghiệp tinh gọn', 'Eric Ries', 'Kinh tế', 2, 1],
  ['Dế Mèn phiêu lưu ký', 'Tô Hoài', 'Văn học', 5, 5],
  ['Kỹ năng giao tiếp', 'Leil Lowndes', 'Kỹ năng', 3, 3],
  ['Node.js thực chiến', 'Azat Mardan', 'Công nghệ', 2, 2]
];

async function createBookDatabase() {
  const db = openDatabase(config.dbPath('book-service'));
  await db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Khác',
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      available INTEGER NOT NULL CHECK (available BETWEEN 0 AND quantity),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
    CREATE INDEX IF NOT EXISTS idx_books_author ON books(author);
    CREATE INDEX IF NOT EXISTS idx_books_category ON books(category);
  `);
  const count = await db.get('SELECT COUNT(*) AS count FROM books');
  if (count.count === 0) {
    for (const book of seedBooks) {
      await db.run('INSERT INTO books (title, author, category, quantity, available) VALUES (?, ?, ?, ?, ?)', book);
    }
  }
  return db;
}

module.exports = { createBookDatabase };
