/* ============================================
   PokerLab — Fresco
   Peinture de range de mémoire.

   On te donne une range (nom, situation, profondeur, adversaire) et une
   grille vide : tu la repeins, main par main, avec les couleurs de ses
   actions. À la validation, chaque cellule est comparée à la range
   d'origine → % de mains exactes, puis ta fresque et la range côte à côte,
   erreurs encadrées.

   Ergonomie : glisser pour peindre, re-clic sur une main déjà de cette
   couleur pour l'effacer, clic droit = gomme, Maj+clic = rectangle depuis
   la dernière main cliquée, Ctrl+Z / Ctrl+Y, 1-8 pour changer d'action,
   « Remplir le reste » pour le fold.

   Deux entrées : la tuile de l'Arena (choix libre de la range) et le
   programme Fresco (launchFrescoForRange, qui reçoit le score via onComplete).
   ============================================ */

import { HANDS_MATRIX, getHandCombos, RANKS, TOTAL_COMBOS } from './poker-hands.js';
import { getSituationLabel } from './range-config.js';
import { getDepthLabel, loadRanges } from './range-model.js';
import { initPainter } from './range-painter.js';
import { showToast } from './toast.js';
import {
  loadSessionHistory, saveSessionHistory, recordSession, getSessions, FRESCO_HISTORY_KEY,
} from './session-history.js';
import { FRESCO_DEMO_RANGE } from './fresco-demo-range.js';

// === CONSTANTES ===

const PREFS_KEY = 'pokerlab_fresco_prefs';
const MAX_UNDO = 100;
const MAX_STORED_MISTAKES = 40;
const TOTAL_HANDS = HANDS_MATRIX.length;

const GRADES = [
  { min: 95, label: 'IMPERATOR' },
  { min: 85, label: 'VENI VIDI VICI' },
  { min: 70, label: 'ALEA IACTA EST' },
  { min: 0,  label: 'Entraîne-toi encore' },
];

// === ÉTAT ===

let onBack = null;
let showSelectView = null;
let showGameView = null;
let onComplete = null;      // (rangeId, pctHands) — posé par le programme, null depuis l'Arena
let completeFired = false;

let candidates = [];        // ranges peignables (standard, sans fréquences GTO)
let range = null;           // range cible
let target = {};            // range.cells nettoyée : index → action valide
let painted = {};           // index → action peinte
let activeAction = 0;       // -1 = gomme
let undoStack = [];
let redoStack = [];
let strokeBefore = null;    // instantané pris au début d'un coup de pinceau
let destroyPainter = null;
let phase = 'idle';         // 'idle' | 'painting' | 'result'
let startedAt = 0;
let result = null;
let prefs = loadPrefs();

// === INIT ===

export function initFresco({ onBack: back, showSelectView: showSelect, showGameView: showGame }) {
  onBack = back;
  showSelectView = showSelect;
  showGameView = showGame;
  migrateHistory();
  document.addEventListener('keydown', handleKeydown);
}

// Le programme et la tuile de l'Arena ne reviennent pas au même endroit
export function reconfigureFresco({ onBack: back, showSelectView: showSelect, onComplete: complete } = {}) {
  if (back !== undefined) onBack = back;
  if (showSelect !== undefined) showSelectView = showSelect;
  if (complete !== undefined) onComplete = complete;
}

// Entrée directe depuis le programme : pas de sélection, la range est imposée
export function launchFrescoForRange(r) {
  if (!isPaintable(r)) {
    showToast('Cette range ne peut pas être peinte (table Nash ou fréquences GTO).');
    onBack && onBack();
    return;
  }
  range = r;
  startSession();
}

function fromProgram() {
  return typeof onComplete === 'function';
}

