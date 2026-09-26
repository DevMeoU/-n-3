const express = require('express');
const { createBorrowDatabase } = require('./db');
const { requireRoles } = require('../../shared/auth');
const config = require('../../shared/config');

const app = express();
app.use(express.json({ limit: '32kb' }));
const staffRoles = ['LIBRARIAN', 'ADMIN'];
const validId = (value) => Number.isInteger(Number(value)) && Number(value) > 0;
const text = (value) => typeof value === 'string' ? value.trim() : '';

function toApi(record) {
  return {
    id: record.id,
    userId: record.user_id,
    userName: record.user_name,
    bookId: record.book_id,
    bookTitle: record.book_title,
    requestDate: record.request_date,
    approvedDate: record.approved_date,
    dueDate: record.due_date,
    returnDate: record.return_date,
    status: record.status,
    note: record.note,
    rejectReason: record.reject_reason
  };
}

function internalHeaders() {
  return { 'x-internal-service-secret': config.internalServiceSecret };
}

async function bookRequest(method, path) {
  const response = await fetch(`http://127.0.0.1:${config.bookServicePort}${path}`, { method, headers: internalHeaders() });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

function plusDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

async function start() {
  const db = await createBorrowDatabase();

  app.get('/borrows', async (req, res, next) => {
    if (!requireRoles(req, res, staffRoles)) return;
    try {
      const status = text(req.query.status);
      if (status && !['PENDING', 'BORROWING', 'RETURNED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'Trạng thái lọc không hợp lệ' });
      const rows = await db.all(`SELECT * FROM borrow_records ${status ? 'WHERE status = ?' : ''} ORDER BY request_date DESC, id DESC`, status ? [status] : []);
      res.json(rows.map(toApi));
    } catch (error) { next(error); }
  });

  app.get('/borrows/my', async (req, res, next) => {
    const identity = requireRoles(req, res, ['READER']);
    if (!identity) return;
    try {
      const status = text(req.query.status);
      if (status && !['PENDING', 'BORROWING', 'RETURNED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'Trạng thái lọc không hợp lệ' });
      const rows = await db.all(`SELECT * FROM borrow_records WHERE user_id = ? ${status ? 'AND status = ?' : ''} ORDER BY request_date DESC, id DESC`, status ? [identity.id, status] : [identity.id]);
      res.json(rows.map(toApi));
    } catch (error) { next(error); }
  });

  app.post('/borrows', async (req, res, next) => {
    const identity = requireRoles(req, res, ['READER']);
    if (!identity) return;
    try {
      const bookId = Number(req.body.bookId);
      const note = text(req.body.note);
      if (!validId(bookId) || note.length > 500) return res.status(400).json({ error: 'Dữ liệu yêu cầu mượn chưa hợp lệ' });
      const duplicate = await db.get("SELECT id FROM borrow_records WHERE user_id = ? AND book_id = ? AND status = 'PENDING'", [identity.id, bookId]);
      if (duplicate) return res.status(409).json({ error: 'Bạn đã có yêu cầu chờ duyệt cho sách này' });
      const bookResponse = await bookRequest('GET', `/books/${bookId}`);
      if (bookResponse.status !== 200) return res.status(bookResponse.status === 404 ? 404 : 502).json({ error: bookResponse.body.error || 'Không thể kiểm tra thông tin sách' });
      const book = bookResponse.body;
      const result = await db.run('INSERT INTO borrow_records (user_id, user_name, book_id, book_title, note) VALUES (?, ?, ?, ?, ?)', [identity.id, identity.fullName, book.id, book.title, note || null]);
      const record = await db.get('SELECT * FROM borrow_records WHERE id = ?', [result.lastID]);
      res.status(201).json(toApi(record));
    } catch (error) { next(error); }
  });

  app.post('/borrows/:id/approve', async (req, res, next) => {
    if (!requireRoles(req, res, staffRoles)) return;
    try {
      if (!validId(req.params.id)) return res.status(400).json({ error: 'Mã phiếu không hợp lệ' });
      const record = await db.get('SELECT * FROM borrow_records WHERE id = ?', [Number(req.params.id)]);
      if (!record) return res.status(404).json({ error: 'Không tìm thấy phiếu mượn' });
      if (record.status !== 'PENDING') return res.status(409).json({ error: 'Chỉ có thể duyệt phiếu đang chờ' });
      const reserved = await bookRequest('POST', `/books/${record.book_id}/reserve`);
      if (reserved.status !== 200) return res.status(reserved.status === 409 ? 409 : 502).json({ error: reserved.status === 409 ? 'Sách đã hết, chưa thể duyệt phiếu' : (reserved.body.error || 'Không thể giữ sách') });
      try {
        await db.run("UPDATE borrow_records SET status = 'BORROWING', approved_date = CURRENT_TIMESTAMP, due_date = ? WHERE id = ? AND status = 'PENDING'", [plusDays(14), record.id]);
      } catch (error) {
        await bookRequest('POST', `/books/${record.book_id}/release`);
        throw error;
      }
      res.json(toApi(await db.get('SELECT * FROM borrow_records WHERE id = ?', [record.id])));
    } catch (error) { next(error); }
  });

  app.post('/borrows/:id/reject', async (req, res, next) => {
    if (!requireRoles(req, res, staffRoles)) return;
    try {
      const reason = text(req.body.reason);
      if (!validId(req.params.id) || reason.length < 3 || reason.length > 500) return res.status(400).json({ error: 'Cần nhập lý do từ chối từ 3 đến 500 ký tự' });
      const result = await db.run("UPDATE borrow_records SET status = 'REJECTED', reject_reason = ? WHERE id = ? AND status = 'PENDING'", [reason, Number(req.params.id)]);
      if (!result.changes) {
        const exists = await db.get('SELECT id FROM borrow_records WHERE id = ?', [Number(req.params.id)]);
        return res.status(exists ? 409 : 404).json({ error: exists ? 'Chỉ có thể từ chối phiếu đang chờ' : 'Không tìm thấy phiếu mượn' });
      }
      res.json(toApi(await db.get('SELECT * FROM borrow_records WHERE id = ?', [Number(req.params.id)])));
    } catch (error) { next(error); }
  });

  app.post('/borrows/:id/cancel', async (req, res, next) => {
    const identity = requireRoles(req, res, ['READER']);
    if (!identity) return;
    try {
      if (!validId(req.params.id)) return res.status(400).json({ error: 'Mã phiếu không hợp lệ' });
      const record = await db.get('SELECT * FROM borrow_records WHERE id = ?', [Number(req.params.id)]);
      if (!record) return res.status(404).json({ error: 'Không tìm thấy phiếu mượn' });
      if (record.user_id !== identity.id) return res.status(403).json({ error: 'Bạn chỉ được hủy yêu cầu của chính mình' });
      if (record.status !== 'PENDING') return res.status(409).json({ error: 'Chỉ có thể hủy phiếu đang chờ duyệt' });
      await db.run("UPDATE borrow_records SET status = 'REJECTED', reject_reason = 'Độc giả hủy yêu cầu' WHERE id = ?", [record.id]);
      res.json(toApi(await db.get('SELECT * FROM borrow_records WHERE id = ?', [record.id])));
    } catch (error) { next(error); }
  });

  app.post('/borrows/:id/return', async (req, res, next) => {
    if (!requireRoles(req, res, staffRoles)) return;
    try {
      if (!validId(req.params.id)) return res.status(400).json({ error: 'Mã phiếu không hợp lệ' });
      const record = await db.get('SELECT * FROM borrow_records WHERE id = ?', [Number(req.params.id)]);
      if (!record) return res.status(404).json({ error: 'Không tìm thấy phiếu mượn' });
      if (record.status !== 'BORROWING') return res.status(409).json({ error: 'Chỉ có thể trả phiếu đang mượn' });
      const released = await bookRequest('POST', `/books/${record.book_id}/release`);
      if (released.status !== 200) return res.status(502).json({ error: released.body.error || 'Không thể cập nhật tồn kho khi trả' });
      try {
        await db.run("UPDATE borrow_records SET status = 'RETURNED', return_date = CURRENT_TIMESTAMP WHERE id = ? AND status = 'BORROWING'", [record.id]);
      } catch (error) {
        await bookRequest('POST', `/books/${record.book_id}/reserve`);
        throw error;
      }
      res.json(toApi(await db.get('SELECT * FROM borrow_records WHERE id = ?', [record.id])));
    } catch (error) { next(error); }
  });

  app.use((error, req, res, next) => {
    console.error('Borrow Service error:', error.message);
    res.status(500).json({ error: 'Borrow Service gặp lỗi nội bộ' });
  });
  app.listen(config.borrowServicePort, () => console.log(`Borrow Service: http://localhost:${config.borrowServicePort}`));
}

start().catch((error) => { console.error(error); process.exit(1); });
