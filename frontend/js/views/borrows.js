// views/borrows.js — quản lý phiếu mượn / trả + phí + thanh toán QR
import { state, can, LATE_FEE_PER_DAY } from '../store.js';
import { api } from '../api.js';
import { $, layout, esc, fmt, fmtVND, loading, errorCard, badge, feeBadge, showModal, closeModal, toast } from '../ui.js';
import { paymentModal } from './payment.js';
import { invoiceModal } from './invoice.js';

export async function borrowsView(router) {
  layout(loading(), router);
  try {
    const endpoint = can('READER') ? '/borrows/my' : '/borrows';
    let records = await api(endpoint);
    const books = await api('/books').catch(() => []);
    window.__bookPrices = Object.fromEntries((books || []).map((b) => [b.id, Number(b.rental_price) || 0]));
    let currentFilter = '';
    if (window.__borrowTimer) clearInterval(window.__borrowTimer);

    layout(`
      <section class="space-y-5">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 class="text-2xl font-bold">${can('READER') ? 'Phiếu mượn của tôi' : 'Quản lý mượn / trả'}</h1>
            <p class="mt-1 text-sm text-slate-500">Hạn mượn mặc định 14 ngày từ ngày duyệt. Quá hạn phạt ${fmtVND(LATE_FEE_PER_DAY)}/ngày.
              <span id="auto-note" class="ml-1 inline-flex items-center gap-1 text-slate-400"></span>
            </p>
          </div>
          ${can('LIBRARIAN', 'ADMIN') ? `<span class="rounded-full bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-800">${records.filter((r) => r.status === 'PENDING').length} phiếu chờ duyệt</span>` : ''}
        </div>
        <div class="flex flex-wrap gap-2" id="status-filters">
          ${[['', 'Tất cả'], ['PENDING', 'Chờ duyệt'], ['BORROWING', 'Đang mượn'], ['RETURNED', 'Đã trả'], ['REJECTED', 'Từ chối/Hủy']]
            .map(([value, label]) => `<button data-status="${value}" class="rounded-full border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">${label}</button>`).join('')}
        </div>
        <div id="borrow-table"></div>
      </section>`, router);

    window.__borrowRecords = records;
    const draw = (status = '') => {
      const rows = records.filter((record) => !status || record.status === status);
      const cols = can('READER') ? 7 : 8;
      $('#borrow-table').innerHTML = `
        <div class="table-wrap rounded-xl border border-slate-200 bg-white">
          <table class="w-full text-left text-sm">
            <thead class="bg-slate-50 text-slate-600">
              <tr><th class="px-4 py-3">Mã</th>${can('READER') ? '' : '<th class="px-4 py-3">Độc giả</th>'}<th class="px-4 py-3">Sách</th><th class="px-4 py-3">Ngày yêu cầu</th><th class="px-4 py-3">Hạn trả</th><th class="px-4 py-3">Phí</th><th class="px-4 py-3">Trạng thái</th><th class="px-4 py-3 text-right">Thao tác</th></tr>
            </thead>
            <tbody>
              ${rows.length ? rows.map((r) => `
                <tr class="border-t border-slate-100">
                  <td class="px-4 py-3">#${r.id}</td>
                  ${can('READER') ? '' : `<td class="px-4 py-3">${esc(r.userName)}</td>`}
                  <td class="px-4 py-3 font-semibold">${esc(r.bookTitle)}${r.rejectReason ? `<small class="mt-1 block font-normal text-rose-700">${esc(r.rejectReason)}</small>` : ''}${r.renewed ? '<small class="mt-1 block font-normal text-blue-700">Đã gia hạn 1 lần</small>' : ''}</td>
                  <td class="px-4 py-3">${fmt(r.requestDate)}</td>
                  <td class="px-4 py-3">${fmt(r.dueDate)}</td>
                  <td class="px-4 py-3">${feeBadge(r)}</td>
                  <td class="px-4 py-3">${badge(r.status)}</td>
                  <td class="px-4 py-3 text-right">${borrowActions(r)}</td>
                </tr>`).join('') : `<tr><td colspan="${cols}" class="px-4 py-10 text-center text-slate-500">Chưa có phiếu phù hợp.</td></tr>`}
            </tbody>
          </table>
        </div>`;
      bindBorrowActions();
    };

    document.querySelectorAll('[data-status]').forEach((button) => {
      button.onclick = () => { currentFilter = button.dataset.status; draw(currentFilter); };
    });
    draw();
    // Tự tải lại nền: ai thanh toán/quản lý đổi trạng thái ở máy khác thì bảng tự cập nhật
    const sig = (list) => JSON.stringify(list.map((r) => [r.id, r.status, r.rentalFee, r.lateFee, r.paid, r.paidRental, r.renewed]));
    window.__borrowTimer = setInterval(async () => {
      if (!document.body.contains($('#borrow-table'))) return clearInterval(window.__borrowTimer);
      if ($('#modal') && $('#modal').innerHTML.trim() !== '') return; // modal đang mở thì thôi
      const note = $('#auto-note');
      try {
        const fresh = await api(endpoint);
        if (sig(fresh) !== sig(records)) {
          records = fresh;
          window.__borrowRecords = records;
          draw(currentFilter);
          toast('Bảng phiếu vừa tự cập nhật');
        }
        if (note) note.innerHTML = `· Tự làm mới ${new Date().toLocaleTimeString('vi-VN')}`;
      } catch {
        if (note) note.textContent = '';
      }
    }, 8000);
  } catch (error) {
    layout(errorCard(error.message), router);
  }
}

