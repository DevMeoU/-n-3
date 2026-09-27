// views/pay.js — trang thanh toán QR fake (CÔNG KHAI, không cần đăng nhập)
// Kịch bản demo: độc giả quét QR → mở link → bấm nút Thanh toán → giả lập chuyển khoản xong.
import { $, root, esc, fmt, fmtVND, toast } from '../ui.js';

async function getBill(id, token) {
  const res = await fetch(`/api/pay/${id}?t=${encodeURIComponent(token || '')}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Không tải được hóa đơn');
  return data;
}

export async function payView(id, token) {
  root.innerHTML = `
    <section class="grid min-h-screen place-items-center bg-[#0b0e14] p-4 text-white">
      <div class="w-full max-w-md">
        <p class="mb-4 text-center text-sm text-slate-400"><a href="#/books" class="hover:text-white">← LibraFlow</a></p>
        <div id="pay-box" class="rounded-2xl bg-[#151a24] p-6 shadow-2xl">
          <p class="text-center text-slate-300">Đang tải hóa đơn...</p>
        </div>
      </div>
    </section>`;
  try {
    const bill = await getBill(id, token);
    renderBill(bill, token);
  } catch (error) {
    $('#pay-box').innerHTML = `
      <h1 class="text-center text-xl font-bold text-rose-400">Liên kết không hợp lệ</h1>
      <p class="mt-2 text-center text-sm text-slate-400">${esc(error.message)}</p>`;
  }
}

function renderBill(bill, token) {
  if (bill.paid) return renderSuccess(bill);
  $('#pay-box').innerHTML = `
    <h1 class="text-center text-xl font-bold">Repayment</h1>
    <h2 class="mt-6 text-lg font-semibold text-slate-200">Thông tin hóa đơn</h2>
    <div class="mt-3 flex items-center gap-3 rounded-xl bg-slate-800 p-3">
      ${bill.coverUrl ? `<img src="${esc(bill.coverUrl)}" alt="Bìa sách" class="h-20 w-14 shrink-0 rounded-md object-cover" onerror="this.style.display='none'">` : ''}
      <div class="min-w-0 text-sm">
        <p class="truncate font-bold text-white">${esc(bill.bookTitle)}</p>
        <p class="mt-1 text-slate-400">Phiếu mượn #${bill.id} · Số lượng: <b class="text-white">${bill.quantity || 1} bản</b></p>
      </div>
    </div>
    <div class="mt-2 space-y-2 text-sm">
      <p class="flex justify-between"><span class="text-slate-400">Tiền mượn (${bill.daysBorrowed || 0} ngày × ${fmtVND(bill.rentalFee)})</span><span>${fmtVND(bill.accruedRental)}</span></p>
      <p class="flex justify-between"><span class="text-slate-400">Phạt quá hạn</span><span>${fmtVND(bill.lateFee)}</span></p>
      ${(Number(bill.paidAmount) || 0) > 0 ? `<p class="flex justify-between"><span class="text-slate-400">Đã thu</span><span class="text-emerald-400">−${fmtVND(bill.paidAmount)}</span></p>` : ''}
      <p class="flex justify-between border-t border-slate-700 pt-2 text-base"><span class="text-slate-300">${bill.status === 'BORROWING' ? 'Tiền mượn (thu trước)' : 'Số tiền thanh toán'}</span><b class="text-rose-500">${fmtVND(bill.payableNow)}</b></p>
    </div>
    <button id="pay-now" class="mt-6 w-full rounded-xl bg-emerald-600 px-4 py-3.5 font-bold text-white hover:bg-emerald-500">
      Thanh toán ${fmtVND(bill.payableNow)}
    </button>
    <p class="mt-3 text-center text-xs text-slate-500">Demo: bấm nút là hệ thống giả lập chuyển khoản thành công, không trừ tiền thật.</p>`;
  $('#pay-now').onclick = async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Đang xử lý...';
    try {
      const res = await fetch(`/api/pay/${bill.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ t: token })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Thanh toán thất bại');
      renderSuccess(data);
      toast('Thanh toán thành công');
    } catch (error) {
      btn.disabled = false;
      btn.textContent = `Thanh toán ${fmtVND(bill.payableNow)}`;
      toast(error.message, 'error');
    }
  };
}

function renderSuccess(bill) {
  const code = `LIBRA${bill.id}-${new Date(bill.paidAt || Date.now()).getTime().toString().slice(-6)}`;
  $('#pay-box').innerHTML = `
    <div class="text-center">
      <span class="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-600 text-3xl font-bold">✓</span>
      <h1 class="mt-4 text-xl font-bold text-emerald-400">ĐÃ THANH TOÁN</h1>
      <p class="mt-1 text-sm text-slate-400">Phiếu mượn #${bill.id} · ${esc(bill.bookTitle)} · Số lượng: ${bill.quantity || 1} bản</p>
    </div>
    <div class="mt-6 space-y-2 text-sm">
      <p class="flex justify-between"><span class="text-slate-400">Số tiền</span><b>${fmtVND(bill.totalFee)}</b></p>
      <p class="flex justify-between"><span class="text-slate-400">Mã giao dịch</span><b>${esc(code)}</b></p>
      <p class="flex justify-between"><span class="text-slate-400">Thời gian</span><b>${bill.paidAt ? new Date(bill.paidAt).toLocaleString('vi-VN') : fmt(Date.now())}</b></p>
    </div>
    <p class="mt-4 rounded-lg bg-slate-800 p-3 text-center text-xs text-slate-400">Hóa đơn demo của LibraFlow — không phát sinh giao dịch thật.</p>`;
}
