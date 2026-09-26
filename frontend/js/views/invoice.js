// views/invoice.js — lập & in hóa đơn phí mượn/trả (thuần frontend, dùng dữ liệu phiếu)
import { $, esc, fmt, fmtVND, showModal, toast } from '../ui.js';
import { payLink, payBase, qrSvg } from './payment.js';

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
  const rental = Number(r.rentalFee) || 0;
  const late = Number(r.lateFee) || 0;
  const days = lateDaysOf(r);
  const total = rental + late;
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
          <tr><td class="border border-slate-300 px-3 py-2">Tiền mượn sách</td><td class="border border-slate-300 px-3 py-2 text-right">${fmtVND(rental)}</td></tr>
          <tr><td class="border border-slate-300 px-3 py-2">Phạt quá hạn${days > 0 ? ` (${days} ngày)` : ' (đúng hạn)'}</td><td class="border border-slate-300 px-3 py-2 text-right">${fmtVND(late)}</td></tr>
          <tr><td class="border border-slate-300 px-3 py-2 font-bold">Tổng thanh toán</td><td class="border border-slate-300 px-3 py-2 text-right font-bold">${fmtVND(total)}</td></tr>
        </tbody>
      </table>
      <p class="mt-2">Trạng thái: <b class="${r.paid ? 'text-emerald-700' : 'text-amber-700'}">${r.paid ? 'ĐÃ THANH TOÁN' : 'CHƯA THANH TOÁN'}</b></p>
      ${!r.paid && r.payToken && total > 0 ? `
      <div class="mt-3 rounded-lg bg-slate-50 p-3 text-center">
        <p class="text-sm font-medium">Quét mã để thanh toán bằng điện thoại</p>
        <div id="invoice-qr" class="mx-auto mt-2 w-fit rounded-lg border border-slate-200 bg-white p-2"></div>
        <p class="mt-1 break-all text-xs text-slate-500">${esc(payLink(r))}</p>
      </div>` : ''}
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
    const qrBox = $('#invoice-qr');
    if (qrBox) {
      payBase().then((base) => {
        if (!document.body.contains(qrBox)) return;
        const link = payLink(record, base);
        qrBox.innerHTML = qrSvg(link) || '<p class="text-sm text-rose-600">Không vẽ được QR — xem Console (F12).</p>';
        const linkText = qrBox.nextElementSibling;
        if (linkText) linkText.textContent = link;
      });
    }
    $('#invoice-print').onclick = () => {
      const area = $('#print-area');
      if (!area) return toast('Thiếu vùng in', 'error');
      area.innerHTML = html;
      window.print();
    };
  });
}
