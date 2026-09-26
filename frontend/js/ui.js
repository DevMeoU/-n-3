// ui.js — helpers hiển thị dùng chung (toast, modal, badge, layout)
import { state, roles, labels, can } from './store.js';

export const $ = (selector) => document.querySelector(selector);
export const root = document.querySelector('#root');

export function esc(value = '') {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

export function fmt(value) {
  return value ? new Date(value).toLocaleDateString('vi-VN') : '—';
}

export function fmtVND(value) {
  return `${Number(value || 0).toLocaleString('vi-VN')}đ`;
}

export function feeBadge(record) {
  const rental = Number(record.rentalFee) || 0;
  const late = Number(record.lateFee) || 0;
  if (record.status === 'BORROWING') {
    const eff = rental || ((typeof window !== 'undefined' && window.__bookPrices) || {})[record.bookId] || 0;
    if (!eff) return '<span class="text-slate-400">Miễn phí</span>';
    return `<span class="font-semibold">${fmtVND(eff)}</span>` +
      (record.paidRental
        ? '<small class="mt-0.5 block font-semibold text-emerald-700">Đã thu trước</small>'
        : '<small class="mt-0.5 block font-semibold text-amber-700">Thu từ ngày mượn</small>');
  }
  const total = rental + late;
  if (!total) return '<span class="text-slate-400">Miễn phí</span>';
  const paid = record.paid
    ? '<small class="mt-0.5 block font-semibold text-emerald-700">Đã thu</small>'
    : '<small class="mt-0.5 block font-semibold text-amber-700">Chưa thu</small>';
  const lateLine = late > 0
    ? `<small class="block font-normal text-slate-500">gồm phạt ${fmtVND(late)}</small>` : '';
  return `<span class="font-semibold">${fmtVND(total)}</span>${lateLine}${paid}`;
}

export function toast(message, type = 'success') {
  const element = $('#toast');
  element.textContent = message;
  element.classList.remove('hidden');
  element.className = `fixed right-4 top-4 z-50 max-w-sm rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${type === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.add('hidden'), 3500);
}

export function badge(status) {
  const colors = {
    PENDING: 'bg-amber-100 text-amber-800',
    BORROWING: 'bg-blue-100 text-blue-800',
    RETURNED: 'bg-emerald-100 text-emerald-800',
    REJECTED: 'bg-rose-100 text-rose-800'
  };
  return `<span class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${colors[status]}">${labels[status] ?? status}</span>`;
}

export function stockBadge(book) {
  const cls = book.available === 0
    ? 'bg-rose-100 text-rose-700'
    : book.available <= 2
      ? 'bg-amber-100 text-amber-800'
      : 'bg-emerald-100 text-emerald-800';
  const text = book.available === 0 ? 'Hết sách' : book.available <= 2 ? 'Còn ít' : 'Còn nhiều';
  return `<span class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${cls}">${text}: ${book.available}/${book.quantity}</span>`;
}

export function loading(message = 'Đang tải dữ liệu...') {
  return `<div class="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">${esc(message)}</div>`;
}

export function errorCard(message) {
  return `<div class="rounded-xl bg-red-50 p-5 text-red-700">${esc(message)}</div>`;
}

// Bìa sách local: frontend/covers/<slug-the-loai>.svg (chạy offline 100%)
// Muốn dùng ảnh tải về: thả file vào thư mục covers/ rồi khai báo đuôi file
// tại COVER_OVERRIDES, vd: { 'cong-nghe': 'jpg' } dùng file cong-nghe.jpg
const COVER_OVERRIDES = {};

export function coverSlug(category = '') {
  return String(category || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[đ]/g, 'd')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'default';
}

export function coverFor(book = {}) {
  const slug = coverSlug(book.category);
  const ext = COVER_OVERRIDES[slug] || 'svg';
  return `/assets/covers/${slug}.${ext}`;
}

// <img> bìa: ưu tiên ảnh upload (book.cover_url), rồi bìa theo thể loại,
// cuối cùng default.svg khi thiếu file
export function coverImg(book = {}, cls = 'book-cover') {
  const title = esc(book.title || 'Bìa sách');
  const src = book.cover_url || coverFor(book);
  return `<img src="${src}" alt="${title}" loading="lazy"
    class="${cls}" onerror="this.onerror=null;this.src='/assets/covers/default.svg';">`;
}

// Khung header + content chung cho các trang đã login
export function layout(content, { onNavigate, onLogout }) {
  const nav = [
    ['dashboard', 'Tổng quan'],
    ['books', 'Sách'],
    ['borrows', 'Mượn / Trả'],
    ...(can('ADMIN') ? [['users', 'Tài khoản']] : []),
    ['profile', 'Hồ sơ']
  ];
  root.innerHTML = `
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
        <button class="mr-auto flex items-center gap-2 text-left" data-nav="books">
          <span class="grid h-9 w-9 place-items-center rounded-lg bg-blue-700 font-bold text-white">L</span>
          <span><b class="block">LibraFlow</b><small class="text-slate-500">Quản lý thư viện</small></span>
        </button>
        <nav class="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
          ${nav.map(([id, name]) => `<button data-nav="${id}" class="whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${state.view === id ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}">${name}</button>`).join('')}
        </nav>
        <div class="flex items-center gap-2">
          <span class="hidden text-right text-sm sm:block">
            <b class="block">${esc(state.user.fullName)}</b>
            <small class="text-slate-500">${roles[state.user.role]}</small>
          </span>
          <button id="logout" class="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">Đăng xuất</button>
        </div>
      </div>
    </header>
    <main class="mx-auto max-w-7xl p-4 sm:p-6">${content}</main>`;
  document.querySelectorAll('[data-nav]').forEach((button) => {
    button.onclick = () => onNavigate(button.dataset.nav);
  });
  $('#logout').onclick = onLogout;
}

export function showModal(html, bind) {
  const modal = $('#modal');
  modal.className = 'fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 p-4';
  modal.innerHTML = `<div class="modal-card w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">${html}</div>`;
  modal.querySelectorAll('[data-close]').forEach((button) => {
    button.onclick = closeModal;
  });
  if (bind) bind(modal);
}

export function closeModal() {
  const modal = $('#modal');
  modal.className = 'fixed inset-0 z-40 hidden items-center justify-center bg-slate-950/50 p-4';
  modal.innerHTML = '';
}
