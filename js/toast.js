/* ============================================
   PokerLab — Toast Notifications
   ============================================ */

let timeout = null;

export function showToast(text) {
  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toast-text');
  if (!toast || !toastText) return;

  toastText.textContent = text;
  toast.classList.add('show');

  if (timeout) clearTimeout(timeout);
  timeout = setTimeout(() => toast.classList.remove('show'), 2500);
}

window.showToast = showToast;
