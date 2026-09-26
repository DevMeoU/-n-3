// views/users.js — quản trị tài khoản (ADMIN): tạo / sửa / xóa
import { state, can, roles } from '../store.js';
import { api } from '../api.js';
import { $, layout, esc, fmt, loading, errorCard, showModal, closeModal, toast } from '../ui.js';

export async function usersView(router) {
  if (!can('ADMIN')) {
    location.hash = 'books';
    return;
  }
  layout(loading(), router);
  try {
    const users = await api('/users');
    layout(`
      <section class="space-y-5">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 class="text-2xl font-bold">Quản trị tài khoản</h1>
            <p class="mt-1 text-sm text-slate-500">Tạo tài khoản và phân vai trò cho hệ thống.</p>
          </div>
          <button id="add-user" class="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white">+ Tạo tài khoản</button>
        </div>
        <div class="table-wrap rounded-xl border border-slate-200 bg-white">
          <table class="w-full text-left text-sm">
            <thead class="bg-slate-50 text-slate-600">
              <tr><th class="px-4 py-3">ID</th><th class="px-4 py-3">Họ tên</th><th class="px-4 py-3">Username</th><th class="px-4 py-3">Vai trò</th><th class="px-4 py-3">Ngày tạo</th><th class="px-4 py-3 text-right">Thao tác</th></tr>
            </thead>
            <tbody>
              ${users.map((u) => {
                const isSelf = state.user && u.id === state.user.id;
                return `
                <tr class="border-t border-slate-100">
                  <td class="px-4 py-3">${u.id}</td>
                  <td class="px-4 py-3 font-semibold">${esc(u.fullName)}</td>
                  <td class="px-4 py-3">${esc(u.username)}</td>
                  <td class="px-4 py-3">${esc(roles[u.role])}</td>
                  <td class="px-4 py-3">${fmt(u.createdAt)}</td>
                  <td class="px-4 py-3 text-right whitespace-nowrap">
                    <button data-edit-user="${u.id}" class="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50">Sửa</button>
                    <button data-del-user="${u.id}" ${isSelf ? 'disabled title="Không thể xóa tài khoản đang đăng nhập"' : ''} class="rounded-md border border-rose-300 px-3 py-1.5 text-rose-700 enabled:hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40">Xóa</button>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>`, router);
    $('#add-user').onclick = () => userModal();
    document.querySelectorAll('[data-edit-user]').forEach((button) => {
      button.onclick = () => userModal(users.find((u) => u.id === Number(button.dataset.editUser)));
    });
    document.querySelectorAll('[data-del-user]').forEach((button) => {
      button.onclick = () => deleteUserModal(users.find((u) => u.id === Number(button.dataset.delUser)));
    });
  } catch (error) {
    layout(errorCard(error.message), router);
  }
}

function userModal(user) {
  const editing = Boolean(user);
  showModal(`
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-bold">${editing ? 'Sửa tài khoản' : 'Tạo tài khoản'}</h2>
      <button data-close class="text-2xl text-slate-500">×</button>
    </div>
    <form id="user-form" class="mt-5 grid gap-4">
      <label class="text-sm font-medium">Họ và tên<input name="fullName" required minlength="2" maxlength="100" value="${esc(user?.fullName)}" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"></label>
      <label class="text-sm font-medium">Tên đăng nhập
        <input name="username" value="${esc(user?.username)}" ${editing ? 'disabled' : 'required pattern="[A-Za-z0-9._-]{3,50}"'} class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100">
        ${editing ? '<small class="font-normal text-slate-500">Tên đăng nhập không được đổi.</small>' : ''}
      </label>
      <label class="text-sm font-medium">${editing ? 'Mật khẩu mới (để trống nếu giữ nguyên)' : 'Mật khẩu'}
        <input name="password" type="password" ${editing ? '' : 'required'} minlength="6" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
      </label>
      <label class="text-sm font-medium">Vai trò
        <select name="role" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
          ${['READER', 'LIBRARIAN', 'ADMIN'].map((r) => `<option value="${r}" ${user?.role === r ? 'selected' : ''}>${roles[r]}</option>`).join('')}
        </select>
      </label>
      <button class="rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white">${editing ? 'Lưu thay đổi' : 'Tạo tài khoản'}</button>
    </form>`, () => {
    $('#user-form').onsubmit = async (event) => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      try {
        const form = Object.fromEntries(new FormData(event.target));
        if (editing) {
          delete form.username; // input disabled không submit, xóa cho chắc
          if (!form.password) delete form.password; // trống = giữ nguyên
          await api(`/users/${user.id}`, 'PUT', form);
          closeModal();
          toast('Đã cập nhật tài khoản');
        } else {
          await api('/users', 'POST', form);
          closeModal();
          toast('Đã tạo tài khoản');
        }
        usersView(window.__router);
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    };
  });
}

function deleteUserModal(user) {
  if (!user) return;
  const isSelf = state.user && user.id === state.user.id;
  showModal(`
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-bold">Xóa tài khoản</h2>
      <button data-close class="text-2xl text-slate-500">×</button>
    </div>
    <p class="mt-4 text-slate-600">Xóa tài khoản <b>${esc(user.fullName)}</b> (<b>${esc(user.username)}</b> — ${esc(roles[user.role])})?</p>
    <p class="mt-2 text-sm text-slate-500">Lịch sử mượn/trả cũ vẫn giữ tên snapshot nên không mất dấu vết.</p>
    <div class="mt-6 flex justify-end gap-3">
      <button data-close class="rounded-lg border border-slate-300 px-4 py-2">Quay lại</button>
      <button id="confirm-delete-user" ${isSelf ? 'disabled' : ''} class="rounded-lg bg-rose-600 px-4 py-2 font-semibold text-white enabled:hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40">Xóa</button>
    </div>`, () => {
    $('#confirm-delete-user').onclick = async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const result = await api(`/users/${user.id}`, 'DELETE');
        closeModal();
        toast(result.message || 'Đã xóa tài khoản');
        usersView(window.__router);
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    };
  });
}
