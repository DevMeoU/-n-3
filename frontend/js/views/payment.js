// views/payment.js — modal QR thu tiền (mở link pay + poll trạng thái)
import { can } from '../store.js';
import { api } from '../api.js';
import { $, esc, fmtVND, showModal, closeModal, toast } from '../ui.js';
import { borrowsView } from './borrows.js';

let cachedBase = null;

async function payBase() {
  if (cachedBase !== null) return cachedBase;
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    cachedBase = cfg.payBaseUrl || location.origin;
  } catch {
    cachedBase = location.origin;
  }
  return cachedBase;
}

export function payLink(record, base) {
  return `${base || location.origin}/#/pay/${record.id}?t=${record.payToken}`;
}

function qrSvg(link) {
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    return qr.createSvgTag({ cellSize: 5, margin: 8, scalable: true });
  } catch {
    return '';
  }
}

export function paymentModal(record) {
  if (!record.payToken) return toast('Phiếu chưa có link thanh toán (chỉ có sau khi duyệt)', 'error');
  const payable = record.status === 'BORROWING'
    ? (Number(record.rentalFee) || 0)
    : (record.paidRental ? (Number(record.lateFee) || 0) : (Number(record.rentalFee) || 0) + (Number(record.lateFee) || 0));
  let link = payLink(record);
  showModal(`
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-bold">Thu tiền phiếu #${record.id}</h2>
      <button data-close class="text-2xl text-slate-500">×</button>
    </div>
    <div class="mt-4 space-y-1.5 rounded-lg bg-slate-50 p-4 text-sm">
      <p class="flex justify-between"><span>Sách</span><b class="text-right">${esc(record.bookTitle)}</b></p>
      <p class="flex justify-between"><span>Tiền mượn</span><b>${fmtVND(record.rentalFee)}</b></p>
      <p class="flex justify-between"><span>Phạt quá hạn</span><b>${fmtVND(record.lateFee)}</b></p>
      <p class="flex justify-between border-t border-slate-200 pt-2 text-base"><span class="font-semibold">${record.status === 'BORROWING' ? 'Thu trước tiền mượn' : 'Tổng thu'}</span><b class="text-rose-700">${fmtVND(payable)}</b></p>
    </div>
    <p class="mt-4 text-center text-sm font-medium">Độc giả quét mã QR để thanh toán (demo)</p>
    <div id="pay-qr" class="mx-auto mt-2 w-fit rounded-xl border border-slate-200 bg-white p-3"><p class="text-sm text-slate-500">Đang tạo mã QR...</p></div>
    <div class="mt-3 flex items-center gap-2">
      <input id="pay-link" readonly value="${esc(link)}" class="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs">
      <button id="pay-copy" class="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Copy</button>
    </div>
    <p id="pay-status" class="mt-3 text-center text-sm font-medium text-amber-700">Đang chờ thanh toán...</p>
    <div class="mt-4 flex justify-end gap-3">
      <button data-close class="rounded-lg border border-slate-300 px-4 py-2">Đóng</button>
      ${can('LIBRARIAN', 'ADMIN') ? '<button id="pay-cash" class="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">Đã thu tiền mặt</button>' : ''}
    </div>`, () => {
    // QR luôn mã hóa link production (điện thoại quét được) nếu đã cấu hình PUBLIC_BASE_URL
    payBase().then((base) => {
      if (!document.body.contains($('#pay-qr'))) return;
      link = payLink(record, base);
      $('#pay-link').value = link;
      $('#pay-qr').innerHTML = qrSvg(link) || '<p class="text-sm text-slate-500">Không tạo được QR, dùng link bên dưới.</p>';
    });
    $('#pay-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(link);
        toast('Đã copy link thanh toán');
      } catch {
        $('#pay-link').select();
        toast('Hãy copy thủ công', 'error');
      }
    };
    const cashBtn = $('#pay-cash');
    if (cashBtn) {
      cashBtn.onclick = async () => {
        cashBtn.disabled = true;
        try {
          await api(`/borrows/${record.id}/pay`, 'POST');
          closeModal();
          toast('Đã thu tiền.');
          borrowsView(window.__router);
        } catch (error) {
          toast(error.message, 'error');
          cashBtn.disabled = false;
        }
      };
    }
    // Poll: độc giả quét + bấm thanh toán xong thì modal tự báo
    const timer = setInterval(async () => {
      if (!document.body.contains($('#pay-status'))) return clearInterval(timer);
      try {
        const res = await fetch(`/api/pay/${record.id}?t=${encodeURIComponent(record.payToken)}`);
        const bill = await res.json();
        if (bill.paid) {
          clearInterval(timer);
          $('#pay-status').innerHTML = '<span class="font-bold text-emerald-700">✓ Đã thanh toán thành công!</span>';
          setTimeout(() => { closeModal(); borrowsView(window.__router); }, 1500);
        }
      } catch { /* thử lại kỳ sau */ }
    }, 3000);
  });
}
