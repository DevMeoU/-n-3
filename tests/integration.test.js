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
const files = ['services/user/index.js', 'services/book/index.js', 'services/borrow/index.js', 'gateway/index.js'];
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
// Sửa trực tiếp DB test (giả lập quá hạn mà không cần đợi 14 ngày)
function dbExec(sql, params = []) {
  const sqlite3 = require('sqlite3').verbose();
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(path.join(dataDir, 'borrow-service-test.db'));
    db.run(sql, params, function onRun(error) {
      db.close();
      if (error) return reject(error);
      resolve();
    });
  });
}
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
    const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await test('Upload ảnh bìa sách (thủ thư)', async () => {
      const r = await call('POST', `/api/books/${bookId}/cover`, { image: png1x1 }, librarian.token);
      expect(r.status === 200 && r.data.cover_url === `/assets/covers/book-${bookId}.png`, `Không upload được ảnh: ${JSON.stringify(r.data)}`);
      const file = path.join(root, 'frontend', 'covers', `book-${bookId}.png`);
      expect(fs.existsSync(file), 'File ảnh không được lưu');
      const badType = await call('POST', `/api/books/${bookId}/cover`, { image: 'data:image/png;base64,eHh4eA==' }, librarian.token);
      expect(badType.status === 400, 'Ảnh rởm phải lỗi 400');
      const forbidden = await call('POST', `/api/books/${bookId}/cover`, { image: png1x1 }, reader.token);
      expect(forbidden.status === 403, 'Reader upload được ảnh');
      const missing = await call('POST', '/api/books/999999/cover', { image: png1x1 }, librarian.token);
      expect(missing.status === 404, 'Upload sách không tồn tại phải 404');
      const mislabeled = await call('POST', `/api/books/${bookId}/cover`, { image: png1x1.replace('image/png', 'image/jpeg') }, librarian.token);
      expect(mislabeled.status === 200 && mislabeled.data.cover_url === `/assets/covers/book-${bookId}.png`, 'Phải nhận dạng PNG theo nội dung, không theo khai báo');
      const del = await call('DELETE', `/api/books/${bookId}/cover`, undefined, librarian.token);
      expect(del.status === 200 && !del.data.cover_url, 'Không gỡ được ảnh');
      expect(!fs.existsSync(file), 'File ảnh không được xóa');
    });
    await test('Reader không xem danh sách tài khoản', async () => {
      const r = await call('GET', '/api/users', undefined, reader.token);
      expect(r.status === 403, 'Reader đã xem được users');
    });
    const username = `qa_${Date.now()}`;
    let qaUserId;
    await test('Admin tạo tài khoản và trùng username lỗi', async () => {
      const created = await call('POST', '/api/users', { fullName: 'Tài khoản QA', username, password: '123456', role: 'READER' }, admin.token);
      expect(created.status === 201 && !created.data.passwordHash, 'Admin không tạo được user');
      qaUserId = created.data.id;
      const duplicate = await call('POST', '/api/users', { fullName: 'Tài khoản QA', username, password: '123456', role: 'READER' }, admin.token);
      expect(duplicate.status === 409, 'Trùng username phải lỗi');
    });
    await test('Admin sửa tài khoản (đổi tên + vai trò)', async () => {
      const r = await call('PUT', `/api/users/${qaUserId}`, { fullName: 'Tài khoản QA Sửa', role: 'LIBRARIAN' }, admin.token);
      expect(r.status === 200 && r.data.fullName === 'Tài khoản QA Sửa' && r.data.role === 'LIBRARIAN', 'Không sửa được user');
      const badRole = await call('PUT', `/api/users/${qaUserId}`, { role: 'SUPER' }, admin.token);
      expect(badRole.status === 400, 'Role sai phải lỗi 400');
      const rename = await call('PUT', `/api/users/${qaUserId}`, { username: 'doi_ten' }, admin.token);
      expect(rename.status === 400, 'Đổi username phải bị chặn');
    });
    await test('Admin không tự đổi vai trò / tự xóa / xóa admin cuối', async () => {
      const selfRole = await call('PUT', '/api/users/3', { role: 'READER' }, admin.token);
      expect(selfRole.status === 403, 'Tự đổi vai trò phải bị chặn');
      const selfDel = await call('DELETE', '/api/users/3', undefined, admin.token);
      expect(selfDel.status === 403, 'Tự xóa phải bị chặn');
      const lastAdmin = await call('DELETE', '/api/users/3', undefined, admin.token);
      expect(lastAdmin.status === 403 || lastAdmin.status === 409, 'Xóa admin cuối phải bị chặn');
    });
    await test('Admin xóa tài khoản và tài khoản đó hết đăng nhập được', async () => {
      const r = await call('DELETE', `/api/users/${qaUserId}`, undefined, admin.token);
      expect(r.status === 200, 'Không xóa được user');
      const gone = await call('DELETE', `/api/users/${qaUserId}`, undefined, admin.token);
      expect(gone.status === 404, 'Xóa lần hai phải 404');
      const login = await call('POST', '/api/auth/login', { username, password: '123456' });
      expect(login.status === 401, 'User đã xóa vẫn đăng nhập được');
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

    // ---- Giá mượn, phí, gia hạn, hồ sơ, thanh toán QR ----
    let pricedBookId;
    await test('Giá mượn: validate và cập nhật', async () => {
      const bad = await call('POST', '/api/books', { title: 'Sách giá sai', author: 'QA', category: 'Test', quantity: 1, rental_price: -5 }, librarian.token);
      expect(bad.status === 400, 'Giá âm phải lỗi 400');
      const created = await call('POST', '/api/books', { title: `Sách có phí ${Date.now()}`, author: 'QA', category: 'Công nghệ', quantity: 2, rental_price: 10000 }, librarian.token);
      expect(created.status === 201 && created.data.rental_price === 10000, 'Không lưu được giá mượn');
      pricedBookId = created.data.id;
      const updated = await call('PUT', `/api/books/${pricedBookId}`, { rental_price: 12000 }, librarian.token);
      expect(updated.status === 200 && updated.data.rental_price === 12000, 'Không sửa được giá');
    });
    let feeBorrowId;
    await test('Duyệt chốt giá mượn, trả đúng hạn không phạt', async () => {
      const created = await call('POST', '/api/borrows', { bookId: pricedBookId }, reader.token);
      feeBorrowId = created.data.id;
      const approved = await call('POST', `/api/borrows/${feeBorrowId}/approve`, undefined, librarian.token);
      expect(approved.status === 200 && approved.data.rentalFee === 12000, 'Không chốt giá khi duyệt');
      expect(typeof approved.data.payToken === 'string' && approved.data.payToken.length >= 16, 'Thiếu payToken');
      const returned = await call('POST', `/api/borrows/${feeBorrowId}/return`, undefined, librarian.token);
      expect(returned.status === 200 && returned.data.lateFee === 0 && returned.data.totalFee === 12000 && !returned.data.paid, 'Phí trả đúng hạn sai');
    });
    await test('Quá hạn 3 ngày phạt 6000đ', async () => {
      const created = await call('POST', '/api/borrows', { bookId: pricedBookId }, reader.token);
      const id = created.data.id;
      await call('POST', `/api/borrows/${id}/approve`, undefined, librarian.token);
      await dbExec('UPDATE borrow_records SET due_date = ? WHERE id = ?', [new Date(Date.now() - 2.5 * 86400000).toISOString(), id]);
      const returned = await call('POST', `/api/borrows/${id}/return`, undefined, librarian.token);
      expect(returned.status === 200 && returned.data.lateFee === 6000 && returned.data.totalFee === 18000, `Phạt quá hạn sai: ${JSON.stringify(returned.data)}`);
    });
    await test('Gia hạn: +7 ngày, 1 lần, quá hạn bị chặn', async () => {
      const created = await call('POST', '/api/borrows', { bookId: pricedBookId }, reader.token);
      const id = created.data.id;
      const approved = await call('POST', `/api/borrows/${id}/approve`, undefined, librarian.token);
      const before = new Date(approved.data.dueDate).getTime();
      const renewed = await call('POST', `/api/borrows/${id}/renew`, undefined, reader.token);
      expect(renewed.status === 200 && renewed.data.renewed === true, 'Không gia hạn được');
      expect(new Date(renewed.data.dueDate).getTime() - before === 7 * 86400000, 'Gia hạn phải +7 ngày');
      const twice = await call('POST', `/api/borrows/${id}/renew`, undefined, reader.token);
      expect(twice.status === 409, 'Gia hạn lần 2 phải bị chặn');
      await dbExec('UPDATE borrow_records SET due_date = ? WHERE id = ?', [new Date(Date.now() - 86400000).toISOString(), id]);
      const late = await call('POST', `/api/borrows/${id}/renew`, undefined, reader.token);
      expect(late.status === 409, 'Quá hạn phải bị chặn gia hạn');
      await call('POST', `/api/borrows/${id}/return`, undefined, librarian.token);
    });
    await test('Thanh toán: QR công khai + thu tiền mặt', async () => {
      const all = await call('GET', '/api/borrows', undefined, librarian.token);
      const target = all.data.find((r) => r.id === feeBorrowId);
      expect(target && target.payToken, 'Thiếu payToken ở API thủ thư');
      const mine = await call('GET', '/api/borrows/my', undefined, reader.token);
      const mineTarget = mine.data.find((r) => r.id === feeBorrowId);
      expect(mineTarget && mineTarget.payToken, 'Độc giả phải thấy link trả phí của mình');
      const badLink = await call('GET', `/api/pay/${feeBorrowId}?t=sai-token`, undefined, undefined);
      expect(badLink.status === 404, 'Link sai phải 404');
      const bill = await call('GET', `/api/pay/${feeBorrowId}?t=${target.payToken}`, undefined, undefined);
      expect(bill.status === 200 && bill.data.totalFee === 12000 && !bill.data.paid && !('payToken' in bill.data) && !('userId' in bill.data) && bill.data.quantity === 1, 'Bill công khai sai');
      const readerPay = await call('POST', `/api/borrows/${feeBorrowId}/pay`, undefined, reader.token);
      expect(readerPay.status === 403, 'Reader không được thu tiền mặt');
      const cash = await call('POST', `/api/borrows/${feeBorrowId}/pay`, undefined, librarian.token);
      expect(cash.status === 200 && cash.data.paid === true, 'Không thu được tiền');
      const again = await call('POST', `/api/borrows/${feeBorrowId}/pay`, undefined, librarian.token);
      expect(again.status === 409, 'Thu 2 lần phải bị chặn');
    });
    await test('Phiếu cũ chưa có giá: trả lấy theo giá sách hiện tại', async () => {
      const created = await call('POST', '/api/borrows', { bookId: pricedBookId }, reader.token);
      const id = created.data.id;
      await call('POST', `/api/borrows/${id}/approve`, undefined, librarian.token);
      await dbExec('UPDATE borrow_records SET rental_fee = 0 WHERE id = ?', [id]);
      const returned = await call('POST', `/api/borrows/${id}/return`, undefined, librarian.token);
      expect(returned.status === 200 && returned.data.rentalFee === 12000 && returned.data.totalFee === 12000, `Không chữa giá phiếu cũ: ${JSON.stringify(returned.data)}`);
    });
    await test('Thu trước tiền mượn khi đang mượn', async () => {
      const created = await call('POST', '/api/borrows', { bookId: pricedBookId }, reader.token);
      const id = created.data.id;
      await call('POST', `/api/borrows/${id}/approve`, undefined, librarian.token);
      const prepay = await call('POST', `/api/borrows/${id}/pay`, undefined, librarian.token);
      expect(prepay.status === 200 && prepay.data.paidRental === true && prepay.data.paid === false, 'Không thu trước được');
      const twice = await call('POST', `/api/borrows/${id}/pay`, undefined, librarian.token);
      expect(twice.status === 409, 'Thu trước 2 lần phải bị chặn');
      const returned = await call('POST', `/api/borrows/${id}/return`, undefined, librarian.token);
      expect(returned.status === 200 && returned.data.totalFee === 12000, 'Tổng phí sai');
      const rest = await call('POST', `/api/borrows/${id}/pay`, undefined, librarian.token);
      expect(rest.status === 200 && rest.data.paid === true, 'Không thu nốt được');
    });
    await test('QR confirm: mở link + bấm thanh toán', async () => {
      const created = await call('POST', '/api/borrows', { bookId: pricedBookId }, reader.token);
      const id = created.data.id;
      await call('POST', `/api/borrows/${id}/approve`, undefined, librarian.token);
      await call('POST', `/api/borrows/${id}/return`, undefined, librarian.token);
      const all = await call('GET', '/api/borrows', undefined, librarian.token);
      const token = all.data.find((r) => r.id === id).payToken;
      const done = await call('POST', `/api/pay/${id}/confirm`, { t: token }, undefined);
      expect(done.status === 200 && done.data.paid === true, 'Xác nhận QR thất bại');
    });
    await test('Hồ sơ: xem, đổi tên, đổi mật khẩu', async () => {
      const me = await call('GET', '/api/users/me', undefined, reader.token);
      expect(me.status === 200 && me.data.username === 'reader', 'Không xem được hồ sơ');
      const renamed = await call('PUT', '/api/users/me', { fullName: 'Bạn Đọc QA' }, reader.token);
      expect(renamed.status === 200 && renamed.data.fullName === 'Bạn Đọc QA', 'Không đổi được tên');
      const badPass = await call('POST', '/api/users/me/password', { oldPassword: 'sai', newPassword: 'moi123456' }, reader.token);
      expect(badPass.status === 401, 'Sai mật khẩu cũ phải 401');
      const changed = await call('POST', '/api/users/me/password', { oldPassword: '123456', newPassword: 'moi123456' }, reader.token);
      expect(changed.status === 200, 'Không đổi được mật khẩu');
      const relogin = await call('POST', '/api/auth/login', { username: 'reader', password: 'moi123456' });
      expect(relogin.status === 200, 'Mật khẩu mới không đăng nhập được');
      await call('POST', '/api/users/me/password', { oldPassword: 'moi123456', newPassword: '123456' }, relogin.data.token);
      const back = await call('POST', '/api/auth/login', { username: 'reader', password: '123456' });
      expect(back.status === 200, 'Không trả được mật khẩu cũ');
    });

    console.log(`\nPASS: ${passed} test cases`);
  } catch (error) {
    console.error('FAIL:', error.message);
    process.exitCode = 1;
  } finally {
    children.forEach((child) => child.kill());
  }
})();
