/* ============================================
   PokerLab — Navigation
   ============================================ */

export function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const pages = document.querySelectorAll('.page');

  function navigateTo(pageId) {
    pages.forEach(p => p.style.display = 'none');
    const target = document.getElementById('page-' + pageId);
    if (target) {
      target.style.display = 'block';
      target.style.animation = 'fadeInUp 500ms ease-out';
    }
    navItems.forEach(n => n.classList.remove('active'));
    const nav = document.querySelector(`.nav-item[data-page="${pageId}"]`);
    if (nav) nav.classList.add('active');
  }

  navItems.forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.page));
  });

  // Expose for card onclick handlers
  window.navigateTo = navigateTo;
}
