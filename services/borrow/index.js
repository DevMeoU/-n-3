const express = require('express');
const crypto = require('crypto');
const { createBorrowDatabase } = require('./db');
const { requireRoles } = require('../../shared/auth');
const config = require('../../shared/config');

const app = express();
app.use(express.json({ limit: '32kb' }));
const staffRoles = ['LIBRARIAN', 'ADMIN'];
const validId = (value) => Number.isInteger(Number(value)) && Number(value) > 0;
const text = (value) => typeof value === 'string' ? value.trim() : '';

// Giá mượn tính theo NGÀY từ lúc duyệt (ngày đầu tính luôn 1 ngày).
// Phạt quá hạn: 2.000đ/ngày (giữ đồng bộ với LATE_FEE_PER_DAY ở frontend/js/store.js)
const LATE_FEE_PER_DAY = 2000;
const DAY_MS = 86400000;

function lateDays(dueDate, now = new Date()) {
  if (!dueDate) return 0;
  const diff = now - new Date(dueDate);
  return diff > 0 ? Math.ceil(diff / DAY_MS) : 0;
}

// Số ngày mượn tính tiền: từ ngày duyệt đến mốc kết thúc, tối thiểu 1 ngày
function borrowedDays(approvedDate, endTime) {
  if (!approvedDate) return 0;
  const diff = new Date(endTime).getTime() - new Date(approvedDate).getTime();
  return Math.max(1, Math.ceil(diff / DAY_MS));
}

// Bảng phí của phiếu tại 1 thời điểm: tiền mượn = giá/ngày × số ngày
function quoteOf(record, now = new Date()) {
  const rate = Number(record.rental_fee) || 0;
  const paidAmount = Number(record.paid_amount) || 0;
  if (!rate || record.status === 'PENDING' || record.status === 'REJECTED' || !record.approved_date) {
    return { rate: 0, days: 0, rental: 0, late: 0, total: 0, paid: paidAmount, due: 0 };
  }
  const end = record.status === 'RETURNED' && record.return_date ? new Date(record.return_date) : now;
  const days = borrowedDays(record.approved_date, end);
  const rental = rate * days;
  const late = record.status === 'RETURNED'
    ? (Number(record.late_fee) || 0)
    : lateDays(record.due_date, now) * LATE_FEE_PER_DAY;
  const total = rental + late;
  return { rate, days, rental, late, total, paid: paidAmount, due: Math.max(0, total - paidAmount) };
}

function vnd(n) {
  return `${Number(n || 0).toLocaleString('vi-VN')}đ`;
}

function toApi(record, now = new Date()) {
  const q = quoteOf(record, now);
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
    rejectReason: record.reject_reason,
    rentalFee: q.rate,
    daysBorrowed: q.days,
    accruedRental: q.rental,
    lateFee: q.late,
    totalFee: q.total,
    paidAmount: q.paid,
    payableNow: q.due,
    paid: Number(record.paid) === 1,
    paidAt: record.paid_at,
    payToken: record.pay_token || null,
    paidRental: q.paid > 0,
    renewed: Number(record.renewed) === 1
  };
}

// Hóa đơn công khai cho trang quét QR (không lộ userId, không lộ payToken).
// payableNow: dư nợ còn lại tại lúc xem.
function toBill(record, now = new Date()) {
  const q = quoteOf(record, now);
  return {
    id: record.id,
    bookTitle: record.book_title,
    quantity: 1,
    status: record.status,
    dueDate: record.due_date,
    returnDate: record.return_date,
    rentalFee: q.rate,
    daysBorrowed: q.days,
    accruedRental: q.rental,
    lateFee: q.late,
    totalFee: q.total,
    paidAmount: q.paid,
    payableNow: q.due,
    paidRental: q.paid > 0,
    paid: Number(record.paid) === 1,
    paidAt: record.paid_at
  };
}

// Kèm ảnh bìa hiện tại của sách để đối chiếu đúng loại sách trên trang quét QR.
// Phiếu cũ chưa chốt giá/ngày (rental_fee = 0) thì lấy theo giá sách hiện tại.
async function billWithCover(record) {
  let bill = toBill(record);
  bill.coverUrl = null;
  try {
    const book = await bookRequest('GET', `/books/${record.book_id}`);
    if (book.status === 200) {
      if (book.body.cover_url) bill.coverUrl = book.body.cover_url;
      if (!bill.rentalFee && (bill.status === 'BORROWING' || bill.status === 'RETURNED')) {
        const price = Math.max(0, Number(book.body.rental_price) || 0);
        if (price > 0) bill = { ...toBill({ ...record, rental_fee: price }), coverUrl: bill.coverUrl };
      }
    }
  } catch { /* thiếu ảnh/giá vẫn hiện hóa đơn */ }
  return bill;
}

