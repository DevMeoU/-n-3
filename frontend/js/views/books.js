// views/books.js — catalog sách: tìm kiếm + mượn (reader) / thêm-sửa (thủ thư)
import { state, can } from '../store.js';
import { api } from '../api.js';
import { $, layout, esc, loading, errorCard, stockBadge, coverImg, showModal, closeModal, toast } from '../ui.js';

export async function booksView(router) {
  layout(loading(), router);
  try {
    state.books = await api('/books');
    const categories = [...new Set(state.books.map((book) => book.category))].sort();

    layout(`
      <section class="space-y-5">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 class="text-2xl font-bold">Danh mục sách</h1>
            <p class="mt-1 text-sm text-slate-500">Tìm kiếm theo tên, tác giả hoặc thể loại.</p>
          </div>
          ${can('LIBRARIAN', 'ADMIN') ? '<button id="add-book" class="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800">+ Thêm sách</button>' : ''}
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <div class="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <input id="book-search" placeholder="Tìm tên sách, tác giả..." class="rounded-lg border border-slate-300 px-3 py-2.5">
            <select id="book-category" class="rounded-lg border border-slate-300 px-3 py-2.5">
              <option value="">Tất cả thể loại</option>
              ${categories.map((item) => `<option>${esc(item)}</option>`).join('')}
            </select>
            <label class="flex items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm">
              <input id="available-only" type="checkbox"> Còn sách
            </label>
          </div>
        </div>
        <div id="book-table"></div>
      </section>`, router);

    const refresh = () => {
      const query = $('#book-search').value.toLowerCase();
      const category = $('#book-category').value;
      const available = $('#available-only').checked;
      bookTable(state.books.filter((book) =>
        (!query || `${book.title} ${book.author} ${book.category}`.toLowerCase().includes(query)) &&
        (!category || book.category === category) &&
        (!available || book.available > 0)));
    };

    ['book-search', 'book-category', 'available-only'].forEach((id) => {
      $(`#${id}`).oninput = refresh;
    });
    bookTable(state.books);
    if ($('#add-book')) $('#add-book').onclick = () => bookModal();
  } catch (error) {
    layout(errorCard(error.message), router);
  }
}

function bookTable(books) {
  $('#book-table').innerHTML = `
    <div class="table-wrap rounded-xl border border-slate-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="bg-slate-50 text-slate-600">
          <tr><th class="px-4 py-3">Sách</th><th class="px-4 py-3">Tác giả</th><th class="px-4 py-3">Thể loại</th><th class="px-4 py-3">Tồn kho</th><th class="px-4 py-3 text-right">Thao tác</th></tr>
        </thead>
        <tbody>
          ${books.length ? books.map((book) => `
            <tr class="border-t border-slate-100">
              <td class="px-4 py-3">
                <div class="flex items-center gap-3">
                  ${coverImg(book, 'book-cover h-16 w-11 shrink-0')}
                  <span class="font-semibold">${esc(book.title)}</span>
                </div>
              </td>
              <td class="px-4 py-3">${esc(book.author)}</td>
              <td class="px-4 py-3">${esc(book.category)}</td>
              <td class="px-4 py-3">${stockBadge(book)}</td>
              <td class="px-4 py-3 text-right">${bookAction(book)}</td>
            </tr>`).join('') : '<tr><td colspan="5" class="px-4 py-10 text-center text-slate-500">Không tìm thấy sách phù hợp.</td></tr>'}
        </tbody>
      </table>
    </div>`;

  document.querySelectorAll('[data-borrow]').forEach((button) => {
    button.onclick = () => borrowModal(state.books.find((book) => book.id === Number(button.dataset.borrow)));
  });
  document.querySelectorAll('[data-edit-book]').forEach((button) => {
    button.onclick = () => bookModal(state.books.find((book) => book.id === Number(button.dataset.editBook)));
  });
}

function bookAction(book) {
  if (can('READER')) {
    return `<button data-borrow="${book.id}" ${book.available === 0 ? 'disabled' : ''} class="rounded-md bg-blue-700 px-3 py-1.5 font-medium text-white enabled:hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300">Mượn</button>`;
  }
  if (can('LIBRARIAN', 'ADMIN')) {
    return `<button data-edit-book="${book.id}" class="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50">Sửa</button>`;
  }
  return '—';
}

function bookModal(book) {
  const editing = Boolean(book);
  showModal(`
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-bold">${editing ? 'Cập nhật sách' : 'Thêm sách'}</h2>
      <button data-close class="text-2xl text-slate-500">×</button>
    </div>
    <form id="book-form" class="mt-5 grid gap-4">
      <label class="text-sm font-medium">Tên sách<input required name="title" maxlength="200" value="${esc(book?.title)}" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"></label>
      <label class="text-sm font-medium">Tác giả<input required name="author" maxlength="120" value="${esc(book?.author)}" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"></label>
      <label class="text-sm font-medium">Thể loại<input required name="category" maxlength="80" value="${esc(book?.category)}" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"></label>
      <label class="text-sm font-medium">Số lượng<input required name="quantity" type="number" min="1" value="${book?.quantity || ''}" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"></label>
      <button class="rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white">${editing ? 'Lưu thay đổi' : 'Thêm sách'}</button>
    </form>`, () => {
    $('#book-form').onsubmit = async (event) => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      try {
        await api(`/books${editing ? `/${book.id}` : ''}`, editing ? 'PUT' : 'POST', Object.fromEntries(new FormData(event.target)));
        closeModal();
        toast(editing ? 'Đã cập nhật sách' : 'Đã thêm sách');
        booksView(window.__router);
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    };
  });
}

function borrowModal(book) {
  showModal(`
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-bold">Xác nhận yêu cầu mượn</h2>
      <button data-close class="text-2xl text-slate-500">×</button>
    </div>
    <div class="mt-4 flex items-center gap-3 rounded-lg bg-blue-50 p-3 text-sm">
      ${coverImg(book, 'book-cover h-20 w-14 shrink-0')}
      <p><b>${esc(book.title)}</b><br>${esc(book.author)} · ${book.available}/${book.quantity} bản còn</p>
    </div>
    <p class="mt-3 text-sm text-slate-600">Yêu cầu sẽ chờ thủ thư duyệt. Tồn kho chỉ giảm sau khi duyệt.</p>
    <form id="borrow-form" class="mt-4">
      <label class="text-sm font-medium">Ghi chú (không bắt buộc)<textarea name="note" maxlength="500" class="mt-1 w-full rounded-lg border border-slate-300 p-3"></textarea></label>
      <button class="mt-4 w-full rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white">Gửi yêu cầu</button>
    </form>`, () => {
    $('#borrow-form').onsubmit = async (event) => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      try {
        await api('/borrows', 'POST', { bookId: book.id, ...Object.fromEntries(new FormData(event.target)) });
        closeModal();
        toast('Đã gửi yêu cầu mượn, chờ thủ thư duyệt.');
        booksView(window.__router);
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    };
  });
}
