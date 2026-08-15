/* ============================================
   PokerLab — Terminus
   Drill des seuils de shove-call (3-handed).

   Terminus, dieu romain des bornes : ce mode ne travaille pas les ranges,
   il travaille la FRONTIÈRE — le stack exact où le call devient un fold.

   Deux épreuves, toutes deux chronométrées :
     · Décision — main + stack effectif → CALL ou FOLD
     · La Borne — main → donner le seuil de mémoire

   Le tirage est concentré autour du seuil (bande 0.65-1.35×), parce que
   c'est là que vivent les erreurs : au-delà de 1.35× la décision est
   triviale et les reps y sont gaspillées.
   ============================================ */

import { HANDS_MATRIX, getHandCombos, RANKS } from './poker-hands.js';
import { nashCellColor } from './range-config.js';
import { SHOVE_CHARTS, ALWAYS_CALL } from './shove-charts.js';

// === CONSTANTES ===

const SUITS = ['heart', 'diamond', 'spade', 'club'];
const MIN_STACK = 1.0;
const MAX_STACK = 14.5;          // stack de départ 3-handed
const BAND_LO = 0.65;            // bande d'entraînement, symétrique autour du seuil
const BAND_HI = 1.35;
const BORDERLINE_SHARE = 0.7;    // part des mains tirées dans la bande
const LEAK_LO = 0.6;             // bande mesurée dans Madonna (sur-fold)
const LEAK_HI = 1.0;
const SEUIL_TOLERANCE = 0.3;     // ±0.3bb accepté en mode Borne
const HISTORY_KEY = 'pokerlab_terminus_history';
const MAX_HISTORY = 30;

const LENGTHS = [20, 40, 60];
const TIMERS = [
  { ms: 3000, label: '3s — sous pression' },
  { ms: 4000, label: '4s — rythme de table' },
  { ms: 6000, label: '6s — confortable' },
  { ms: 0, label: 'Sans limite' },
];

// === ÉTAT ===

let onBack = null;
let showSelectView = null;
let showGameView = null;

let chart = null;
let mode = 'decision';           // 'decision' | 'seuil'
let sessionLength = 40;
let timerMs = 4000;

let questions = [];              // journal de la session
let current = null;              // { idx, stack, threshold, ratio, correctAction }
let answering = false;
let askedAt = 0;
let countdownRaf = null;
let advanceTimer = null;

let weightedAll = [];            // index pondérés par combos
let weightedFinite = [];         // idem, seuils finis seulement (les seules bornes drillables)

// === INIT ===

export function initTerminus({ onBack: back, showSelectView: showSelect, showGameView: showGame }) {
  onBack = back;
  showSelectView = showSelect;
  showGameView = showGame;
  document.addEventListener('keydown', handleKeydown);
}

function handleKeydown(e) {
  const view = document.getElementById('terminus-game-view');
  if (!view || view.style.display === 'none') return;
  if (e.key === 'Escape' && document.getElementById('terminus-error-overlay')) {
    e.preventDefault();
    e.stopPropagation();
    closeErrorPanel();
    return;
  }
  if (mode === 'decision' && answering) {
    if (e.key === 'c' || e.key === 'C' || e.key === 'ArrowLeft') { e.preventDefault(); answerDecision('call'); }
    if (e.key === 'f' || e.key === 'F' || e.key === 'ArrowRight') { e.preventDefault(); answerDecision('fold'); }
  }
  if (!answering && current && e.key === 'Enter') { e.preventDefault(); nextQuestion(); }
}

// === ÉCRAN DE SÉLECTION ===

