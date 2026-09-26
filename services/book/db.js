const { openDatabase } = require('../../shared/db');

// [title, author, category, quantity, available, rental_price(VND/lượt)]
const seedBooks = [
  ['Clean Code', 'Robert C. Martin', 'Công nghệ', 5, 5, 15000],
  ['Lập trình Java cơ bản', 'Nguyễn Văn A', 'Công nghệ', 3, 2, 10000],
  ['Cơ sở dữ liệu', 'Abraham Silberschatz', 'Công nghệ', 4, 3, 10000],
  ['Đắc nhân tâm', 'Dale Carnegie', 'Kỹ năng', 6, 6, 8000],
  ['Nhà giả kim', 'Paulo Coelho', 'Văn học', 4, 4, 12000],
  ['Tư duy nhanh và chậm', 'Daniel Kahneman', 'Kinh tế', 3, 3, 15000],
  ['Khởi nghiệp tinh gọn', 'Eric Ries', 'Kinh tế', 2, 1, 12000],
  ['Dế Mèn phiêu lưu ký', 'Tô Hoài', 'Văn học', 5, 5, 5000],
  ['Kỹ năng giao tiếp', 'Leil Lowndes', 'Kỹ năng', 3, 3, 8000],
  ['Node.js thực chiến', 'Azat Mardan', 'Công nghệ', 2, 2, 15000]
];

async function createBookDatabase() {
  const db = openDatabase('book-service');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Khác',
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      available INTEGER NOT NULL CHECK (available BETWEEN 0 AND quantity),
      rental_price INTEGER NOT NULL DEFAULT 0 CHECK (rental_price >= 0),
      cover_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
    CREATE INDEX IF NOT EXISTS idx_books_author ON books(author);
    CREATE INDEX IF NOT EXISTS idx_books_category ON books(category);
  `);
  // Migration cho DB cũ. Dùng try-ALTER thay vì PRAGMA để chạy
  // được cả SQLite local lẫn Turso (PRAGMA hành xử khác nhau).
  for (const sql of [
    'ALTER TABLE books ADD COLUMN cover_url TEXT',
    'ALTER TABLE books ADD COLUMN rental_price INTEGER NOT NULL DEFAULT 0'
  ]) {
    try {
      await db.exec(sql);
    } catch (error) {
      if (!/duplicate column name/i.test(error.message)) throw error;
    }
  }
  const count = await db.get('SELECT COUNT(*) AS count FROM books');
  if (count.count === 0) {
    for (const book of seedBooks) {
      await db.run('INSERT INTO books (title, author, category, quantity, available, rental_price) VALUES (?, ?, ?, ?, ?, ?)', book);
    }
  }
  // Backfill giá mẫu cho DB cũ (chỉ chạm sách giá 0 để không đè giá thủ thư đã đặt)
  for (const book of seedBooks) {
    await db.run('UPDATE books SET rental_price = ? WHERE title = ? AND author = ? AND rental_price = 0', [book[5], book[0], book[1]]);
  }
  // Gắn ảnh bìa mẫu (file ship kèm repo trong frontend/covers/)
  const seedCovers = [
    ['Clean Code', '/assets/covers/clean-code.jpg'],
    ['Đắc nhân tâm', '/assets/covers/dac-nhan-tam.jpg'],
    ['Nhà giả kim', '/assets/covers/nha-gia-kim.jpg'],
    ['Tư duy nhanh và chậm', '/assets/covers/tu-duy-nhanh-va-cham.jpg'],
    ['Khởi nghiệp tinh gọn', '/assets/covers/khoi-nghiep-tinh-gon.jpg']
  ];
  for (const [title, coverUrl] of seedCovers) {
    await db.run("UPDATE books SET cover_url = ? WHERE title = ? AND (cover_url IS NULL OR cover_url = '')", [coverUrl, title]);
  }
  return db;
}

module.exports = { createBookDatabase };
