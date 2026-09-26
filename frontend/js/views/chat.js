// views/chat.js — chat nội bộ độc giả ↔ thủ thư/quản trị viên (poll 3s, không cần websocket)
import { state, can, roles } from '../store.js';
import { api } from '../api.js';
import { $, layout, esc, fmt, loading, errorCard, showModal, closeModal, toast } from '../ui.js';

export async function updateChatBadge() {
  const badge = $('#chat-badge');
  if (!badge || !state.token) return;
  try {
    const { unread } = await api('/chat/unread');
    badge.textContent = unread > 0 ? unread : '';
    badge.style.display = unread > 0 ? '' : 'none';
  } catch { /* im lặng, thử lại lần sau */ }
}

export async function chatView(router) {
  layout(loading(), router);
  try {
    const threads = await api('/chat/threads');
    const open = pickThread(threads);
    layout(`
      <section class="space-y-5">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 class="text-2xl font-bold">Tin nhắn nội bộ</h1>
            <p class="mt-1 text-sm text-slate-500">${can('READER') ? 'Trao đổi với quầy thủ thư / quản trị viên.' : 'Trả lời độc giả theo từng hội thoại.'}</p>
          </div>
          ${can('READER') ? '<button id="new-chat" class="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800">+ Chat mới</button>' : ''}
        </div>
        <div class="grid gap-4 md:grid-cols-[280px_1fr]">
          <div id="thread-list" class="space-y-2"></div>
          <div class="rounded-xl border border-slate-200 bg-white p-4">
            <div id="chat-box" class="space-y-3"></div>
          </div>
        </div>
      </section>`, router);
    renderThreads(threads, open);
    if (open) await openThread(open.readerId, open.staffRole);
    else $('#chat-box').innerHTML = '<p class="py-10 text-center text-sm text-slate-500">Chọn một hội thoại hoặc tạo chat mới.</p>';
    if (can('READER')) $('#new-chat').onclick = newChatModal;
    startPoll();
    updateChatBadge();
  } catch (error) {
    layout(errorCard(error.message), router);
  }
}

function pickThread(threads) {
  const [rid, role] = (window.__openThread || '').split('|');
  return threads.find((t) => String(t.readerId) === rid && t.staffRole === role) || threads[0] || null;
}

function renderThreads(threads, open) {
  $('#thread-list').innerHTML = threads.length ? threads.map((t) => `
    <button data-thread="${t.readerId}|${t.staffRole}"
      class="block w-full rounded-xl border p-3 text-left text-sm ${open && open.readerId === t.readerId && open.staffRole === t.staffRole ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}">
      <span class="flex items-center justify-between gap-2">
        <b class="truncate">${can('READER') ? esc(staffLabel(t)) : esc(t.readerName)}</b>
        ${t.unread > 0 ? `<span class="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-bold text-white">${t.unread}</span>` : ''}
      </span>
      <small class="mt-1 block truncate text-slate-500">${esc(t.lastMessage.senderName)}: ${esc(t.lastMessage.body)}</small>
    </button>`).join('')
    : '<p class="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">Chưa có hội thoại nào.</p>';
  document.querySelectorAll('[data-thread]').forEach((b) => {
    b.onclick = () => {
      const [readerId, staffRole] = b.dataset.thread.split('|');
      window.__openThread = b.dataset.thread;
      openThread(Number(readerId), staffRole);
      renderThreads(window.__threadsCache || threads, { readerId: Number(readerId), staffRole });
    };
  });
}

function staffLabel(t) {
  return t.staffRole === 'ADMIN' ? 'Quản trị viên' : 'Quầy thủ thư';
}

function bubble(m) {
  const mine = state.user && m.senderId === state.user.id;
  return `
    <div class="flex ${mine ? 'justify-end' : 'justify-start'}">
      <div class="max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${mine ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-900'}">
        ${mine ? '' : `<p class="mb-0.5 text-xs font-semibold text-blue-700">${esc(m.senderName)} · ${esc(roles[m.senderRole] || m.senderRole)}</p>`}
        <p class="whitespace-pre-wrap break-words">${esc(m.body)}</p>
        <p class="mt-1 text-right text-[11px] ${mine ? 'text-blue-200' : 'text-slate-400'}">${fmtTime(m.createdAt)}</p>
      </div>
    </div>`;
}

function fmtTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