function handleKeydown(e) {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  // Un bouton focalisé réagit déjà nativement à Entrée/Espace : ne pas doubler
  if (tag === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;
  // Les sous-vues gardent leur display quand on change de page : vérifier la page aussi
  if (document.getElementById('page-trainer')?.style.display === 'none') return;

  const selectView = document.getElementById('fresco-select-view');
  if (selectView && selectView.style.display !== 'none') {
    if (e.key === 'Enter' && range) { e.preventDefault(); startSession(); }
    return;
  }

  const view = document.getElementById('fresco-game-view');
  if (!view || view.style.display === 'none' || phase !== 'painting') return;

  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
  if (mod || e.altKey) return;

  if (/^[1-8]$/.test(e.key)) {
    const i = parseInt(e.key, 10) - 1;
    if (i < range.actionDefs.length) { e.preventDefault(); selectAction(i); }
    return;
  }
  if (e.key === '0' || e.key === 'e' || e.key === 'E') { e.preventDefault(); selectAction(-1); return; }
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); fillRest(); return; }
  if (e.key === 'Enter') { e.preventDefault(); validate(); }
}

// === ÉCRAN DE SÉLECTION ===

export function isPaintable(r) {
  return !!r && r.type !== 'nash' && Array.isArray(r.actionDefs) && r.actionDefs.length > 0
    && !Object.values(r.cells || {}).some(v => Array.isArray(v));
}

export function openFrescoSelect() {
  teardown();
  range = null;
  candidates = loadRanges().filter(isPaintable);

  const view = document.getElementById('fresco-select-view');
  view.innerHTML = `
    <div class="page-content">
      <div class="page-header">
        <h1>Fresco</h1>
        <p>Peins la range de mémoire, main par main. Le verdict tombe cellule par cellule.</p>
      </div>
      <div class="frise-divider"></div>

      <div class="fresco-setup">
        <div class="filters-row fresco-filters">
          <select id="fresco-filter-opponent" class="select-baroque">
            <option value="">Tous adversaires</option>
            <option value="reg">Reg</option>
            <option value="fish">Fish</option>
          </select>
          <select id="fresco-filter-situation" class="select-baroque"><option value="">Toutes positions</option></select>
          <select id="fresco-filter-depth" class="select-baroque"><option value="">Tous stacks</option></select>
        </div>

        <div class="fresco-range-list" id="fresco-range-list"></div>

        <div class="fresco-block-title">Range de démonstration</div>
        <div class="fresco-range-list" id="fresco-demo-list"></div>

        <div class="fresco-actions">
          <button id="btn-fresco-start" class="btn-gold" disabled>Peindre →</button>
          <button id="btn-fresco-back" class="btn-stone">Retour</button>
        </div>
        <div class="fresco-hint">
          Glisse pour peindre · re-clic sur une main de la même couleur pour l'effacer · clic droit = gomme ·
          Maj+clic = rectangle depuis la dernière main cliquée · 1–8 changent d'action · Ctrl+Z annule · Entrée valide.
        </div>
      </div>
    </div>`;

  populateFilters();
  renderRangeList();
  renderDemoCard();

  ['fresco-filter-opponent', 'fresco-filter-situation', 'fresco-filter-depth'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      prefs.opponent = document.getElementById('fresco-filter-opponent').value;
      prefs.situation = document.getElementById('fresco-filter-situation').value;
      prefs.depth = document.getElementById('fresco-filter-depth').value;
      savePrefs();
      renderRangeList();
    });
  });

  document.getElementById('btn-fresco-start').addEventListener('click', startSession);
  document.getElementById('btn-fresco-back').addEventListener('click', () => onBack && onBack());
}

function populateFilters() {
  const sitSelect = document.getElementById('fresco-filter-situation');
  const sitIds = [...new Set(candidates.map(r => r.situation).filter(Boolean))];
  sitIds.forEach(id => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = getSituationLabel(id) || id;
    sitSelect.appendChild(opt);
  });
  sitSelect.value = sitIds.includes(prefs.situation) ? prefs.situation : '';

  const depthSelect = document.getElementById('fresco-filter-depth');
  const depthMap = new Map();
  candidates.forEach(r => {
    const label = getDepthLabel(r);
    if (!depthMap.has(label)) depthMap.set(label, r.depthMin ?? 0);
  });
  const depths = [...depthMap.entries()].sort((a, b) => a[1] - b[1]).map(([label]) => label);
  depths.forEach(label => {
    const opt = document.createElement('option');
    opt.value = label;
    opt.textContent = label;
    depthSelect.appendChild(opt);
  });
  depthSelect.value = depths.includes(prefs.depth) ? prefs.depth : '';

  document.getElementById('fresco-filter-opponent').value = prefs.opponent || '';
}

