const express = require('express');
const fs = require('fs');
const path = require('path');
const { createBookDatabase } = require('./db');
const { requireRoles } = require('../../shared/auth');
const config = require('../../shared/config');

const app = express();

// Ảnh bìa: client gửi base64-JSON { image: 'data:image/jpeg;base64,...' }
// (giữ JSON để đi qua Gateway không cần parse multipart), file thật lưu
// tại frontend/covers/ và phục vụ qua /assets/covers/ có sẵn.
const coversDir = path.join(config.rootDir, 'frontend', 'covers');
fs.mkdirSync(coversDir, { recursive: true });
const COVER_LIMIT = 2 * 1024 * 1024; // 2MB file thật

// Nhận dạng loại ảnh theo magic bytes (nội dung thật), không tin đuôi file/mime
// vì ảnh tải về hay bị đổi đuôi (vd PNG/HEIC/SVG đặt tên .jpg)
function detectImageExt(buf) {
  if (buf.length > 1 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.length > 3 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 11 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 3 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  return null;
}

function parseCoverImage(dataUrl) {
  const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(
    typeof dataUrl === 'string' ? dataUrl.trim() : ''
  );
  if (!match) return { error: 'Ảnh bìa phải là file JPG/PNG/WebP' };
  const buf = Buffer.from(match[1], 'base64');
  if (!buf.length || buf.length > COVER_LIMIT) return { error: 'Ảnh bìa vượt quá 2MB' };
  const ext = detectImageExt(buf);
  if (!ext) return { error: 'File không phải ảnh JPG/PNG/WebP (có thể file bị đổi đuôi, hãy mở và lưu lại đúng định dạng)' };
  return { value: { buf, ext } };
}

function removeCoverFile(coverUrl) {
  if (!coverUrl) return;
  const name = path.basename(coverUrl);
  // Chỉ xóa file do hệ thống đặt tên (book-<id>.<ext>), không đụng ảnh seed/bìa thể loại
  if (!/^book-\d+\.(jpg|png|webp)$/.test(name)) return;
  try { fs.unlinkSync(path.join(coversDir, name)); } catch { /* file đã mất thì thôi */ }
}

const roleStaff = ['LIBRARIAN', 'ADMIN'];
const clean = (value) => typeof value === 'string' ? value.trim() : '';
const validId = (value) => Number.isInteger(Number(value)) && Number(value) > 0;

function validateBook(body, isUpdate = false) {
  if (body && body.cover_url !== undefined) return { error: 'Ảnh bìa dùng endpoint POST /books/:id/cover' };
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

  // Route upload ảnh bìa: parser JSON riêng 3mb, đăng ký TRƯỚC json toàn cục
  // để body ảnh lớn không bị chặn ở limit 32kb
  app.post('/books/:id/cover', express.json({ limit: '3mb' }), async (req, res, next) => {
    if (!requireRoles(req, res, roleStaff)) return;
    try {
      if (!validId(req.params.id)) return res.status(400).json({ error: 'Mã sách không hợp lệ' });
      const id = Number(req.params.id);
      const book = await db.get('SELECT * FROM books WHERE id = ?', [id]);
      if (!book) return res.status(404).json({ error: 'Không tìm thấy sách' });
      const parsed = parseCoverImage(req.body && req.body.image);
      if (parsed.error) {
        return res.status(parsed.error.includes('2MB') ? 413 : 400).json({ error: parsed.error });
      }
      const fileName = `book-${id}.${parsed.value.ext}`;
      if (book.cover_url && path.basename(book.cover_url) !== fileName) removeCoverFile(book.cover_url);
      fs.writeFileSync(path.join(coversDir, fileName), parsed.value.buf);
      await db.run('UPDATE books SET cover_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [`/assets/covers/${fileName}`, id]);
      res.json(await db.get('SELECT * FROM books WHERE id = ?', [id]));
    } catch (error) { next(error); }
  });

  app.delete('/books/:id/cover', async (req, res, next) => {
    if (!requireRoles(req, res, roleStaff)) return;
    try {
      if (!validId(req.params.id)) return res.status(400).json({ error: 'Mã sách không hợp lệ' });
      const id = Number(req.params.id);
      const book = await db.get('SELECT * FROM books WHERE id = ?', [id]);
      if (!book) return res.status(404).json({ error: 'Không tìm thấy sách' });
      if (book.cover_url) {
        removeCoverFile(book.cover_url);
        await db.run('UPDATE books SET cover_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
      }
      res.json(await db.get('SELECT * FROM books WHERE id = ?', [id]));
    } catch (error) { next(error); }
  });

  app.use(express.json({ limit: '32kb' }));

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
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Ảnh bìa vượt quá 2MB' });
    console.error('Book Service error:', error.message);
    res.status(500).json({ error: 'Book Service gặp lỗi nội bộ' });
  });
  app.listen(config.bookServicePort, () => console.log(`Book Service: http://localhost:${config.bookServicePort}`));
}

start().catch((error) => { console.error(error); process.exit(1); });
