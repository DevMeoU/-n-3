// views/profile.js — hồ sơ cá nhân + đổi mật khẩu
import { state, roles } from '../store.js';
import { api } from '../api.js';
import { $, layout, esc, fmt, showModal, closeModal, toast, loading, errorCard } from '../ui.js';

export async function profileView(router) {
  layout(loading(), router);
  try {
    const me = await api('/users/me');
    state.user.fullName = me.fullName;
    localStorage.setItem('library_user', JSON.stringify(state.user));
    layout(`
      <section class="mx-auto max-w-2xl space-y-5">
        <div>
          <h1 class="text-2xl font-bold">Hồ sơ cá nhân</h1>
          <p class="mt-1 text-sm text-slate-500">Thông tin tài khoản đang đăng nhập.</p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-6">
          <div class="flex items-center gap-4">
            <span class="grid h-14 w-14 place-items-center rounded-full bg-blue-700 text-2xl font-bold text-white">${esc(me.fullName.charAt(0).toUpperCase())}</span>
            <div>
              <p class="text-lg font-bold">${esc(me.fullName)}</p>
              <p class="text-sm text-slate-500">@${esc(me.username)} · ${esc(roles[me.role])} · tham gia ${fmt(me.createdAt)}</p>
            </div>
          </div>
          <div class="mt-6 flex flex-wrap gap-3">
            <button id="edit-name" class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">Đổi họ tên</button>
            <button id="change-pass" class="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">Đổi mật khẩu</button>
          </div>
        </div>
      </section>`, router);
    $('#edit-name').onclick = () => nameModal(me);
    $('#change-pass').onclick = () => passwordModal();
  } catch (error) {
    layout(errorCard(error.message), router);
  }
}

function nameModal(me) {
  showModal(`
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-bold">Đổi họ tên</h2>
      <button data-close class="text-2xl text-slate-500">×</button>
    </div>
    <form id="name-form" class="mt-5 grid gap-4">
      <label class="text-sm font-medium">Họ và tên mới<input name="fullName" required minlength="2" maxlength="100" value="${esc(me.fullName)}" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"></label>
      <button class="rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white">Lưu</button>
    </form>`, () => {
    $('#name-form').onsubmit = async (event) => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      try {
        await api('/users/me', 'PUT', Object.fromEntries(new FormData(event.target)));
        closeModal();
        toast('Đã cập nhật họ tên');
        profileView(window.__router);
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    };
  });
}

function passwordModal() {
  showModal(`
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-bold">Đổi mật khẩu</h2>
      <button data-close class="text-2xl text-slate-500">×</button>
    </div>
    <form id="pass-form" class="mt-5 grid gap-4">
      <label class="text-sm font-medium">Mật khẩu hiện tại<input name="oldPassword" type="password" required class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"></label>
      <label class="text-sm font-medium">Mật khẩu mới (≥ 6 ký tự)<input name="newPassword" type="password" required minlength="6" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"></label>
      <button class="rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white">Đổi mật khẩu</button>
    </form>`, () => {
    $('#pass-form').onsubmit = async (event) => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      try {
        await api('/users/me/password', 'POST', Object.fromEntries(new FormData(event.target)));
        closeModal();
        toast('Đã đổi mật khẩu');
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    };
  });
}
