// views/payment.js — modal QR thu tiền (mở link pay + poll trạng thái)
import { can } from '../store.js';
import { api } from '../api.js';
import { $, esc, fmtVND, showModal, closeModal, toast } from '../ui.js';
import { borrowsView } from './borrows.js';

let cachedBase = null;

export async function payBase() {
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

export function qrSvg(link) {
  try {
    if (typeof window.qrcode !== 'function') throw new Error('thieu lib QR: hard refresh Ctrl+Shift+R');
    const qr = window.qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    // Kích thước cố định (không dùng scalable) để SVG luôn hiện đúng cỡ
    return qr.createSvgTag(6, 4);
  } catch (e) {
    console.error('QR error:', e);
    return '';
  }
}

export function paymentModal(record) {
  if (!record.payToken) return toast('Phiếu chưa có link thanh toán (chỉ có sau khi duyệt)', 'error');
  const rate = Number(record.rentalFee) || 0;
  const days = Number(record.daysBorrowed) || 0;
  const accrued = Number(record.accruedRental ?? rate) || 0;
  const paid = Number(record.paidAmount) || 0;
  const payable = Math.max(0, accrued + (Number(record.lateFee) || 0) - paid);
  let link = payLink(record);
  showModal(`
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-bold">Thu tiền phiếu #${record.id}</h2>
      <button data-close class="text-2xl text-slate-500">×</button>
    </div>
    <div class="mt-4 space-y-1.5 rounded-lg bg-slate-50 p-4 text-sm">
      <p class="flex justify-between"><span>Sách</span><b class="text-right">${esc(record.bookTitle)}</b></p>
      <p class="flex justify-between"><span>Tiền mượn (${days} ngày × ${fmtVND(rate)})</span><b id="pay-bill-rental">${fmtVND(accrued)}</b></p>
      <p class="flex justify-between"><span>Phạt quá hạn</span><b>${fmtVND(record.lateFee)}</b></p>
      ${paid > 0 ? `<p class="flex justify-between text-emerald-700"><span>Đã thu</span><b>−${fmtVND(paid)}</b></p>` : ''}
      <p class="flex justify-between border-t border-slate-200 pt-2 text-base"><span class="font-semibold">Còn phải thu</span><b id="pay-bill-total" class="text-rose-700">${fmtVND(payable)}</b></p>
    </div>
    <p class="mt-4 text-center text-sm font-medium">Độc giả quét mã QR để thanh toán (demo)</p>
    <div id="pay-qr" class="mx-auto mt-2 w-fit rounded-xl border border-slate-200 bg-white p-3"><p class="text-sm text-slate-500">Đang tạo mã QR...</p></div>
    <div class="mt-3 flex items-center gap-2">
      <input id="pay-link" readonly value="${esc(link)}" class="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs">
      <button id="pay-copy" class="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Copy</button>
    </div>
    <p id="pay-status" class="mt-3 text-center text-sm font-medium text-amber-700"><span class="spinner"></span> Đang chờ thanh toán...</p>
    <div class="mt-4 flex justify-end gap-3">
      <button data-close class="rounded-lg border border-slate-300 px-4 py-2">Đóng</button>
      ${can('LIBRARIAN', 'ADMIN') ? '<button id="pay-cash" class="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">Đã thu tiền mặt</button>' : ''}
    </div>`, () => {
    // Lấy bill mới nhất từ server (số ngày + đã thu mới nhất) + QR mã hóa link production
    fetch(`/api/pay/${record.id}?t=${encodeURIComponent(record.payToken)}`)
      .then((res) => res.json())
      .then((bill) => {
        if (!bill || bill.error || !document.body.contains($('#pay-bill-total'))) return;
        $('#pay-bill-rental').textContent = `${fmtVND(bill.accruedRental)} (${bill.daysBorrowed} ngày)`;
        $('#pay-bill-total').textContent = fmtVND(bill.payableNow);
      })
      .catch(() => {});
    payBase().then((base) => {
      if (!document.body.contains($('#pay-qr'))) return;
      link = payLink(record, base);
      $('#pay-link').value = link;
      const svg = qrSvg(link);
      $('#pay-qr').innerHTML = svg || '<p class="text-sm text-rose-600">Không vẽ được QR — xem lỗi trong Console (F12), hoặc bấm Copy để copy link.</p>';
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
    // Poll: độc giả quét + bấm thanh toán xong thì modal tự báo.
    // Phiếu đang mượn xong khi paidRental, phiếu đã trả xong khi paid.
    const timer = setInterval(async () => {
      if (!document.body.contains($('#pay-status'))) return clearInterval(timer);
      try {
        const res = await fetch(`/api/pay/${record.id}?t=${encodeURIComponent(record.payToken)}`);
        const bill = await res.json();
        const done = record.status === 'BORROWING' ? bill.paidRental : bill.paid;
        if (done) {
          clearInterval(timer);
          $('#pay-status').innerHTML = '<span class="font-bold text-emerald-700">✓ Đã thanh toán thành công!</span>';
          setTimeout(() => { closeModal(); borrowsView(window.__router); }, 1500);
        }
      } catch { /* thử lại kỳ sau */ }
    }, 3000);
  });
}