export function openTerminusSelect() {
  chart = null;
  const view = document.getElementById('terminus-select-view');
  view.innerHTML = `
    <div class="page-content">
      <div class="page-header">
        <h1>Terminus</h1>
        <p>Le dieu des bornes. Ici on ne révise pas une range — on place la frontière au bon endroit.</p>
      </div>
      <div class="frise-divider"></div>

      <div class="terminus-setup">
        <div class="terminus-block">
          <div class="terminus-block-title">Le nœud</div>
          <div class="terminus-chart-list" id="terminus-chart-list"></div>
          <div class="terminus-preview" id="terminus-preview"></div>
        </div>

        <div class="terminus-block">
          <div class="terminus-block-title">L'épreuve</div>
          <div class="terminus-mode-row">
            <div class="terminus-mode-card${mode === 'decision' ? ' selected' : ''}" data-mode="decision">
              <div class="terminus-mode-name">Décision</div>
              <div class="terminus-mode-desc">Une main, un stack effectif. Call ou fold.</div>
            </div>
            <div class="terminus-mode-card${mode === 'seuil' ? ' selected' : ''}" data-mode="seuil">
              <div class="terminus-mode-name">La Borne</div>
              <div class="terminus-mode-desc">Une main. Donne le seuil de mémoire, au dixième.</div>
            </div>
          </div>
        </div>

        <div class="terminus-block terminus-options">
          <div>
            <div class="terminus-block-title">Longueur</div>
            <div class="terminus-chip-row" id="terminus-length-row"></div>
          </div>
          <div>
            <div class="terminus-block-title">Chrono</div>
            <div class="terminus-chip-row" id="terminus-timer-row"></div>
          </div>
        </div>

        <div class="terminus-actions">
          <button id="btn-terminus-start" class="btn-gold" disabled>Commencer</button>
          <button id="btn-terminus-back" class="btn-stone">Retour</button>
        </div>
        <div class="terminus-hint" id="terminus-hint"></div>
      </div>
    </div>`;

  const list = document.getElementById('terminus-chart-list');
  SHOVE_CHARTS.forEach(c => {
    const finite = c.cells.filter(t => t > 0 && t < ALWAYS_CALL).length;
    const card = document.createElement('div');
    card.className = 'terminus-chart-card';
    card.innerHTML = `
      <div class="terminus-chart-info">
        <div class="terminus-chart-name">${escapeHtml(c.hero)} face au shove ${escapeHtml(c.villain)}</div>
        <div class="terminus-chart-meta">${finite} seuils réels · ${c.cells.length - finite} toujours-call</div>
      </div>
      <span class="terminus-chart-badge ${c.opponentType}">${escapeHtml(c.opponentType)}</span>`;
    card.addEventListener('click', () => {
      list.querySelectorAll('.terminus-chart-card').forEach(x => x.classList.remove('selected'));
      card.classList.add('selected');
      chart = c;
      document.getElementById('btn-terminus-start').disabled = false;
      renderPreview();
      renderHint();
    });
    list.appendChild(card);
  });

  view.querySelectorAll('.terminus-mode-card').forEach(el => {
    el.addEventListener('click', () => {
      view.querySelectorAll('.terminus-mode-card').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      mode = el.dataset.mode;
      renderTimerChips();
      renderHint();
    });
  });

  renderChips('terminus-length-row', LENGTHS.map(n => ({ val: n, label: `${n} mains` })),
    () => sessionLength, v => { sessionLength = v; });
  renderTimerChips();
  renderHint();

  document.getElementById('btn-terminus-start').addEventListener('click', startSession);
  document.getElementById('btn-terminus-back').addEventListener('click', () => onBack && onBack());
}

function renderTimerChips() {
  // La Borne demande de taper un nombre : le chrono le plus court y est injouable.
  const opts = TIMERS.filter(t => mode === 'decision' || t.ms === 0 || t.ms >= 4000);
  if (!opts.some(o => o.ms === timerMs)) timerMs = mode === 'decision' ? 4000 : 6000;
  renderChips('terminus-timer-row', opts.map(t => ({ val: t.ms, label: t.label })),
    () => timerMs, v => { timerMs = v; });
}

