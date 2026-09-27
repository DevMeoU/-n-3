// views/dashboard.js — trang tổng quan (số liệu từ API có sẵn, không cần backend mới)
import { state, can } from '../store.js';
import { api } from '../api.js';
import { $, layout, esc, fmt, fmtVND, loading, errorCard } from '../ui.js';

const DAY = 86400000;

export async function dashboardView(router) {
  layout(loading(), router);
  try {
    const [books, records] = await Promise.all([
      api('/books'),
      api(can('READER') ? '/borrows/my' : '/borrows')
    ]);
    const totalCopies = books.reduce((sum, b) => sum + b.quantity, 0);
    const availableCopies = books.reduce((sum, b) => sum + b.available, 0);
    const borrowing = records.filter((r) => r.status === 'BORROWING');
    const pending = records.filter((r) => r.status === 'PENDING');
    const overdue = borrowing.filter((r) => r.dueDate && new Date(r.dueDate).getTime() < Date.now());
    const dueOf = (r) => (typeof r.payableNow === 'number')
      ? Math.max(0, r.payableNow)
      : Math.max(0, (Number(r.accruedRental ?? r.rentalFee) || 0) + (Number(r.lateFee) || 0) - (Number(r.paidAmount) || 0));
    const unpaid = records.filter((r) => (r.status === 'BORROWING' || r.status === 'RETURNED') && !r.paid && dueOf(r) > 0);
    const unpaidTotal = unpaid.reduce((sum, r) => sum + dueOf(r), 0);
    // Top sách mượn nhiều (đếm theo phiếu BORROWING/RETURNED)
    const freq = {};
    for (const r of records) {
      if (r.status === 'BORROWING' || r.status === 'RETURNED') {
        freq[r.bookTitle] = (freq[r.bookTitle] || 0) + 1;
      }
    }
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const card = (label, value, accent) => `
      <div class="rounded-xl border border-slate-200 bg-white p-5">
        <p class="text-sm text-slate-500">${label}</p>
        <p class="mt-1 text-3xl font-bold ${accent}">${value}</p>
      </div>`;

    layout(`
      <section class="space-y-5">
        <div>
          <h1 class="text-2xl font-bold">Tổng quan${can('READER') ? ' của tôi' : ' hệ thống'}</h1>
          <p class="mt-1 text-sm text-slate-500">Xin chào, <b>${esc(state.user.fullName)}</b>!</p>
        </div>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          ${card('Đầu sách', books.length, 'text-slate-900')}
          ${card('Lượt đang mượn', borrowing.length, 'text-blue-700')}
          ${card('Quá hạn', overdue.length, overdue.length ? 'text-rose-700' : 'text-slate-900')}
          ${can('READER')
            ? card('Phí chưa thanh toán', fmtVND(unpaidTotal), unpaidTotal ? 'text-amber-700' : 'text-slate-900')
            : card('Phiếu chờ duyệt', pending.length, pending.length ? 'text-amber-700' : 'text-slate-900')}
        </div>
        <div class="grid gap-4 lg:grid-cols-2">
          <div class="rounded-xl border border-slate-200 bg-white p-5">
            <h2 class="font-bold">Tồn kho</h2>
            <p class="mt-2 text-sm text-slate-600">Còn <b>${availableCopies}/${totalCopies}</b> bản khả dụng.</p>
            <div class="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
              <div class="h-full rounded-full bg-blue-600" style="width:${totalCopies ? Math.round((availableCopies / totalCopies) * 100) : 0}%"></div>
            </div>
            ${overdue.length ? `<h2 class="mt-5 font-bold text-rose-700">Quá hạn (${overdue.length})</h2>
            <ul class="mt-2 space-y-1 text-sm">${overdue.slice(0, 5).map((r) => `<li>#${r.id} · ${esc(r.bookTitle)} — hạn ${fmt(r.dueDate)}</li>`).join('')}</ul>` : ''}
          </div>
          <div class="rounded-xl border border-slate-200 bg-white p-5">
            <h2 class="font-bold">Sách mượn nhiều nhất</h2>
            ${top.length ? `<ol class="mt-2 space-y-1.5 text-sm">${top.map(([title, n], i) => `<li class="flex justify-between"><span>${i + 1}. ${esc(title)}</span><b>${n} lượt</b></li>`).join('')}</ol>`
              : '<p class="mt-2 text-sm text-slate-500">Chưa có lượt mượn nào.</p>'}
            ${!can('READER') && unpaid.length ? `<h2 class="mt-5 font-bold">Phí chưa thu: ${fmtVND(unpaidTotal)}</h2>
            <p class="mt-1 text-sm text-slate-500">${unpaid.length} phiếu chờ thu tiền.</p>` : ''}
          </div>
        </div>
      </section>`, router);
  } catch (error) {
    layout(errorCard(error.message), router);
  }
}
