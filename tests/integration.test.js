const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.join(__dirname, '..');
const dataDir = path.join(root, 'data');
for (const name of ['user-service-test.db', 'book-service-test.db', 'borrow-service-test.db']) {
  const file = path.join(dataDir, name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

const env = {
  ...process.env,
  NODE_ENV: 'test',
  GATEWAY_PORT: '4100',
  USER_SERVICE_PORT: '4101',
  BOOK_SERVICE_PORT: '4102',
  BORROW_SERVICE_PORT: '4103',
  JWT_SECRET: 'test-secret',
  INTERNAL_SERVICE_SECRET: 'test-internal-secret'
};
const files = ['services/user-service.js', 'services/book-service.js', 'services/borrow-service.js', 'gateway.js'];
const children = files.map((file) => spawn(process.execPath, [path.join(root, file)], { env, stdio: 'ignore' }));

function call(method, requestPath, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: '127.0.0.1', port: 4100, path: requestPath, method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: raw ? JSON.parse(raw) : {} }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function expect(condition, message) { if (!condition) throw new Error(message); }
async function login(username, password = '123456') {
  const response = await call('POST', '/api/auth/login', { username, password });
  expect(response.status === 200 && response.data.token, `Đăng nhập ${username}`);
  return response.data;
}

(async () => {
  let passed = 0;
  const test = async (name, action) => {
    await action();
    passed++;
    console.log(`PASS ${passed}: ${name}`);
  };
  try {
    await wait(2500);
    const reader = await login('reader');
    const librarian = await login('librarian');
    const admin = await login('admin');

    await test('Login sai mật khẩu trả 401', async () => {
      const r = await call('POST', '/api/auth/login', { username: 'reader', password: 'wrong' });
      expect(r.status === 401 && r.data.error, 'Sai mã login');
    });
    await test('API không JWT trả 401', async () => {
      const r = await call('GET', '/api/books');
      expect(r.status === 401, 'Thiếu JWT phải bị chặn');
    });
    await test('Reader xem danh mục sách', async () => {
      const r = await call('GET', '/api/books?q=Clean', undefined, reader.token);
      expect(r.status === 200 && r.data.some((book) => book.title === 'Clean Code'), `Không tìm thấy Clean Code: ${JSON.stringify(r.data)}`);
    });
    await test('Reader không được thêm sách', async () => {
      const r = await call('POST', '/api/books', { title: 'Sai quyền', author: 'Test', category: 'Test', quantity: 1 }, reader.token);
      expect(r.status === 403, 'Reader đã thêm được sách');
    });
    const uniqueBook = `Sách test ${Date.now()}`;
    let bookId;
    await test('Librarian thêm sách hợp lệ', async () => {
      const r = await call('POST', '/api/books', { title: uniqueBook, author: 'QA', category: 'Công nghệ', quantity: 2 }, librarian.token);
      expect(r.status === 201 && r.data.available === 2, 'Không thêm được sách');
      bookId = r.data.id;
    });
    await test('Validate số lượng sách âm', async () => {
      const r = await call('POST', '/api/books', { title: 'Sai dữ liệu', author: 'QA', category: 'Test', quantity: 0 }, librarian.token);
      expect(r.status === 400, 'Quantity 0 phải lỗi');
    });
    await test('Reader không xem danh sách tài khoản', async () => {
      const r = await call('GET', '/api/users', undefined, reader.token);
      expect(r.status === 403, 'Reader đã xem được users');
    });
    const username = `qa_${Date.now()}`;
    await test('Admin tạo tài khoản và trùng username lỗi', async () => {
      const created = await call('POST', '/api/users', { fullName: 'Tài khoản QA', username, password: '123456', role: 'READER' }, admin.token);
      expect(created.status === 201 && !created.data.passwordHash, 'Admin không tạo được user');
      const duplicate = await call('POST', '/api/users', { fullName: 'Tài khoản QA', username, password: '123456', role: 'READER' }, admin.token);
      expect(duplicate.status === 409, 'Trùng username phải lỗi');
    });

    let borrowId;
    await test('Reader tạo phiếu PENDING không giảm tồn', async () => {
      const before = await call('GET', `/api/books/${bookId}`, undefined, reader.token);
      const r = await call('POST', '/api/borrows', { bookId, note: 'Phục vụ kiểm thử' }, reader.token);
      const after = await call('GET', `/api/books/${bookId}`, undefined, reader.token);
      expect(r.status === 201 && r.data.status === 'PENDING', 'Không tạo PENDING');
      expect(before.data.available === after.data.available, 'PENDING không được giảm tồn');
      borrowId = r.data.id;
    });
    await test('Librarian duyệt phiếu và giảm tồn', async () => {
      const before = await call('GET', `/api/books/${bookId}`, undefined, librarian.token);
      const r = await call('POST', `/api/borrows/${borrowId}/approve`, undefined, librarian.token);
      const after = await call('GET', `/api/books/${bookId}`, undefined, librarian.token);
      expect(r.status === 200 && r.data.status === 'BORROWING' && r.data.dueDate, 'Không duyệt được phiếu');
      expect(after.data.available === before.data.available - 1, 'Duyệt chưa giảm tồn');
    });
    await test('Trả sách tăng tồn và không trả hai lần', async () => {
      const before = await call('GET', `/api/books/${bookId}`, undefined, librarian.token);
      const r = await call('POST', `/api/borrows/${borrowId}/return`, undefined, librarian.token);
      const after = await call('GET', `/api/books/${bookId}`, undefined, librarian.token);
      const duplicate = await call('POST', `/api/borrows/${borrowId}/return`, undefined, librarian.token);
      expect(r.status === 200 && r.data.status === 'RETURNED', 'Không trả được sách');
      expect(after.data.available === before.data.available + 1, 'Trả chưa tăng tồn');
      expect(duplicate.status === 409, 'Trả hai lần phải lỗi');
    });
    let pendingId;
    await test('Reader hủy PENDING của chính mình', async () => {
      const created = await call('POST', '/api/borrows', { bookId }, reader.token);
      pendingId = created.data.id;
      const cancelled = await call('POST', `/api/borrows/${pendingId}/cancel`, undefined, reader.token);
      expect(cancelled.status === 200 && cancelled.data.status === 'REJECTED', 'Hủy PENDING thất bại');
    });
    await test('Duyệt phiếu REJECTED bị chặn', async () => {
      const r = await call('POST', `/api/borrows/${pendingId}/approve`, undefined, librarian.token);
      expect(r.status === 409, 'Duyệt REJECTED phải lỗi');
    });

    console.log(`\nPASS: ${passed} test cases`);
  } catch (error) {
    console.error('FAIL:', error.message);
    process.exitCode = 1;
  } finally {
    children.forEach((child) => child.kill());
  }
})();