function renderRangeList() {
  const list = document.getElementById('fresco-range-list');
  list.innerHTML = '';
  selectRange(null);

  const opp = document.getElementById('fresco-filter-opponent').value;
  const sit = document.getElementById('fresco-filter-situation').value;
  const depth = document.getElementById('fresco-filter-depth').value;

  const filtered = candidates.filter(r => {
    if (opp && (r.opponentType || 'reg') !== opp) return false;
    if (sit && r.situation !== sit) return false;
    if (depth && getDepthLabel(r) !== depth) return false;
    return true;
  });

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="fresco-empty">
        ${candidates.length === 0
          ? 'Aucune range peignable — crée-en une dans <strong>Mes Ranges</strong>, ou entraîne-toi sur la range de démonstration ci-dessous.'
          : 'Aucune range ne correspond aux filtres.'}
      </div>`;
    return;
  }

  filtered.forEach(r => list.appendChild(buildRangeCard(r)));
}

function renderDemoCard() {
  document.getElementById('fresco-demo-list').appendChild(buildRangeCard(FRESCO_DEMO_RANGE));
}

function buildRangeCard(r) {
  const situationLabel = getSituationLabel(r.situation) || r.situation || '';
  const oppLabel = r.opponentType === 'fish' ? 'Fish' : 'Reg';
  const subLabel = r.opponentSubcategory ? ` (${r.opponentSubcategory})` : '';
  const assigned = Object.keys(r.cells || {}).length;
  const stats = historyStats(r.id);

  const card = document.createElement('div');
  card.className = 'fresco-range-card' + (r.demo ? ' demo' : '');
  card.innerHTML = `
    <div class="fresco-range-info">
      <div class="fresco-range-name">${escapeHtml(r.name)}${r.demo ? '<span class="fresco-demo-badge">Démo</span>' : ''}</div>
      <div class="fresco-range-meta">${escapeHtml(situationLabel)} · ${escapeHtml(getDepthLabel(r))} · vs ${escapeHtml(oppLabel + subLabel)} · ${r.actionDefs.length} actions · ${assigned}/${TOTAL_HANDS} mains</div>
      <div class="fresco-range-swatches">${r.actionDefs.map(a => `<i style="background:${escapeHtml(a.color)}" title="${escapeHtml(a.label)}"></i>`).join('')}</div>
    </div>
    <div class="fresco-range-history">
      ${stats ? `
        <div class="fresco-range-last ${accClass(stats.last)}">${stats.last} %</div>
        <div class="fresco-range-best">meilleur ${stats.best} % · ${stats.count} fresque${stats.count > 1 ? 's' : ''}</div>`
        : '<div class="fresco-range-best">jamais peinte</div>'}
    </div>`;

  card.addEventListener('click', () => selectRange(r, card));
  card.addEventListener('dblclick', () => { selectRange(r, card); startSession(); });
  return card;
}

function selectRange(r, card = null) {
  range = r;
  document.querySelectorAll('.fresco-range-card').forEach(c => c.classList.toggle('selected', c === card));
  const btn = document.getElementById('btn-fresco-start');
  if (btn) btn.disabled = !r;
}

// === SESSION ===

function startSession() {
  if (!range) return;
  teardown();

  // Ne garder que les cellules qui pointent vers une action existante
  target = {};
  Object.entries(range.cells || {}).forEach(([idx, v]) => {
    if (Number.isInteger(v) && v >= 0 && v < range.actionDefs.length) target[idx] = v;
  });

  painted = {};
  undoStack = [];
  redoStack = [];
  strokeBefore = null;
  activeAction = 0;
  result = null;
  completeFired = false;
  phase = 'painting';
  startedAt = performance.now();

  showGameView && showGameView();
  renderGameShell();
}

function teardown() {
  if (destroyPainter) { destroyPainter(); destroyPainter = null; }
  phase = 'idle';
}

function rangeMetaLine() {
  const situationLabel = getSituationLabel(range.situation) || range.situation || '';
  const oppLabel = (range.opponentType === 'fish' ? 'Fish' : 'Reg') + (range.opponentSubcategory ? ` (${range.opponentSubcategory})` : '');
  return `${situationLabel} · ${getDepthLabel(range)} · vs ${oppLabel}`;
}

// === RENDU : ATELIER ===

function renderGameShell() {
  const view = document.getElementById('fresco-game-view');

  view.innerHTML = `
    <div class="page-content fresco-room">
      <div class="fresco-topbar">
        <button id="btn-fresco-quit" class="game-quit-btn">✕ Quitter</button>
        <div class="fresco-topbar-info">
          <div class="fresco-topbar-name">${escapeHtml(range.name)}</div>
          <div class="fresco-topbar-meta">${escapeHtml(rangeMetaLine())}${fromProgram() ? ' · <span class="fresco-topbar-program">Programme</span>' : ''}</div>
        </div>
        <div class="fresco-topbar-progress">
          <span class="fresco-count" id="fresco-count">0 / ${TOTAL_HANDS}</span>
          <div class="fresco-progress-bar"><div class="fresco-progress-fill" id="fresco-progress-fill"></div></div>
        </div>
      </div>

      <div class="fresco-body">
        <div class="fresco-board">
          <div class="matrix-container fresco-frame">
            <div class="matrix-felt-bg"></div>
            <div class="fresco-grid${prefs.labels === false ? '' : ' show-labels'}" id="fresco-grid"></div>
          </div>
        </div>

        <aside class="fresco-side">
          <div class="fresco-side-title">Palette</div>
          <div class="fresco-palette" id="fresco-palette"></div>

          <div class="fresco-side-title">Outils</div>
          <div class="fresco-tools">
            <button class="fresco-tool" id="btn-fresco-undo" title="Ctrl+Z">↶ Annuler</button>
            <button class="fresco-tool" id="btn-fresco-redo" title="Ctrl+Y">↷ Rétablir</button>
            <button class="fresco-tool" id="btn-fresco-fill" title="F — peint toutes les mains vides avec l'action active">Remplir le reste</button>
            <button class="fresco-tool danger" id="btn-fresco-clear">Tout effacer</button>
          </div>
          <div class="toggle-row fresco-toggle-row">
            <div class="toggle${prefs.labels === false ? '' : ' on'}" id="fresco-toggle-labels"></div>
            <span class="toggle-label">Labels des mains</span>
          </div>

          <button id="btn-fresco-validate" class="btn-gold fresco-validate">Valider la fresque</button>
          <div class="fresco-help">
            Glisse pour peindre · re-clic même couleur = effacer · clic droit = gomme<br>
            Maj+clic = rectangle depuis la dernière main cliquée<br>
            <kbd>1</kbd>–<kbd>8</kbd> action · <kbd>0</kbd> gomme · <kbd>F</kbd> remplir · <kbd>Ctrl+Z</kbd> annuler · <kbd>Entrée</kbd> valider
          </div>
        </aside>
      </div>
    </div>`;

  const grid = document.getElementById('fresco-grid');
  buildGrid(grid);
  renderPalette();
  updateCounts();
  updateToolButtons();

  destroyPainter = initPainter(grid, () => activeAction, handleCellChange, {
    onStrokeStart: () => { strokeBefore = { ...painted }; },
    onStrokeEnd: () => {
      if (strokeBefore && !sameCells(strokeBefore, painted)) pushUndo(strokeBefore);
      strokeBefore = null;
    },
  });

  document.getElementById('btn-fresco-quit').addEventListener('click', quit);
  [['btn-fresco-undo', undo], ['btn-fresco-redo', redo], ['btn-fresco-fill', fillRest], ['btn-fresco-clear', clearAll]]
    .forEach(([id, fn]) => {
      const btn = document.getElementById(id);
      btn.addEventListener('click', () => { fn(); btn.blur(); });
    });
  document.getElementById('btn-fresco-validate').addEventListener('click', validate);
  document.getElementById('fresco-toggle-labels').addEventListener('click', function () {
    this.classList.toggle('on');
    prefs.labels = this.classList.contains('on');
    savePrefs();
    document.querySelectorAll('.fresco-grid').forEach(g => g.classList.toggle('show-labels', prefs.labels));
  });
}

/** Grille 13×13 étiquetée (rangs en haut et à gauche). Les cellules portent data-index. */
function buildGrid(grid) {
  grid.innerHTML = '';
  const corner = document.createElement('div');
  corner.className = 'fresco-rank';
  grid.appendChild(corner);
  RANKS.forEach(r => {
    const lbl = document.createElement('div');
    lbl.className = 'fresco-rank';
    lbl.textContent = r;
    grid.appendChild(lbl);
  });
  RANKS.forEach((rowRank, rowIdx) => {
    const lbl = document.createElement('div');
    lbl.className = 'fresco-rank';
    lbl.textContent = rowRank;
    grid.appendChild(lbl);
    for (let colIdx = 0; colIdx < 13; colIdx++) {
      const i = rowIdx * 13 + colIdx;
      const cell = document.createElement('div');
      cell.className = 'mini-cell';
      cell.dataset.index = i;
      cell.textContent = HANDS_MATRIX[i];
      cell.title = HANDS_MATRIX[i];
      grid.appendChild(cell);
    }
  });
}

function renderPalette() {
  const el = document.getElementById('fresco-palette');
  el.innerHTML = '';
  range.actionDefs.forEach((def, i) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'fresco-chip' + (i === activeAction ? ' active' : '');
    chip.style.setProperty('--chip-color', def.color);
    chip.style.setProperty('--chip-text', contrastText(def.color));
    chip.innerHTML = `
      <kbd>${i + 1}</kbd>
      <span class="fresco-chip-dot"></span>
      <span class="fresco-chip-label">${escapeHtml(def.label)}</span>
      <span class="fresco-chip-count" data-action="${i}">0</span>`;
    chip.addEventListener('click', () => { selectAction(i); chip.blur(); });
    el.appendChild(chip);
  });

  const eraser = document.createElement('button');
  eraser.type = 'button';
  eraser.className = 'fresco-chip eraser' + (activeAction < 0 ? ' active' : '');
  eraser.innerHTML = `<kbd>0</kbd><span class="fresco-chip-dot"></span><span class="fresco-chip-label">Gomme</span>`;
  eraser.addEventListener('click', () => { selectAction(-1); eraser.blur(); });
  el.appendChild(eraser);
}

function selectAction(i) {
  if (phase !== 'painting') return;
  activeAction = i;
  document.querySelectorAll('.fresco-chip').forEach((chip, k) => {
    // le dernier chip est la gomme
    const idx = k < range.actionDefs.length ? k : -1;
    chip.classList.toggle('active', idx === i);
  });
  updateToolButtons();
}

// === PEINTURE ===

function handleCellChange(index, actionIdx) {
  if (phase !== 'painting') return;
  if (actionIdx === null || actionIdx < 0) delete painted[index];
  else painted[index] = actionIdx;
  paintCellEl(index);
  updateCounts();
}

function paintCellEl(index) {
  const cell = document.querySelector(`#fresco-grid .mini-cell[data-index="${index}"]`);
  if (!cell) return;
  applyCellFill(cell, painted[index] ?? null);
}