function newPayToken() {
  return crypto.randomBytes(16).toString('hex');
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
      // Độc giả thấy payToken của CHÍNH mình để tự mở link thanh toán QR
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
      const created = toApi(await db.get('SELECT * FROM borrow_records WHERE id = ?', [result.lastID]));
      delete created.payToken;
      res.status(201).json(created);
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
      // Chốt giá mượn theo giá sách tại lúc duyệt (đổi giá sau không ảnh hưởng phiếu cũ)
      // + cấp token thanh toán cho QR (mỗi phiếu 1 token riêng)
      const rentalFee = Math.max(0, Number(reserved.body.rental_price) || 0);
      try {
        await db.run("UPDATE borrow_records SET status = 'BORROWING', approved_date = CURRENT_TIMESTAMP, due_date = ?, rental_fee = ?, pay_token = ? WHERE id = ? AND status = 'PENDING'", [plusDays(14), rentalFee, newPayToken(), record.id]);
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

  // Trả sách: CHẶN khi còn dư nợ — thu hết trước rồi mới được trả
  app.post('/borrows/:id/return', async (req, res, next) => {
    if (!requireRoles(req, res, staffRoles)) return;
    try {
      if (!validId(req.params.id)) return res.status(400).json({ error: 'Mã phiếu không hợp lệ' });
      let record = await db.get('SELECT * FROM borrow_records WHERE id = ?', [Number(req.params.id)]);
      if (!record) return res.status(404).json({ error: 'Không tìm thấy phiếu mượn' });
      if (record.status !== 'BORROWING') return res.status(409).json({ error: 'Chỉ có thể trả phiếu đang mượn' });
      // Phiếu cũ chưa chốt giá/ngày (rental_fee = 0) → lấy giá hiện tại của sách
      if (!Number(record.rental_fee)) {
        const bookNow = await bookRequest('GET', `/books/${record.book_id}`);
        if (bookNow.status === 200) {
          const price = Math.max(0, Number(bookNow.body.rental_price) || 0);
          await db.run('UPDATE borrow_records SET rental_fee = ? WHERE id = ?', [price, record.id]);
          record = await db.get('SELECT * FROM borrow_records WHERE id = ?', [record.id]);
        }
      }
      const q = quoteOf(record);
      if (q.due > 0) {
        return res.status(409).json({ error: `Còn dư nợ ${vnd(q.due)} (mượn ${q.days} ngày + phạt), thu hết mới được trả sách`, due: q.due });
      }
      const released = await bookRequest('POST', `/books/${record.book_id}/release`);
      if (released.status !== 200) return res.status(502).json({ error: released.body.error || 'Không thể cập nhật tồn kho khi trả' });
      try {
        await db.run("UPDATE borrow_records SET status = 'RETURNED', return_date = CURRENT_TIMESTAMP, late_fee = ?, paid = 1, paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP) WHERE id = ? AND status = 'BORROWING'", [q.late, record.id]);
      } catch (error) {
        await bookRequest('POST', `/books/${record.book_id}/reserve`);
        throw error;
      }
      res.json(toApi(await db.get('SELECT * FROM borrow_records WHERE id = ?', [record.id])));
    } catch (error) { next(error); }
  });

  // Thu tiền: thu TRỌN số dư còn lại tại lúc thu (tiền mượn theo ngày + phạt đến hôm nay).
  // Đang mượn thu xong, mai phát sinh thêm ngày mới thì thu tiếp. Chỉ chốt paid khi đã trả
  // (đang mượn không bao giờ chốt paid vì ngày mai còn phát sinh).
  app.post('/borrows/:id/pay', async (req, res, next) => {
    if (!requireRoles(req, res, staffRoles)) return;
    try {
      if (!validId(req.params.id)) return res.status(400).json({ error: 'Mã phiếu không hợp lệ' });
      const record = await db.get('SELECT * FROM borrow_records WHERE id = ?', [Number(req.params.id)]);
      if (!record) return res.status(404).json({ error: 'Không tìm thấy phiếu mượn' });
      if (record.status !== 'BORROWING' && record.status !== 'RETURNED') {
        return res.status(409).json({ error: 'Chỉ thu tiền phiếu đang mượn hoặc đã trả sách' });
      }
      const q = quoteOf(record);
      if (q.total === 0) return res.status(409).json({ error: 'Phiếu không phát sinh phí' });
      if (q.due === 0) {
        if (record.status === 'RETURNED' && Number(record.paid) !== 1) {
          await db.run('UPDATE borrow_records SET paid = 1, paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP) WHERE id = ?', [record.id]);
        } else if (Number(record.paid) === 1) {
          return res.status(409).json({ error: 'Phiếu này đã thu hết tiền' });
        } else {
          return res.status(409).json({ error: 'Không còn dư nợ phải thu' });
        }
      } else {
        // Thu trọn dư nợ; phiếu đã trả thì chốt paid luôn vì sau trả không phát sinh thêm
        await db.run('UPDATE borrow_records SET paid_amount = paid_amount + ?, paid_rental = 1, paid = CASE WHEN status = ? THEN 1 ELSE paid END, paid_at = CASE WHEN status = ? THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE paid_at END WHERE id = ?', [q.due, 'RETURNED', 'RETURNED', record.id]);
      }
      const fresh = toApi(await db.get('SELECT * FROM borrow_records WHERE id = ?', [record.id]));
      res.json({ ...fresh, collected: q.due });
    } catch (error) { next(error); }
  });

  // Gia hạn: độc giả tự gia hạn phiếu BORROWING của mình 1 lần duy nhất (+7 ngày),
  // không áp dụng phiếu đã quá hạn
  app.post('/borrows/:id/renew', async (req, res, next) => {
    const identity = requireRoles(req, res, ['READER']);
    if (!identity) return;
    try {
      if (!validId(req.params.id)) return res.status(400).json({ error: 'Mã phiếu không hợp lệ' });
      const record = await db.get('SELECT * FROM borrow_records WHERE id = ?', [Number(req.params.id)]);
      if (!record) return res.status(404).json({ error: 'Không tìm thấy phiếu mượn' });
      if (record.user_id !== identity.id) return res.status(403).json({ error: 'Bạn chỉ được gia hạn phiếu của chính mình' });
      if (record.status !== 'BORROWING') return res.status(409).json({ error: 'Chỉ gia hạn phiếu đang mượn' });
      if (Number(record.renewed) === 1) return res.status(409).json({ error: 'Mỗi phiếu chỉ được gia hạn một lần' });
      if (lateDays(record.due_date) > 0) return res.status(409).json({ error: 'Phiếu đã quá hạn nên không gia hạn được' });
      const due = new Date(new Date(record.due_date).getTime() + 7 * 86400000).toISOString();
      await db.run('UPDATE borrow_records SET due_date = ?, renewed = 1 WHERE id = ? AND status = ?', [due, record.id, 'BORROWING']);
      res.json(toApi(await db.get('SELECT * FROM borrow_records WHERE id = ?', [record.id])));
    } catch (error) { next(error); }
  });

  // ---- Kênh thanh toán QR fake (công khai, xác thực bằng pay_token, phục vụ demo) ----
  app.get('/pay/:id', async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return res.status(400).json({ error: 'Mã phiếu không hợp lệ' });
      const record = await db.get('SELECT * FROM borrow_records WHERE id = ?', [Number(req.params.id)]);
      if (!record || !record.pay_token || record.pay_token !== text(req.query.t)) {
        return res.status(404).json({ error: 'Liên kết thanh toán không hợp lệ hoặc đã hết hạn' });
      }
      res.json(await billWithCover(record));
    } catch (error) { next(error); }
  });

  app.post('/pay/:id/confirm', async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return res.status(400).json({ error: 'Mã phiếu không hợp lệ' });
      const token = text((req.body && req.body.t) || req.query.t);
      const record = await db.get('SELECT * FROM borrow_records WHERE id = ?', [Number(req.params.id)]);
      if (!record || !record.pay_token || record.pay_token !== token) {
        return res.status(404).json({ error: 'Liên kết thanh toán không hợp lệ hoặc đã hết hạn' });
      }
      if (record.status !== 'BORROWING' && record.status !== 'RETURNED') {
        return res.status(409).json({ error: 'Phiếu chưa tới kỳ thanh toán' });
      }
      const q = quoteOf(record);
      if (q.total === 0) return res.status(409).json({ error: 'Phiếu không phát sinh phí' });
      // Lũy kế số đã thu; hết nợ thì chốt paid (idempotent: quét lại vẫn thành công)
      if (q.due > 0) {
        await db.run('UPDATE borrow_records SET paid_amount = paid_amount + ?, paid_rental = 1 WHERE id = ?', [q.due, record.id]);
      }
      const fresh = await db.get('SELECT * FROM borrow_records WHERE id = ?', [record.id]);
      const q2 = quoteOf(fresh);
      if (fresh.status === 'RETURNED' && q2.due === 0 && Number(fresh.paid) !== 1) {
        await db.run('UPDATE borrow_records SET paid = 1, paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP) WHERE id = ?', [record.id]);
      }
      const bill = await billWithCover(await db.get('SELECT * FROM borrow_records WHERE id = ?', [record.id]));
      res.json({ ...bill, collected: q.due });
    } catch (error) { next(error); }
  });

  app.use((error, req, res, next) => {
    console.error('Borrow Service error:', error.message);
    res.status(500).json({ error: 'Borrow Service gặp lỗi nội bộ' });
  });
  app.listen(config.borrowServicePort, () => console.log(`Borrow Service: http://localhost:${config.borrowServicePort}`));
}

start().catch((error) => { console.error(error); process.exit(1); });