function renderChips(containerId, options, getter, setter) {
  const row = document.getElementById(containerId);
  if (!row) return;
  row.innerHTML = '';
  options.forEach(o => {
    const chip = document.createElement('button');
    chip.className = 'terminus-chip' + (getter() === o.val ? ' selected' : '');
    chip.textContent = o.label;
    chip.addEventListener('click', () => {
      setter(o.val);
      row.querySelectorAll('.terminus-chip').forEach(x => x.classList.remove('selected'));
      chip.classList.add('selected');
      renderHint();
    });
    row.appendChild(chip);
  });
}

// === TABLE 13×13 ===

/** Matrice étiquetée des seuils. `highlightIdx` encadre la main en cours. */
function buildChartMatrix(cells, highlightIdx = null) {
  const grid = document.createElement('div');
  grid.className = 'nash-labeled-matrix';

  const corner = document.createElement('div');
  corner.className = 'nash-matrix-corner';
  grid.appendChild(corner);

  RANKS.forEach(r => {
    const lbl = document.createElement('div');
    lbl.className = 'nash-matrix-col-label';
    lbl.textContent = r;
    grid.appendChild(lbl);
  });

  RANKS.forEach((rowRank, rowIdx) => {
    const rowLbl = document.createElement('div');
    rowLbl.className = 'nash-matrix-row-label';
    rowLbl.textContent = rowRank;
    grid.appendChild(rowLbl);

    for (let colIdx = 0; colIdx < 13; colIdx++) {
      const i = rowIdx * 13 + colIdx;
      const hand = HANDS_MATRIX[i];
      const t = cells[i];
      const cell = document.createElement('div');
      cell.className = 'mini-cell painted';

      const color = nashCellColor(t >= ALWAYS_CALL ? 999 : t);
      const [r, g, b] = [1, 3, 5].map(o => parseInt(color.slice(o, o + 2), 16));
      const darker = `rgb(${Math.max(0, r - 30)},${Math.max(0, g - 30)},${Math.max(0, b - 30)})`;
      cell.style.background = `linear-gradient(135deg, ${color}, ${darker})`;
      cell.textContent = t >= ALWAYS_CALL ? '∞' : String(t);
      cell.title = t >= ALWAYS_CALL ? `${hand} — call à toute profondeur` : `${hand} — call si ≤ ${t} BB`;

      if (i === highlightIdx) cell.classList.add('range-preview-highlight');
      grid.appendChild(cell);
    }
  });
  return grid;
}

function matrixLegend() {
  const el = document.createElement('div');
  el.className = 'terminus-legend';
  el.innerHTML = `
    <span class="terminus-legend-item"><i style="background:#a03030"></i>&lt; 4 BB</span>
    <span class="terminus-legend-item"><i style="background:#b07030"></i>4–8</span>
    <span class="terminus-legend-item"><i style="background:#7a9a30"></i>8–15</span>
    <span class="terminus-legend-item"><i style="background:#3a7a50"></i>∞ toujours call</span>
    <span class="terminus-legend-note">Valeur = stack effectif en dessous duquel tu call.</span>`;
  return el;
}

function renderPreview() {
  const box = document.getElementById('terminus-preview');
  if (!box) return;
  box.innerHTML = '';
  if (!chart) return;
  const title = document.createElement('div');
  title.className = 'terminus-preview-title';
  title.textContent = `${chart.hero} face au shove ${chart.villain} — ${chart.opponentType}`;
  box.appendChild(title);
  box.appendChild(buildChartMatrix(chart.cells));
  box.appendChild(matrixLegend());
}

function renderHint() {
  const el = document.getElementById('terminus-hint');
  if (!el) return;
  el.textContent = mode === 'decision'
    ? `${Math.round(BORDERLINE_SHARE * 100)} % des mains tomberont entre ${BAND_LO}× et ${BAND_HI}× le seuil — la zone où les erreurs vivent. Raccourcis : C = call, F = fold.`
    : `Réponse au dixième de bb, tolérance ±${SEUIL_TOLERANCE}. Entrée pour valider. « T » pour toujours-call.`;
}

