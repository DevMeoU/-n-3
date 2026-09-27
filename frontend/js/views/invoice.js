// views/invoice.js — lập & in hóa đơn phí mượn/trả (thuần chứng từ, không thu tiền ở đây).
// Thu tiền làm ở modal QR / nút Thu tiền mặt ngoài bảng phiếu.
import { $, esc, fmt, fmtVND, showModal, toast } from '../ui.js';

const DAY = 86400000;

function lateDaysOf(r) {
  if (!r.dueDate || !r.returnDate) return 0;
  const diff = new Date(r.returnDate).getTime() - new Date(r.dueDate).getTime();
  return diff > 0 ? Math.ceil(diff / DAY) : 0;
}

export function invoiceNo(r) {
  const d = new Date(r.paidAt || r.returnDate || Date.now());
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `HD-${r.id}-${ymd}`;
}

export function invoiceModal(record) {
  const r = record;
  const rate = Number(r.rentalFee) || 0;
  const days = Number(r.daysBorrowed) || 0;
  const rental = Number(r.accruedRental ?? rate) || 0;
  const late = Number(r.lateFee) || 0;
  const lateDays = lateDaysOf(r);
  const paid = Number(r.paidAmount) || 0;
  const due = Math.max(0, rental + late - paid);
  const settled = r.paid || due === 0;
  const no = invoiceNo(r);
  const html = `
    <div id="invoice-doc" class="text-sm text-slate-900">
      <div class="flex items-start justify-between border-b-2 border-slate-900 pb-3">
        <div class="flex items-center gap-2">
          <span class="grid h-10 w-10 place-items-center rounded-lg bg-blue-700 font-bold text-white">L</span>
          <div><b class="block">LibraFlow</b><small class="text-slate-500">Hệ thống quản lý thư viện</small></div>
        </div>
        <div class="text-right">
          <b class="block text-lg">HÓA ĐƠN PHÍ MƯỢN SÁCH</b>
          <small class="text-slate-500">Số: ${esc(no)}</small>
        </div>
      </div>
      <div class="mt-3 grid grid-cols-2 gap-2">
        <p>Độc giả: <b>${esc(r.userName || '—')}</b></p>
        <p class="text-right">Ngày lập: <b>${fmt(r.paidAt || r.returnDate)}</b></p>
        <p>Sách: <b>${esc(r.bookTitle)}</b></p>
        <p class="text-right">Phiếu mượn: <b>#${r.id}</b></p>
        <p>Hạn trả: <b>${fmt(r.dueDate)}</b></p>
        <p class="text-right">Ngày trả: <b>${fmt(r.returnDate)}</b></p>
      </div>
      <table class="mt-3 w-full border-collapse text-left">
        <thead><tr class="bg-slate-100">
          <th class="border border-slate-300 px-3 py-2">Nội dung</th>
          <th class="border border-slate-300 px-3 py-2 text-right">Số tiền</th>
        </tr></thead>
        <tbody>
          <tr><td class="border border-slate-300 px-3 py-2">Tiền mượn sách (${days} ngày × ${fmtVND(rate)})</td><td class="border border-slate-300 px-3 py-2 text-right">${fmtVND(rental)}</td></tr>
          <tr><td class="border border-slate-300 px-3 py-2">Phạt quá hạn${lateDays > 0 ? ` (${lateDays} ngày)` : ' (đúng hạn)'}</td><td class="border border-slate-300 px-3 py-2 text-right">${fmtVND(late)}</td></tr>
          ${paid > 0 ? `<tr><td class="border border-slate-300 px-3 py-2">Đã thu</td><td class="border border-slate-300 px-3 py-2 text-right">−${fmtVND(paid)}</td></tr>` : ''}
          <tr><td class="border border-slate-300 px-3 py-2 font-bold">Còn phải thu</td><td class="border border-slate-300 px-3 py-2 text-right font-bold">${fmtVND(due)}</td></tr>
        </tbody>
      </table>
      <p class="mt-2">Trạng thái: <b class="${settled ? 'text-emerald-700' : 'text-amber-700'}">${settled ? 'ĐÃ THANH TOÁN' : 'CHƯA THANH TOÁN'}</b></p>
      ${!settled ? `<p class="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Hóa đơn này còn dư nợ ${fmtVND(due)}. Thu tiền ở nút <b>QR thu tiền</b> / <b>Thu tiền mặt</b> ngoài bảng phiếu.</p>` : ''}
      <div class="mt-6 grid grid-cols-2 text-center">
        <div><p class="text-slate-500">Độc giả</p><p class="mt-10 text-sm text-slate-400">(Ký, ghi rõ họ tên)</p></div>
        <div><p class="text-slate-500">Thủ thư</p><p class="mt-10 text-sm text-slate-400">(Ký, ghi rõ họ tên)</p></div>
      </div>
    </div>`;
  showModal(`
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-bold">Hóa đơn ${esc(no)}</h2>
      <button data-close class="text-2xl text-slate-500">×</button>
    </div>
    <div class="mt-4 rounded-xl border border-slate-200 bg-white p-4">${html}</div>
    <div class="mt-4 flex justify-end gap-3">
      <button data-close class="rounded-lg border border-slate-300 px-4 py-2">Đóng</button>
      <button id="invoice-print" class="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800">In hóa đơn</button>
    </div>`, () => {
    $('#invoice-print').onclick = () => {
      const area = $('#print-area');
      if (!area) return toast('Thiếu vùng in', 'error');
      area.innerHTML = html;
      window.print();
    };
  });
}