/** Applique la couleur d'une action (ou vide) à une cellule. */
function applyCellFill(cell, actionIdx) {
  const def = actionIdx === null || actionIdx === undefined ? null : range.actionDefs[actionIdx];
  if (def) {
    cell.classList.add('painted');
    cell.style.background = cellBackground(def.color);
    cell.style.color = contrastText(def.color);
    cell.dataset.action = actionIdx;
  } else {
    cell.classList.remove('painted');
    cell.style.background = '';
    cell.style.color = '';
    delete cell.dataset.action;
  }
}

function repaintAll() {
  HANDS_MATRIX.forEach((_, i) => paintCellEl(i));
  updateCounts();
  updateToolButtons();
}

function updateCounts() {
  const counts = range.actionDefs.map(() => 0);
  let total = 0;
  Object.values(painted).forEach(v => { if (counts[v] !== undefined) { counts[v]++; total++; } });

  document.querySelectorAll('.fresco-chip-count').forEach(el => {
    el.textContent = counts[parseInt(el.dataset.action, 10)] ?? 0;
  });
  const countEl = document.getElementById('fresco-count');
  if (countEl) countEl.textContent = `${total} / ${TOTAL_HANDS}`;
  const fill = document.getElementById('fresco-progress-fill');
  if (fill) fill.style.width = `${(total / TOTAL_HANDS) * 100}%`;

  const fillBtn = document.getElementById('btn-fresco-fill');
  if (fillBtn) fillBtn.disabled = activeAction < 0 || total >= TOTAL_HANDS;
}

