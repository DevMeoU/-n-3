// app.js — entry + hash router (kèm route công khai #/pay/:id?t=...)
import { state, clearSession } from './store.js';
import { loginView } from './views/login.js';
import { booksView } from './views/books.js';
import { borrowsView } from './views/borrows.js';
import { usersView } from './views/users.js';
import { payView } from './views/pay.js';
import { dashboardView } from './views/dashboard.js';
import { profileView } from './views/profile.js';

const router = {
  onNavigate(view) {
    state.view = view;
    location.hash = view;
    render();
  },
  onLogout() {
    clearSession();
    location.hash = '';
    render();
  }
};

// Cho views tự refresh sau modal (tránh circular import)
window.__router = router;

function payRoute() {
  // location.hash dạng '#/pay/5?t=abc' → { id: '5', token: 'abc' }
  const raw = location.hash.slice(1);
  if (!raw.startsWith('/pay/')) return null;
  const [path, query] = raw.split('?');
  const id = path.replace('/pay/', '');
  const token = new URLSearchParams(query || '').get('t');
  if (!id) return null;
  return { id, token };
}

async function render() {
  const pay = payRoute();
  if (pay) return payView(pay.id, pay.token); // công khai, không cần đăng nhập
  if (!state.token || !state.user) {
    return loginView({
      onLoggedIn() {
        state.view = 'dashboard';
        location.hash = 'dashboard';
        render();
      }
    });
  }
  if (!['dashboard', 'books', 'borrows', 'users', 'profile'].includes(state.view)) state.view = 'dashboard';
  if (state.view === 'dashboard') return dashboardView(router);
  if (state.view === 'books') return booksView(router);
  if (state.view === 'borrows') return borrowsView(router);
  if (state.view === 'profile') return profileView(router);
  return usersView(router);
}

window.addEventListener('hashchange', () => {
  state.view = location.hash.slice(1) || 'dashboard';
  render();
});

render();
