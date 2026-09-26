// store.js — state dùng chung + hằng số hiển thị
export const state = {
  token: localStorage.getItem('library_token'),
  user: JSON.parse(localStorage.getItem('library_user') || 'null'),
  view: location.hash.slice(1) || 'books',
  books: []
};

export const roles = {
  READER: 'Độc giả',
  LIBRARIAN: 'Thủ thư',
  ADMIN: 'Quản trị viên'
};

export const labels = {
  PENDING: 'Chờ duyệt',
  BORROWING: 'Đang mượn',
  RETURNED: 'Đã trả',
  REJECTED: 'Đã từ chối/Hủy'
};

// Phạt quá hạn (VND/ngày). GIỮ ĐỒNG BỘ với LATE_FEE_PER_DAY ở services/borrow/index.js
export const LATE_FEE_PER_DAY = 2000;

export function can(...allowed) {
  return Boolean(state.user) && allowed.includes(state.user.role);
}

export function saveSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('library_token', token);
  localStorage.setItem('library_user', JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem('library_token');
  localStorage.removeItem('library_user');
  state.token = null;
  state.user = null;
}