function updateToolButtons() {
  const undoBtn = document.getElementById('btn-fresco-undo');
  const redoBtn = document.getElementById('btn-fresco-redo');
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  const fillBtn = document.getElementById('btn-fresco-fill');
  if (fillBtn) fillBtn.disabled = activeAction < 0 || Object.keys(painted).length >= TOTAL_HANDS;
}

// === ANNULER / RÉTABLIR ===

function pushUndo(snapshot) {
  undoStack.push(snapshot);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
  updateToolButtons();
}

function undo() {
  if (phase !== 'painting' || undoStack.length === 0) return;
  redoStack.push({ ...painted });
  painted = undoStack.pop();
  repaintAll();
}

function redo() {
  if (phase !== 'painting' || redoStack.length === 0) return;
  undoStack.push({ ...painted });
  painted = redoStack.pop();
  repaintAll();
}

function sameCells(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => a[k] === b[k]);
}

// === OUTILS ===

function fillRest() {
  if (phase !== 'painting' || activeAction < 0) return;
  const before = { ...painted };
  let n = 0;
  HANDS_MATRIX.forEach((_, i) => {
    if (painted[i] === undefined) { painted[i] = activeAction; n++; }
  });
  if (n === 0) { showToast('Toutes les mains sont déjà peintes'); return; }
  pushUndo(before);
  repaintAll();
  showToast(`${n} main${n > 1 ? 's' : ''} → ${range.actionDefs[activeAction].label}`);
}

