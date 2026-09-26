// app.js — entry + hash router
import { state, clearSession } from './store.js';
import { loginView } from './views/login.js';
import { booksView } from './views/books.js';
import { borrowsView } from './views/borrows.js';
import { usersView } from './views/users.js';

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

async function render() {
  if (!state.token || !state.user) {
    return loginView({
      onLoggedIn() {
        state.view = 'books';
        location.hash = 'books';
        render();
      }
    });
  }
  if (!['books', 'borrows', 'users'].includes(state.view)) state.view = 'books';
  if (state.view === 'books') return booksView(router);
  if (state.view === 'borrows') return borrowsView(router);
  return usersView(router);
}

window.addEventListener('hashchange', () => {
  state.view = location.hash.slice(1) || 'books';
  render();
});

render();
