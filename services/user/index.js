const express = require('express');
const bcrypt = require('bcryptjs');
const { createUserDatabase } = require('./db');
const { ROLES, signUserToken, requireRoles } = require('../../shared/auth');
const config = require('../../shared/config');

const app = express();
app.use(express.json({ limit: '32kb' }));

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function publicUser(user) {
  return { id: user.id, fullName: user.full_name, username: user.username, role: user.role, createdAt: user.created_at };
}

const validId = (value) => Number.isInteger(Number(value)) && Number(value) > 0;

async function countAdmins(db) {
  const row = await db.get("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN'");
  return row.count;
}

async function start() {
  const db = await createUserDatabase();

  app.post('/login', async (req, res, next) => {
    try {
      const username = cleanText(req.body.username).toLowerCase();
      const password = typeof req.body.password === 'string' ? req.body.password : '';
      if (!username || !password) return res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu' });
      const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
      if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
      return res.json({ message: 'Đăng nhập thành công', token: signUserToken(user), user: publicUser(user) });
    } catch (error) { next(error); }
  });

  // Hồ sơ cá nhân: mọi vai trò đã đăng nhập (Gateway mở riêng, xem gateway/index.js)
  app.get('/users/me', async (req, res, next) => {
    const identity = requireRoles(req, res, ['READER', 'LIBRARIAN', 'ADMIN']);
    if (!identity) return;
    try {
      const user = await db.get('SELECT id, full_name, username, role, created_at FROM users WHERE id = ?', [identity.id]);
      if (!user) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });
      res.json(publicUser(user));
    } catch (error) { next(error); }
  });

  app.put('/users/me', async (req, res, next) => {
    const identity = requireRoles(req, res, ['READER', 'LIBRARIAN', 'ADMIN']);
    if (!identity) return;
    try {
      const fullName = cleanText(req.body.fullName);
      if (fullName.length < 2 || fullName.length > 100) {
        return res.status(400).json({ error: 'Họ tên phải từ 2 đến 100 ký tự' });
      }
      await db.run('UPDATE users SET full_name = ? WHERE id = ?', [fullName, identity.id]);
      const user = await db.get('SELECT id, full_name, username, role, created_at FROM users WHERE id = ?', [identity.id]);
      res.json(publicUser(user));
    } catch (error) { next(error); }
  });

  app.post('/users/me/password', async (req, res, next) => {
    const identity = requireRoles(req, res, ['READER', 'LIBRARIAN', 'ADMIN']);
    if (!identity) return;
    try {
      const oldPassword = typeof req.body.oldPassword === 'string' ? req.body.oldPassword : '';
      const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
      if (!oldPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'Mật khẩu mới phải từ 6 ký tự trở lên' });
      }
      const user = await db.get('SELECT * FROM users WHERE id = ?', [identity.id]);
      if (!user || !(await bcrypt.compare(oldPassword, user.password_hash))) {
        return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });
      }
      await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(newPassword, 10), identity.id]);
      res.json({ message: 'Đã đổi mật khẩu' });
    } catch (error) { next(error); }
  });

  app.get('/users', async (req, res, next) => {
    if (!requireRoles(req, res, ['ADMIN'])) return;
    try {
      const users = await db.all('SELECT id, full_name, username, role, created_at FROM users ORDER BY id');
      res.json(users.map(publicUser));
    } catch (error) { next(error); }
  });

  app.post('/users', async (req, res, next) => {
    if (!requireRoles(req, res, ['ADMIN'])) return;
    try {
      const fullName = cleanText(req.body.fullName);
      const username = cleanText(req.body.username).toLowerCase();
      const password = typeof req.body.password === 'string' ? req.body.password : '';
      const role = req.body.role;
      if (fullName.length < 2 || fullName.length > 100 || !/^[a-z0-9._-]{3,50}$/i.test(username) || password.length < 6 || !ROLES.includes(role)) {
        return res.status(400).json({ error: 'Thông tin tài khoản chưa hợp lệ' });
      }
      const passwordHash = await bcrypt.hash(password, 10);
      const result = await db.run('INSERT INTO users (full_name, username, password_hash, role) VALUES (?, ?, ?, ?)', [fullName, username, passwordHash, role]);
      const user = await db.get('SELECT id, full_name, username, role, created_at FROM users WHERE id = ?', [result.lastID]);
      return res.status(201).json(publicUser(user));
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT') return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại' });
      return next(error);
    }
  });

  app.put('/users/:id', async (req, res, next) => {
    const identity = requireRoles(req, res, ['ADMIN']);
    if (!identity) return;
    try {
      if (!validId(req.params.id)) return res.status(400).json({ error: 'Mã tài khoản không hợp lệ' });
      const target = await db.get('SELECT id, full_name, username, role, created_at FROM users WHERE id = ?', [Number(req.params.id)]);
      if (!target) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });
      // username là định danh bất biến (borrow-service lưu tham chiếu logic theo user_id/username)
      if (req.body.username !== undefined && cleanText(req.body.username).toLowerCase() !== target.username) {
        return res.status(400).json({ error: 'Không được đổi tên đăng nhập' });
      }
      const updates = {};
      if (req.body.fullName !== undefined) {
        const fullName = cleanText(req.body.fullName);
        if (fullName.length < 2 || fullName.length > 100) return res.status(400).json({ error: 'Họ tên phải từ 2 đến 100 ký tự' });
        updates.full_name = fullName;
      }
      if (req.body.role !== undefined) {
        if (!ROLES.includes(req.body.role)) return res.status(400).json({ error: 'Vai trò không hợp lệ' });
        updates.role = req.body.role;
      }
      let passwordHash;
      if (req.body.password !== undefined && req.body.password !== '') {
        if (typeof req.body.password !== 'string' || req.body.password.length < 6) {
          return res.status(400).json({ error: 'Mật khẩu mới phải từ 6 ký tự trở lên' });
        }
        passwordHash = await bcrypt.hash(req.body.password, 10);
      }
      if (Object.keys(updates).length === 0 && !passwordHash) {
        return res.status(400).json({ error: 'Không có dữ liệu cần cập nhật' });
      }
      // Chống tự lock: không được đổi vai trò của chính mình
      if (updates.role && updates.role !== target.role && target.id === identity.id) {
        return res.status(403).json({ error: 'Không thể đổi vai trò của chính mình' });
      }
      // Luôn giữ ít nhất một ADMIN
      if (updates.role && target.role === 'ADMIN' && updates.role !== 'ADMIN' && (await countAdmins(db)) <= 1) {
        return res.status(409).json({ error: 'Hệ thống phải giữ ít nhất một quản trị viên' });
      }
      const sets = Object.keys(updates).map((key) => `${key} = ?`);
      const params = Object.values(updates);
      if (passwordHash) { sets.push('password_hash = ?'); params.push(passwordHash); }
      params.push(target.id);
      await db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
      const user = await db.get('SELECT id, full_name, username, role, created_at FROM users WHERE id = ?', [target.id]);
      res.json(publicUser(user));
    } catch (error) { next(error); }
  });

  app.delete('/users/:id', async (req, res, next) => {
    const identity = requireRoles(req, res, ['ADMIN']);
    if (!identity) return;
    try {
      if (!validId(req.params.id)) return res.status(400).json({ error: 'Mã tài khoản không hợp lệ' });
      const target = await db.get('SELECT id, username, role FROM users WHERE id = ?', [Number(req.params.id)]);
      if (!target) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });
      if (target.id === identity.id) return res.status(403).json({ error: 'Không thể xóa tài khoản đang đăng nhập' });
      if (target.role === 'ADMIN' && (await countAdmins(db)) <= 1) {
        return res.status(409).json({ error: 'Hệ thống phải giữ ít nhất một quản trị viên' });
      }
      await db.run('DELETE FROM users WHERE id = ?', [target.id]);
      res.json({ message: `Đã xóa tài khoản ${target.username}`, id: target.id });
    } catch (error) { next(error); }
  });

  app.use((error, req, res, next) => {
    console.error('User Service error:', error.message);
    res.status(500).json({ error: 'User Service gặp lỗi nội bộ' });
  });

  app.listen(config.userServicePort, () => console.log(`User Service: http://localhost:${config.userServicePort}`));
}

start().catch((error) => { console.error(error); process.exit(1); });