function clearAll() {
  if (phase !== 'painting' || Object.keys(painted).length === 0) return;
  if (!confirm('Effacer toute la fresque ? (Ctrl+Z pour revenir en arrière)')) return;
  pushUndo({ ...painted });
  painted = {};
  repaintAll();
}

function quit() {
  if (phase === 'painting' && Object.keys(painted).length > 0
      && !confirm('Abandonner la fresque en cours ?')) return;
  teardown();
  if (fromProgram()) {
    // Lancée depuis le programme : on y retourne, sans passer par la sélection
    onBack && onBack();
    return;
  }
  openFrescoSelect();
  showSelectView && showSelectView();
}

// === VALIDATION ===

function validate() {
  if (phase !== 'painting') return;
  const empty = TOTAL_HANDS - Object.keys(painted).length;
  if (empty > 0 && !confirm(`${empty} main${empty > 1 ? 's' : ''} non peinte${empty > 1 ? 's' : ''}. Valider quand même ?`)) return;

  const seconds = Math.round((performance.now() - startedAt) / 1000);
  result = evaluate(seconds);
  phase = 'result';
  if (destroyPainter) { destroyPainter(); destroyPainter = null; }
  saveSession(result);
  renderResult();

  // Le programme reçoit le % de mains exactes (une fois par fresque)
  if (onComplete && !completeFired) {
    completeFired = true;
    onComplete(range.id, result.pctHands);
  }
}

function evaluate(seconds) {
  let correctHands = 0;
  let correctCombos = 0;
  const mistakes = []; // { idx, hand, mine, target } (null = vide)

  HANDS_MATRIX.forEach((hand, i) => {
    const t = target[i] ?? null;
    const m = painted[i] ?? null;
    if (t === m) {
      correctHands++;
      correctCombos += getHandCombos(hand);
    } else {
      mistakes.push({ idx: i, hand, mine: m, target: t });
    }
  });

  const pctHands = Math.round(correctHands / TOTAL_HANDS * 100);
  const grade = GRADES.find(g => pctHands >= g.min)?.label ?? GRADES[GRADES.length - 1].label;

  return { correctHands, totalHands: TOTAL_HANDS, correctCombos, totalCombos: TOTAL_COMBOS, pctHands, grade, seconds, mistakes };
}

