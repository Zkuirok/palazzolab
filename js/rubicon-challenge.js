/* ============================================
   PokerLab — Rubicon Challenge Mode
   200-hand accuracy session, 4-hand grid
   ============================================ */

import { HANDS_MATRIX, getHandCombos } from './poker-hands.js';

// === CONSTANTS ===

const SESSION_SIZE = 200;
const BATCH_SIZE = 4;

const SUITS = ['heart', 'diamond', 'spade', 'club'];

// === STATE ===

let challengeRange = null;
let eligibleHands = [];
let handsDone = 0;
let correctCount = 0;
let batchAnsweredCount = 0;
let onBackToSelectCb = null;

// Current batch: array of { handIndex, stack, cardPair, correctAction }
let currentBatch = [];

// Auto-advance timer handle
let autoAdvanceTimer = null;

// === INIT ===

export function initRubiconChallenge({ onBackToSelect }) {
  onBackToSelectCb = onBackToSelect;

  document.getElementById('btn-challenge-quit').addEventListener('click', () => {
    clearTimeout(autoAdvanceTimer);
    onBackToSelectCb();
  });
}

// === START ===

export function openRubiconChallenge(range) {
  clearTimeout(autoAdvanceTimer);
  challengeRange = range;
  handsDone = 0;
  correctCount = 0;
  batchAnsweredCount = 0;

  // Build weighted eligible hands
  eligibleHands = [];
  HANDS_MATRIX.forEach((hand, i) => {
    const threshold = range.cells[i];
    if (threshold !== undefined) {
      const weight = getHandCombos(hand);
      for (let w = 0; w < weight; w++) eligibleHands.push(i);
    }
  });

  // Reset progress UI
  updateProgressUI();
  document.getElementById('challenge-next-bar').style.display = 'none';

  // Restore grid (in case we're replaying after end screen)
  const room = document.querySelector('.challenge-room');
  if (!room.querySelector('#challenge-grid')) {
    room.innerHTML = `
      <div class="challenge-topbar">
        <div class="challenge-progress-wrap">
          <span id="challenge-hand-count" class="challenge-hand-count">0 / ${SESSION_SIZE}</span>
          <div class="challenge-progress-bar">
            <div id="challenge-progress-fill" class="challenge-progress-fill"></div>
          </div>
        </div>
        <div id="challenge-accuracy" class="challenge-accuracy">—%</div>
        <button id="btn-challenge-quit" class="game-quit-btn">✕ Quitter</button>
      </div>
      <div id="challenge-grid" class="challenge-grid"></div>
      <div id="challenge-next-bar" class="challenge-next-bar" style="display:none">
        <button id="btn-challenge-next" class="btn-gold">Suivant →</button>
      </div>
    `;
    // Re-wire buttons after DOM rebuild
    document.getElementById('btn-challenge-quit').addEventListener('click', () => onBackToSelectCb());
    document.getElementById('btn-challenge-next').addEventListener('click', () => {
      if (handsDone >= SESSION_SIZE) showEndScreen();
      else dealBatch();
    });
  }

  updateProgressUI();
  dealBatch();
}

// === BATCH ===

function dealBatch() {
  if (eligibleHands.length === 0) return;

  clearTimeout(autoAdvanceTimer);
  batchAnsweredCount = 0;
  currentBatch = [];

  document.getElementById('challenge-next-bar').style.display = 'none';
  const isCall = challengeRange.chartType === 'call';

  for (let i = 0; i < BATCH_SIZE; i++) {
    const handIndex = eligibleHands[Math.floor(Math.random() * eligibleHands.length)];
    const handName = HANDS_MATRIX[handIndex];
    const stack = Math.round((1.5 + Math.random() * 13.5) * 10) / 10;
    const threshold = challengeRange.cells[handIndex];
    const correctAction = stack <= threshold ? (isCall ? 'call' : 'push') : 'fold';
    const cardPair = generateCardPair(handName);

    currentBatch.push({ handIndex, handName, stack, threshold, correctAction, cardPair });
  }

  // Render panels
  const grid = document.getElementById('challenge-grid');
  grid.innerHTML = '';
  currentBatch.forEach((item, i) => renderPanel(i, item));
}

