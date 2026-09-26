const express = require('express');
const { createBookDatabase } = require('./db');
const { requireRoles } = require('../../shared/auth');
const config = require('../../shared/config');

const app = express();
app.use(express.json({ limit: '32kb' }));

const roleStaff = ['LIBRARIAN', 'ADMIN'];
const clean = (value) => typeof value === 'string' ? value.trim() : '';
const validId = (value) => Number.isInteger(Number(value)) && Number(value) > 0;

function validateBook(body, isUpdate = false) {
  const result = {};
  for (const field of ['title', 'author', 'category']) {
    if (body[field] !== undefined) {
      const value = clean(body[field]);
      if (!value || value.length > (field === 'title' ? 200 : 120)) return { error: `${field} chưa hợp lệ` };
      result[field] = value;
    }
  }
  if (!isUpdate && (!result.title || !result.author || !result.category)) return { error: 'Tên sách, tác giả và thể loại là bắt buộc' };
  if (body.quantity !== undefined) {
    const quantity = Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) return { error: 'Số lượng phải là số nguyên dương' };
    result.quantity = quantity;
  }
  if (!isUpdate && result.quantity === undefined) return { error: 'Số lượng là bắt buộc' };
  return { value: result };
}

function isInternalRequest(req) {
  return req.get('x-internal-service-secret') === config.internalServiceSecret;
}

async function start() {
  const db = await createBookDatabase();

  app.get('/books', async (req, res, next) => {
    const identity = isInternalRequest(req) || requireRoles(req, res, ['READER', 'LIBRARIAN', 'ADMIN']);
    if (!identity) return;
    try {
      const query = clean(req.query.q).toLowerCase();
      const category = clean(req.query.category);
      const availableOnly = req.query.available === 'true';
      const clauses = [];
      const params = [];
      if (query) { clauses.push('(LOWER(title) LIKE ? OR LOWER(author) LIKE ? OR LOWER(category) LIKE ?)'); params.push(`%${query}%`, `%${query}%`, `%${query}%`); }
      if (category) { clauses.push('category = ?'); params.push(category); }
      if (availableOnly) clauses.push('available > 0');
      const rows = await db.all(`SELECT * FROM books ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY title`, params);
      res.json(rows);
    } catch (error) { next(error); }
  });

  app.get('/books/:id', async (req, res, next) => {
    const identity = isInternalRequest(req) || requireRoles(req, res, ['READER', 'LIBRARIAN', 'ADMIN']);
    if (!identity) return;
    try {
      if (!validId(req.params.id)) return res.status(400).json({ error: 'Mã sách không hợp lệ' });
      const book = await db.get('SELECT * FROM books WHERE id = ?', [Number(req.params.id)]);
      if (!book) return res.status(404).json({ error: 'Không tìm thấy sách' });
      res.json(book);
    } catch (error) { next(error); }
  });

  app.post('/books', async (req, res, next) => {
    if (!requireRoles(req, res, roleStaff)) return;
    try {
      const validated = validateBook(req.body);
      if (validated.error) return res.status(400).json({ error: validated.error });
      const book = validated.value;
      const result = await db.run('INSERT INTO books (title, author, category, quantity, available) VALUES (?, ?, ?, ?, ?)', [book.title, book.author, book.category, book.quantity, book.quantity]);
      res.status(201).json(await db.get('SELECT * FROM books WHERE id = ?', [result.lastID]));
    } catch (error) { next(error); }
  });

  app.put('/books/:id', async (req, res, next) => {
    if (!requireRoles(req, res, roleStaff)) return;
    try {
      if (!validId(req.params.id)) return res.status(400).json({ error: 'Mã sách không hợp lệ' });
      const current = await db.get('SELECT * FROM books WHERE id = ?', [Number(req.params.id)]);
      if (!current) return res.status(404).json({ error: 'Không tìm thấy sách' });
      const validated = validateBook(req.body, true);
      if (validated.error || Object.keys(validated.value).length === 0) return res.status(400).json({ error: validated.error || 'Không có dữ liệu cần cập nhật' });
      const nextBook = { ...current, ...validated.value };
      if (nextBook.quantity < current.quantity - current.available) return res.status(409).json({ error: 'Số lượng mới nhỏ hơn số bản đang được mượn' });
      nextBook.available = nextBook.quantity - (current.quantity - current.available);
      await db.run('UPDATE books SET title = ?, author = ?, category = ?, quantity = ?, available = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [nextBook.title, nextBook.author, nextBook.category, nextBook.quantity, nextBook.available, current.id]);
      res.json(await db.get('SELECT * FROM books WHERE id = ?', [current.id]));
    } catch (error) { next(error); }
  });

  app.post('/books/:id/reserve', async (req, res, next) => {
    if (!isInternalRequest(req)) return res.status(403).json({ error: 'Endpoint reserve chỉ dành cho Borrow Service' });
    try {
      if (!validId(req.params.id)) return res.status(400).json({ error: 'Mã sách không hợp lệ' });
      const id = Number(req.params.id);
      const result = await db.run('UPDATE books SET available = available - 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND available > 0', [id]);
      if (result.changes === 0) {
        const exists = await db.get('SELECT id FROM books WHERE id = ?', [id]);
        return res.status(exists ? 409 : 404).json({ error: exists ? 'Sách đã hết' : 'Không tìm thấy sách' });
      }
      res.json(await db.get('SELECT * FROM books WHERE id = ?', [id]));
    } catch (error) { next(error); }
  });

  app.post('/books/:id/release', async (req, res, next) => {
    if (!isInternalRequest(req)) return res.status(403).json({ error: 'Endpoint release chỉ dành cho Borrow Service' });
    try {
      if (!validId(req.params.id)) return res.status(400).json({ error: 'Mã sách không hợp lệ' });
      const id = Number(req.params.id);
      const result = await db.run('UPDATE books SET available = available + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND available < quantity', [id]);
      if (result.changes === 0) {
        const book = await db.get('SELECT * FROM books WHERE id = ?', [id]);
        return res.status(book ? 409 : 404).json({ error: book ? 'Tồn kho đã đạt số lượng tối đa' : 'Không tìm thấy sách' });
      }
      res.json(await db.get('SELECT * FROM books WHERE id = ?', [id]));
    } catch (error) { next(error); }
  });

  app.use((error, req, res, next) => {
    console.error('Book Service error:', error.message);
    res.status(500).json({ error: 'Book Service gặp lỗi nội bộ' });
  });
  app.listen(config.bookServicePort, () => console.log(`Book Service: http://localhost:${config.bookServicePort}`));
}

start().catch((error) => { console.error(error); process.exit(1); });
