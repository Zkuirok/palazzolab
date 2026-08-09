/* ============================================
   PokerLab — Dashboard Program Controller
   Spaced repetition program UI (Aujourd'hui / Suivi / Gérer)
   ============================================ */

import { loadRanges, saveRanges, downloadJson } from './range-model.js';
import { getSituationLabel } from './range-config.js';
import { showToast } from './toast.js';
import {
  loadSessionHistory,
  getSessions,
  aggregateMistakes,
  mergeSessionHistory,
} from './session-history.js';
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
  daysOverdue,
  addRangesToProgram,
  removeRangeFromProgram,
  setDailyLimit,
  getPendingCalibration,
  getMasteryLevel,
  buildProgramBundle,
  parseProgramBundle,
} from './program.js';

let _launchQuiz = null;
let _activeTab = 'today';       // 'today' | 'tracking' | 'manage'
let _trackingSort = 'weak';     // 'weak' | 'strong' | 'due' | 'name'
const _expandedRows = new Set(); // range ids whose mistake panel is open
let _pendingFeedback = null;     // survives the re-render that follows an import

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
    _activeTab = 'today';
    renderSetup(container);
    flushPendingFeedback(container);
    return;
  }

  container.appendChild(buildTabBar(program));

  const body = document.createElement('div');
  body.id = 'program-tab-body';
  container.appendChild(body);

  if (_activeTab === 'tracking') {
    renderTracking(body, program);
  } else if (_activeTab === 'manage') {
    renderManage(body, program);
  } else if (program.status === 'CALIBRATING') {
    renderCalibration(body, program);
  } else {
    renderActive(body, program);
  }

  flushPendingFeedback(container);
}

// A render() wipes the container, so an import summary written before it would
// be lost — replay it onto whichever feedback slot the new markup exposes.
function flushPendingFeedback(container) {
  if (!_pendingFeedback) return;
  const el = container.querySelector('#program-io-feedback')
    || container.querySelector('#program-setup-feedback');
  if (el) setFeedback(el, _pendingFeedback.message, _pendingFeedback.kind);
  _pendingFeedback = null;
}

function buildTabBar(program) {
  const bar = document.createElement('div');
  bar.className = 'program-tabs';

  let todayBadge = '';
  if (program.status === 'ACTIVE') {
    const { due } = getDailyPlan(program);
    if (due.length > 0) todayBadge = `<span class="program-tab-badge">${due.length}</span>`;
  } else {
    const pending = getPendingCalibration(program).length;
    if (pending > 0) todayBadge = `<span class="program-tab-badge">${pending}</span>`;
  }

  const tabs = [
    { key: 'today', label: "Aujourd'hui", badge: todayBadge },
    { key: 'tracking', label: 'Suivi', badge: '' },
    { key: 'manage', label: 'Gérer', badge: '' },
  ];

  bar.innerHTML = tabs.map(t => `
    <button class="program-tab${_activeTab === t.key ? ' active' : ''}" data-tab="${t.key}">
      ${t.label}${t.badge}
    </button>`).join('');

  bar.querySelectorAll('.program-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeTab = btn.dataset.tab;
      render();
    });
  });

  return bar;
}

// Ranges usable in the program: standard only (no Nash, no GTO frequency ranges)
function eligibleRanges(allRanges = null) {
  return (allRanges || loadRanges()).filter(r =>
    r.type !== 'nash' &&
    !Object.values(r.cells || {}).some(v => Array.isArray(v))
  );
}

// ============================================
// STATE 0: SETUP FORM
// ============================================