// === SESSION ===

function startSession() {
  if (!chart) return;
  questions = [];
  current = null;

  weightedAll = [];
  weightedFinite = [];
  chart.cells.forEach((t, i) => {
    const w = getHandCombos(HANDS_MATRIX[i]);
    for (let k = 0; k < w; k++) {
      weightedAll.push(i);
      if (t > 0 && t < ALWAYS_CALL) weightedFinite.push(i);
    }
  });

  showGameView && showGameView();
  renderGameShell();
  nextQuestion();
}

function drawQuestion() {
  if (mode === 'seuil') {
    return { idx: pick(weightedAll), stack: null };
  }
  // Décision : concentrer le tirage autour du seuil, sans le rendre devinable.
  // La bande est symétrique (0.65-1.35×) donc « c'est borderline » n'indique
  // pas la réponse : il y a autant de calls que de folds dedans.
  const borderline = weightedFinite.length > 0 && Math.random() < BORDERLINE_SHARE;
  if (borderline) {
    const idx = pick(weightedFinite);
    const t = chart.cells[idx];
    const lo = Math.max(MIN_STACK, t * BAND_LO);
    const hi = Math.min(MAX_STACK, t * BAND_HI);
    return { idx, stack: round1(lo + Math.random() * (hi - lo)) };
  }
  return { idx: pick(weightedAll), stack: round1(MIN_STACK + Math.random() * (MAX_STACK - MIN_STACK)) };
}

function nextQuestion() {
  if (questions.length >= sessionLength) return endSession();
  clearTimers();

  const { idx, stack } = drawQuestion();
  const threshold = chart.cells[idx];
  current = {
    idx, stack, threshold,
    hand: HANDS_MATRIX[idx],
    ratio: stack === null ? null : stack / threshold,
    correctAction: stack === null ? null : (stack <= threshold ? 'call' : 'fold'),
  };
  answering = true;
  askedAt = performance.now();

  renderQuestion();
  if (timerMs > 0) startCountdown();
}

function startCountdown() {
  const bar = document.getElementById('terminus-timer-bar');
  if (!bar) return;
  const tick = () => {
    if (!answering) return;
    const elapsed = performance.now() - askedAt;
    const left = Math.max(0, 1 - elapsed / timerMs);
    bar.style.transform = `scaleX(${left})`;
    bar.classList.toggle('urgent', left < 0.33);
    if (left <= 0) return onTimeout();
    countdownRaf = requestAnimationFrame(tick);
  };
  countdownRaf = requestAnimationFrame(tick);
}

function onTimeout() {
  if (!answering) return;
  answering = false;
  record({ answer: null, correct: false, timedOut: true, ms: timerMs });
  renderFeedback(false, true);
}

function answerDecision(action) {
  if (!answering || mode !== 'decision') return;
  answering = false;
  const ms = performance.now() - askedAt;
  const correct = action === current.correctAction;
  record({ answer: action, correct, timedOut: false, ms });
  renderFeedback(correct, false);
}

function answerSeuil() {
  if (!answering || mode !== 'seuil') return;
  const input = document.getElementById('terminus-seuil-input');
  const raw = (input?.value || '').trim().replace(',', '.');
  if (raw === '') return;
  answering = false;
  const ms = performance.now() - askedAt;
  const isAlways = current.threshold >= ALWAYS_CALL;
  const said = raw.toLowerCase() === 't' ? ALWAYS_CALL : parseFloat(raw);
  const correct = Number.isFinite(said) && (isAlways
    ? said >= ALWAYS_CALL
    : Math.abs(said - current.threshold) <= SEUIL_TOLERANCE);
  record({ answer: raw, correct, timedOut: false, ms });
  renderFeedback(correct, false);
}

function record(res) {
  clearTimers();
  questions.push({ ...current, ...res });
}

// === RENDU ===