function effectiveRental(r) {
  // Phiếu cũ chưa chốt giá thì ước tính theo giá sách hiện tại
  return Number(r.rentalFee) || (window.__bookPrices || {})[r.bookId] || 0;
}

function rentalUnpaid(r) {
  return effectiveRental(r) > 0 && !r.paidRental;
}

function remainderOf(r) {
  if (r.status === 'BORROWING') return rentalUnpaid(r) ? effectiveRental(r) : 0;
  if (r.status !== 'RETURNED' || r.paid) return 0;
  const rental = r.paidRental ? 0 : effectiveRental(r);
  return rental + (Number(r.lateFee) || 0);
}

function canPay(r) {
  return remainderOf(r) > 0;
}

function payableAmount(r) {
  return remainderOf(r);
}

function borrowActions(record) {
  if (can('READER') && record.status === 'PENDING') {
    return `<button data-action="cancel" data-id="${record.id}" class="rounded-md border border-rose-300 px-3 py-1.5 text-rose-700 hover:bg-rose-50">Hủy yêu cầu</button>`;
  }
  if (can('READER') && record.status === 'BORROWING') {
    return `<button data-action="renew" data-id="${record.id}" class="rounded-md border border-blue-300 px-3 py-1.5 text-blue-700 hover:bg-blue-50">Gia hạn +7 ngày</button>` +
      (canPay(record) ? ` <button data-action="qrpay" data-id="${record.id}" class="rounded-md bg-emerald-700 px-3 py-1.5 text-white hover:bg-emerald-800">Thanh toán ${fmtVND(record.rentalFee)}</button>` : '');
  }
  if (can('READER') && canPay(record)) {
    return `<button data-action="qrpay" data-id="${record.id}" class="rounded-md bg-emerald-700 px-3 py-1.5 text-white hover:bg-emerald-800">Thanh toán</button>`;
  }
  if (can('READER') && record.status === 'RETURNED') {
    return `<button data-action="invoice" data-id="${record.id}" class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">Hóa đơn</button>`;
  }
  if (can('LIBRARIAN', 'ADMIN') && record.status === 'PENDING') {
    return `<button data-action="approve" data-id="${record.id}" class="rounded-md bg-blue-700 px-3 py-1.5 text-white">Duyệt</button> <button data-action="reject" data-id="${record.id}" class="rounded-md border border-rose-300 px-3 py-1.5 text-rose-700">Từ chối</button>`;
  }
  if (can('LIBRARIAN', 'ADMIN') && record.status === 'BORROWING') {
    return `<button data-action="return" data-id="${record.id}" class="rounded-md bg-emerald-700 px-3 py-1.5 text-white">Xác nhận trả</button>` +
      (canPay(record) ? ` <button data-action="qrpay" data-id="${record.id}" class="rounded-md bg-slate-700 px-3 py-1.5 text-white hover:bg-slate-800">QR thu tiền</button> <button data-action="pay" data-id="${record.id}" class="rounded-md border border-emerald-600 px-3 py-1.5 text-emerald-700 hover:bg-emerald-50">Thu tiền mặt</button>` : '');
  }
  if (can('LIBRARIAN', 'ADMIN') && canPay(record)) {
    return `<button data-action="qrpay" data-id="${record.id}" class="rounded-md bg-slate-700 px-3 py-1.5 text-white hover:bg-slate-800">QR thu tiền</button> <button data-action="pay" data-id="${record.id}" class="rounded-md border border-emerald-600 px-3 py-1.5 text-emerald-700 hover:bg-emerald-50">Thu tiền mặt</button>`;
  }
  if (can('LIBRARIAN', 'ADMIN') && record.status === 'RETURNED') {
    return `<button data-action="invoice" data-id="${record.id}" class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">Hóa đơn</button>`;
  }
  return '—';
}

function findRecord(id) {
  return (window.__borrowRecords || []).find((r) => r.id === Number(id));
}

function bindBorrowActions() {
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.onclick = () => {
      const record = findRecord(button.dataset.id);
      if (!record) return toast('Không tìm thấy phiếu', 'error');
      if (button.dataset.action === 'qrpay') return paymentModal(record);
      if (button.dataset.action === 'invoice') return invoiceModal(record);
      confirmBorrowAction(record, button.dataset.action);
    };
  });
}

