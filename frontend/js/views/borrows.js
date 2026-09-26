// views/borrows.js — quản lý phiếu mượn / trả
import { can } from '../store.js';
import { api } from '../api.js';
import { $, layout, esc, fmt, loading, errorCard, badge, showModal, closeModal, toast } from '../ui.js';

export async function borrowsView(router) {
  layout(loading(), router);
  try {
    const endpoint = can('READER') ? '/borrows/my' : '/borrows';
    const records = await api(endpoint);

    layout(`
      <section class="space-y-5">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 class="text-2xl font-bold">${can('READER') ? 'Phiếu mượn của tôi' : 'Quản lý mượn / trả'}</h1>
            <p class="mt-1 text-sm text-slate-500">Hạn mượn mặc định 14 ngày từ ngày duyệt.</p>
          </div>
          ${can('LIBRARIAN', 'ADMIN') ? `<span class="rounded-full bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-800">${records.filter((r) => r.status === 'PENDING').length} phiếu chờ duyệt</span>` : ''}
        </div>
        <div class="flex flex-wrap gap-2" id="status-filters">
          ${[['', 'Tất cả'], ['PENDING', 'Chờ duyệt'], ['BORROWING', 'Đang mượn'], ['RETURNED', 'Đã trả'], ['REJECTED', 'Từ chối/Hủy']]
            .map(([value, label]) => `<button data-status="${value}" class="rounded-full border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">${label}</button>`).join('')}
        </div>
        <div id="borrow-table"></div>
      </section>`, router);

    const draw = (status = '') => {
      const rows = records.filter((record) => !status || record.status === status);
      $('#borrow-table').innerHTML = `
        <div class="table-wrap rounded-xl border border-slate-200 bg-white">
          <table class="w-full text-left text-sm">
            <thead class="bg-slate-50 text-slate-600">
              <tr><th class="px-4 py-3">Mã</th>${can('READER') ? '' : '<th class="px-4 py-3">Độc giả</th>'}<th class="px-4 py-3">Sách</th><th class="px-4 py-3">Ngày yêu cầu</th><th class="px-4 py-3">Hạn trả</th><th class="px-4 py-3">Trạng thái</th><th class="px-4 py-3 text-right">Thao tác</th></tr>
            </thead>
            <tbody>
              ${rows.length ? rows.map((r) => `
                <tr class="border-t border-slate-100">
                  <td class="px-4 py-3">#${r.id}</td>
                  ${can('READER') ? '' : `<td class="px-4 py-3">${esc(r.userName)}</td>`}
                  <td class="px-4 py-3 font-semibold">${esc(r.bookTitle)}${r.rejectReason ? `<small class="mt-1 block font-normal text-rose-700">${esc(r.rejectReason)}</small>` : ''}</td>
                  <td class="px-4 py-3">${fmt(r.requestDate)}</td>
                  <td class="px-4 py-3">${fmt(r.dueDate)}</td>
                  <td class="px-4 py-3">${badge(r.status)}</td>
                  <td class="px-4 py-3 text-right">${borrowActions(r)}</td>
                </tr>`).join('') : `<tr><td colspan="${can('READER') ? 6 : 7}" class="px-4 py-10 text-center text-slate-500">Chưa có phiếu phù hợp.</td></tr>`}
            </tbody>
          </table>
        </div>`;
      bindBorrowActions();
    };

    document.querySelectorAll('[data-status]').forEach((button) => {
      button.onclick = () => draw(button.dataset.status);
    });
    draw();
  } catch (error) {
    layout(errorCard(error.message), router);
  }
}

function borrowActions(record) {
  if (can('READER') && record.status === 'PENDING') {
    return `<button data-action="cancel" data-id="${record.id}" class="rounded-md border border-rose-300 px-3 py-1.5 text-rose-700 hover:bg-rose-50">Hủy yêu cầu</button>`;
  }
  if (can('LIBRARIAN', 'ADMIN') && record.status === 'PENDING') {
    return `<button data-action="approve" data-id="${record.id}" class="rounded-md bg-blue-700 px-3 py-1.5 text-white">Duyệt</button> <button data-action="reject" data-id="${record.id}" class="rounded-md border border-rose-300 px-3 py-1.5 text-rose-700">Từ chối</button>`;
  }
  if (can('LIBRARIAN', 'ADMIN') && record.status === 'BORROWING') {
    return `<button data-action="return" data-id="${record.id}" class="rounded-md bg-emerald-700 px-3 py-1.5 text-white">Xác nhận trả</button>`;
  }
  return '—';
}

function bindBorrowActions() {
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.onclick = () => confirmBorrowAction(button.dataset.id, button.dataset.action);
  });
}

function confirmBorrowAction(id, action) {
  const config = {
    approve: ['Duyệt phiếu mượn', 'Duyệt phiếu sẽ giảm tồn kho một bản.'],
    reject: ['Từ chối yêu cầu', 'Nhập lý do để độc giả biết.'],
    cancel: ['Hủy yêu cầu', 'Yêu cầu sẽ được chuyển sang trạng thái đã hủy.'],
    return: ['Xác nhận trả sách', 'Tồn kho sẽ tăng lại một bản.']
  }[action];

  showModal(`
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-bold">${config[0]}</h2>
      <button data-close class="text-2xl text-slate-500">×</button>
    </div>
    <p class="mt-4 text-slate-600">${config[1]}</p>
    ${action === 'reject' ? '<textarea id="reject-reason" class="mt-4 w-full rounded-lg border border-slate-300 p-3" minlength="3" placeholder="Lý do từ chối" required></textarea>' : ''}
    <div class="mt-6 flex justify-end gap-3">
      <button data-close class="rounded-lg border border-slate-300 px-4 py-2">Quay lại</button>
      <button id="confirm-action" class="rounded-lg ${action === 'return' ? 'bg-emerald-700' : action === 'cancel' || action === 'reject' ? 'bg-rose-600' : 'bg-blue-700'} px-4 py-2 font-semibold text-white">Xác nhận</button>
    </div>`, () => {
    $('#confirm-action').onclick = async () => {
      const reason = $('#reject-reason')?.value.trim();
      if (action === 'reject' && (!reason || reason.length < 3)) {
        return toast('Nhập lý do từ chối tối thiểu 3 ký tự', 'error');
      }
      const button = $('#confirm-action');
      button.disabled = true;
      try {
        await api(`/borrows/${id}/${action}`, 'POST', action === 'reject' ? { reason } : undefined);
        closeModal();
        toast(action === 'approve' ? 'Đã duyệt phiếu.' : action === 'return' ? 'Đã xác nhận trả sách.' : action === 'reject' ? 'Đã từ chối yêu cầu.' : 'Đã hủy yêu cầu.');
        borrowsView(window.__router);
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    };
  });
}
