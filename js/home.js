/* ============================================
   PokerLab — Home Dashboard
   At-a-glance stats and daily call-to-action
   ============================================ */

import { loadRanges } from './range-model.js';
import { loadProgram, getDailyPlan } from './program.js';

export function initHome() {
  render();
  const nav = document.querySelector('.nav-item[data-page="dashboard"]');
  if (nav) nav.addEventListener('click', render);
}

function render() {
  const el = document.getElementById('home-stats');
  if (!el) return;

  const ranges = loadRanges();
  const stdCount = ranges.filter(r => r.type !== 'nash').length;
  const nashCount = ranges.length - stdCount;

  // Last Colosseum session
  let history = {};
  try {
    history = JSON.parse(localStorage.getItem('pokerlab_colosseum_history') || '{}');
  } catch { /* ignore */ }
  let last = null;
  Object.entries(history).forEach(([rangeId, sessions]) => {
    (sessions || []).forEach(s => {
      if (!last || s.date > last.date) last = { ...s, rangeId };
    });
  });
  const lastRange = last ? ranges.find(r => r.id === last.rangeId) : null;
  const lastAcc = last ? Math.round(last.correct / last.total * 100) : null;

  // Program status
  const program = loadProgram();
  let ctaHtml = '';
  let dueCount = null;
  if (program && program.status === 'ACTIVE') {
    const { due } = getDailyPlan(program);
    dueCount = due.length;
    if (due.length > 0) {
      ctaHtml = `
        <div class="home-cta" data-nav="program">
          <span class="home-cta-icon">▶</span>
          <span>${due.length} range${due.length > 1 ? 's' : ''} à réviser aujourd'hui</span>
          <span class="home-cta-arrow">→</span>
        </div>`;
    } else {
      ctaHtml = `
        <div class="home-cta done" data-nav="program">
          <span class="home-cta-icon">✓</span>
          <span>Programme à jour — reviens demain</span>
        </div>`;
    }
  } else if (program && program.status === 'CALIBRATING') {
    const progresses = Object.values(program.progress || {});
    const done = progresses.filter(p => p.calibrationScore !== null).length;
    ctaHtml = `
      <div class="home-cta" data-nav="program">
        <span class="home-cta-icon">◎</span>
        <span>Calibration en cours — ${done} / ${progresses.length}</span>
        <span class="home-cta-arrow">→</span>
      </div>`;
  }

  const tiles = [
    { value: stdCount, label: 'Ranges' },
    { value: nashCount, label: 'Tables Nash' },
  ];
  if (dueCount !== null) {
    tiles.push({ value: dueCount, label: 'Dû aujourd\'hui', accent: dueCount > 0 });
  }
  if (last) {
    tiles.push({
      value: `${lastAcc}%`,
      label: 'Dernière session',
      sub: lastRange ? lastRange.name : '',
      accent: false,
    });
  }

  el.innerHTML = `
    <div class="home-stats-row">
      ${tiles.map(t => `
        <div class="home-stat-tile${t.accent ? ' accent' : ''}">
          <span class="home-stat-value">${t.value}</span>
          <span class="home-stat-label">${escapeHtml(t.label)}</span>
          ${t.sub ? `<span class="home-stat-sub">${escapeHtml(t.sub)}</span>` : ''}
        </div>`).join('')}
      ${ctaHtml}
    </div>
  `;

  el.querySelectorAll('[data-nav]').forEach(cta => {
    cta.addEventListener('click', () => window.navigateTo(cta.dataset.nav));
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