function renderPanel(i, item) {
  const isCall = challengeRange.chartType === 'call';
  const primaryAction = isCall ? 'call' : 'push';
  const primaryLabel = isCall ? 'CALL' : 'PUSH';

  const panel = document.createElement('div');
  panel.className = 'challenge-panel';
  panel.id = `challenge-panel-${i}`;

  // Stack
  const stackEl = document.createElement('div');
  stackEl.className = 'challenge-panel-stack';
  stackEl.textContent = `${item.stack.toFixed(1)} BB`;
  panel.appendChild(stackEl);

  // Cards
  const cardsEl = document.createElement('div');
  cardsEl.className = 'challenge-panel-cards';
  item.cardPair.forEach(({ rank, suit }) => {
    cardsEl.appendChild(renderCard(rank, suit));
  });
  panel.appendChild(cardsEl);

  // Buttons
  const btnsEl = document.createElement('div');
  btnsEl.className = 'challenge-panel-btns';

  const primaryBtn = document.createElement('button');
  primaryBtn.className = `ch-action-btn ${primaryAction}-btn`;
  primaryBtn.textContent = primaryLabel;
  primaryBtn.addEventListener('click', () => handlePanelAnswer(i, primaryAction, item));

  const foldBtn = document.createElement('button');
  foldBtn.className = 'ch-action-btn fold-btn';
  foldBtn.textContent = 'FOLD';
  foldBtn.addEventListener('click', () => handlePanelAnswer(i, 'fold', item));

  btnsEl.appendChild(primaryBtn);
  btnsEl.appendChild(foldBtn);
  panel.appendChild(btnsEl);

  // Result placeholder
  const resultEl = document.createElement('div');
  resultEl.className = 'challenge-panel-result';
  resultEl.id = `challenge-result-${i}`;
  panel.appendChild(resultEl);

  document.getElementById('challenge-grid').appendChild(panel);
}

function handlePanelAnswer(i, action, item) {
  const panel = document.getElementById(`challenge-panel-${i}`);
  if (!panel || panel.classList.contains('answered')) return;

  panel.classList.add('answered');

  // Disable buttons
  panel.querySelectorAll('.ch-action-btn').forEach(btn => { btn.disabled = true; });

  const isCorrect = action === item.correctAction;
  if (isCorrect) correctCount++;

  // Show result
  const resultEl = document.getElementById(`challenge-result-${i}`);
  const thresholdText = item.threshold >= 999 ? '∞' : `${item.threshold} BB`;
  const actionLabel = item.correctAction === 'push' ? 'PUSH' : item.correctAction === 'call' ? 'CALL' : 'FOLD';
  resultEl.className = `challenge-panel-result ${isCorrect ? 'correct' : 'wrong'}`;
  resultEl.textContent = `${isCorrect ? '✓' : '✗'} Seuil ${thresholdText} → ${actionLabel}`;

  batchAnsweredCount++;

  if (batchAnsweredCount === BATCH_SIZE) {
    handsDone += BATCH_SIZE;
    updateProgressUI();

    // Auto-advance after 3s; show a skip button in the meantime
    const nextBar = document.getElementById('challenge-next-bar');
    const nextBtn = document.getElementById('btn-challenge-next');
    if (nextBar && nextBtn) {
      nextBtn.textContent = handsDone >= SESSION_SIZE ? 'Résultats →' : 'Suivant →';
      nextBar.style.display = 'flex';
      const advance = () => {
        clearTimeout(autoAdvanceTimer);
        nextBar.style.display = 'none';
        if (handsDone >= SESSION_SIZE) showEndScreen();
        else dealBatch();
      };
      nextBtn.onclick = advance;
      autoAdvanceTimer = setTimeout(advance, 3000);
    }
  }
}

// === PROGRESS UI ===

function updateProgressUI() {
  const countEl = document.getElementById('challenge-hand-count');
  const fillEl = document.getElementById('challenge-progress-fill');
  const accEl = document.getElementById('challenge-accuracy');

  if (countEl) countEl.textContent = `${handsDone} / ${SESSION_SIZE}`;
  if (fillEl) fillEl.style.width = `${(handsDone / SESSION_SIZE) * 100}%`;
  if (accEl) {
    if (handsDone === 0) {
      accEl.textContent = '—%';
    } else {
      accEl.textContent = `${Math.round(correctCount / handsDone * 100)}%`;
    }
  }
}

// === END SCREEN ===

function showEndScreen() {
  const accuracy = handsDone > 0 ? Math.round(correctCount / handsDone * 100) : 0;
  const grade = getGrade(accuracy);

  const room = document.querySelector('.challenge-room');
  room.innerHTML = `
    <div class="challenge-end-screen">
      <div class="challenge-end-title">Session terminée</div>
      <div class="challenge-end-accuracy">${accuracy}%</div>
      <div class="challenge-end-detail">${correctCount} / ${SESSION_SIZE} correctes</div>
      <div class="challenge-end-grade">${grade}</div>
      <div class="challenge-end-actions">
        <button id="btn-challenge-restart" class="btn-gold">Rejouer</button>
        <button id="btn-challenge-back" class="btn-stone">← Choisir une range</button>
      </div>
    </div>
  `;

  document.getElementById('btn-challenge-restart').addEventListener('click', () => {
    openRubiconChallenge(challengeRange);
  });
  document.getElementById('btn-challenge-back').addEventListener('click', () => {
    onBackToSelectCb();
  });
}

function getGrade(pct) {
  if (pct >= 95) return 'IMPERATOR';
  if (pct >= 85) return 'VENI VIDI VICI';
  if (pct >= 70) return 'ALEA IACTA EST';
  return 'Entraîne-toi encore';
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
    suit1 = s[0];
    suit2 = s[1];
  } else if (isSuited) {
    suit1 = suit2 = SUITS[Math.floor(Math.random() * SUITS.length)];
  } else {
    const s = shuffleSuits();
    suit1 = s[0];
    suit2 = s[1];
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
