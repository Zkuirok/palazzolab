/* ============================================
   PokerLab — Home Dashboard
   At-a-glance stats and daily call-to-action
   ============================================ */

import { loadRanges } from './range-model.js';
import { loadProgram, getDailyPlan, PROGRAM_MODES } from './program.js';
import { loadSessionHistory, QUIZ_HISTORY_KEY, FRESCO_HISTORY_KEY } from './session-history.js';
import { MODES, setProgramMode, renderProgramPage } from './dashboard.js';

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

  // Last graded session, whichever exercise it came from (demo/deleted ranges skipped)
  const knownIds = new Set(ranges.map(r => r.id));
  let last = null;
  [['quiz', QUIZ_HISTORY_KEY], ['fresco', FRESCO_HISTORY_KEY]].forEach(([mode, key]) => {
    Object.entries(loadSessionHistory(key)).forEach(([rangeId, sessions]) => {
      if (!knownIds.has(rangeId)) return;
      (sessions || []).forEach(s => {
        if (s && s.total > 0 && (!last || s.date > last.date)) last = { ...s, rangeId, mode };
      });
    });
  });
  const lastRange = last ? ranges.find(r => r.id === last.rangeId) : null;
  const lastAcc = last ? Math.round(last.correct / last.total * 100) : null;

  // Program status — one program per exercise; the CTA opens the one with work due
  const programs = PROGRAM_MODES
    .map(mode => ({ mode, program: loadProgram(mode) }))
    .filter(x => x.program);
  const active = programs
    .filter(x => x.program.status === 'ACTIVE')
    .map(x => ({ ...x, due: getDailyPlan(x.program).due.length }));
  const calibrating = programs.filter(x => x.program.status === 'CALIBRATING');
  const withDue = active.filter(x => x.due > 0);

  let ctaHtml = '';
  let dueCount = null;
  if (active.length > 0) dueCount = active.reduce((sum, x) => sum + x.due, 0);

  if (withDue.length > 0) {
    const detail = active.length > 1
      ? ` <span class="home-cta-detail">(${active.map(x => `${MODES[x.mode].label} ${x.due}`).join(' · ')})</span>`
      : '';
    ctaHtml = `
      <div class="home-cta" data-nav="program" data-mode="${withDue[0].mode}">
        <span class="home-cta-icon">▶</span>
        <span>${dueCount} range${dueCount > 1 ? 's' : ''} à réviser aujourd'hui${detail}</span>
        <span class="home-cta-arrow">→</span>
      </div>`;
  } else if (calibrating.length > 0) {
    const { mode, program } = calibrating[0];
    const progresses = Object.values(program.progress || {});
    const done = progresses.filter(p => p.calibrationScore !== null).length;
    ctaHtml = `
      <div class="home-cta" data-nav="program" data-mode="${mode}">
        <span class="home-cta-icon">◎</span>
        <span>Calibration ${MODES[mode].label} en cours — ${done} / ${progresses.length}</span>
        <span class="home-cta-arrow">→</span>
      </div>`;
  } else if (active.length > 0) {
    ctaHtml = `
      <div class="home-cta done" data-nav="program" data-mode="${active[0].mode}">
        <span class="home-cta-icon">✓</span>
        <span>Programme${active.length > 1 ? 's' : ''} à jour — reviens demain</span>
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
      label: `Dernière session · ${MODES[last.mode].label}`,
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
    cta.addEventListener('click', () => {
      if (cta.dataset.mode) setProgramMode(cta.dataset.mode);
      window.navigateTo(cta.dataset.nav);
      renderProgramPage();
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