function renderGameShell() {
  const view = document.getElementById('terminus-game-view');
  view.innerHTML = `
    <div class="game-room terminus-room">
      <div class="terminus-timer-track"><div class="terminus-timer-bar" id="terminus-timer-bar"></div></div>

      <div class="game-table-area">
        <img class="game-table-img" src="assets/game/table.png" alt="Table">
        <div class="game-position game-pos-villain">
          <div class="game-position-label" id="terminus-villain-label"></div>
        </div>
        <div class="game-center-area">
          <div class="game-stack-display" id="terminus-stack-block">
            <span class="game-stack-value" id="terminus-stack-value">—</span>
            <span class="game-stack-unit">BB</span>
          </div>
          <div class="game-cards" id="terminus-cards"></div>
        </div>
        <div class="game-position game-pos-hero">
          <div class="game-position-label" id="terminus-hero-label"></div>
        </div>
      </div>

      <div class="game-bottom">
        <div class="game-score-box">
          <div class="game-score-item">
            <span class="score-val score-correct-val" id="terminus-correct">0</span>
            <span class="score-label">Correct</span>
          </div>
          <div class="game-score-divider"></div>
          <div class="game-score-item">
            <span class="score-val score-wrong-val" id="terminus-wrong">0</span>
            <span class="score-label">Erreurs</span>
          </div>
          <div class="game-score-divider"></div>
          <div class="game-score-item">
            <span class="score-val" id="terminus-progress">0/${sessionLength}</span>
            <span class="score-label">Progression</span>
          </div>
          <button id="btn-terminus-quit" class="game-quit-btn">✕ Quitter</button>
        </div>

        <div class="game-action-section" id="terminus-action-section"></div>
        <div class="game-feedback-panel" id="terminus-feedback"></div>
      </div>
    </div>`;

  document.getElementById('terminus-villain-label').textContent = `${chart.villain} · ${chart.opponentType} · ALL-IN`;
  document.getElementById('terminus-hero-label').textContent = `Toi · ${chart.hero}`;
  document.getElementById('btn-terminus-quit').addEventListener('click', quit);
}

function renderQuestion() {
  document.getElementById('terminus-feedback').innerHTML = '';
  renderCards(generateCardPair(current.hand));

  const stackBlock = document.getElementById('terminus-stack-block');
  if (mode === 'decision') {
    stackBlock.style.visibility = 'visible';
    document.getElementById('terminus-stack-value').textContent = current.stack.toFixed(1);
  } else {
    stackBlock.style.visibility = 'hidden';
  }

  const section = document.getElementById('terminus-action-section');
  if (mode === 'decision') {
    section.innerHTML = `
      <div class="game-action-row">
        <button class="game-action-btn call-btn" id="terminus-btn-call">CALL</button>
        <button class="game-action-btn fold-btn" id="terminus-btn-fold">FOLD</button>
      </div>`;
    document.getElementById('terminus-btn-call').addEventListener('click', () => answerDecision('call'));
    document.getElementById('terminus-btn-fold').addEventListener('click', () => answerDecision('fold'));
  } else {
    section.innerHTML = `
      <div class="terminus-seuil-prompt">Seuil de <strong>${escapeHtml(current.hand)}</strong> ?</div>
      <div class="terminus-seuil-row">
        <input id="terminus-seuil-input" class="terminus-seuil-input" type="text"
               inputmode="decimal" autocomplete="off" placeholder="4.7">
        <span class="terminus-seuil-unit">BB</span>
        <button class="terminus-seuil-always" id="terminus-btn-always" title="Toujours call">T</button>
      </div>`;
    const input = document.getElementById('terminus-seuil-input');
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      // Sans stopPropagation, ce même Entrée remonte au document et y déclenche
      // l'avance à la question suivante : le feedback ne serait jamais lisible.
      e.stopPropagation();
      answerSeuil();
    });
    document.getElementById('terminus-btn-always').addEventListener('click', () => {
      input.value = 't';
      answerSeuil();
    });
    input.focus();
  }
  updateScore();
}