function renderSetup(container) {
  const eligible = eligibleRanges();

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
    <div class="program-setup-restore">
      <span>Tu as déjà une sauvegarde ?</span>
      <button class="program-link-btn" id="program-setup-import">Importer un programme</button>
      <input type="file" id="program-setup-file" accept="application/json,.json" style="display:none">
    </div>
    <div class="program-io-feedback" id="program-setup-feedback"></div>
  `;

  const listEl = panel.querySelector('#program-range-list');

  if (eligible.length === 0) {
    listEl.innerHTML = '<div class="program-empty-ranges">Aucune range standard disponible. Crée d\'abord des ranges dans <strong>Mes Ranges</strong>.</div>';
  } else {
    eligible.forEach(range => {
      listEl.appendChild(buildCheckRow(range));
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

  // Restore from a backup file
  const fileInput = panel.querySelector('#program-setup-file');
  panel.querySelector('#program-setup-import').addEventListener('click', () => fileInput.click());
  bindBundleImport(fileInput, panel.querySelector('#program-setup-feedback'));
}

function buildCheckRow(range) {
  const row = document.createElement('label');
  row.className = 'program-range-check-row';
  row.innerHTML = `
    <input type="checkbox" value="${escapeAttr(range.id)}">
    <span class="program-range-check-label">${escapeHtml(range.name)}</span>
    <span class="program-range-check-meta">${escapeHtml(getSituationLabel(range.situation) || range.situation || '')}</span>
  `;
  return row;
}

// ============================================
// TAB: TODAY — CALIBRATING
// ============================================

function renderCalibration(container, program) {
  const allRanges = loadRanges();
  const progresses = program.selectedRangeIds.map(id => program.progress[id]).filter(Boolean);
  const total = progresses.length;
  const done = progresses.filter(p => p.calibrationScore !== null).length;

  const panel = document.createElement('div');
  panel.className = 'program-panel';

  panel.innerHTML = `
    <div class="program-panel-title">Calibration</div>
    <div class="program-cal-banner">
      <span class="program-cal-banner-icon">◎</span>
      <div class="program-cal-banner-text">
        Phase de calibration — <strong>${done} / ${total}</strong> range${total !== 1 ? 's' : ''} complétée${total !== 1 ? 's' : ''}
      </div>
    </div>
    <div class="program-cal-list" id="program-cal-list"></div>
  `;

  const list = panel.querySelector('#program-cal-list');

  program.selectedRangeIds.forEach(id => {
    const p = program.progress[id];
    if (!p) return;
    list.appendChild(buildCalibrationRow(p, allRanges));
  });

  container.appendChild(panel);
  bindCalibrationButtons(panel);
}

function buildCalibrationRow(p, allRanges) {
  const liveRange = allRanges.find(r => r.id === p.rangeId);
  const name = liveRange ? liveRange.name : (p.name || p.rangeId);
  const isDeleted = !liveRange;
  const isDone = p.calibrationScore !== null;

  const row = document.createElement('div');
  row.className = 'program-cal-row';

  let statusHtml;
  if (isDeleted) {
    statusHtml = `<span class="program-cal-status not-started">Range supprimée</span>`;
  } else if (isDone) {
    statusHtml = `<span class="program-cal-status ${scoreClass(p.calibrationScore, 'done')}">${p.calibrationScore}%</span>`;
  } else {
    statusHtml = `<span class="program-cal-status not-started">Non commencée</span>`;
  }

  row.innerHTML = `
    <span class="program-cal-name">${escapeHtml(name)}</span>
    ${statusHtml}
    <button class="program-cal-btn" data-range-id="${escapeAttr(p.rangeId)}" ${isDeleted ? 'disabled' : ''}>
      ${isDone ? 'Refaire' : 'Démarrer'}
    </button>
  `;

  return row;
}

function bindCalibrationButtons(scope) {
  scope.querySelectorAll('.program-cal-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      _launchQuiz(btn.dataset.rangeId, {
        onComplete: handleQuizComplete,
        onBack: () => {
          window.navigateTo('program');
          render();
        },
      });
    });
  });
}

// ============================================
// TAB: TODAY — ACTIVE
// ============================================

function renderActive(container, program) {
  const allRanges = loadRanges();
  const { due, reinforcement } = getDailyPlan(program);
  const pending = getPendingCalibration(program);
  const today = todayStr();

  const panel = document.createElement('div');
  panel.className = 'program-panel';

  panel.innerHTML = `
    <div class="program-today-header">
      Aujourd'hui <span>(${due.length} dû${due.length !== 1 ? 's' : ''} · ${reinforcement.length} renforcement${reinforcement.length !== 1 ? 's' : ''})</span>
    </div>
    <div class="program-range-cards" id="program-due-cards"></div>
  `;

  const dueCards = panel.querySelector('#program-due-cards');

  // Newly added ranges waiting for their first quiz
  if (pending.length > 0) {
    dueCards.appendChild(sectionLabel('À calibrer'));
    const calList = document.createElement('div');
    calList.className = 'program-cal-list';
    pending.forEach(p => calList.appendChild(buildCalibrationRow(p, allRanges)));
    dueCards.appendChild(calList);
  }

  if (due.length === 0 && reinforcement.length === 0 && pending.length === 0) {
    dueCards.innerHTML = '<div class="program-empty-today">Tout est à jour — reviens demain !</div>';
  } else {
    if (due.length > 0) {
      dueCards.appendChild(sectionLabel('À réviser'));
      due.forEach(p => dueCards.appendChild(buildRangeCard(p, allRanges, today, false)));
    }
    if (reinforcement.length > 0) {
      dueCards.appendChild(sectionLabel('Renforcement'));
      reinforcement.forEach(p => dueCards.appendChild(buildRangeCard(p, allRanges, today, true)));
    }
  }

  container.appendChild(panel);

  bindCalibrationButtons(panel);

  panel.querySelectorAll('[data-action="start"]').forEach(btn => {
    btn.addEventListener('click', () => {
      _launchQuiz(btn.dataset.rangeId, {
        onComplete: handleQuizComplete,
        onBack: () => {
          window.navigateTo('program');
          render();
        },
      });
    });
  });

  panel.querySelectorAll('[data-action="skip"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const prog = loadProgram();
      if (prog) {
        skipRange(prog, btn.dataset.rangeId);
        render();
      }
    });
  });
}

function sectionLabel(text) {
  const el = document.createElement('div');
  el.className = 'program-section-label';
  el.textContent = text;
  return el;
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
    dueBadge = `<span class="program-due-badge overdue">En retard de ${daysOverdue(p.nextDue)} j</span>`;
  } else {
    dueBadge = `<span class="program-due-badge due-today">Dû aujourd'hui</span>`;
  }

  // Stats chips
  const chips = [];
  if (p.lastScore !== null) {
    chips.push(`<span class="program-stat-chip ${scoreClass(p.lastScore, 'score')}">Score : ${p.lastScore}%</span>`);
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
// TAB: TRACKING
// ============================================

function buildTrackingRow(p, allRanges, history) {
  const live = allRanges.find(r => r.id === p.rangeId);
  const sessions = getSessions(p.rangeId, history);
  const accs = sessions.map(s => s.accuracy);
  const last = sessions[sessions.length - 1] || null;

  return {
    p,
    live,
    name: live ? live.name : (p.name || p.rangeId),
    isDeleted: !live,
    sessions,
    mastery: getMasteryLevel(p),
    score: p.lastScore ?? (last ? last.accuracy : null),
    avg: accs.length ? Math.round(accs.reduce((a, b) => a + b, 0) / accs.length) : null,
    best: accs.length ? Math.max(...accs) : null,
    delta: (p.lastScore !== null && p.calibrationScore !== null) ? p.lastScore - p.calibrationScore : null,
  };
}

function sortTrackingRows(rows) {
  const byName = (a, b) => a.name.localeCompare(b.name, 'fr');
  const sorters = {
    weak: (a, b) => a.mastery.rank - b.mastery.rank || (a.score ?? 0) - (b.score ?? 0) || byName(a, b),
    strong: (a, b) => b.mastery.rank - a.mastery.rank || (b.score ?? 0) - (a.score ?? 0) || byName(a, b),
    due: (a, b) => String(a.p.nextDue ?? '9999').localeCompare(String(b.p.nextDue ?? '9999')) || byName(a, b),
    name: byName,
  };
  return [...rows].sort(sorters[_trackingSort] || sorters.weak);
}

function renderTracking(container, program) {
  const allRanges = loadRanges();
  const history = loadSessionHistory();
  const rows = Object.values(program.progress).map(p => buildTrackingRow(p, allRanges, history));

  const panel = document.createElement('div');
  panel.className = 'program-panel';

  const scored = rows.filter(r => r.score !== null);
  const avgScore = scored.length
    ? Math.round(scored.reduce((s, r) => s + r.score, 0) / scored.length)
    : null;
  const mastered = rows.filter(r => r.mastery.key === 'mastered' || r.mastery.key === 'solid').length;
  const fragile = rows.filter(r => r.mastery.key === 'fragile').length;
  const totalSessions = rows.reduce((s, r) => s + r.sessions.length, 0);

  const tiles = [
    { value: rows.length, label: 'Ranges suivies' },
    { value: avgScore !== null ? `${avgScore}%` : '—', label: 'Score moyen', cls: avgScore !== null ? scoreClass(avgScore, 'tile') : '' },
    { value: mastered, label: 'Solides' },
    { value: fragile, label: 'Fragiles', cls: fragile > 0 ? 'tile-low' : '' },
    { value: totalSessions, label: 'Sessions' },
  ];

  panel.innerHTML = `
    <div class="program-panel-title">Suivi par range</div>
    <div class="program-track-tiles">
      ${tiles.map(t => `
        <div class="program-track-tile ${t.cls || ''}">
          <span class="program-track-tile-value">${t.value}</span>
          <span class="program-track-tile-label">${escapeHtml(t.label)}</span>
        </div>`).join('')}
    </div>
    <div class="program-track-toolbar">
      <label class="program-track-sort-label" for="program-track-sort">Trier par</label>
      <select id="program-track-sort" class="program-track-sort">
        <option value="weak">Les plus fragiles</option>
        <option value="strong">Les mieux maîtrisées</option>
        <option value="due">Prochaine échéance</option>
        <option value="name">Nom</option>
      </select>
    </div>
    <div class="program-track-list" id="program-track-list"></div>
  `;

  panel.querySelector('#program-track-sort').value = _trackingSort;
  panel.querySelector('#program-track-sort').addEventListener('change', e => {
    _trackingSort = e.target.value;
    render();
  });

  const list = panel.querySelector('#program-track-list');
  if (rows.length === 0) {
    list.innerHTML = '<div class="program-empty-today">Aucune range dans le programme.</div>';
  } else {
    sortTrackingRows(rows).forEach(row => list.appendChild(buildTrackingRowEl(row)));
  }

  container.appendChild(panel);

  // Ranges with a history but outside the program
  const outside = eligibleRanges(allRanges)
    .filter(r => !program.progress[r.id])
    .map(r => ({ range: r, sessions: getSessions(r.id, history) }))
    .filter(x => x.sessions.length > 0);

  if (outside.length > 0) {
    container.appendChild(buildOutsidePanel(outside));
  }

  bindTrackingActions(container);
}

function buildTrackingRowEl(row) {
  const { p, mastery, sessions, score, avg, best, delta } = row;
  const expanded = _expandedRows.has(p.rangeId);
  const mistakes = aggregateMistakes(sessions, 14);

  const el = document.createElement('div');
  el.className = `program-track-row${expanded ? ' expanded' : ''}`;

  const metaChips = [];
  if (avg !== null) metaChips.push(`Moy. ${avg}%`);
  if (best !== null) metaChips.push(`Best ${best}%`);
  metaChips.push(`${sessions.length} session${sessions.length !== 1 ? 's' : ''}`);
  if (p.interval !== null) metaChips.push(`Intervalle ${p.interval}j`);
  if (p.nextDue) metaChips.push(`Prochain ${formatDate(p.nextDue)}`);
  if (p.lastReviewedAt) metaChips.push(`Vu le ${formatDate(p.lastReviewedAt)}`);

  let deltaHtml = '';
  if (delta !== null && delta !== 0) {
    const up = delta > 0;
    const pts = Math.abs(delta);
    deltaHtml = `<span class="program-track-delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${pts} pt${pts > 1 ? 's' : ''}</span>`;
  }

  el.innerHTML = `
    <div class="program-track-main">
      <div class="program-track-identity">
        <span class="program-track-name">${escapeHtml(row.name)}${row.isDeleted ? ' <em class="program-track-deleted">(supprimée)</em>' : ''}</span>
        <span class="program-track-meta">${metaChips.map(escapeHtml).join(' · ')}</span>
      </div>
      <span class="program-track-spark ${score !== null ? scoreClass(score, 'spark') : ''}">${sparkline(sessions)}</span>
      <span class="program-track-score ${score !== null ? scoreClass(score, 'score') : 'score-none'}">
        ${score !== null ? `${score}%` : '—'}
      </span>
      ${deltaHtml}
      <span class="program-mastery-badge mastery-${mastery.key}">${mastery.label}</span>
      <button class="program-track-toggle" data-toggle-id="${escapeAttr(p.rangeId)}" ${mistakes.length === 0 ? 'disabled' : ''}>
        ${mistakes.length === 0 ? 'Aucune erreur' : `Erreurs (${mistakes.length}) ${expanded ? '▴' : '▾'}`}
      </button>
      <button class="program-track-quiz" data-quiz-id="${escapeAttr(p.rangeId)}" ${row.isDeleted ? 'disabled' : ''}>Réviser</button>
    </div>
    <div class="program-track-detail" style="display:${expanded ? '' : 'none'}">
      <div class="program-track-detail-title">Mains les plus ratées</div>
      <div class="program-track-mistakes">
        ${mistakes.map(m => `
          <span class="program-mistake-chip">
            <strong>${escapeHtml(m.hand)}</strong>
            <span class="program-mistake-flow">${escapeHtml(m.chosen)} → ${escapeHtml(m.correct)}</span>
            <span class="program-mistake-count">×${m.count}</span>
          </span>`).join('')}
      </div>
    </div>
  `;

  return el;
}

function buildOutsidePanel(outside) {
  const panel = document.createElement('div');
  panel.className = 'program-panel';
  panel.innerHTML = `
    <div class="program-panel-title">Hors programme</div>
    <p class="program-setup-intro">Ranges déjà travaillées au Colosseum mais absentes du programme.</p>
    <div class="program-track-list" id="program-outside-list"></div>
  `;

  const list = panel.querySelector('#program-outside-list');
  outside
    .sort((a, b) => {
      const la = a.sessions[a.sessions.length - 1].accuracy;
      const lb = b.sessions[b.sessions.length - 1].accuracy;
      return la - lb;
    })
    .forEach(({ range, sessions }) => {
      const last = sessions[sessions.length - 1];
      const el = document.createElement('div');
      el.className = 'program-track-row';
      el.innerHTML = `
        <div class="program-track-main">
          <div class="program-track-identity">
            <span class="program-track-name">${escapeHtml(range.name)}</span>
            <span class="program-track-meta">${sessions.length} session${sessions.length !== 1 ? 's' : ''} · dernière le ${escapeHtml(formatDateTime(last.date))}</span>
          </div>
          <span class="program-track-spark ${scoreClass(last.accuracy, 'spark')}">${sparkline(sessions)}</span>
          <span class="program-track-score ${scoreClass(last.accuracy, 'score')}">${last.accuracy}%</span>
          <button class="program-track-quiz" data-add-id="${escapeAttr(range.id)}">+ Au programme</button>
        </div>`;
      list.appendChild(el);
    });

  return panel;
}

function bindTrackingActions(scope) {
  scope.querySelectorAll('[data-toggle-id]:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.toggleId;
      if (_expandedRows.has(id)) _expandedRows.delete(id);
      else _expandedRows.add(id);
      render();
    });
  });

  scope.querySelectorAll('[data-quiz-id]:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      _launchQuiz(btn.dataset.quizId, {
        onComplete: handleQuizComplete,
        onBack: () => {
          window.navigateTo('program');
          render();
        },
      });
    });
  });

  scope.querySelectorAll('[data-add-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const prog = loadProgram();
      if (!prog) return;
      addRangesToProgram(prog, [btn.dataset.addId], loadRanges());
      showToast('Range ajoutée — un quiz de calibration la planifiera.');
      render();
    });
  });
}

