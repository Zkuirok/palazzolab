/* ============================================
   PokerLab — Colosseum
   Standard range quiz (100-hand graded session)
   ============================================ */

import { HANDS_MATRIX, getHandCombos, RANKS } from './poker-hands.js';
import { getSituationLabel } from './range-config.js';
import { getDepthLabel } from './range-model.js';

// === CONSTANTS ===

const SESSION_SIZE = 100;
const SUITS = ['heart', 'diamond', 'spade', 'club'];
const HISTORY_KEY = 'pokerlab_colosseum_history';
const MAX_HISTORY = 5; // sessions kept per range

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

  document.getElementById('btn-colosseum-eye').addEventListener('click', () => {
    if (activeRange && currentHandIndex !== null) {
      document.getElementById('btn-colosseum-eye').classList.toggle('active');
      showRangePreview();
    }
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
  startSession(range);
  _showGameView();
}

// === RANGE SELECTION ===

export function openColosseumSelect(allRanges) {
  activeRange = null;
  const list = document.getElementById('colosseum-range-list');
  const startBtn = document.getElementById('btn-colosseum-start');
  const warningEl = document.getElementById('colosseum-warning');
  list.innerHTML = '';
  startBtn.disabled = true;
  warningEl.style.display = 'none';

  // Filter: no Nash, no GTO (any cell with array value)
  const standardRanges = allRanges.filter(r =>
    r.type !== 'nash' &&
    !Object.values(r.cells || {}).some(v => Array.isArray(v))
  );

  if (standardRanges.length === 0) {
    list.innerHTML = `
      <div class="colosseum-empty-state">
        <div class="empty-icon">⚔</div>
        <p>Aucune range disponible.<br>Crée d'abord une range dans <strong>Mes Ranges</strong>.</p>
      </div>`;
    return;
  }

  const history = loadHistory();

  standardRanges.forEach(range => {
    const eligible = buildEligibleHands(range);
    const assignedCount = Object.values(range.cells || {}).filter(v => !Array.isArray(v)).length;
    const situationLabel = getSituationLabel(range.situation) || range.situation || '';
    const depthLabel = getDepthLabel(range);
    const rangeHistory = history[range.id] || [];

    const card = document.createElement('div');
    card.className = 'colosseum-range-card';

    const historyHtml = rangeHistory.length > 0 ? `
      <button class="colosseum-history-toggle" type="button">
        Historique (${rangeHistory.length}) ▾
      </button>
      <div class="colosseum-history-panel" style="display:none">
        ${[...rangeHistory].reverse().map(s => {
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
          <div class="colosseum-range-meta">${escapeHtml(situationLabel)} · ${escapeHtml(depthLabel)} · ${assignedCount}/169 mains</div>
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

  // Random hand (combo-weighted)
  currentHandIndex = eligibleHands[Math.floor(Math.random() * eligibleHands.length)];
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

  if (isCorrect) correctCount++;
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
  const isLast = handsDone >= SESSION_SIZE;
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
  if (countEl) countEl.textContent = `${handsDone} / ${SESSION_SIZE}`;
  const fillEl = document.getElementById('colosseum-progress-fill');
  if (fillEl) fillEl.style.width = `${(handsDone / SESSION_SIZE) * 100}%`;
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
    btn.textContent = def.label.toUpperCase();
    btn.dataset.actionIdx = idx;
    btn.dataset.actionLabel = def.label;
    // Opaque action color background with white text
    btn.style.background = def.color;
    btn.style.borderColor = def.color;
    btn.style.color = '#ffffff';
    btn.style.textShadow = '0 1px 2px rgba(0,0,0,0.4)';
    btn.addEventListener('click', () => handleAnswer(def.label, idx));
    row.appendChild(btn);
  });
}

// === END SCREEN ===

function showEndScreen() {
  const accuracy = Math.round(correctCount / SESSION_SIZE * 100);
  const grade = GRADES.find(g => accuracy >= g.min)?.label ?? GRADES[GRADES.length - 1].label;

  // Save to history
  const history = loadHistory();
  if (!history[activeRange.id]) history[activeRange.id] = [];
  history[activeRange.id].push({ date: new Date().toISOString(), correct: correctCount, total: SESSION_SIZE });
  if (history[activeRange.id].length > MAX_HISTORY) {
    history[activeRange.id] = history[activeRange.id].slice(-MAX_HISTORY);
  }
  saveHistory(history);

  // Populate end overlay
  document.getElementById('colosseum-end-range-name').textContent = activeRange.name;
  document.getElementById('colosseum-end-accuracy-val').textContent = `${accuracy}%`;
  document.getElementById('colosseum-end-detail').textContent = `${correctCount} / ${SESSION_SIZE} correctes`;
  document.getElementById('colosseum-end-grade').textContent = grade;
  document.getElementById('colosseum-end-overlay').style.display = '';

  // Notify program scheduler (once per session)
  if (_onComplete && !_completeFired) {
    _completeFired = true;
    _onComplete(activeRange.id, accuracy);
  }
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

// === HISTORY ===

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
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