// === RENDU : VERDICT — ta fresque et la range, côte à côte ===

function renderResult() {
  const view = document.getElementById('fresco-game-view');
  const r = result;
  const errors = r.mistakes.length;

  const actionsHtml = fromProgram()
    ? `<button id="btn-fresco-again" class="btn-stone">Repeindre</button>
       <button id="btn-fresco-hub" class="btn-gold">Retour au programme</button>`
    : `<button id="btn-fresco-again" class="btn-gold">Repeindre</button>
       <button id="btn-fresco-select" class="btn-stone">Changer de range</button>
       <button id="btn-fresco-hub" class="btn-stone">Arena</button>`;

  view.innerHTML = `
    <div class="page-content fresco-room">
      <div class="fresco-result-head">
        <div class="fresco-result-score">
          <div class="fresco-result-pct ${accClass(r.pctHands)}">${r.pctHands} %</div>
          <div class="fresco-result-grade">${escapeHtml(r.grade)}</div>
        </div>
        <div class="fresco-result-detail">
          <div class="fresco-result-range">${escapeHtml(range.name)}</div>
          <div class="fresco-result-meta">${escapeHtml(rangeMetaLine())}</div>
          <div class="fresco-result-numbers">
            <strong>${r.correctHands} / ${r.totalHands}</strong> mains exactes ·
            <strong>${errors}</strong> erreur${errors > 1 ? 's' : ''} ·
            peinte en ${formatDuration(r.seconds)}
          </div>
        </div>
        <div class="fresco-actions fresco-result-actions">${actionsHtml}</div>
      </div>

      <div class="fresco-compare">
        <div class="fresco-compare-col">
          <div class="fresco-compare-title">Ta fresque <span>erreurs encadrées</span></div>
          <div class="matrix-container fresco-frame">
            <div class="matrix-felt-bg"></div>
            <div class="fresco-grid readonly${prefs.labels === false ? '' : ' show-labels'}" id="fresco-grid-mine"></div>
          </div>
        </div>
        <div class="fresco-compare-col">
          <div class="fresco-compare-title">La range <span>ce qu'il fallait peindre</span></div>
          <div class="matrix-container fresco-frame">
            <div class="matrix-felt-bg"></div>
            <div class="fresco-grid readonly${prefs.labels === false ? '' : ' show-labels'}" id="fresco-grid-solution"></div>
          </div>
        </div>
      </div>
      <div class="fresco-legend" id="fresco-legend"></div>
    </div>`;

  renderCompareGrids();
  renderLegend();

  document.getElementById('btn-fresco-again').addEventListener('click', startSession);
  document.getElementById('btn-fresco-select')?.addEventListener('click', () => {
    openFrescoSelect();
    showSelectView && showSelectView();
  });
  document.getElementById('btn-fresco-hub').addEventListener('click', () => { teardown(); onBack && onBack(); });
}

function renderCompareGrids() {
  const mine = document.getElementById('fresco-grid-mine');
  const solution = document.getElementById('fresco-grid-solution');
  buildGrid(mine);
  buildGrid(solution);
  const labelOf = idx => idx === null ? 'vide' : range.actionDefs[idx].label;
  const wrong = new Set(result.mistakes.map(m => m.idx));

  HANDS_MATRIX.forEach((hand, i) => {
    const t = target[i] ?? null;
    const m = painted[i] ?? null;
    const mc = mine.querySelector(`.mini-cell[data-index="${i}"]`);
    const sc = solution.querySelector(`.mini-cell[data-index="${i}"]`);
    applyCellFill(mc, m);
    applyCellFill(sc, t);
    const tip = wrong.has(i)
      ? `${hand} — toi : ${labelOf(m)} · attendu : ${labelOf(t)}`
      : `${hand} — ${labelOf(t)} ✓`;
    mc.title = tip;
    sc.title = tip;
    if (wrong.has(i)) {
      mc.classList.add('wrong');
      sc.classList.add('wrong-peer');
    }
  });

  linkGrids(mine, solution);
}