// ============================================
// TAB: MANAGE
// ============================================

function renderManage(container, program) {
  const allRanges = loadRanges();
  const inProgram = Object.values(program.progress);
  const available = eligibleRanges(allRanges).filter(r => !program.progress[r.id]);

  // --- Rhythm ---
  const rhythm = document.createElement('div');
  rhythm.className = 'program-panel';
  rhythm.innerHTML = `
    <div class="program-panel-title">Rythme</div>
    <div class="program-limit-row">
      <span class="program-limit-label">Ranges / jour :</span>
      <input type="number" id="program-manage-limit" class="program-limit-input" value="${program.dailyLimit}" min="1" max="10">
      <button class="program-cal-btn" id="program-manage-limit-save">Enregistrer</button>
      <span class="program-limit-hint">s'applique aux prochaines planifications</span>
    </div>
  `;
  container.appendChild(rhythm);

  // --- Ranges in the program ---
  const current = document.createElement('div');
  current.className = 'program-panel';
  current.innerHTML = `
    <div class="program-panel-title">Ranges du programme (${inProgram.length})</div>
    <div class="program-manage-list" id="program-manage-list"></div>
  `;
  const list = current.querySelector('#program-manage-list');

  inProgram
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'))
    .forEach(p => {
      const live = allRanges.find(r => r.id === p.rangeId);
      const mastery = getMasteryLevel(p);
      const row = document.createElement('div');
      row.className = 'program-manage-row';
      row.innerHTML = `
        <span class="program-manage-name">
          ${escapeHtml(live ? live.name : (p.name || p.rangeId))}
          ${live ? '' : '<em class="program-track-deleted">(supprimée)</em>'}
        </span>
        <span class="program-mastery-badge mastery-${mastery.key}">${mastery.label}</span>
        <span class="program-manage-score ${p.lastScore !== null ? scoreClass(p.lastScore, 'score') : 'score-none'}">
          ${p.lastScore !== null ? `${p.lastScore}%` : '—'}
        </span>
        <button class="program-manage-remove" data-remove-id="${escapeAttr(p.rangeId)}" title="Retirer du programme">✕</button>
      `;
      list.appendChild(row);
    });

  container.appendChild(current);

  // --- Add ranges ---
  const add = document.createElement('div');
  add.className = 'program-panel';
  add.innerHTML = `
    <div class="program-panel-title">Ajouter des ranges</div>
    <div class="program-setup-ranges" id="program-add-list"></div>
    <button class="program-start-btn" id="program-add-btn" disabled>Ajouter au programme</button>
    <p class="program-add-hint">
      Une range ajoutée passe d'abord un quiz de calibration ; le reste du programme continue normalement.
    </p>
  `;
  const addList = add.querySelector('#program-add-list');
  if (available.length === 0) {
    addList.innerHTML = '<div class="program-empty-ranges">Toutes les ranges standard sont déjà dans le programme.</div>';
  } else {
    available.forEach(r => addList.appendChild(buildCheckRow(r)));
  }
  container.appendChild(add);

  // --- Backup ---
  const backup = document.createElement('div');
  backup.className = 'program-panel';
  backup.innerHTML = `
    <div class="program-panel-title">Sauvegarde</div>
    <p class="program-setup-intro">
      L'export contient <strong>le programme, toutes tes ranges et l'historique des sessions</strong> — un seul fichier suffit pour reprendre sur un autre ordinateur.
    </p>
    <div class="program-io-row">
      <button class="program-cal-btn" id="program-export-btn">⤓ Exporter la sauvegarde</button>
      <button class="program-btn-skip" id="program-import-btn">⤒ Importer une sauvegarde</button>
      <input type="file" id="program-import-file" accept="application/json,.json" style="display:none">
    </div>
    <div class="program-io-feedback" id="program-io-feedback"></div>
  `;
  container.appendChild(backup);

  // --- Danger zone ---
  const danger = document.createElement('div');
  danger.className = 'program-panel program-danger';
  danger.innerHTML = `
    <div class="program-panel-title">Zone de danger</div>
    <p class="program-setup-intro">
      Réinitialiser efface la progression du programme (scores de calibration, intervalles, échéances).
      Tes ranges et l'historique des sessions sont conservés.
    </p>
    <button class="program-reset-link" id="program-reset-btn">Réinitialiser le programme</button>
  `;
  container.appendChild(danger);

  bindManageActions(container);
}

