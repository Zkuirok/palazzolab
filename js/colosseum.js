/* ============================================
   PokerLab — Colosseum
   Standard range quiz (100-hand graded session)
   ============================================ */

import { HANDS_MATRIX, getHandCombos, RANKS } from './poker-hands.js';
import { getSituationLabel } from './range-config.js';
import { getDepthLabel } from './range-model.js';
import { loadSessionHistory, recordSession } from './session-history.js';

// === CONSTANTS ===

const SESSION_SIZES = [25, 50, 100];
const DEFAULT_SESSION_SIZE = 100;
const SUITS = ['heart', 'diamond', 'spade', 'club'];
const FILTERS_KEY = 'pokerlab_colosseum_filters';

const GRADES = [
  { min: 95, label: 'IMPERATOR' },
  { min: 85, label: 'VENI VIDI VICI' },
  { min: 70, label: 'ALEA IACTA EST' },
  { min: 0,  label: 'Entraîne-toi encore' },
];

// === STATE ===

let activeRange = null;
let eligibleHands = [];
let handsDone = 0;
let correctCount = 0;
let currentHandIndex = null;
let currentCorrectActionIdx = null;
let currentStack = null;
let answering = true;

let _onBack = null;
let _showGameView = null;
let _showSelectView = null;
let _onComplete = null;
let _completeFired = false;

let recentHands = [];
let _autoAdvanceTimer = null;

let _selectRanges = []; // standard ranges available in the select view
let sessionSize = DEFAULT_SESSION_SIZE;

// Learning aids: mistakes of the current session + retry queue
let sessionMistakes = [];   // { handIndex, chosenIdx, correctIdx }
let actionStats = [];       // per actionDef: { asked, correct }
let retryQueue = [];        // { handIndex, dueAt } — missed hands come back

// === INIT ===

export function initColosseum({ onBack, showGameView, showSelectView, onComplete = null }) {
  _onBack = onBack;
  _showGameView = showGameView;
  _showSelectView = showSelectView;
  _onComplete = onComplete;

  document.getElementById('btn-colosseum-back').addEventListener('click', () => {
    _onBack();
  });

  document.getElementById('btn-colosseum-start').addEventListener('click', () => {
    if (!activeRange) return;
    startSession(activeRange);
    _showGameView();
  });

  document.getElementById('btn-colosseum-quit').addEventListener('click', () => {
    document.getElementById('colosseum-end-overlay').style.display = 'none';
    _showSelectView();
  });

  document.getElementById('btn-colosseum-replay').addEventListener('click', () => {
    document.getElementById('colosseum-end-overlay').style.display = 'none';
    startSession(activeRange);
  });

  document.getElementById('btn-colosseum-end-back').addEventListener('click', () => {
    document.getElementById('colosseum-end-overlay').style.display = 'none';
    _showSelectView();
  });

  document.getElementById('btn-colosseum-end-review').addEventListener('click', () => {
    if (activeRange) showRangePreview();
  });

  document.getElementById('btn-colosseum-eye').addEventListener('click', () => {
    if (activeRange && currentHandIndex !== null) {
      document.getElementById('btn-colosseum-eye').classList.toggle('active');
      showRangePreview();
    }
  });

  // Select-view filters: persist + re-render on change
  ['colosseum-filter-opponent', 'colosseum-filter-situation', 'colosseum-filter-depth'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      saveCurrentSelectPrefs();
      renderSelectList();
    });
  });

  // Session size chips
  document.querySelectorAll('#colosseum-size-select .size-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      sessionSize = parseInt(chip.dataset.size, 10) || DEFAULT_SESSION_SIZE;
      document.querySelectorAll('#colosseum-size-select .size-chip').forEach(c =>
        c.classList.toggle('active', c === chip));
      saveCurrentSelectPrefs();
    });
  });

  // Keyboard shortcuts: 1–9 answer, Space/Enter fast-forwards the feedback delay
  document.addEventListener('keydown', handleGameKeydown);
}