// Survoler une main dans une grille la met en relief dans l'autre
function linkGrids(a, b) {
  const pair = [[a, b], [b, a]];
  pair.forEach(([from, to]) => {
    from.addEventListener('mouseover', e => {
      const cell = e.target.closest('.mini-cell');
      if (!cell) return;
      to.querySelectorAll('.peer-hover').forEach(c => c.classList.remove('peer-hover'));
      to.querySelector(`.mini-cell[data-index="${cell.dataset.index}"]`)?.classList.add('peer-hover');
    });
    from.addEventListener('mouseleave', () => {
      to.querySelectorAll('.peer-hover').forEach(c => c.classList.remove('peer-hover'));
    });
  });
}

function renderLegend() {
  const el = document.getElementById('fresco-legend');
  el.innerHTML = range.actionDefs.map(a =>
    `<span class="fresco-legend-item"><i style="background:${escapeHtml(a.color)}"></i>${escapeHtml(a.label)}</span>`).join('');
  const note = document.createElement('span');
  note.className = 'fresco-legend-note';
  note.textContent = 'Cadre plein = main fausse dans ta fresque · cadre pointillé = la bonne action en face · survole une main pour la retrouver dans l\'autre grille';
  el.appendChild(note);
}

// === HISTORIQUE (store partagé, même forme que le Colosseum) ===

function saveSession(r) {
  const labelOf = idx => idx === null ? 'vide' : range.actionDefs[idx].label;
  try {
    recordSession(range.id, {
      date: new Date().toISOString(),
      correct: r.correctHands,
      total: r.totalHands,
      combosCorrect: r.correctCombos,
      combosTotal: r.totalCombos,
      seconds: r.seconds,
      mistakes: r.mistakes.slice(0, MAX_STORED_MISTAKES).map(m => ({ hand: m.hand, chosen: labelOf(m.mine), correct: labelOf(m.target) })),
    }, FRESCO_HISTORY_KEY);
  } catch {
    /* stockage indisponible : la session est perdue, l'outil reste utilisable */
  }
}

function historyStats(rangeId) {
  const sessions = getSessions(rangeId, null, FRESCO_HISTORY_KEY);
  if (sessions.length === 0) return null;
  const pcts = sessions.map(s => s.accuracy);
  return { last: pcts[pcts.length - 1], best: Math.max(...pcts), count: sessions.length };
}

// Le prototype stockait { at, correctHands, totalHands, mistakes:[{mine,target}] } :
// on convertit une fois vers la forme partagée pour que le programme lise tout.
function migrateHistory() {
  try {
    const store = loadSessionHistory(FRESCO_HISTORY_KEY);
    let changed = false;
    Object.keys(store).forEach(id => {
      store[id] = (store[id] || []).map(s => {
        if (!s || s.date || !s.at) return s;
        changed = true;
        return {
          date: s.at,
          correct: s.correctHands,
          total: s.totalHands,
          combosCorrect: s.correctCombos,
          combosTotal: s.totalCombos,
          seconds: s.seconds,
          mistakes: (s.mistakes || []).map(m => ({ hand: m.hand, chosen: m.mine ?? 'vide', correct: m.target ?? 'vide' })),
        };
      });
    });
    if (changed) saveSessionHistory(store, FRESCO_HISTORY_KEY);
  } catch {
    /* ignore */
  }
}

// === PRÉFÉRENCES ===

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  } catch {
    return {};
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

// === UTILITAIRES ===

function cellBackground(color) {
  const [r, g, b] = parseHex(color);
  const darker = `rgb(${Math.max(0, r - 30)},${Math.max(0, g - 30)},${Math.max(0, b - 30)})`;
  return `linear-gradient(135deg, ${color}, ${darker})`;
}

/** Texte sombre sur les couleurs claires (blanc, jaune, cyan…), crème sinon. */
function contrastText(color) {
  const [r, g, b] = parseHex(color);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#1a1510' : '#f0e8d8';
}

function parseHex(color) {
  let hex = (color || '').trim().replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return [122, 106, 80];
  return [0, 2, 4].map(o => parseInt(hex.slice(o, o + 2), 16));
}

function accClass(pct) {
  return pct >= 95 ? 'acc-good' : pct >= 80 ? 'acc-mid' : 'acc-low';
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} min ${s.toString().padStart(2, '0')} s` : `${s} s`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
