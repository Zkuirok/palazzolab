/* ============================================
   PokerLab — Dashboard Program Controller
   Spaced repetition program UI
   ============================================ */

import { loadRanges } from './range-model.js';
import { showToast } from './toast.js';
import {
  loadProgram,
  saveProgram,
  deleteProgram,
  createProgram,
  recordCalibrationScore,
  recordActiveScore,
  getDailyPlan,
  skipRange,
  todayStr,
  addDays,
  daysOverdue,
} from './program.js';

let _launchQuiz = null;

// ============================================
// INIT
// ============================================

export function initDashboard({ launchQuizForRange }) {
  _launchQuiz = launchQuizForRange;
  render();

  // Re-render when the programme nav item is clicked
  const nav = document.querySelector('.nav-item[data-page="program"]');
  if (nav) nav.addEventListener('click', () => render());
}

// ============================================
// MAIN RENDER DISPATCHER
// ============================================

function render() {
  const program = loadProgram();
  const container = document.getElementById('dashboard-program-section');
  if (!container) return;
  container.innerHTML = '';

  if (!program) {
    renderSetup(container);
  } else if (program.status === 'CALIBRATING') {
    renderCalibration(container, program);
  } else {
    renderActive(container, program);
  }
}

// ============================================
// STATE 0: SETUP FORM
// ============================================

function renderSetup(container) {
  const allRanges = loadRanges();
  // Only standard ranges (no Nash, no GTO)
  const eligible = allRanges.filter(r =>
    r.type !== 'nash' &&
    !Object.values(r.cells || {}).some(v => Array.isArray(v))
  );

  const panel = document.createElement('div');
  panel.className = 'program-panel';

  panel.innerHTML = `
    <div class="program-panel-title">Programme d'entraînement</div>
    <p class="program-setup-intro">
      Sélectionne les ranges à maîtriser et définis ton rythme quotidien.<br>
      Tu commenceras par une phase de calibration (1 quiz par range), puis le système planifiera tes révisions automatiquement.
    </p>
    <div class="program-setup-ranges" id="program-range-list"></div>
    <div class="program-limit-row">
      <span class="program-limit-label">Ranges / jour :</span>
      <input type="number" id="program-daily-limit" class="program-limit-input" value="3" min="1" max="10">
      <span class="program-limit-hint">quiz par jour en croisière</span>
    </div>
    <button class="program-start-btn" id="program-start-btn" disabled>
      Démarrer le programme →
    </button>
  `;

  const listEl = panel.querySelector('#program-range-list');

  if (eligible.length === 0) {
    listEl.innerHTML = '<div class="program-empty-ranges">Aucune range standard disponible. Crée d\'abord des ranges dans <strong>Mes Ranges</strong>.</div>';
  } else {
    eligible.forEach(range => {
      const row = document.createElement('label');
      row.className = 'program-range-check-row';
      row.innerHTML = `
        <input type="checkbox" value="${escapeAttr(range.id)}">
        <span class="program-range-check-label">${escapeHtml(range.name)}</span>
        <span class="program-range-check-meta">${escapeHtml(range.situation || '')}</span>
      `;
      listEl.appendChild(row);
    });
  }

  container.appendChild(panel);

  // Enable/disable Start button based on checkbox state
  const startBtn = panel.querySelector('#program-start-btn');
  const updateStartBtn = () => {
    const checked = panel.querySelectorAll('input[type="checkbox"]:checked').length;
    startBtn.disabled = checked === 0;
  };
  panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', updateStartBtn);
  });

  startBtn.addEventListener('click', () => {
    const selectedIds = [...panel.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value);
    if (selectedIds.length === 0) return;
    const limit = Math.max(1, Math.min(10, parseInt(panel.querySelector('#program-daily-limit').value) || 3));
    const program = createProgram(selectedIds, limit, loadRanges());
    saveProgram(program);
    render();
  });
}

// ============================================
// STATE CALIBRATING
// ============================================