function bindManageActions(container) {
  // Daily limit
  container.querySelector('#program-manage-limit-save').addEventListener('click', () => {
    const prog = loadProgram();
    if (!prog) return;
    setDailyLimit(prog, container.querySelector('#program-manage-limit').value);
    showToast(`Rythme : ${prog.dailyLimit} range${prog.dailyLimit > 1 ? 's' : ''} par jour`);
    render();
  });

  // Remove a range
  container.querySelectorAll('[data-remove-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const prog = loadProgram();
      if (!prog) return;
      if (Object.keys(prog.progress).length <= 1) {
        showToast('Impossible de retirer la dernière range — utilise Réinitialiser.');
        return;
      }
      const p = prog.progress[btn.dataset.removeId];
      const name = p ? (p.name || btn.dataset.removeId) : btn.dataset.removeId;
      if (!window.confirm(`Retirer « ${name} » du programme ?\nLa range et son historique de sessions sont conservés.`)) return;
      removeRangeFromProgram(prog, btn.dataset.removeId);
      showToast('Range retirée du programme.');
      render();
    });
  });

  // Add ranges
  const addBtn = container.querySelector('#program-add-btn');
  const addList = container.querySelector('#program-add-list');
  const updateAddBtn = () => {
    addBtn.disabled = addList.querySelectorAll('input[type="checkbox"]:checked').length === 0;
  };
  addList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', updateAddBtn);
  });
  addBtn.addEventListener('click', () => {
    const ids = [...addList.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value);
    if (ids.length === 0) return;
    const prog = loadProgram();
    if (!prog) return;
    const { added } = addRangesToProgram(prog, ids, loadRanges());
    showToast(`${added} range${added > 1 ? 's' : ''} ajoutée${added > 1 ? 's' : ''} — calibration à faire.`);
    _activeTab = 'today';
    render();
  });

  // Export bundle
  container.querySelector('#program-export-btn').addEventListener('click', () => {
    const ranges = loadRanges();
    const bundle = buildProgramBundle({
      program: loadProgram(),
      ranges,
      history: loadSessionHistory(),
    });
    downloadJson(bundle, `pokerlab-programme-${todayStr()}.json`);
    setFeedback(
      container.querySelector('#program-io-feedback'),
      `✓ Sauvegarde exportée — ${ranges.length} range(s) + programme + historique.`,
      'ok'
    );
  });

  // Import bundle
  const fileInput = container.querySelector('#program-import-file');
  container.querySelector('#program-import-btn').addEventListener('click', () => fileInput.click());
  bindBundleImport(fileInput, container.querySelector('#program-io-feedback'));

  // Reset
  container.querySelector('#program-reset-btn').addEventListener('click', () => {
    if (window.confirm('Réinitialiser le programme ? Toutes les données de progression seront perdues.\nTes ranges et l\'historique des sessions sont conservés.')) {
      deleteProgram();
      _activeTab = 'today';
      render();
    }
  });
}