function renderFeedback(correct, timedOut) {
  const el = document.getElementById('terminus-feedback');
  const t = current.threshold >= ALWAYS_CALL ? 'toujours call' : `${current.threshold.toFixed(1)} BB`;
  const ratioLine = current.ratio === null ? '' : `
    <div class="terminus-fb-ratio">${current.stack.toFixed(1)} / ${current.threshold.toFixed(1)} = <strong>${current.ratio.toFixed(2)}×</strong></div>`;
  const verdict = timedOut ? 'TROP LENT' : (correct ? '✓' : '✗');

  el.innerHTML = `
    <div class="game-feedback-result ${correct ? 'correct' : 'wrong'}">${verdict}</div>
    <div class="game-feedback-hand">${escapeHtml(current.hand)}</div>
    <div class="game-feedback-threshold">
      <span class="feedback-threshold-label">Seuil</span>
      <span class="feedback-threshold-val">${t}</span>
    </div>
    ${ratioLine}
    ${correct ? '' : `
      <button class="terminus-continue-btn" id="terminus-btn-continue">Continuer →</button>
      <div class="terminus-fb-next">ou Entrée</div>
      <button class="terminus-seechart-btn" id="terminus-btn-seechart">Revoir la table</button>`}`;

  document.querySelectorAll('#terminus-action-section .game-action-btn').forEach(b => b.disabled = true);
  const input = document.getElementById('terminus-seuil-input');
  if (input) input.disabled = true;
  updateScore();

  if (correct) {
    // Les bonnes réponses enchaînent ; les erreurs s'arrêtent sur la table.
    advanceTimer = setTimeout(nextQuestion, 850);
    return;
  }
  document.getElementById('terminus-btn-continue').addEventListener('click', nextQuestion);
  document.getElementById('terminus-btn-seechart').addEventListener('click', openErrorPanel);
  openErrorPanel();
}

// === PANNEAU D'ERREUR — la table, main encadrée ===

function openErrorPanel() {
  closeErrorPanel();
  const t = current.threshold >= ALWAYS_CALL ? '∞ (toujours call)' : `${current.threshold.toFixed(1)} BB`;
  const overlay = document.createElement('div');
  overlay.id = 'terminus-error-overlay';
  overlay.className = 'range-preview-overlay';

  const panel = document.createElement('div');
  panel.className = 'range-preview-panel ornamented';
  panel.innerHTML = `
    <div class="corner-tl"></div><div class="corner-tr"></div>
    <div class="corner-bl"></div><div class="corner-br"></div>
    <div class="range-preview-header">
      <span class="range-preview-title">${escapeHtml(chart.hero)} vs shove ${escapeHtml(chart.villain)} — ${escapeHtml(chart.opponentType)}</span>
      <button class="range-preview-close" id="terminus-err-close">✕ Fermer</button>
    </div>
    <div class="terminus-err-recap">
      <span class="terminus-err-hand">${escapeHtml(current.hand)}</span>
      ${current.stack === null ? '' : `<span class="terminus-err-num">${current.stack.toFixed(1)} BB effectif</span>`}
      <span class="terminus-err-num">seuil ${t}</span>
      ${current.ratio === null ? '' : `<span class="terminus-err-num">${current.ratio.toFixed(2)}×</span>`}
      ${current.correctAction ? `<span class="terminus-err-verdict">→ ${current.correctAction.toUpperCase()}</span>` : ''}
    </div>`;

  panel.appendChild(buildChartMatrix(chart.cells, current.idx));
  panel.appendChild(matrixLegend());

  const footer = document.createElement('div');
  footer.className = 'terminus-err-footer';
  footer.innerHTML = `<button class="terminus-continue-btn" id="terminus-err-continue">Continuer →</button>`;
  panel.appendChild(footer);

  overlay.appendChild(panel);
  // Clic hors du panneau : on referme sans avancer, le feedback reste lisible.
  overlay.addEventListener('click', e => { if (e.target === overlay) closeErrorPanel(); });
  document.body.appendChild(overlay);
  panel.querySelector('#terminus-err-close').addEventListener('click', closeErrorPanel);
  panel.querySelector('#terminus-err-continue').addEventListener('click', nextQuestion);
}