function renderCalibration(container, program) {
  const allRanges = loadRanges();
  const progresses = program.selectedRangeIds.map(id => program.progress[id]);
  const total = progresses.length;
  const done = progresses.filter(p => p && p.calibrationScore !== null).length;

  const panel = document.createElement('div');
  panel.className = 'program-panel';

  panel.innerHTML = `
    <div class="program-panel-title">Programme d'entraînement</div>
    <div class="program-cal-banner">
      <span class="program-cal-banner-icon">◎</span>
      <div class="program-cal-banner-text">
        Phase de calibration — <strong>${done} / ${total}</strong> range${total !== 1 ? 's' : ''} complétée${total !== 1 ? 's' : ''}
      </div>
    </div>
    <div class="program-cal-list" id="program-cal-list"></div>
    <button class="program-reset-link" id="program-reset-btn">Réinitialiser le programme</button>
  `;

  const list = panel.querySelector('#program-cal-list');

  program.selectedRangeIds.forEach(id => {
    const p = program.progress[id];
    const liveRange = allRanges.find(r => r.id === id);

    if (!p) return;

    const row = document.createElement('div');
    row.className = 'program-cal-row';

    const name = liveRange ? liveRange.name : (p.name || id);
    const isDeleted = !liveRange;
    const isDone = p.calibrationScore !== null;

    let statusHtml;
    if (isDeleted) {
      statusHtml = `<span class="program-cal-status not-started">Range supprimée</span>`;
    } else if (isDone) {
      const score = p.calibrationScore;
      const cls = score >= 95 ? 'done-high' : score >= 70 ? 'done-mid' : 'done-low';
      statusHtml = `<span class="program-cal-status ${cls}">${score}%</span>`;
    } else {
      statusHtml = `<span class="program-cal-status not-started">Non commencée</span>`;
    }

    const btnDisabled = isDeleted || isDone ? 'disabled' : '';
    row.innerHTML = `
      <span class="program-cal-name">${escapeHtml(name)}</span>
      ${statusHtml}
      <button class="program-cal-btn" data-range-id="${escapeAttr(id)}" ${btnDisabled}>
        ${isDone ? 'Refaire' : 'Démarrer'}
      </button>
    `;

    // Allow redo of calibration (overwrites score)
    if (!isDeleted) {
      row.querySelector('.program-cal-btn').disabled = false;
    }

    list.appendChild(row);
  });

  container.appendChild(panel);

  // Bind quiz launch buttons
  panel.querySelectorAll('.program-cal-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      const rangeId = btn.dataset.rangeId;
      _launchQuiz(rangeId, {
        onComplete: (id, score) => {
          const prog = loadProgram();
          if (!prog) return;
          recordCalibrationScore(prog, id, score);
          const updated = loadProgram();
          if (updated && updated.status === 'ACTIVE') {
            showToast('Calibration terminée — programme activé !');
          } else {
            showToast(`Calibration : ${score}%`);
          }
          render();
        },
        onBack: () => {
          window.navigateTo('dashboard');
          render();
        },
      });
    });
  });

  // Reset
  panel.querySelector('#program-reset-btn').addEventListener('click', () => {
    if (window.confirm('Réinitialiser le programme ? Toutes les données de progression seront perdues.')) {
      deleteProgram();
      render();
    }
  });
}

// ============================================
// STATE ACTIVE
// ============================================

