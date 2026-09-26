// views/login.js — màn hình đăng nhập + tài khoản demo
import { saveSession } from '../store.js';
import { api } from '../api.js';
import { $, root, toast } from '../ui.js';

export function loginView({ onLoggedIn }) {
  root.innerHTML = `
    <section class="login-bg grid min-h-screen place-items-center p-4">
      <div class="grid w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl md:grid-cols-2">
        <div class="bg-slate-900 p-8 text-white">
          <span class="grid h-12 w-12 place-items-center rounded-xl bg-blue-500 text-xl font-bold">L</span>
          <h1 class="mt-6 text-3xl font-bold">LibraFlow</h1>
          <p class="mt-3 text-slate-300">Hệ thống quản lý thư viện theo kiến trúc Microservices.</p>
          <div class="mt-8 space-y-3 text-sm">
            <p class="font-semibold text-blue-200">Tài khoản demo</p>
            ${[['reader', 'Độc giả'], ['librarian', 'Thủ thư'], ['admin', 'Quản trị viên']]
              .map(([u, r]) => `<button data-demo="${u}" class="block w-full rounded-lg border border-slate-700 bg-slate-800 p-3 text-left hover:bg-slate-700"><b>${r}</b><br><span class="text-slate-300">${u} / 123456</span></button>`).join('')}
          </div>
        </div>
        <div class="p-8">
          <h2 class="text-2xl font-bold">Đăng nhập</h2>
          <p class="mt-1 text-sm text-slate-500">Dùng tài khoản được cấp để tiếp tục.</p>
          <form id="login-form" class="mt-8 space-y-4">
            <label class="block text-sm font-medium">Tên đăng nhập
              <input name="username" required minlength="3" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100">
            </label>
            <label class="block text-sm font-medium">Mật khẩu
              <input name="password" type="password" required minlength="6" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100">
            </label>
            <button class="w-full rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white hover:bg-blue-800">Đăng nhập</button>
          </form>
        </div>
      </div>
    </section>`;

  $('#login-form').onsubmit = async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    button.textContent = 'Đang đăng nhập...';
    try {
      const data = await api('/auth/login', 'POST', Object.fromEntries(new FormData(event.target)));
      saveSession(data.token, data.user);
      toast(data.message);
      onLoggedIn();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Đăng nhập';
    }
  };

  document.querySelectorAll('[data-demo]').forEach((button) => {
    button.onclick = () => {
      $('#login-form [name=username]').value = button.dataset.demo;
      $('#login-form [name=password]').value = '123456';
    };
  });
}
