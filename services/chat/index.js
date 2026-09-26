const express = require('express');
const { createChatDatabase } = require('./db');
const { requireRoles } = require('../../shared/auth');
const config = require('../../shared/config');

const app = express();
app.use(express.json({ limit: '32kb' }));
const validId = (value) => Number.isInteger(Number(value)) && Number(value) > 0;
const text = (value) => typeof value === 'string' ? value.trim() : '';
const STAFF = ['LIBRARIAN', 'ADMIN'];

function toApi(row) {
  return {
    id: row.id,
    readerId: row.reader_id,
    staffRole: row.staff_role,
    senderId: row.sender_id,
    senderName: row.sender_name,
    senderRole: row.sender_role,
    body: row.body,
    createdAt: row.created_at,
    read: row.read_at !== null && row.read_at !== undefined
  };
}

async function start() {
  const db = await createChatDatabase();

  // Gửi tin nhắn. READER: mở/tilếp thread với quầy Thủ thư hoặc Admin.
  // Thủ thư/Admin: chỉ trả lời độc giả trong thread có sẵn.
  app.post('/chat', async (req, res, next) => {
    const identity = requireRoles(req, res, ['READER', 'LIBRARIAN', 'ADMIN']);
    if (!identity) return;
    try {
      const body = text(req.body.body);
      if (!body || body.length > 1000) return res.status(400).json({ error: 'Tin nhắn từ 1 đến 1000 ký tự' });
      let readerId;
      let staffRole;
      if (identity.role === 'READER') {
        staffRole = req.body.toRole;
        if (!STAFF.includes(staffRole)) return res.status(400).json({ error: 'Chọn quầy Thủ thư hoặc Quản trị viên' });
        readerId = identity.id;
      } else {
        readerId = Number(req.body.toUserId);
        staffRole = identity.role;
        if (!validId(readerId)) return res.status(400).json({ error: 'Thiếu độc giả nhận tin' });
        if (readerId === identity.id) return res.status(400).json({ error: 'Không tự nhắn cho chính mình' });
      }
      const result = await db.run(
        'INSERT INTO messages (reader_id, staff_role, sender_id, sender_name, sender_role, body) VALUES (?, ?, ?, ?, ?, ?)',
        [readerId, staffRole, identity.id, identity.fullName, identity.role, body]
      );
      res.status(201).json(toApi(await db.get('SELECT * FROM messages WHERE id = ?', [result.lastID])));
    } catch (error) { next(error); }
  });

  // Danh sách hội thoại + số chưa đọc
  app.get('/chat/threads', async (req, res, next) => {
    const identity = requireRoles(req, res, ['READER', 'LIBRARIAN', 'ADMIN']);
    if (!identity) return;
    try {
      const where = identity.role === 'READER'
        ? 'WHERE reader_id = ?'
        : identity.role === 'ADMIN'
          ? 'WHERE 1 = 1'
          : 'WHERE (staff_role = ? OR sender_id = ?)';
      const params = identity.role === 'READER' ? [identity.id]
        : identity.role === 'ADMIN' ? []
        : [identity.role, identity.id];
      const rows = await db.all(
        `SELECT reader_id, staff_role,
                MAX(id) AS last_id,
                SUM(CASE WHEN read_at IS NULL AND sender_id != ? THEN 1 ELSE 0 END) AS unread
           FROM messages ${where}
          GROUP BY reader_id, staff_role
          ORDER BY last_id DESC`,
        [identity.id, ...params]
      );
      const threads = [];
      for (const row of rows) {
        const last = await db.get('SELECT * FROM messages WHERE id = ?', [row.last_id]);
        const readerName = await db.get(
          "SELECT sender_name FROM messages WHERE reader_id = ? AND staff_role = ? AND sender_role = 'READER' ORDER BY id LIMIT 1",
          [row.reader_id, row.staff_role]
        );
        threads.push({
          readerId: row.reader_id,
          readerName: readerName ? readerName.sender_name : `Độc giả #${row.reader_id}`,
          staffRole: row.staff_role,
          unread: Number(row.unread) || 0,
          lastMessage: toApi(last)
        });
      }
      res.json(threads);
    } catch (error) { next(error); }
  });

  // Tổng số chưa đọc (badge navbar)
  app.get('/chat/unread', async (req, res, next) => {
    const identity = requireRoles(req, res, ['READER', 'LIBRARIAN', 'ADMIN']);
    if (!identity) return;
    try {
      const where = identity.role === 'READER'
        ? 'reader_id = ? AND sender_role != ?'
        : identity.role === 'ADMIN'
          ? 'sender_id != ?'
          : '((staff_role = ? OR sender_id = ?) AND sender_id != ?)';
      const params = identity.role === 'READER'
        ? [identity.id, identity.id]
        : identity.role === 'ADMIN'
          ? [identity.id]
          : [identity.role, identity.id, identity.id];
      const row = await db.get(
        `SELECT COUNT(*) AS count FROM messages WHERE read_at IS NULL AND sender_id != ? AND (${where})`,
        [identity.id, ...params]
      );
      res.json({ unread: row.count });
    } catch (error) { next(error); }
  });

  // Đọc 1 thread (đồng thời đánh dấu đã đọc tin của phía bên kia)
  app.get('/chat/threads/:readerId/:staffRole', async (req, res, next) => {
    const identity = requireRoles(req, res, ['READER', 'LIBRARIAN', 'ADMIN']);
    if (!identity) return;
    try {
      const readerId = Number(req.params.readerId);
      const staffRole = req.params.staffRole;
      if (!validId(readerId) || !STAFF.includes(staffRole)) {
        return res.status(400).json({ error: 'Hội thoại không hợp lệ' });
      }
      if (identity.role === 'READER' && readerId !== identity.id) {
        return res.status(403).json({ error: 'Bạn chỉ được xem hội thoại của chính mình' });
      }
      if (identity.role !== 'READER' && staffRole !== identity.role && identity.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Bạn chỉ được xem quầy của vai trò mình' });
      }
      await db.run(
        'UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE reader_id = ? AND staff_role = ? AND sender_id != ? AND read_at IS NULL',
        [readerId, staffRole, identity.id]
      );
      const rows = await db.all(
        'SELECT * FROM messages WHERE reader_id = ? AND staff_role = ? ORDER BY id',
        [readerId, staffRole]
      );
      res.json(rows.map(toApi));
    } catch (error) { next(error); }
  });

  app.use((error, req, res, next) => {
    console.error('Chat Service error:', error.message);
    res.status(500).json({ error: 'Chat Service gặp lỗi nội bộ' });
  });
  app.listen(config.chatServicePort, () => console.log(`Chat Service: http://localhost:${config.chatServicePort}`));
}

start().catch((error) => { console.error(error); process.exit(1); });
