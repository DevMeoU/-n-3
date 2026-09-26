// views/books.js — catalog sách: tìm kiếm + mượn (reader) / thêm-sửa (thủ thư)
import { state, can } from '../store.js';
import { api } from '../api.js';
import { $, layout, esc, loading, errorCard, stockBadge, coverImg, coverSlug, showModal, closeModal, toast } from '../ui.js';

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
                <button data-preview="${book.id}" class="flex items-center gap-3 text-left hover:opacity-90" title="Xem trước">
                  ${coverImg(book, 'book-cover h-16 w-11 shrink-0')}
                  <span class="font-semibold text-blue-700 hover:underline">${esc(book.title)}</span>
                </button>
              </td>
              <td class="px-4 py-3">${esc(book.author)}</td>
              <td class="px-4 py-3">${esc(book.category)}</td>
              <td class="px-4 py-3">${stockBadge(book)}</td>
              <td class="px-4 py-3 text-right">${bookAction(book)}</td>
            </tr>`).join('') : '<tr><td colspan="5" class="px-4 py-10 text-center text-slate-500">Không tìm thấy sách phù hợp.</td></tr>'}
        </tbody>
      </table>
    </div>`;

  document.querySelectorAll('[data-preview]').forEach((button) => {
    button.onclick = () => bookDetailModal(state.books.find((book) => book.id === Number(button.dataset.preview)));
  });
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
  const currentCover = editing && book.cover_url ? book.cover_url : '';
  showModal(`
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-bold">${editing ? 'Cập nhật sách' : 'Thêm sách'}</h2>
      <button data-close class="text-2xl text-slate-500">×</button>
    </div>
    <form id="book-form" class="mt-5 grid gap-4">
      <div class="flex items-center gap-4">
        <img id="book-cover-preview" src="${currentCover || (editing ? `/assets/covers/${coverSlug(book.category)}.svg` : '/assets/covers/default.svg')}" alt="Xem trước bìa" class="book-cover h-24 w-16 shrink-0" onerror="this.onerror=null;this.src='/assets/covers/default.svg';">
        <label class="flex-1 text-sm font-medium">Ảnh bìa (JPG/PNG/WebP ≤ 2MB, tùy chọn)
          <input id="book-cover-file" type="file" accept="image/jpeg,image/png,image/webp" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
          ${currentCover ? '<button type="button" id="book-cover-remove" class="mt-2 text-sm text-rose-700 hover:underline">Gỡ ảnh hiện tại</button>' : ''}
        </label>
      </div>
      <label class="text-sm font-medium">Tên sách<input required name="title" maxlength="200" value="${esc(book?.title)}" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"></label>
      <label class="text-sm font-medium">Tác giả<input required name="author" maxlength="120" value="${esc(book?.author)}" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"></label>
      <label class="text-sm font-medium">Thể loại<input required name="category" maxlength="80" value="${esc(book?.category)}" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"></label>
      <label class="text-sm font-medium">Số lượng<input required name="quantity" type="number" min="1" value="${book?.quantity || ''}" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"></label>
      <button class="rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white">${editing ? 'Lưu thay đổi' : 'Thêm sách'}</button>
    </form>`, () => {
    const fileInput = $('#book-cover-file');
    const preview = $('#book-cover-preview');
    fileInput.onchange = () => {
      const file = fileInput.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        toast('Ảnh vượt quá 2MB', 'error');
        fileInput.value = '';
        return;
      }
      preview.src = URL.createObjectURL(file);
    };
    const removeBtn = $('#book-cover-remove');
    if (removeBtn) {
      removeBtn.onclick = async () => {
        removeBtn.disabled = true;
        try {
          await api(`/books/${book.id}/cover`, 'DELETE');
          closeModal();
          toast('Đã gỡ ảnh bìa');
          booksView(window.__router);
        } catch (error) {
          toast(error.message, 'error');
          removeBtn.disabled = false;
        }
      };
    }
    $('#book-form').onsubmit = async (event) => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      const readFile = () => new Promise((resolve, reject) => {
        const file = fileInput.files[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Không đọc được file ảnh'));
        reader.readAsDataURL(file);
      });
      try {
        const form = new FormData(event.target);
        const payload = {
          title: form.get('title'),
          author: form.get('author'),
          category: form.get('category'),
          quantity: Number(form.get('quantity'))
        };
        const saved = await api(`/books${editing ? `/${book.id}` : ''}`, editing ? 'PUT' : 'POST', payload);
        const dataUrl = await readFile();
        if (dataUrl) {
          try {
            await api(`/books/${saved.id}/cover`, 'POST', { image: dataUrl });
            toast(editing ? 'Đã cập nhật sách + ảnh bìa' : 'Đã thêm sách + ảnh bìa');
          } catch (error) {
            toast(`Đã lưu sách nhưng tải ảnh lỗi: ${error.message}`, 'error');
          }
        } else {
          toast(editing ? 'Đã cập nhật sách' : 'Đã thêm sách');
        }
        closeModal();
        booksView(window.__router);
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    };
  });
}

function bookDetailModal(book) {
  if (!book) return;
  const borrowed = book.quantity - book.available;
  showModal(`
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-bold">Xem trước sách</h2>
      <button data-close class="text-2xl text-slate-500">×</button>
    </div>
    <div class="mt-5 flex flex-col gap-5 sm:flex-row">
      ${coverImg(book, 'book-cover h-48 w-32 shrink-0 self-center sm:self-start')}
      <div class="min-w-0 flex-1 space-y-3 text-sm">
        <p class="text-lg font-bold leading-snug">${esc(book.title)}</p>
        <p class="text-slate-600">Tác giả: <b class="text-slate-900">${esc(book.author)}</b></p>
        <p><span class="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">${esc(book.category)}</span></p>
        <p>${stockBadge(book)}</p>
        <dl class="grid grid-cols-3 gap-2 text-center">
          <div class="rounded-lg bg-slate-50 p-2"><dt class="text-xs text-slate-500">Tổng số</dt><dd class="text-lg font-bold">${book.quantity}</dd></div>
          <div class="rounded-lg bg-slate-50 p-2"><dt class="text-xs text-slate-500">Còn lại</dt><dd class="text-lg font-bold text-emerald-700">${book.available}</dd></div>
          <div class="rounded-lg bg-slate-50 p-2"><dt class="text-xs text-slate-500">Đang mượn</dt><dd class="text-lg font-bold text-blue-700">${borrowed}</dd></div>
        </dl>
      </div>
    </div>
    <div class="mt-6 flex justify-end gap-3">
      <button data-close class="rounded-lg border border-slate-300 px-4 py-2">Đóng</button>
      ${can('READER')
        ? `<button id="detail-borrow" ${book.available === 0 ? 'disabled' : ''} class="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white enabled:hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300">Mượn sách này</button>`
        : can('LIBRARIAN', 'ADMIN')
          ? `<button id="detail-edit" class="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800">Sửa thông tin</button>`
          : ''}
    </div>`, () => {
    const goBorrow = $('#detail-borrow');
    if (goBorrow) goBorrow.onclick = () => borrowModal(book);
    const goEdit = $('#detail-edit');
    if (goEdit) goEdit.onclick = () => bookModal(book);
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
