const express = require('express');
const path = require('path');
const config = require('../shared/config');
const { verifyToken } = require('../shared/auth');

const app = express();
// Nới 3mb để body ảnh bìa base64 (~2.7MB) đi qua được; các service vẫn giữ limit riêng
app.use(express.json({ limit: '3mb' }));
app.use('/assets', express.static(path.join(__dirname, '..', 'frontend')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));

const routes = [
  { prefix: '/api/auth', port: () => config.userServicePort, public: true, rewrite: (url) => url.replace('/api/auth', '') },
  { prefix: '/api/users', port: () => config.userServicePort, roles: ['ADMIN'] },
  // DELETE /api/books chỉ có endpoint gỡ ảnh bìa nên mở cho thủ thư (book-service không có xóa sách)
  { prefix: '/api/books', port: () => config.bookServicePort, roles: ['READER', 'LIBRARIAN', 'ADMIN'], methodRoles: { POST: ['LIBRARIAN', 'ADMIN'], PUT: ['LIBRARIAN', 'ADMIN'], DELETE: ['LIBRARIAN', 'ADMIN'] } },
  { prefix: '/api/borrows', port: () => config.borrowServicePort, roles: ['READER', 'LIBRARIAN', 'ADMIN'] }
];

function allowedRoles(req) {
  const pathName = req.originalUrl.split('?')[0];
  if (pathName === '/api/borrows' && req.method === 'GET') return ['LIBRARIAN', 'ADMIN'];
  if (pathName === '/api/borrows/my' && req.method === 'GET') return ['READER'];
  if (pathName === '/api/borrows' && req.method === 'POST') return ['READER'];
  if (/^\/api\/borrows\/\d+\/cancel$/.test(pathName)) return ['READER'];
  if (/^\/api\/borrows\/\d+\/(approve|reject|return)$/.test(pathName)) return ['LIBRARIAN', 'ADMIN'];
  return null;
}

app.use('/api', async (req, res) => {
  const apiPath = req.originalUrl.split('?')[0];
  const route = routes.find((item) => apiPath.startsWith(item.prefix));
  if (!route) return res.status(404).json({ error: 'API không tồn tại' });

  let identity = null;
  if (!route.public) {
    const authorization = req.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) return res.status(401).json({ error: 'Thiếu JWT xác thực' });
    try { identity = verifyToken(authorization.slice(7)); }
    catch { return res.status(401).json({ error: 'JWT không hợp lệ hoặc đã hết hạn' }); }

    const required = allowedRoles(req) || route.methodRoles?.[req.method] || route.roles;
    if (!required.includes(identity.role)) return res.status(403).json({ error: 'Bạn không có quyền thực hiện chức năng này' });
  }

  const destinationPath = (route.rewrite ? route.rewrite(req.originalUrl) : req.originalUrl.replace('/api', ''));
  const headers = { 'Content-Type': 'application/json' };
  if (route.prefix === '/api/books' && /\/books\/\d+\/(reserve|release)$/.test(apiPath)) {
    return res.status(404).json({ error: 'API không tồn tại' });
  }
  if (identity) {
    headers['x-user-id'] = String(identity.id);
    headers['x-user-name'] = encodeURIComponent(identity.fullName);
    headers['x-user-role'] = identity.role;
    headers['x-username'] = identity.username;
  }
  try {
    const response = await fetch(`http://127.0.0.1:${route.port()}${destinationPath}`, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body || {})
    });
    const body = await response.text();
    res.status(response.status).type('json').send(body || '{}');
  } catch (error) {
    res.status(502).json({ error: `Dịch vụ tạm thời không phản hồi: ${error.message}` });
  }
});

app.use((error, req, res, next) => {
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Dữ liệu gửi lên vượt quá 3MB' });
  if (error instanceof SyntaxError) return res.status(400).json({ error: 'Dữ liệu JSON không hợp lệ' });
  console.error('Gateway error:', error.message);
  return res.status(500).json({ error: 'API Gateway gặp lỗi nội bộ' });
});

app.listen(config.gatewayPort, () => console.log(`API Gateway + Web: http://localhost:${config.gatewayPort}`));