function handleGameKeydown(e) {
  const gameVisible = document.getElementById('colosseum-game-view').style.display !== 'none';
  if (!gameVisible || !activeRange) return;
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const endVisible = document.getElementById('colosseum-end-overlay').style.display !== 'none';
  if (endVisible) return;

  if (answering && /^[1-9]$/.test(e.key)) {
    const idx = parseInt(e.key, 10) - 1;
    const btn = document.querySelector(`.colosseum-action-btn[data-action-idx="${idx}"]`);
    if (btn && !btn.disabled) {
      e.preventDefault();
      btn.click();
    }
  } else if (!answering && (e.key === ' ' || e.key === 'Enter') && _autoAdvanceTimer) {
    // Skip the feedback delay
    e.preventDefault();
    clearTimeout(_autoAdvanceTimer);
    _autoAdvanceTimer = null;
    if (handsDone >= sessionSize) showEndScreen();
    else dealNextHand();
  }
}

function saveCurrentSelectPrefs() {
  saveSelectFilters({
    opponent: document.getElementById('colosseum-filter-opponent').value,
    situation: document.getElementById('colosseum-filter-situation').value,
    depth: document.getElementById('colosseum-filter-depth').value,
    size: sessionSize,
  });
}

// === RECONFIGURE (for dashboard deep-link launches) ===

export function reconfigureColosseum({ onBack, showSelectView, onComplete } = {}) {
  if (onBack !== undefined) _onBack = onBack;
  if (showSelectView !== undefined) _showSelectView = showSelectView;
  if (onComplete !== undefined) _onComplete = onComplete;
}

export function launchColosseumForRange(range) {
  _completeFired = false;
  activeRange = range;
  // Respect the user's preferred session size even without visiting the picker
  const saved = loadSelectFilters();
  sessionSize = SESSION_SIZES.includes(saved.size) ? saved.size : DEFAULT_SESSION_SIZE;
  startSession(range);
  _showGameView();
}

// === RANGE SELECTION ===

export function openColosseumSelect(allRanges) {
  activeRange = null;

  // Filter: no Nash, no GTO frequency format (any cell with array value)
  _selectRanges = allRanges.filter(r =>
    r.type !== 'nash' &&
    !Object.values(r.cells || {}).some(v => Array.isArray(v))
  );

  populateSelectFilters();
  renderSelectList();
}

// === SELECT-VIEW FILTERS ===