// ============================================
// BUNDLE IMPORT
// ============================================

function bindBundleImport(fileInput, feedbackEl) {
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInput.value = '';
    setFeedback(feedbackEl, 'Import en cours…', 'neutral');
    try {
      const summary = await importBundleFile(file);
      if (summary.cancelled) {
        setFeedback(feedbackEl, 'Import annulé — rien n\'a été modifié.', 'neutral');
        return;
      }
      const parts = [`${summary.rangesAdded} range(s) importée(s)`];
      if (summary.rangesSkipped > 0) parts.push(`${summary.rangesSkipped} déjà présente(s)`);
      if (summary.sessionsAdded > 0) parts.push(`${summary.sessionsAdded} session(s) d'historique`);
      parts.push(summary.programImported ? 'programme restauré' : 'programme inchangé');
      const message = `✓ ${parts.join(' · ')}.`;
      _pendingFeedback = { message, kind: 'ok' };
      showToast(message.replace('✓ ', 'Import : '));
      render();
    } catch (err) {
      setFeedback(feedbackEl, `✗ ${err.message}`, 'error');
    }
  });
}

async function importBundleFile(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('Fichier illisible (JSON invalide)');
  }

  const { ranges, program, history } = parseProgramBundle(parsed);

  // A program whose ranges are missing would be unusable — confirm before touching anything
  const current = loadProgram();
  let programImported = false;
  if (program && current) {
    if (!window.confirm(
      'Un programme existe déjà sur ce navigateur.\n' +
      'L\'importer remplacera ta progression actuelle (scores, intervalles, échéances).\n\n' +
      'Continuer ?'
    )) {
      return { cancelled: true };
    }
  }

  // 1. Ranges — never overwrite an existing id
  const existing = loadRanges();
  const existingIds = new Set(existing.map(r => r.id));
  const toAdd = ranges.filter(r => r && r.id && !existingIds.has(r.id));
  if (toAdd.length > 0) saveRanges([...existing, ...toAdd]);

  // 2. Session history — merged, deduped on session date
  const { added: sessionsAdded } = mergeSessionHistory(history);

  // 3. Program — replaces the local one
  if (program) {
    saveProgram(program);
    programImported = true;
  }

  return {
    rangesAdded: toAdd.length,
    rangesSkipped: ranges.length - toAdd.length,
    sessionsAdded,
    programImported,
  };
}