function closeErrorPanel() {
  document.getElementById('terminus-error-overlay')?.remove();
}

function updateScore() {
  const ok = questions.filter(q => q.correct).length;
  document.getElementById('terminus-correct').textContent = ok;
  document.getElementById('terminus-wrong').textContent = questions.length - ok;
  document.getElementById('terminus-progress').textContent = `${questions.length}/${sessionLength}`;
}

// === FIN DE SESSION ===

function computeStats() {
  const total = questions.length;
  const correct = questions.filter(q => q.correct).length;
  const times = questions.filter(q => !q.timedOut).map(q => q.ms).sort((a, b) => a - b);
  const median = times.length ? times[Math.floor(times.length / 2)] : null;

  // La métrique qui compte : dans la bande 0.6-1.0× le seuil, la réponse est
  // CALL. Combien de fois as-tu foldé ? C'est le chiffre mesuré dans Madonna.
  const band = questions.filter(q => q.ratio !== null && q.ratio > LEAK_LO && q.ratio <= LEAK_HI);
  const bandFolds = band.filter(q => q.answer === 'fold' || q.timedOut).length;
  // Miroir : juste au-dessus du seuil, la réponse est FOLD.
  const above = questions.filter(q => q.ratio !== null && q.ratio > LEAK_HI && q.ratio <= 1.4);
  const aboveCalls = above.filter(q => q.answer === 'call').length;

  return { total, correct, median, band, bandFolds, above, aboveCalls };
}

function endSession() {
  clearTimers();
  const s = computeStats();
  saveSession(s);

  const missed = questions.filter(q => !q.correct);
  const missedHtml = missed.length
    ? missed.slice(0, 24).map(q => {
        const t = q.threshold >= ALWAYS_CALL ? '∞' : q.threshold.toFixed(1);
        const ctx = q.ratio === null ? `seuil ${t}` : `${q.stack.toFixed(1)} vs ${t} (${q.ratio.toFixed(2)}×)`;
        return `<div class="terminus-miss"><span class="terminus-miss-hand">${escapeHtml(q.hand)}</span>
                <span class="terminus-miss-ctx">${ctx}</span>
                <span class="terminus-miss-tag">${q.timedOut ? 'trop lent' : (q.answer === 'fold' ? 'foldé' : 'callé')}</span></div>`;
      }).join('')
    : '<div class="terminus-miss-empty">Aucune erreur. Sans faute.</div>';

  const bandPct = s.band.length ? Math.round(100 * s.bandFolds / s.band.length) : null;
  const abovePct = s.above.length ? Math.round(100 * s.aboveCalls / s.above.length) : null;

  document.getElementById('terminus-game-view').innerHTML = `
    <div class="page-content">
      <div class="page-header">
        <h1>Terminus</h1>
        <p>${escapeHtml(chart.hero)} face au shove ${escapeHtml(chart.villain)} — ${escapeHtml(chart.opponentType)} · ${mode === 'decision' ? 'Décision' : 'La Borne'}</p>
      </div>
      <div class="frise-divider"></div>

      <div class="terminus-result-grid">
        <div class="terminus-stat">
          <div class="terminus-stat-val">${s.correct}/${s.total}</div>
          <div class="terminus-stat-label">Réussite</div>
        </div>
        <div class="terminus-stat">
          <div class="terminus-stat-val">${s.median === null ? '—' : (s.median / 1000).toFixed(1) + 's'}</div>
          <div class="terminus-stat-label">Temps médian</div>
        </div>
        ${mode === 'decision' ? `
        <div class="terminus-stat ${bandPct !== null && bandPct > 15 ? 'alert' : ''}">
          <div class="terminus-stat-val">${bandPct === null ? '—' : bandPct + '%'}</div>
          <div class="terminus-stat-label">Sur-fold ${LEAK_LO}–${LEAK_HI}× <span class="terminus-stat-n">(n=${s.band.length})</span></div>
        </div>
        <div class="terminus-stat">
          <div class="terminus-stat-val">${abovePct === null ? '—' : abovePct + '%'}</div>
          <div class="terminus-stat-label">Sur-call 1.0–1.4× <span class="terminus-stat-n">(n=${s.above.length})</span></div>
        </div>` : ''}
      </div>

      ${mode === 'decision' ? `<div class="terminus-target">
        Cible sur le sur-fold : <strong>&lt; 15 %</strong>. En jeu réel tu es à <strong>50 %</strong> sur ce nœud (mesuré sur 2026).
      </div>` : ''}

      <div class="terminus-misses">
        <div class="terminus-block-title">Erreurs</div>
        ${missedHtml}
      </div>

      <div class="terminus-actions">
        <button id="btn-terminus-again" class="btn-gold">Rejouer</button>
        <button id="btn-terminus-select" class="btn-stone">Changer de nœud</button>
      </div>
    </div>`;

  document.getElementById('btn-terminus-again').addEventListener('click', startSession);
  document.getElementById('btn-terminus-select').addEventListener('click', () => {
    openTerminusSelect();
    showSelectView && showSelectView();
  });
}