async function openThread(readerId, staffRole) {
  const box = $('#chat-box');
  try {
    const messages = await api(`/chat/threads/${readerId}/${encodeURIComponent(staffRole)}`);
    window.__openMessages = messages;
    box.innerHTML = `
      <div id="msg-list" class="max-h-[420px] space-y-3 overflow-y-auto pr-1">
        ${messages.length ? messages.map(bubble).join('') : '<p class="py-6 text-center text-sm text-slate-500">Chưa có tin nhắn. Hãy chào trước nhé!</p>'}
      </div>
      <form id="send-form" class="mt-3 flex gap-2">
        <input id="send-input" maxlength="1000" placeholder="Nhập tin nhắn..." autocomplete="off"
          class="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100">
        <button class="shrink-0 rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white hover:bg-blue-800">Gửi</button>
      </form>`;
    const list = $('#msg-list');
    list.scrollTop = list.scrollHeight;
    $('#send-form').onsubmit = async (event) => {
      event.preventDefault();
      const input = $('#send-input');
      const body = input.value.trim();
      if (!body) return;
      input.value = '';
      try {
        await sendMessage(readerId, staffRole, body);
        await refreshOpen();
      } catch (error) {
        toast(error.message, 'error');
        input.value = body;
      }
    };
    updateChatBadge();
  } catch (error) {
    box.innerHTML = `<p class="py-6 text-center text-sm text-rose-700">${esc(error.message)}</p>`;
  }
}

async function sendMessage(readerId, staffRole, body) {
  if (can('READER')) {
    await api('/chat', 'POST', { toRole: staffRole, body });
  } else {
    await api('/chat', 'POST', { toUserId: readerId, body });
  }
}

async function refreshOpen() {
  const [rid, role] = (window.__openThread || '').split('|');
  if (!rid || !role) return;
  try {
    const messages = await api(`/chat/threads/${rid}/${encodeURIComponent(role)}`);
    const list = $('#msg-list');
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    list.innerHTML = messages.length ? messages.map(bubble).join('') : '';
    if (nearBottom) list.scrollTop = list.scrollHeight;
    window.__openMessages = messages;
  } catch { /* giữ nội dung cũ */ }
}

function startPoll() {
  if (window.__chatTimer) clearInterval(window.__chatTimer);
  window.__chatTimer = setInterval(async () => {
    if (!document.body.contains($('#chat-box'))) return clearInterval(window.__chatTimer);
    if ($('#modal') && $('#modal').innerHTML.trim() !== '') return;
    try {
      const threads = await api('/chat/threads');
      window.__threadsCache = threads;
      const open = pickThread(threads);
      renderThreads(threads, open);
      const [rid, role] = (window.__openThread || '').split('|');
      if (rid && role) {
        const messages = await api(`/chat/threads/${rid}/${encodeURIComponent(role)}`);
        const old = (window.__openMessages || []).length;
        if (messages.length !== old) {
          window.__openMessages = messages;
          const list = $('#msg-list');
          if (list) {
            list.innerHTML = messages.map(bubble).join('');
            list.scrollTop = list.scrollHeight;
          }
        }
      }
      updateChatBadge();
    } catch { /* thử lại kỳ sau */ }
  }, 3000);
}

function newChatModal() {
  showModal(`
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-bold">Chat mới</h2>
      <button data-close class="text-2xl text-slate-500">×</button>
    </div>
    <div class="mt-5 grid gap-3">
      <button data-role="LIBRARIAN" class="rounded-xl border border-slate-300 p-4 text-left hover:bg-slate-50"><b>Quầy thủ thư</b><br><small class="text-slate-500">Hỏi về sách, mượn/trả, gia hạn</small></button>
      <button data-role="ADMIN" class="rounded-xl border border-slate-300 p-4 text-left hover:bg-slate-50"><b>Quản trị viên</b><br><small class="text-slate-500">Hỏi về tài khoản, phân quyền</small></button>
    </div>
    <form id="first-form" class="mt-4 flex gap-2">
      <input id="first-input" maxlength="1000" placeholder="Nhập tin nhắn đầu tiên..." autocomplete="off"
        class="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5">
      <button class="shrink-0 rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white">Gửi</button>
    </form>`, () => {
    let role = 'LIBRARIAN';
    document.querySelectorAll('[data-role]').forEach((b) => {
      b.onclick = () => {
        role = b.dataset.role;
        document.querySelectorAll('[data-role]').forEach((x) => x.classList.remove('!border-blue-600', '!bg-blue-50'));
        b.classList.add('!border-blue-600', '!bg-blue-50');
      };
    });
    document.querySelector('[data-role="LIBRARIAN"]').classList.add('!border-blue-600', '!bg-blue-50');
    $('#first-form').onsubmit = async (event) => {
      event.preventDefault();
      const body = $('#first-input').value.trim();
      if (!body) return toast('Nhập tin nhắn trước', 'error');
      try {
        await api('/chat', 'POST', { toRole: role, body });
        closeModal();
        window.__openThread = `${state.user.id}|${role}`;
        toast('Đã gửi tin nhắn');
        chatView(window.__router);
      } catch (error) {
        toast(error.message, 'error');
      }
    };
  });
}