function estimateFee(record) {
  // Phiếu cũ chưa chốt giá (rentalFee = 0) thì ước tính theo giá sách hiện tại.
  // Đã thu trước thì trừ ra, chỉ còn phải thu phần dư.
  const rental = Number(record.rentalFee) || (window.__bookPrices || {})[record.bookId] || 0;
  const prepaid = record.paidRental ? rental : 0;
  let days = 0;
  if (record.dueDate) {
    const diff = Date.now() - new Date(record.dueDate).getTime();
    if (diff > 0) days = Math.ceil(diff / 86400000);
  }
  const late = days * LATE_FEE_PER_DAY;
  return { rental, prepaid, days, late, total: rental + late - prepaid };
}

function confirmBorrowAction(record, action) {
  const id = record.id;
  const config = {
    approve: ['Duyệt phiếu mượn', `Duyệt phiếu sẽ giảm tồn kho một bản. Giá mượn chốt theo giá sách hiện tại: <b>${fmtVND((window.__bookPrices || {})[record.bookId] ?? state.books.find((b) => b.id === record.bookId)?.rental_price)}</b>/lượt.`],
    reject: ['Từ chối yêu cầu', 'Nhập lý do để độc giả biết.'],
    cancel: ['Hủy yêu cầu', 'Yêu cầu sẽ được chuyển sang trạng thái đã hủy.'],
    renew: ['Gia hạn mượn sách', `Hạn trả dời thêm <b>7 ngày</b> (từ ${fmt(record.dueDate)}). Mỗi phiếu chỉ gia hạn <b>1 lần</b>, phiếu quá hạn không gia hạn được.`],
    pay: ['Thu tiền mặt', `Xác nhận đã thu <b>${fmtVND(payableAmount(record))}</b> của phiếu #${id} (${esc(record.bookTitle)}).`],
    return: ['Xác nhận trả sách', 'Tồn kho sẽ tăng lại một bản.']
  }[action];

  const fee = action === 'return' ? estimateFee(record) : null;
  showModal(`
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-bold">${config[0]}</h2>
      <button data-close class="text-2xl text-slate-500">×</button>
    </div>
    <p class="mt-4 text-slate-600">${config[1]}</p>
    ${fee ? `<div class="mt-4 space-y-1.5 rounded-lg bg-slate-50 p-4 text-sm">
      <p class="flex justify-between"><span>Tiền mượn sách</span><b>${fmtVND(fee.rental)}</b></p>
      <p class="flex justify-between"><span>Phạt quá hạn ${fee.days > 0 ? `(${fee.days} ngày × ${fmtVND(LATE_FEE_PER_DAY)})` : '(đúng hạn)'}</span><b>${fmtVND(fee.late)}</b></p>
      ${fee.prepaid > 0 ? `<p class="flex justify-between text-emerald-700"><span>Đã thu trước</span><b>−${fmtVND(fee.prepaid)}</b></p>` : ''}
      <p class="flex justify-between border-t border-slate-200 pt-2 text-base"><span class="font-semibold">Còn phải thu</span><b class="text-rose-700">${fmtVND(fee.total)}</b></p>
    </div>` : ''}
    ${action === 'reject' ? '<textarea id="reject-reason" class="mt-4 w-full rounded-lg border border-slate-300 p-3" minlength="3" placeholder="Lý do từ chối" required></textarea>' : ''}
    <div class="mt-6 flex justify-end gap-3">
      <button data-close class="rounded-lg border border-slate-300 px-4 py-2">Quay lại</button>
      <button id="confirm-action" class="rounded-lg ${action === 'return' || action === 'pay' ? 'bg-emerald-700' : action === 'cancel' || action === 'reject' ? 'bg-rose-600' : 'bg-blue-700'} px-4 py-2 font-semibold text-white">Xác nhận</button>
    </div>`, () => {
    $('#confirm-action').onclick = async () => {
      const reason = $('#reject-reason')?.value.trim();
      if (action === 'reject' && (!reason || reason.length < 3)) {
        return toast('Nhập lý do từ chối tối thiểu 3 ký tự', 'error');
      }
      const button = $('#confirm-action');
      button.disabled = true;
      try {
        const result = await api(`/borrows/${id}/${action}`, 'POST', action === 'reject' ? { reason } : undefined);
        closeModal();
        const messages = {
          approve: 'Đã duyệt phiếu.',
          return: `Đã xác nhận trả sách. Tổng phí: ${fmtVND(result.totalFee)}${result.totalFee > 0 && !result.paid ? ' (chưa thu)' : ''}.`,
          reject: 'Đã từ chối yêu cầu.',
          cancel: 'Đã hủy yêu cầu.',
          renew: `Đã gia hạn đến ${fmt(result.dueDate)}.`,
          pay: 'Đã thu tiền.'
        };
        toast(messages[action] || 'Xong.');
        borrowsView(window.__router);
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    };
  });
}
