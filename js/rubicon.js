/* ============================================
   PokerLab — Rubicon
   Nash push/fold quiz mini-game
   ============================================ */

import { HANDS_MATRIX, getHandCombos, RANKS } from './poker-hands.js';
import { nashCellColor } from './range-config.js';

// === CONSTANTS ===

const SUITS = ['heart', 'diamond', 'spade', 'club'];
const RED_SUITS = new Set(['heart', 'diamond']);

const STREAK_MESSAGES = {
  5:  'ALEA IACTA EST',
  10: 'VENI VIDI VICI',
  15: 'GLORIA AETERNA',
  20: 'IMPERATOR',
};

// === STATE ===

let activeRange = null;
let onBackToHub = null;
let onBackToSelect = null;
let onShowGameView = null;

let score = { correct: 0, wrong: 0, streak: 0 };
let currentHandIndex = null;
let currentStack = null;
let answering = true;   // false while showing feedback

// Build a weighted index of all hands that have a defined threshold
let eligibleHands = [];

// === INIT ===

export function initRubicon({ onBackToHub: backHub, onBackToSelect: backSelect, onShowGameView: showGame, onStartChallenge }) {
  onBackToHub = backHub;
  onBackToSelect = backSelect;
  onShowGameView = showGame;

  document.getElementById('btn-rubicon-back-hub').addEventListener('click', () => {
    onBackToHub();
  });

  document.getElementById('btn-rubicon-start').addEventListener('click', () => {
    if (!activeRange) return;
    startSession(activeRange);
    if (onShowGameView) onShowGameView();
  });

  document.getElementById('btn-rubicon-start-challenge').addEventListener('click', () => {
    if (!activeRange) return;
    if (onStartChallenge) onStartChallenge(activeRange);
  });

  document.getElementById('btn-rubicon-quit').addEventListener('click', () => {
    activeRange = null;
    onBackToSelect();
  });

  document.getElementById('btn-view-range-eye').addEventListener('click', () => {
    const btn = document.getElementById('btn-view-range-eye');
    if (activeRange && currentHandIndex !== null) {
      btn.classList.toggle('active');
      showRangePreview();
    }
  });
}

// === RANGE SELECTION ===