function loadSelectFilters() {
  try {
    return JSON.parse(localStorage.getItem(FILTERS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveSelectFilters(filters) {
  localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
}

function populateSelectFilters() {
  const saved = loadSelectFilters();

  // Situations (positions) present in available ranges
  const sitSelect = document.getElementById('colosseum-filter-situation');
  const sitIds = [...new Set(_selectRanges.map(r => r.situation).filter(Boolean))];
  sitSelect.innerHTML = '<option value="">Toutes positions</option>';
  sitIds.forEach(id => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = getSituationLabel(id) || id;
    sitSelect.appendChild(opt);
  });
  sitSelect.value = sitIds.includes(saved.situation) ? saved.situation : '';

  // Stack depths present in available ranges (sorted by depthMin)
  const depthSelect = document.getElementById('colosseum-filter-depth');
  const depthMap = new Map();
  _selectRanges.forEach(r => {
    const label = getDepthLabel(r);
    if (!depthMap.has(label)) depthMap.set(label, r.depthMin ?? 0);
  });
  const depths = [...depthMap.entries()].sort((a, b) => a[1] - b[1]).map(([label]) => label);
  depthSelect.innerHTML = '<option value="">Tous stacks</option>';
  depths.forEach(label => {
    const opt = document.createElement('option');
    opt.value = label;
    opt.textContent = label;
    depthSelect.appendChild(opt);
  });
  depthSelect.value = depths.includes(saved.depth) ? saved.depth : '';

  // Opponent (static options)
  document.getElementById('colosseum-filter-opponent').value = saved.opponent || '';

  // Session size
  sessionSize = SESSION_SIZES.includes(saved.size) ? saved.size : DEFAULT_SESSION_SIZE;
  document.querySelectorAll('#colosseum-size-select .size-chip').forEach(c =>
    c.classList.toggle('active', parseInt(c.dataset.size, 10) === sessionSize));
}

function renderSelectList() {
  const list = document.getElementById('colosseum-range-list');
  const startBtn = document.getElementById('btn-colosseum-start');
  const warningEl = document.getElementById('colosseum-warning');
  list.innerHTML = '';
  activeRange = null;
  startBtn.disabled = true;
  warningEl.style.display = 'none';

  const oppFilter = document.getElementById('colosseum-filter-opponent').value;
  const sitFilter = document.getElementById('colosseum-filter-situation').value;
  const depthFilter = document.getElementById('colosseum-filter-depth').value;

  const filtered = _selectRanges.filter(r => {
    if (oppFilter && (r.opponentType || 'reg') !== oppFilter) return false;
    if (sitFilter && r.situation !== sitFilter) return false;
    if (depthFilter && getDepthLabel(r) !== depthFilter) return false;
    return true;
  });

  if (filtered.length === 0) {
    const msg = _selectRanges.length === 0
      ? 'Aucune range disponible.<br>Crée d\'abord une range dans <strong>Mes Ranges</strong>.'
      : 'Aucune range ne correspond aux filtres.';
    list.innerHTML = `
      <div class="colosseum-empty-state">
        <div class="empty-icon">⚔</div>
        <p>${msg}</p>
      </div>`;
    return;
  }

  const history = loadSessionHistory();

  filtered.forEach(range => {
    const eligible = buildEligibleHands(range);
    const assignedCount = Object.values(range.cells || {}).filter(v => !Array.isArray(v)).length;
    const situationLabel = getSituationLabel(range.situation) || range.situation || '';
    const depthLabel = getDepthLabel(range);
    const oppLabel = range.opponentType === 'fish' ? 'Fish' : range.opponentType === 'gto' ? 'GTO' : 'Reg';
    const subLabel = range.opponentSubcategory ? ` (${range.opponentSubcategory})` : '';
    const rangeHistory = history[range.id] || [];

    const card = document.createElement('div');
    card.className = 'colosseum-range-card';

    const historyHtml = rangeHistory.length > 0 ? `
      <button class="colosseum-history-toggle" type="button">
        Historique (${rangeHistory.length}) ▾
      </button>
      <div class="colosseum-history-panel" style="display:none">
        ${[...rangeHistory].reverse().slice(0, 10).map(s => {
          const acc = Math.round(s.correct / s.total * 100);
          return `
            <div class="colosseum-history-row">
              <span class="colosseum-history-date">${formatDate(s.date)}</span>
              <span class="colosseum-history-accuracy ${acc >= 85 ? 'acc-good' : acc >= 70 ? 'acc-mid' : 'acc-low'}">${acc}%</span>
              <span class="colosseum-history-detail">${s.correct}/${s.total}</span>
            </div>`;
        }).join('')}
      </div>
    ` : '';

    card.innerHTML = `
      <div class="colosseum-range-main">
        <div class="colosseum-range-info">
          <div class="colosseum-range-name">${escapeHtml(range.name)}</div>
          <div class="colosseum-range-meta">${escapeHtml(situationLabel)} · ${escapeHtml(depthLabel)} · vs ${escapeHtml(oppLabel + subLabel)} · ${assignedCount}/169 mains</div>
        </div>
      </div>
      ${historyHtml}
    `;

    // History toggle
    const toggleBtn = card.querySelector('.colosseum-history-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', e => {
        e.stopPropagation();
        const panel = card.querySelector('.colosseum-history-panel');
        const open = panel.style.display !== 'none';
        panel.style.display = open ? 'none' : '';
        toggleBtn.textContent = open
          ? `Historique (${rangeHistory.length}) ▾`
          : `Historique (${rangeHistory.length}) ▴`;
      });
    }

    // Select range on card click
    card.addEventListener('click', e => {
      if (e.target.classList.contains('colosseum-history-toggle')) return;
      list.querySelectorAll('.colosseum-range-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      activeRange = range;

      if (eligible.length < 5) {
        warningEl.textContent = `Seulement ${assignedCount} main${assignedCount !== 1 ? 's' : ''} assignée${assignedCount !== 1 ? 's' : ''} — le quiz sera limité.`;
        warningEl.style.display = '';
        startBtn.disabled = eligible.length === 0;
      } else {
        warningEl.style.display = 'none';
        startBtn.disabled = false;
      }
    });

    list.appendChild(card);
  });
}

// === ELIGIBLE HANDS ===

function buildEligibleHands(range) {
  const hands = [];
  HANDS_MATRIX.forEach((hand, i) => {
    const cell = (range.cells || {})[i];
    if (cell !== undefined && !Array.isArray(cell)) {
      const weight = getHandCombos(hand);
      for (let w = 0; w < weight; w++) hands.push(i);
    }
  });
  return hands;
}

// === SESSION ===

function startSession(range) {
  _completeFired = false;
  recentHands = [];
  if (_autoAdvanceTimer) { clearTimeout(_autoAdvanceTimer); _autoAdvanceTimer = null; }

  activeRange = range;
  eligibleHands = buildEligibleHands(range);
  handsDone = 0;
  correctCount = 0;
  answering = true;
  sessionMistakes = [];
  retryQueue = [];
  actionStats = range.actionDefs.map(() => ({ asked: 0, correct: 0 }));

  // Situation label
  const situationEl = document.getElementById('colosseum-situation-label');
  if (situationEl) situationEl.textContent = getSituationLabel(range.situation) || range.situation || '';

  renderRecapRangeInfo(range);
  renderRecapPanel();
  renderActionButtons(range);
  updateScoreDisplay();
  updateProgress();
  dealNextHand();
}

function dealNextHand() {
  if (eligibleHands.length === 0) return;
  answering = true;

  // Reset buttons
  document.querySelectorAll('.colosseum-action-btn').forEach(btn => {
    btn.classList.remove('flash-correct', 'flash-wrong');
    btn.disabled = false;
  });

  // Clear inline action feedback
  const feedbackEl = document.getElementById('colosseum-action-feedback');
  if (feedbackEl) { feedbackEl.innerHTML = ''; feedbackEl.classList.remove('aaf-visible'); }

  // Missed hand due for a retry? Otherwise random (combo-weighted)
  let nextHand = null;
  if (retryQueue.length > 0 && retryQueue[0].dueAt <= handsDone) {
    const item = retryQueue.shift();
    if (item.handIndex !== currentHandIndex) {
      nextHand = item.handIndex;
    } else {
      // Avoid dealing the exact same hand twice in a row — postpone it
      retryQueue.push({ handIndex: item.handIndex, dueAt: handsDone + 2 });
    }
  }
  if (nextHand === null) {
    nextHand = eligibleHands[Math.floor(Math.random() * eligibleHands.length)];
  }
  currentHandIndex = nextHand;
  const handName = HANDS_MATRIX[currentHandIndex];

  // Random stack within depthMin–depthMax
  const min = activeRange.depthMin ?? 10;
  const max = activeRange.depthMax ?? min;
  const span = Math.max(0, max - min);
  currentStack = span > 0
    ? Math.round((min + Math.random() * span) * 10) / 10
    : min;

  // Correct action index
  currentCorrectActionIdx = activeRange.cells[currentHandIndex];

  // Stack display
  const stackEl = document.getElementById('colosseum-stack-value');
  if (stackEl) {
    stackEl.style.opacity = '0';
    requestAnimationFrame(() => {
      stackEl.textContent = currentStack.toFixed(1);
      stackEl.style.opacity = '1';
    });
  }

  // Cards
  const container = document.getElementById('colosseum-cards');
  if (container) {
    container.innerHTML = '';
    generateCardPair(handName).forEach(({ rank, suit }) => container.appendChild(renderCard(rank, suit)));
  }
}

function handleAnswer(actionLabel, actionIdx) {
  if (!answering) return;
  answering = false;

  const handName = HANDS_MATRIX[currentHandIndex];
  const isCorrect = actionIdx === currentCorrectActionIdx;
  const correctDef = activeRange.actionDefs[currentCorrectActionIdx];

  if (actionStats[currentCorrectActionIdx]) {
    actionStats[currentCorrectActionIdx].asked++;
    if (isCorrect) actionStats[currentCorrectActionIdx].correct++;
  }

  if (isCorrect) {
    correctCount++;
  } else {
    sessionMistakes.push({ handIndex: currentHandIndex, chosenIdx: actionIdx, correctIdx: currentCorrectActionIdx });
    // Requeue the missed hand a few hands later so it gets re-tested
    retryQueue.push({ handIndex: currentHandIndex, dueAt: handsDone + 3 + Math.floor(Math.random() * 4) });
    retryQueue.sort((a, b) => a.dueAt - b.dueAt);
  }
  handsDone++;

  updateScoreDisplay();
  updateProgress();

  // Flash buttons
  document.querySelectorAll('.colosseum-action-btn').forEach(btn => {
    btn.disabled = true;
    const btnIdx = parseInt(btn.dataset.actionIdx);
    if (btnIdx === currentCorrectActionIdx) {
      btn.classList.add('flash-correct');
    } else if (btnIdx === actionIdx && !isCorrect) {
      btn.classList.add('flash-wrong');
    }
  });

  autoAdvanceFeedback(isCorrect, correctDef, handName, actionIdx);
}

function autoAdvanceFeedback(isCorrect, correctDef, handName, chosenActionIdx) {
  const isLast = handsDone >= sessionSize;
  const chosenDef = activeRange.actionDefs[chosenActionIdx];

  // Update recap sidebar
  addToRecap(handName, isCorrect, chosenDef, correctDef);

  // Show brief inline feedback below action buttons
  const fbEl = document.getElementById('colosseum-action-feedback');
  if (fbEl) {
    if (isCorrect) {
      fbEl.innerHTML = `<span class="aaf-icon aaf-correct">✓</span><span class="aaf-text" style="color:${correctDef.color}">${escapeHtml(correctDef.label.toUpperCase())}</span>`;
    } else {
      fbEl.innerHTML = `<span class="aaf-icon aaf-wrong">✗</span><span class="aaf-text">Était : </span><span class="aaf-text" style="color:${correctDef.color}">${escapeHtml(correctDef.label.toUpperCase())}</span>`;
    }
    fbEl.classList.add('aaf-visible');
  }

  // Auto-advance after short delay
  if (_autoAdvanceTimer) clearTimeout(_autoAdvanceTimer);
  const delay = isLast ? 700 : (isCorrect ? 750 : 1150);
  _autoAdvanceTimer = setTimeout(() => {
    _autoAdvanceTimer = null;
    if (isLast) showEndScreen();
    else dealNextHand();
  }, delay);
}

// === RECAP SIDEBAR ===

function addToRecap(handName, isCorrect, chosenDef, correctDef) {
  recentHands.unshift({ handName, isCorrect, chosenDef, correctDef });
  if (recentHands.length > 12) recentHands.pop();
  renderRecapPanel();
}

function renderRecapPanel() {
  const list = document.getElementById('colosseum-recap-list');
  if (!list) return;
  list.innerHTML = '';

  if (recentHands.length === 0) {
    list.innerHTML = '<div class="colosseum-recap-empty">Joue ta première main →</div>';
    return;
  }

  recentHands.forEach((entry, i) => {
    const el = document.createElement('div');
    el.className = `colosseum-recap-entry${i === 0 ? ' latest' : ''}`;

    const wrongLine = !entry.isCorrect
      ? `<div class="crec-played" style="color:${entry.chosenDef.color}">${escapeHtml(entry.chosenDef.label.toUpperCase())}</div>`
      : '';

    el.innerHTML = `
      <div class="crec-main">
        <span class="crec-result ${entry.isCorrect ? 'correct' : 'wrong'}">${entry.isCorrect ? '✓' : '✗'}</span>
        <span class="crec-hand">${escapeHtml(entry.handName)}</span>
        <span class="crec-action" style="color:${entry.correctDef.color}">${escapeHtml(entry.correctDef.label.toUpperCase())}</span>
      </div>
      ${wrongLine}
    `;
    list.appendChild(el);
  });
}

function renderRecapRangeInfo(range) {
  const el = document.getElementById('colosseum-recap-range-info');
  if (!el) return;
  const situationLabel = getSituationLabel(range.situation) || range.situation || '';
  const depthLabel = getDepthLabel(range);
  el.innerHTML = `
    <div class="crec-range-label">Range</div>
    <div class="crec-range-name">${escapeHtml(range.name)}</div>
    <div class="crec-range-meta">${escapeHtml(situationLabel)} · ${escapeHtml(depthLabel)}</div>
  `;
}

// === SCORE & PROGRESS ===

function updateScoreDisplay() {
  const el = document.getElementById('colosseum-score-correct');
  if (el) el.textContent = correctCount;
  const wrongEl = document.getElementById('colosseum-score-wrong');
  if (wrongEl) wrongEl.textContent = handsDone - correctCount;
}

function updateProgress() {
  const countEl = document.getElementById('colosseum-hand-count');
  if (countEl) countEl.textContent = `${handsDone} / ${sessionSize}`;
  const fillEl = document.getElementById('colosseum-progress-fill');
  if (fillEl) fillEl.style.width = `${(handsDone / sessionSize) * 100}%`;
  const accEl = document.getElementById('colosseum-topbar-accuracy');
  if (accEl) accEl.textContent = handsDone > 0 ? `${Math.round(correctCount / handsDone * 100)}%` : '—%';
}

// === ACTION BUTTONS ===

function renderActionButtons(range) {
  const row = document.getElementById('colosseum-action-row');
  if (!row) return;
  row.innerHTML = '';
  range.actionDefs.forEach((def, idx) => {
    const btn = document.createElement('button');
    btn.className = 'colosseum-action-btn';
    btn.dataset.actionIdx = idx;
    btn.dataset.actionLabel = def.label;
    // Opaque action color background with white text + keyboard hint
    btn.style.background = def.color;
    btn.style.borderColor = def.color;
    btn.style.color = '#ffffff';
    btn.style.textShadow = '0 1px 2px rgba(0,0,0,0.4)';
    btn.innerHTML = `<span class="action-key-hint">${idx + 1}</span>${escapeHtml(def.label.toUpperCase())}`;
    btn.addEventListener('click', () => handleAnswer(def.label, idx));
    row.appendChild(btn);
  });
}

// === END SCREEN ===

function showEndScreen() {
  const accuracy = Math.round(correctCount / sessionSize * 100);
  const grade = GRADES.find(g => accuracy >= g.min)?.label ?? GRADES[GRADES.length - 1].label;

  // Save to history (with mistakes so future reviews can target leaks)
  recordSession(activeRange.id, {
    date: new Date().toISOString(),
    correct: correctCount,
    total: sessionSize,
    mistakes: sessionMistakes.slice(0, 30).map(m => ({
      hand: HANDS_MATRIX[m.handIndex],
      chosen: activeRange.actionDefs[m.chosenIdx]?.label ?? '?',
      correct: activeRange.actionDefs[m.correctIdx]?.label ?? '?',
    })),
  });

  // Populate end overlay
  document.getElementById('colosseum-end-range-name').textContent = activeRange.name;
  document.getElementById('colosseum-end-accuracy-val').textContent = `${accuracy}%`;
  document.getElementById('colosseum-end-detail').textContent = `${correctCount} / ${sessionSize} correctes`;
  document.getElementById('colosseum-end-grade').textContent = grade;
  renderEndActionStats();
  renderEndMistakes();
  document.getElementById('colosseum-end-overlay').style.display = '';

  // Notify program scheduler (once per session)
  if (_onComplete && !_completeFired) {
    _completeFired = true;
    _onComplete(activeRange.id, accuracy);
  }
}

// Per-action accuracy row on the end screen
function renderEndActionStats() {
  const el = document.getElementById('colosseum-end-action-stats');
  if (!el) return;
  el.innerHTML = '';
  activeRange.actionDefs.forEach((def, i) => {
    const s = actionStats[i];
    if (!s || s.asked === 0) return;
    const chip = document.createElement('span');
    chip.className = 'end-action-chip';
    const pct = Math.round(s.correct / s.asked * 100);
    chip.innerHTML = `<span class="end-action-dot" style="background:${def.color}"></span>${escapeHtml(def.label.toUpperCase())} ${s.correct}/${s.asked}${s.asked >= 5 ? ` (${pct}%)` : ''}`;
    el.appendChild(chip);
  });
}

// Missed hands recap on the end screen, grouped and sorted by frequency
function renderEndMistakes() {
  const el = document.getElementById('colosseum-end-mistakes');
  if (!el) return;
  el.innerHTML = '';

  if (sessionMistakes.length === 0) {
    el.innerHTML = '<div class="end-mistakes-none">Sans faute — session parfaite</div>';
    return;
  }

  // Group by hand + chosen action
  const groups = new Map();
  sessionMistakes.forEach(m => {
    const key = `${m.handIndex}|${m.chosenIdx}`;
    if (!groups.has(key)) groups.set(key, { ...m, count: 0 });
    groups.get(key).count++;
  });
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count);
  const MAX_SHOWN = 14;

  const title = document.createElement('div');
  title.className = 'end-mistakes-title';
  title.textContent = `Mains ratées (${sessionMistakes.length})`;
  el.appendChild(title);

  const listEl = document.createElement('div');
  listEl.className = 'end-mistakes-list';
  sorted.slice(0, MAX_SHOWN).forEach(m => {
    const chosen = activeRange.actionDefs[m.chosenIdx];
    const correct = activeRange.actionDefs[m.correctIdx];
    const chip = document.createElement('span');
    chip.className = 'end-mistake-chip';
    chip.innerHTML = `
      <span class="end-mistake-hand">${escapeHtml(HANDS_MATRIX[m.handIndex])}</span>
      <span class="end-mistake-chosen" style="color:${chosen?.color ?? '#a03030'}">${escapeHtml((chosen?.label ?? '?').toUpperCase())}</span>
      <span class="end-mistake-arrow">→</span>
      <span class="end-mistake-correct" style="color:${correct?.color ?? '#3a7a50'}">${escapeHtml((correct?.label ?? '?').toUpperCase())}</span>
      ${m.count > 1 ? `<span class="end-mistake-count">×${m.count}</span>` : ''}`;
    listEl.appendChild(chip);
  });
  if (sorted.length > MAX_SHOWN) {
    const more = document.createElement('span');
    more.className = 'end-mistakes-more';
    more.textContent = `+${sorted.length - MAX_SHOWN} autres`;
    listEl.appendChild(more);
  }
  el.appendChild(listEl);
}

// === RANGE PREVIEW MODAL ===

function showRangePreview() {
  const existing = document.getElementById('colosseum-range-preview-modal');
  if (existing) {
    existing.remove();
    document.getElementById('btn-colosseum-eye')?.classList.remove('active');
    return;
  }

  const modal = document.createElement('div');
  modal.id = 'colosseum-range-preview-modal';
  modal.className = 'range-preview-overlay';

  const panel = document.createElement('div');
  panel.className = 'range-preview-panel ornamented';
  panel.innerHTML = `
    <div class="corner-tl"></div><div class="corner-tr"></div>
    <div class="corner-bl"></div><div class="corner-br"></div>
    <div class="range-preview-header">
      <span class="range-preview-title">${escapeHtml(activeRange.name)}</span>
      <button class="range-preview-close" id="btn-colosseum-preview-close">✕ Fermer</button>
    </div>
  `;

  // Legend row (one swatch per actionDef)
  const legend = document.createElement('div');
  legend.className = 'colosseum-preview-legend';
  activeRange.actionDefs.forEach(def => {
    const item = document.createElement('span');
    item.className = 'colosseum-preview-legend-item';
    item.innerHTML = `<span class="colosseum-preview-swatch" style="background:${def.color}"></span>${escapeHtml(def.label)}`;
    legend.appendChild(item);
  });
  panel.appendChild(legend);

  // 13×13 labeled matrix (same structure as Rubicon)
  const grid = document.createElement('div');
  grid.className = 'nash-labeled-matrix';

  // Corner
  const corner = document.createElement('div');
  corner.className = 'nash-matrix-corner';
  grid.appendChild(corner);

  // Column headers
  RANKS.forEach(r => {
    const lbl = document.createElement('div');
    lbl.className = 'nash-matrix-col-label';
    lbl.textContent = r;
    grid.appendChild(lbl);
  });

  // 13 rows
  RANKS.forEach((rowRank, rowIdx) => {
    const rowLbl = document.createElement('div');
    rowLbl.className = 'nash-matrix-row-label';
    rowLbl.textContent = rowRank;
    grid.appendChild(rowLbl);

    for (let colIdx = 0; colIdx < 13; colIdx++) {
      const i = rowIdx * 13 + colIdx;
      const hand = HANDS_MATRIX[i];
      const cell = document.createElement('div');
      cell.className = 'mini-cell';

      const actionIdx = (activeRange.cells || {})[i];
      if (actionIdx !== undefined && !Array.isArray(actionIdx)) {
        const def = activeRange.actionDefs[actionIdx];
        if (def) {
          cell.classList.add('painted');
          cell.style.background = def.color + 'cc'; // ~80% opacity
          cell.title = `${hand} — ${def.label}`;
          cell.textContent = hand;
        }
      } else {
        cell.textContent = hand;
        cell.title = `${hand} — non défini`;
        cell.style.color = 'rgba(160,140,100,0.35)';
      }

      if (i === currentHandIndex) {
        cell.classList.add('range-preview-highlight');
      }

      grid.appendChild(cell);
    }
  });

  panel.appendChild(grid);
  modal.appendChild(panel);

  const closeModal = () => {
    modal.remove();
    document.getElementById('btn-colosseum-eye')?.classList.remove('active');
  };
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.body.appendChild(modal);
  panel.querySelector('#btn-colosseum-preview-close').addEventListener('click', closeModal);
}

// === CARD RENDERING ===

function generateCardPair(handName) {
  const isPair = handName.length === 2;
  const isSuited = handName.endsWith('s');
  const rank1 = handName[0];
  const rank2 = handName[1];

  let suit1, suit2;
  if (isPair) {
    const s = shuffleSuits();
    suit1 = s[0]; suit2 = s[1];
  } else if (isSuited) {
    suit1 = suit2 = SUITS[Math.floor(Math.random() * SUITS.length)];
  } else {
    const s = shuffleSuits();
    suit1 = s[0]; suit2 = s[1];
    if (suit1 === suit2) suit2 = SUITS[(SUITS.indexOf(suit2) + 1) % SUITS.length];
  }
  return [{ rank: rank1, suit: suit1 }, { rank: rank2, suit: suit2 }];
}

function shuffleSuits() {
  return [...SUITS].sort(() => Math.random() - 0.5);
}

function renderCard(rank, suit) {
  const card = document.createElement('div');
  card.className = `playing-card suit-${suit}`;
  const displayRank = rank === 'T' ? '10' : rank;
  card.innerHTML = `
    <span class="card-rank">${displayRank}</span>
    <img class="card-suit-center" src="assets/game/${suit}.png" alt="${suit}">
    <span class="card-rank-bottom">${displayRank}</span>
  `;
  return card;
}

// === UTILS ===

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function formatDate(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  } catch {
    return isoString;
  }
}