// ============================================
// QUIZ COMPLETION
// ============================================

function handleQuizComplete(rangeId, score) {
  const prog = loadProgram();
  if (!prog) return;
  const p = prog.progress[rangeId];
  if (!p) return;

  if (p.calibrationScore === null) {
    const wasCalibrating = prog.status === 'CALIBRATING';
    recordCalibrationScore(prog, rangeId, score);
    if (wasCalibrating && prog.status === 'ACTIVE') {
      showToast('Calibration terminée — programme activé !');
    } else if (p.nextDue) {
      showToast(`Calibration : ${score}% — planifiée le ${formatDate(p.nextDue)}`);
    } else {
      showToast(`Calibration : ${score}%`);
    }
  } else {
    const { intervalDays } = recordActiveScore(prog, rangeId, score);
    showToast(`Score : ${score}% — prochaine révision dans ${intervalDays} jour${intervalDays !== 1 ? 's' : ''}`);
  }

  render();
}

// ============================================
// UTILS
// ============================================

function scoreClass(score, prefix = 'score') {
  const level = score >= 95 ? 'high' : score >= 70 ? 'mid' : 'low';
  if (prefix === 'done') return `done-${level}`;
  if (prefix === 'tile') return `tile-${level}`;
  if (prefix === 'spark') return `spark-${level}`;
  return `score-${level}`;
}

// Inline trend line over the last sessions
function sparkline(sessions) {
  const pts = sessions.slice(-12);
  if (pts.length < 2) return '';

  const W = 84, H = 24, PAD = 3;
  const accs = pts.map(s => s.accuracy);
  const lo = Math.max(0, Math.min(...accs) - 4);
  const span = 100 - lo || 1;

  const coords = pts.map((s, i) => {
    const x = PAD + (i / (pts.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((s.accuracy - lo) / span) * (H - PAD * 2);
    return [x.toFixed(1), y.toFixed(1)];
  });

  const [lx, ly] = coords[coords.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <polyline points="${coords.map(c => c.join(',')).join(' ')}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" />
    <circle cx="${lx}" cy="${ly}" r="2.3" fill="currentColor" />
  </svg>`;
}

function setFeedback(el, message, kind) {
  if (!el) return;
  el.textContent = message;
  el.className = `program-io-feedback ${kind}`;
}

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

function formatDateTime(isoString) {
  try {
    return new Date(isoString).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  } catch {
    return isoString;
  }
}