export function openRubiconSelect(nashRanges) {
  activeRange = null;
  const list = document.getElementById('rubicon-range-list');
  const startBtn = document.getElementById('btn-rubicon-start');
  const warningEl = document.getElementById('rubicon-warning');
  list.innerHTML = '';
  startBtn.disabled = true;
  document.getElementById('btn-rubicon-start-challenge').disabled = true;
  warningEl.style.display = 'none';

  if (nashRanges.length === 0) {
    list.innerHTML = `
      <div class="rubicon-empty-state">
        <div class="empty-icon">⊞</div>
        <p>Aucune Table Nash trouvée.<br>Crée d'abord une table dans <strong>Mes Ranges</strong>.</p>
      </div>`;
    return;
  }

  nashRanges.forEach(range => {
    const card = document.createElement('div');
    card.className = 'rubicon-range-card';

    const definedCount = Object.keys(range.cells).length;
    const chartLabel = range.chartType === 'call' ? 'Call/Fold' : 'Push/Fold';
    const situationLabel = range.format && range.position ? `${range.format} ${range.position}` : '';

    card.innerHTML = `
      <div class="rubicon-range-info">
        <div class="rubicon-range-name">${escapeHtml(range.name)}</div>
        <div class="rubicon-range-meta">${escapeHtml(situationLabel)} — ${definedCount}/169 mains définies</div>
      </div>
      <span class="rubicon-range-badge ${range.chartType === 'call' ? 'call' : 'push'}">${escapeHtml(chartLabel)}</span>
    `;

    card.addEventListener('click', () => {
      // Deselect all
      list.querySelectorAll('.rubicon-range-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      activeRange = range;
      startBtn.disabled = false;
      document.getElementById('btn-rubicon-start-challenge').disabled = false;

      // Warn if very few hands
      if (definedCount < 5) {
        warningEl.textContent = `Seulement ${definedCount} main${definedCount !== 1 ? 's' : ''} définie${definedCount !== 1 ? 's' : ''} — le quiz sera limité.`;
        warningEl.style.display = '';
      } else {
        warningEl.style.display = 'none';
      }
    });

    list.appendChild(card);
  });
}

// === SESSION ===

function startSession(range) {
  activeRange = range;
  score = { correct: 0, wrong: 0, streak: 0 };
  answering = true;

  // Build weighted eligible hands list
  eligibleHands = [];
  HANDS_MATRIX.forEach((hand, i) => {
    const threshold = range.cells[i];
    if (threshold !== undefined) {
      const weight = getHandCombos(hand);
      for (let w = 0; w < weight; w++) eligibleHands.push(i);
    }
  });

  // Render situation context
  const isCall = range.chartType === 'call';

  // Render positions
  renderPositions(range);

  // Render action buttons
  renderActionButtons(isCall);

  // Update score bar
  updateScoreBar();

  // Deal first hand
  dealNextHand();
}

function dealNextHand() {
  if (eligibleHands.length === 0) return;

  answering = true;

  // Reset button styles
  document.querySelectorAll('.game-action-btn').forEach(btn => {
    btn.classList.remove('flash-correct', 'flash-wrong');
    btn.disabled = false;
  });

  // Clear feedback
  document.getElementById('game-feedback').innerHTML = '';

  // Random stack: 1.5 to 15 in 0.1 steps
  currentStack = Math.round((1.5 + Math.random() * 13.5) * 10) / 10;

  // Random hand (weighted)
  currentHandIndex = eligibleHands[Math.floor(Math.random() * eligibleHands.length)];
  const handName = HANDS_MATRIX[currentHandIndex];

  // Update stack display with brief fade transition
  const stackEl = document.getElementById('game-stack-value');
  stackEl.style.opacity = '0';
  requestAnimationFrame(() => {
    stackEl.textContent = currentStack.toFixed(1);
    stackEl.style.opacity = '1';
  });

  // Generate and render card pair
  const cardPair = generateCardPair(handName);
  renderCards(cardPair);

  // Clear feedback panel for new hand
  document.getElementById('game-feedback').innerHTML = '';
}

function handleAnswer(action) {
  if (!answering) return;
  answering = false;

  const threshold = activeRange.cells[currentHandIndex];
  const handName = HANDS_MATRIX[currentHandIndex];
  const isCall = activeRange.chartType === 'call';
  const correctAction = currentStack <= threshold ? (isCall ? 'call' : 'push') : 'fold';
  const isCorrect = action === correctAction;

  // Update score
  if (isCorrect) {
    score.correct++;
    score.streak++;
  } else {
    score.wrong++;
    score.streak = 0;
  }
  updateScoreBar();

  // Flash the clicked button
  const clickedBtn = document.getElementById(`btn-action-${action}`);
  const correctBtn = document.getElementById(`btn-action-${correctAction}`);
  if (clickedBtn) clickedBtn.classList.add(isCorrect ? 'flash-correct' : 'flash-wrong');
  if (!isCorrect && correctBtn) correctBtn.classList.add('flash-correct');

  // Disable buttons during feedback
  document.querySelectorAll('.game-action-btn').forEach(btn => btn.disabled = true);

  // Show feedback
  renderFeedback(isCorrect, threshold, correctAction, handName);
}

function renderFeedback(isCorrect, threshold, correctAction, handName) {
  const feedbackEl = document.getElementById('game-feedback');
  const thresholdText = threshold >= 999 ? '∞' : `${threshold} BB`;
  const actionLabel = correctAction === 'push' ? 'PUSH' : correctAction === 'call' ? 'CALL' : 'FOLD';

  feedbackEl.innerHTML = `
    <div class="game-feedback-result ${isCorrect ? 'correct' : 'wrong'}">
      ${isCorrect ? '✓' : '✗'}
    </div>
    <div class="game-feedback-hand">${handName}</div>
    <div class="game-feedback-threshold">
      <span class="feedback-threshold-label">Seuil</span>
      <span class="feedback-threshold-val">${thresholdText}</span>
    </div>
    <span class="feedback-action-label">Action</span>
    <span class="feedback-action-val">${actionLabel}</span>
    <button class="game-next-btn" id="btn-next-hand" style="margin-top:6px;">Suivante →</button>
  `;

  document.getElementById('btn-next-hand').addEventListener('click', dealNextHand);
}

function showRangePreview() {
  // Toggle: clicking again removes the modal
  const existing = document.getElementById('range-preview-modal');
  if (existing) {
    existing.remove();
    document.getElementById('btn-view-range-eye')?.classList.remove('active');
    return;
  }

  const modal = document.createElement('div');
  modal.id = 'range-preview-modal';
  modal.className = 'range-preview-overlay';

  const panel = document.createElement('div');
  panel.className = 'range-preview-panel ornamented';
  panel.innerHTML = `
    <div class="corner-tl"></div><div class="corner-tr"></div>
    <div class="corner-bl"></div><div class="corner-br"></div>
    <div class="range-preview-header">
      <span class="range-preview-title">${escapeHtml(activeRange.name)}</span>
      <button class="range-preview-close" id="btn-preview-close">✕ Fermer</button>
    </div>
  `;

  // Build labeled matrix (14×14 grid: corner + 13 col headers + 13×(row label + 13 cells))
  const grid = document.createElement('div');
  grid.className = 'nash-labeled-matrix';

  // Corner
  const corner = document.createElement('div');
  corner.className = 'nash-matrix-corner';
  grid.appendChild(corner);

  // Column headers (A K Q J T 9 8 7 6 5 4 3 2)
  RANKS.forEach(r => {
    const lbl = document.createElement('div');
    lbl.className = 'nash-matrix-col-label';
    lbl.textContent = r;
    grid.appendChild(lbl);
  });

  // 13 rows: row label + 13 cells
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
      const threshold = activeRange.cells[i];

      if (threshold !== undefined) {
        const color = nashCellColor(threshold);
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        const darker = `rgb(${Math.max(0,r-30)},${Math.max(0,g-30)},${Math.max(0,b-30)})`;
        cell.classList.add('painted');
        cell.style.background = `linear-gradient(135deg, ${color}, ${darker})`;
        cell.textContent = threshold >= 999 ? '∞' : String(threshold);
        cell.title = threshold >= 999 ? `${hand} — toujours` : `${hand} — ≤ ${threshold} BB`;
      } else {
        cell.textContent = hand;
        cell.title = `${hand} — non défini`;
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
    document.getElementById('btn-view-range-eye')?.classList.remove('active');
  };
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.body.appendChild(modal);
  panel.querySelector('#btn-preview-close').addEventListener('click', closeModal);
}

// === SCORE BAR ===

function updateScoreBar() {
  document.getElementById('score-correct').textContent = score.correct;
  document.getElementById('score-wrong').textContent = score.wrong;

  const streakEl = document.getElementById('score-streak');
  const msgEl = document.getElementById('streak-message');

  // Render streak as Roman numerals (simple version up to 20, then numeric)
  streakEl.textContent = score.streak > 0 ? toRoman(score.streak) : '—';

  // Animate streak value
  if (score.streak > 0) {
    streakEl.classList.remove('pulse');
    streakEl.offsetHeight; // reflow to restart animation
    streakEl.classList.add('pulse');
  }

  // Streak message
  const message = STREAK_MESSAGES[score.streak];
  if (message) {
    msgEl.textContent = message;
    msgEl.style.display = '';
    setTimeout(() => { msgEl.style.display = 'none'; }, 3000);
  }
}

function toRoman(n) {
  if (n > 20) return String(n);
  const vals = [10,9,5,4,1];
  const syms = ['X','IX','V','IV','I'];
  let result = '';
  for (let i = 0; i < vals.length; i++) {
    while (n >= vals[i]) { result += syms[i]; n -= vals[i]; }
  }
  return result;
}

// === TABLE POSITIONS ===

function renderPositions(range) {
  const villainEl = document.getElementById('game-pos-villain');
  const villain2El = document.getElementById('game-pos-villain2');
  const heroEl = document.getElementById('game-pos-hero');

  villain2El.style.display = 'none';

  // Determine labels based on format and position
  let heroLabel, villainLabel, villain2Label;

  if (range.format === 'HU') {
    heroLabel = range.position || 'SB';
    villainLabel = heroLabel === 'SB' ? 'BB' : 'SB';
  } else {
    // 3H
    heroLabel = range.position || 'BTN';
    const allPos = ['BTN', 'SB', 'BB'];
    const others = allPos.filter(p => p !== heroLabel);
    villainLabel = others[0];
    villain2Label = others[1];
  }

  villainEl.innerHTML = positionHTML(villainLabel);
  heroEl.innerHTML = positionHTML(heroLabel);

  if (range.format === '3H' && villain2Label) {
    villain2El.style.display = '';
    villain2El.innerHTML = positionHTML(villain2Label);
  }
}

function positionHTML(label) {
  return `<div class="game-position-label">${label}</div>`;
}

// === ACTION BUTTONS ===

function renderActionButtons(isCall) {
  const row = document.getElementById('game-action-row');
  row.innerHTML = '';

  const primaryAction = isCall ? 'call' : 'push';
  const primaryLabel = isCall ? 'CALL' : 'PUSH';

  const pushBtn = document.createElement('button');
  pushBtn.id = `btn-action-${primaryAction}`;
  pushBtn.className = `game-action-btn ${primaryAction}-btn`;
  pushBtn.textContent = primaryLabel;
  pushBtn.addEventListener('click', () => handleAnswer(primaryAction));

  const foldBtn = document.createElement('button');
  foldBtn.id = 'btn-action-fold';
  foldBtn.className = 'game-action-btn fold-btn';
  foldBtn.textContent = 'FOLD';
  foldBtn.addEventListener('click', () => handleAnswer('fold'));

  row.appendChild(pushBtn);
  row.appendChild(foldBtn);
}

// === CARD RENDERING ===

function generateCardPair(handName) {
  // handName: "AA", "AKs", "AKo", "KQs", etc.
  const isPair = handName.length === 2;
  const isSuited = handName.endsWith('s');
  const rank1 = handName[0];
  const rank2 = isPair ? handName[1] : handName[1];

  let suit1, suit2;

  if (isPair) {
    // Same rank, two different suits
    const s = shuffleSuits();
    suit1 = s[0];
    suit2 = s[1];
  } else if (isSuited) {
    // Both cards same suit
    suit1 = suit2 = SUITS[Math.floor(Math.random() * SUITS.length)];
  } else {
    // Offsuit: two different suits
    const s = shuffleSuits();
    suit1 = s[0];
    suit2 = s[1];
    // Ensure they differ
    if (suit1 === suit2) suit2 = SUITS[(SUITS.indexOf(suit2) + 1) % SUITS.length];
  }

  return [
    { rank: rank1, suit: suit1 },
    { rank: rank2, suit: suit2 },
  ];
}

function shuffleSuits() {
  return [...SUITS].sort(() => Math.random() - 0.5);
}

function renderCards(cardPair) {
  const container = document.getElementById('game-cards');
  container.innerHTML = '';
  cardPair.forEach(({ rank, suit }) => {
    container.appendChild(renderCard(rank, suit));
  });
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

// === FLASH & SHAKE ===

function triggerFlash(cls) {
  const el = document.getElementById('game-flash-overlay');
  if (!el) return;
  el.classList.remove('flash-gold', 'flash-crimson');
  el.offsetWidth; // reflow to restart animation
  el.classList.add(cls);
}

function triggerShake() {
  const room = document.querySelector('.game-room');
  if (!room) return;
  room.classList.remove('shake');
  room.offsetWidth; // reflow
  room.classList.add('shake');
  room.addEventListener('animationend', () => room.classList.remove('shake'), { once: true });
}

// === UTILS ===

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
