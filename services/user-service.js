const express = require('express');
const bcrypt = require('bcryptjs');
const { createUserDatabase } = require('./user-db');
const { ROLES, signUserToken, requireRoles } = require('../lib/auth');
const config = require('../lib/config');

const app = express();
app.use(express.json({ limit: '32kb' }));

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function publicUser(user) {
  return { id: user.id, fullName: user.full_name, username: user.username, role: user.role, createdAt: user.created_at };
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

  app.use((error, req, res, next) => {
    console.error('User Service error:', error.message);
    res.status(500).json({ error: 'User Service gặp lỗi nội bộ' });
  });

  app.listen(config.userServicePort, () => console.log(`User Service: http://localhost:${config.userServicePort}`));
}

start().catch((error) => { console.error(error); process.exit(1); });