function quit() {
  clearTimers();
  answering = false;
  if (questions.length > 0) saveSession(computeStats());
  onBack && onBack();
}

// === HISTORIQUE (clé dédiée — n'interfère pas avec Colosseum) ===

function saveSession(s) {
  try {
    const store = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}');
    const key = `${chart.id}::${mode}`;
    if (!store[key]) store[key] = [];
    store[key].push({
      at: new Date().toISOString(),
      total: s.total,
      correct: s.correct,
      medianMs: s.median,
      timerMs,
      bandN: s.band.length,
      bandFolds: s.bandFolds,
      aboveN: s.above.length,
      aboveCalls: s.aboveCalls,
    });
    if (store[key].length > MAX_HISTORY) store[key] = store[key].slice(-MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(store));
  } catch {
    /* stockage indisponible : la session est perdue, le drill reste utilisable */
  }
}

export function loadTerminusHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}');
  } catch {
    return {};
  }
}

// === UTILITAIRES ===

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

function clearTimers() {
  closeErrorPanel();
  if (countdownRaf) { cancelAnimationFrame(countdownRaf); countdownRaf = null; }
  if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
  const bar = document.getElementById('terminus-timer-bar');
  if (bar) { bar.style.transform = 'scaleX(1)'; bar.classList.remove('urgent'); }
}

function generateCardPair(handName) {
  const isPair = handName.length === 2;
  const isSuited = handName.endsWith('s');
  const [rank1, rank2] = [handName[0], handName[1]];
  if (isSuited) {
    const s = SUITS[Math.floor(Math.random() * SUITS.length)];
    return [{ rank: rank1, suit: s }, { rank: rank2, suit: s }];
  }
  const shuffled = [...SUITS].sort(() => Math.random() - 0.5);
  return [{ rank: rank1, suit: shuffled[0] }, { rank: rank2, suit: shuffled[1] }];
}

function renderCards(pair) {
  const container = document.getElementById('terminus-cards');
  container.innerHTML = '';
  pair.forEach(({ rank, suit }) => {
    const card = document.createElement('div');
    card.className = `playing-card suit-${suit}`;
    const display = rank === 'T' ? '10' : rank;
    card.innerHTML = `
      <span class="card-rank">${display}</span>
      <img class="card-suit-center" src="assets/game/${suit}.png" alt="${suit}">
      <span class="card-rank-bottom">${display}</span>`;
    container.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