function renderActive(container, program) {
  const allRanges = loadRanges();
  const { due, reinforcement } = getDailyPlan(program);
  const today = todayStr();

  const panel = document.createElement('div');
  panel.className = 'program-panel';

  const totalToday = due.length + reinforcement.length;
  panel.innerHTML = `
    <div class="program-today-header">
      Aujourd'hui <span>(${due.length} dû${due.length !== 1 ? 's' : ''} · ${reinforcement.length} renforcement${reinforcement.length !== 1 ? 's' : ''})</span>
    </div>
    <div class="program-range-cards" id="program-due-cards"></div>
    <button class="program-reset-link" id="program-reset-btn">Réinitialiser le programme</button>
  `;

  const dueCards = panel.querySelector('#program-due-cards');

  if (due.length === 0 && reinforcement.length === 0) {
    dueCards.innerHTML = '<div class="program-empty-today">Tout est à jour — reviens demain !</div>';
  } else {
    if (due.length > 0) {
      const dueLabel = document.createElement('div');
      dueLabel.className = 'program-section-label';
      dueLabel.textContent = 'À réviser';
      dueCards.appendChild(dueLabel);
      due.forEach(p => dueCards.appendChild(buildRangeCard(p, allRanges, today, false)));
    }
    if (reinforcement.length > 0) {
      const reinLabel = document.createElement('div');
      reinLabel.className = 'program-section-label';
      reinLabel.textContent = 'Renforcement';
      dueCards.appendChild(reinLabel);
      reinforcement.forEach(p => dueCards.appendChild(buildRangeCard(p, allRanges, today, true)));
    }
  }

  container.appendChild(panel);

  // Bind buttons
  panel.querySelectorAll('[data-action="start"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const rangeId = btn.dataset.rangeId;
      _launchQuiz(rangeId, {
        onComplete: (id, score) => {
          const prog = loadProgram();
          if (!prog) return;
          const { intervalDays } = recordActiveScore(prog, id, score);
          showToast(`Score : ${score} — Prochaine révision dans ${intervalDays} jour${intervalDays !== 1 ? 's' : ''}`);
          render();
        },
        onBack: () => {
          window.navigateTo('dashboard');
          render();
        },
      });
    });
  });

  panel.querySelectorAll('[data-action="skip"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const rangeId = btn.dataset.rangeId;
      const prog = loadProgram();
      if (prog) {
        skipRange(prog, rangeId);
        render();
      }
    });
  });

  panel.querySelector('#program-reset-btn').addEventListener('click', () => {
    if (window.confirm('Réinitialiser le programme ? Toutes les données de progression seront perdues.')) {
      deleteProgram();
      render();
    }
  });
}

function buildRangeCard(p, allRanges, today, isReinforcement) {
  const liveRange = allRanges.find(r => r.id === p.rangeId);
  const name = liveRange ? liveRange.name : (p.name || p.rangeId);
  const isDeleted = !liveRange;

  const card = document.createElement('div');
  card.className = `program-range-card${isReinforcement ? ' reinforcement' : ''}`;

  // Due status badge
  let dueBadge = '';
  if (isReinforcement) {
    dueBadge = `<span class="program-due-badge reinforcement">Renforcement</span>`;
  } else if (p.nextDue && p.nextDue < today) {
    const days = daysOverdue(p.nextDue);
    dueBadge = `<span class="program-due-badge overdue">En retard de ${days} j</span>`;
  } else {
    dueBadge = `<span class="program-due-badge due-today">Dû aujourd'hui</span>`;
  }

  // Stats chips
  const chips = [];
  if (p.lastScore !== null) {
    const score = p.lastScore;
    const scoreCls = score >= 95 ? 'score-high' : score >= 70 ? 'score-mid' : 'score-low';
    chips.push(`<span class="program-stat-chip ${scoreCls}">Score : ${score}%</span>`);
  }
  if (p.interval !== null) {
    chips.push(`<span class="program-stat-chip">Intervalle : ${p.interval}j</span>`);
  }
  if (p.streak98 > 0) {
    chips.push(`<span class="program-stat-chip streak">Streak : ${p.streak98}</span>`);
  }
  if (p.nextDue) {
    const nextLabel = p.nextDue > today ? `Prochain : ${formatDate(p.nextDue)}` : `Échéance : ${formatDate(p.nextDue)}`;
    chips.push(`<span class="program-stat-chip">${nextLabel}</span>`);
  }

  card.innerHTML = `
    <div class="program-range-card-top">
      <span class="program-range-card-name">${escapeHtml(name)}</span>
      ${dueBadge}
    </div>
    <div class="program-range-stats">${chips.join('')}</div>
    <div class="program-range-actions">
      <button class="program-btn-start" data-action="start" data-range-id="${escapeAttr(p.rangeId)}" ${isDeleted ? 'disabled' : ''}>
        Démarrer →
      </button>
      <button class="program-btn-skip" data-action="skip" data-range-id="${escapeAttr(p.rangeId)}" ${isDeleted ? 'disabled' : ''}>
        Passer
      </button>
    </div>
  `;

  return card;
}

// ============================================
// UTILS
// ============================================

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str ?? '').replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  } catch {
    return dateStr;
  }
}
