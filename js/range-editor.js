/* ============================================
   PokerLab — Range Editor View
   Metadata form, action config, matrix, stats
   ============================================ */

import { HANDS_MATRIX, getHandCombos, TOTAL_COMBOS } from './poker-hands.js';
import { getRangeStats } from './range-model.js';
import {
  getAllSituations, addCustomSituation,
  getSubcategoriesFor, addSubcategory,
  ACTION_COLOR_PALETTE, getNextAvailableColor,
} from './range-config.js';
import { initPainter } from './range-painter.js';
import { showToast } from './toast.js';

let currentRange = null;
let activeActionIndex = 0;
let onSave = null;
let onBack = null;
let destroyPainter = null;

export function initEditor({ onSaveRange, onBackToList }) {
  onSave = onSaveRange;
  onBack = onBackToList;

  document.getElementById('btn-save-range').addEventListener('click', handleSave);
  document.getElementById('btn-back-to-list').addEventListener('click', handleBack);
  document.getElementById('btn-add-action').addEventListener('click', handleAddAction);

  // Situation select: show custom input when "custom" is selected
  document.getElementById('editor-situation').addEventListener('change', (e) => {
    const isCustom = e.target.value === '__custom__';
    document.getElementById('editor-situation-custom').style.display = isCustom ? '' : 'none';
    document.getElementById('btn-add-situation').style.display = isCustom ? '' : 'none';
  });
  document.getElementById('btn-add-situation').addEventListener('click', () => {
    const input = document.getElementById('editor-situation-custom');
    const label = input.value.trim();
    if (!label) return;
    const sit = addCustomSituation(label);
    populateSituationSelect();
    document.getElementById('editor-situation').value = sit.id;
    input.value = '';
    input.style.display = 'none';
    document.getElementById('btn-add-situation').style.display = 'none';
  });

  // Opponent type change -> update subcategories + GTO mode + sync currentRange
  document.getElementById('editor-opponent').addEventListener('change', () => {
    if (currentRange) currentRange.opponentType = document.getElementById('editor-opponent').value;
    populateSubcategorySelect();
    updateGTOMode();
    renderMatrix();
  });

  // GTO import buttons
  document.getElementById('btn-gto-import').addEventListener('click', handleGTOImport);
  document.getElementById('btn-gto-clear').addEventListener('click', handleGTOClear);

  // Subcategory: show custom input when "custom" is selected
  document.getElementById('editor-subcategory').addEventListener('change', (e) => {
    const isCustom = e.target.value === '__custom__';
    document.getElementById('editor-subcategory-custom').style.display = isCustom ? '' : 'none';
    document.getElementById('btn-add-subcategory').style.display = isCustom ? '' : 'none';
  });
  document.getElementById('btn-add-subcategory').addEventListener('click', () => {
    const input = document.getElementById('editor-subcategory-custom');
    const label = input.value.trim();
    if (!label) return;
    const oppType = document.getElementById('editor-opponent').value;
    addSubcategory(oppType, label);
    populateSubcategorySelect();
    document.getElementById('editor-subcategory').value = label;
    input.value = '';
    input.style.display = 'none';
    document.getElementById('btn-add-subcategory').style.display = 'none';
  });

  // Hand label toggle
  document.getElementById('toggle-labels').addEventListener('click', function () {
    this.classList.toggle('on');
    const matrix = document.getElementById('editor-matrix');
    matrix.classList.toggle('show-labels', this.classList.contains('on'));
  });
}

export function openEditor(range) {
  currentRange = structuredClone(range);
  activeActionIndex = 0;

  // Populate form
  document.getElementById('editor-name').value = currentRange.name;

  populateSituationSelect();
  document.getElementById('editor-situation').value = currentRange.situation;
  document.getElementById('editor-situation-custom').style.display = 'none';
  document.getElementById('btn-add-situation').style.display = 'none';

  document.getElementById('editor-depth-min').value = currentRange.depthMin;
  document.getElementById('editor-depth-max').value = currentRange.depthMax;

  document.getElementById('editor-opponent').value = currentRange.opponentType;
  populateSubcategorySelect();
  document.getElementById('editor-subcategory').value = currentRange.opponentSubcategory || '';
  updateGTOMode();

  document.getElementById('editor-subcategory-custom').style.display = 'none';
  document.getElementById('btn-add-subcategory').style.display = 'none';

  // Update panel title
  updatePanelTitle();

  // Render action config
  renderActionConfig();

  // Render action bar
  renderActionBar();

  // Render matrix
  renderMatrix();

  // Clean up previous painter if any, then init new one
  if (destroyPainter) destroyPainter();
  const matrixEl = document.getElementById('editor-matrix');
  destroyPainter = initPainter(matrixEl, () => activeActionIndex, handleCellChange);

  // Update stats
  updateStats();

  // Ensure labels toggle state is applied
  const toggleLabels = document.getElementById('toggle-labels');
  matrixEl.classList.toggle('show-labels', toggleLabels.classList.contains('on'));
}

// === FORM HELPERS ===

function populateSituationSelect() {
  const select = document.getElementById('editor-situation');
  const current = select.value;
  select.innerHTML = '';
  getAllSituations().forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.label;
    select.appendChild(opt);
  });
  // Add custom option
  const customOpt = document.createElement('option');
  customOpt.value = '__custom__';
  customOpt.textContent = 'Personnaliser...';
  select.appendChild(customOpt);
  if (current) select.value = current;
}

function populateSubcategorySelect() {
  const oppType = document.getElementById('editor-opponent').value;
  const select = document.getElementById('editor-subcategory');
  const current = select.value;
  select.innerHTML = '<option value="">Aucune</option>';
  getSubcategoriesFor(oppType).forEach(sub => {
    const opt = document.createElement('option');
    opt.value = sub;
    opt.textContent = sub;
    select.appendChild(opt);
  });
  const customOpt = document.createElement('option');
  customOpt.value = '__custom__';
  customOpt.textContent = 'Autre...';
  select.appendChild(customOpt);
  if (current) select.value = current;
}

function updatePanelTitle() {
  const el = document.getElementById('editor-panel-title');
  el.textContent = currentRange.name || 'Nouvelle Range';
}

// === ACTION CONFIG PANEL ===

function renderActionConfig() {
  const container = document.getElementById('action-config-list');
  container.innerHTML = '';

  currentRange.actionDefs.forEach((action, i) => {
    const row = document.createElement('div');
    row.className = 'action-config-row';

    // Color swatch
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.background = action.color;
    swatch.addEventListener('click', (e) => openColorPicker(e, i));
    row.appendChild(swatch);

    // Label input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'action-label-input';
    input.value = action.label;
    input.addEventListener('change', () => {
      currentRange.actionDefs[i].label = input.value.trim() || `Action ${i + 1}`;
      renderActionBar();
      updateStats();
    });
    row.appendChild(input);

    // Delete button (hidden if only 2 actions)
    if (currentRange.actionDefs.length > 2) {
      const delBtn = document.createElement('button');
      delBtn.className = 'action-delete-btn';
      delBtn.textContent = '✕';
      delBtn.title = 'Supprimer cette action';
      delBtn.addEventListener('click', () => handleDeleteAction(i));
      row.appendChild(delBtn);
    }

    container.appendChild(row);
  });

  // Update add button state
  const addBtn = document.getElementById('btn-add-action');
  addBtn.disabled = currentRange.actionDefs.length >= 8;
  addBtn.style.opacity = currentRange.actionDefs.length >= 8 ? '0.4' : '1';

  // Keep GTO action selector in sync
  populateGTOActionSelect();
}

function openColorPicker(event, actionIndex) {
  // Close any existing picker
  closeColorPicker();

  const picker = document.createElement('div');
  picker.className = 'color-palette';
  picker.id = 'active-color-picker';

  ACTION_COLOR_PALETTE.forEach(color => {
    const swatch = document.createElement('div');
    swatch.className = 'color-palette-swatch';
    if (currentRange.actionDefs[actionIndex].color === color) {
      swatch.classList.add('selected');
    }
    swatch.style.background = color;
    swatch.addEventListener('click', () => {
      currentRange.actionDefs[actionIndex].color = color;
      closeColorPicker();
      renderActionConfig();
      renderActionBar();
      renderMatrix();
      updateStats();
    });
    picker.appendChild(swatch);
  });

  // Custom color input
  const customDiv = document.createElement('div');
  customDiv.className = 'color-palette-custom';
  const customInput = document.createElement('input');
  customInput.type = 'color';
  customInput.value = currentRange.actionDefs[actionIndex].color;
  customInput.addEventListener('input', () => {
    currentRange.actionDefs[actionIndex].color = customInput.value;
    renderActionConfig();
    renderActionBar();
    renderMatrix();
    updateStats();
  });
  customInput.addEventListener('change', () => closeColorPicker());
  customDiv.appendChild(customInput);
  picker.appendChild(customDiv);

  // Position near the swatch
  const swatch = event.currentTarget;
  swatch.style.position = 'relative';
  swatch.appendChild(picker);

  // Close on outside click (next frame)
  requestAnimationFrame(() => {
    document.addEventListener('click', handlePickerOutsideClick);
  });
}

function handlePickerOutsideClick(e) {
  const picker = document.getElementById('active-color-picker');
  if (picker && !picker.contains(e.target) && !e.target.classList.contains('color-swatch')) {
    closeColorPicker();
  }
}

function closeColorPicker() {
  const picker = document.getElementById('active-color-picker');
  if (picker) picker.remove();
  document.removeEventListener('click', handlePickerOutsideClick);
}

// === ACTION BAR (in matrix panel) ===

function renderActionBar() {
  const bar = document.getElementById('editor-action-bar');
  bar.innerHTML = '';

  currentRange.actionDefs.forEach((action, i) => {
    const chip = document.createElement('div');
    chip.className = 'action-chip' + (i === activeActionIndex ? ' active' : '');
    chip.style.setProperty('--chip-color', action.color);
    chip.innerHTML = `<span class="dot"></span> ${escapeHtml(action.label)}`;
    chip.title = action.label;
    chip.addEventListener('click', () => {
      activeActionIndex = i;
      renderActionBar();
    });
    bar.appendChild(chip);
  });

  // Eraser
  const eraser = document.createElement('div');
  eraser.className = 'action-chip eraser' + (activeActionIndex < 0 ? ' active' : '');
  eraser.innerHTML = '<span class="dot"></span> Gomme';
  eraser.addEventListener('click', () => {
    activeActionIndex = -1;
    renderActionBar();
  });
  bar.appendChild(eraser);
}

// === MATRIX ===

function renderMatrix() {
  const matrixEl = document.getElementById('editor-matrix');
  matrixEl.innerHTML = '';
  const isGTO = currentRange.opponentType === 'gto';

  HANDS_MATRIX.forEach((hand, i) => {
    const cell = document.createElement('div');
    cell.className = 'mini-cell';
    cell.dataset.index = i;
    cell.textContent = hand;

    const cellData = currentRange.cells[i];

    if (isGTO && Array.isArray(cellData)) {
      // GTO format: fractional cell
      const bg = gtoCellBackground(cellData, currentRange.actionDefs);
      if (bg) {
        cell.classList.add('painted');
        cell.style.background = bg;
      }
      cell.title = gtoTooltip(hand, cellData, currentRange.actionDefs);
    } else if (!isGTO && cellData !== undefined && cellData >= 0 && cellData < currentRange.actionDefs.length) {
      // Regular format
      cell.classList.add('painted');
      cell.style.background = cellBackground(currentRange.actionDefs[cellData].color);
      cell.dataset.action = cellData;
      cell.title = hand;
    } else {
      cell.title = hand;
    }

    matrixEl.appendChild(cell);
  });
}

function handleCellChange(index, actionIndex) {
  if (currentRange.opponentType === 'gto') return; // GTO ranges are import-only
  const cell = document.querySelector(`#editor-matrix .mini-cell[data-index="${index}"]`);
  if (!cell) return;

  if (actionIndex === null || actionIndex < 0) {
    // Erase
    delete currentRange.cells[index];
    cell.classList.remove('painted');
    cell.style.background = '';
    delete cell.dataset.action;
  } else {
    // Paint
    currentRange.cells[index] = actionIndex;
    cell.classList.add('painted');
    cell.style.background = cellBackground(currentRange.actionDefs[actionIndex].color);
    cell.dataset.action = actionIndex;
  }

  updateStats();
}

function cellBackground(color) {
  // Create a gradient similar to the original raise/call styling
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const darker = `rgb(${Math.max(0, r - 30)},${Math.max(0, g - 30)},${Math.max(0, b - 30)})`;
  return `linear-gradient(135deg, ${color}, ${darker})`;
}

function gtoCellBackground(freqs, actionDefs) {
  const stops = [];
  let pos = 0;
  freqs.forEach((f, i) => {
    if (f < 0.005 || i >= actionDefs.length) return; // skip near-zero (<0.5%)
    const color = actionDefs[i].color;
    stops.push(`${color} ${(pos * 100).toFixed(1)}%`);
    stops.push(`${color} ${((pos + f) * 100).toFixed(1)}%`);
    pos += f;
  });
  if (stops.length === 0) return '';
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

function gtoTooltip(hand, freqs, actionDefs) {
  const parts = freqs
    .map((f, i) => i < actionDefs.length && f >= 0.005
      ? `${actionDefs[i].label} ${Math.round(f * 100)}%`
      : null)
    .filter(Boolean);
  return parts.length > 0 ? `${hand} — ${parts.join(' | ')}` : hand;
}

// === GTO MODE ===

function updateGTOMode() {
  const isGTO = document.getElementById('editor-opponent').value === 'gto';
  document.getElementById('editor-action-bar').style.display = isGTO ? 'none' : '';
  document.getElementById('gto-import-panel').style.display = isGTO ? '' : 'none';
  if (isGTO) populateGTOActionSelect();
}

function populateGTOActionSelect() {
  if (!currentRange) return;
  const select = document.getElementById('gto-action-select');
  const current = select.value;
  select.innerHTML = '';
  currentRange.actionDefs.forEach((action, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = action.label;
    select.appendChild(opt);
  });
  // Try to restore previous selection
  if (current !== '' && select.querySelector(`option[value="${current}"]`)) {
    select.value = current;
  }
}

function handleGTOImport() {
  const text = document.getElementById('gto-paste-area').value.trim();
  if (!text) return;

  const actionIdx = parseInt(document.getElementById('gto-action-select').value, 10);
  if (isNaN(actionIdx)) return;

  const parsed = parseGTOWizardText(text);
  const actionCount = currentRange.actionDefs.length;

  HANDS_MATRIX.forEach((hand, i) => {
    // Ensure cell is an array
    if (!Array.isArray(currentRange.cells[i])) {
      currentRange.cells[i] = new Array(actionCount).fill(0);
    }
    // Extend array if actions were added after last import
    while (currentRange.cells[i].length < actionCount) {
      currentRange.cells[i].push(0);
    }
    // Set frequency for this action (0 if not in parsed data)
    currentRange.cells[i][actionIdx] = parsed.get(hand) ?? 0;
  });

  document.getElementById('gto-paste-area').value = '';
  renderMatrix();
  updateStats();
  showToast(`Action "${currentRange.actionDefs[actionIdx].label}" importée`);
}

function handleGTOClear() {
  const actionIdx = parseInt(document.getElementById('gto-action-select').value, 10);
  if (isNaN(actionIdx)) return;

  HANDS_MATRIX.forEach((hand, i) => {
    if (Array.isArray(currentRange.cells[i])) {
      currentRange.cells[i][actionIdx] = 0;
    }
  });

  renderMatrix();
  updateStats();
}

// === GTO WIZARD PARSER ===

const RANKS_ORDER = 'AKQJT98765432';

function parseGTOWizardText(text) {
  // Matches e.g. "Ac7d: 0.0014" or "Ac7d:1"
  const regex = /([AKQJTakqjt2-9][cdhsCDHS][AKQJTakqjt2-9][cdhsCDHS])\s*:\s*([0-9]*\.?[0-9]+)/g;
  const groups = new Map(); // handType -> [frequencies]
  let match;
  while ((match = regex.exec(text)) !== null) {
    const handType = comboToHandType(match[1]);
    if (!handType) continue;
    const freq = parseFloat(match[2]);
    if (!groups.has(handType)) groups.set(handType, []);
    groups.get(handType).push(freq);
  }
  // Average frequencies across all combos of each hand type
  const result = new Map();
  groups.forEach((freqs, handType) => {
    const avg = freqs.reduce((a, b) => a + b, 0) / freqs.length;
    result.set(handType, Math.min(1, avg));
  });
  return result;
}

function comboToHandType(combo) {
  const c = combo.toUpperCase();
  const rank1 = c[0];
  const suit1 = c[1].toLowerCase();
  const rank2 = c[2];
  const suit2 = c[3].toLowerCase();

  const r1 = RANKS_ORDER.indexOf(rank1);
  const r2 = RANKS_ORDER.indexOf(rank2);
  if (r1 < 0 || r2 < 0) return null;

  if (r1 === r2) {
    // Pair
    return rank1 + rank2;
  }

  const suited = suit1 === suit2;
  const [high, low] = r1 < r2 ? [rank1, rank2] : [rank2, rank1];
  return high + low + (suited ? 's' : 'o');
}

// === STATS ===

function updateStats() {
  const stats = getRangeStats(currentRange);
  const container = document.getElementById('editor-stats-row');
  container.innerHTML = '';

  currentRange.actionDefs.forEach((action, i) => {
    const pill = document.createElement('div');
    pill.className = 'stat-pill';
    pill.innerHTML = `
      <span class="stat-value" style="color:${action.color}">${stats.percentages[i]}%</span>
      <span class="stat-label">${escapeHtml(action.label)}</span>
    `;
    container.appendChild(pill);
  });

  // Unassigned pill
  if (stats.unassignedPct > 0) {
    const pill = document.createElement('div');
    pill.className = 'stat-pill';
    pill.innerHTML = `
      <span class="stat-value" style="color:var(--cream-muted)">${stats.unassignedPct}%</span>
      <span class="stat-label">Vide</span>
    `;
    container.appendChild(pill);
  }
}

// === ACTION MANAGEMENT ===

function handleAddAction() {
  if (currentRange.actionDefs.length >= 8) return;

  const usedColors = currentRange.actionDefs.map(a => a.color);
  const color = getNextAvailableColor(usedColors);
  const index = currentRange.actionDefs.length + 1;

  currentRange.actionDefs.push({ label: `Action ${index}`, color });
  renderActionConfig();
  renderActionBar();
  updateStats();
}

function handleDeleteAction(actionIndex) {
  // Count cells assigned to this action
  const assignedCells = Object.entries(currentRange.cells)
    .filter(([, v]) => v === actionIndex);

  if (assignedCells.length > 0) {
    if (!confirm(`Cette action est assignée à ${assignedCells.length} mains. Supprimer ?`)) {
      return;
    }
  }

  // Remove action and reindex
  currentRange.actionDefs.splice(actionIndex, 1);

  const newCells = {};
  for (const [idx, action] of Object.entries(currentRange.cells)) {
    if (action === actionIndex) continue; // Remove cells with deleted action
    if (action > actionIndex) {
      newCells[idx] = action - 1; // Decrement
    } else {
      newCells[idx] = action;
    }
  }
  currentRange.cells = newCells;

  // Adjust active action if needed
  if (activeActionIndex >= currentRange.actionDefs.length) {
    activeActionIndex = currentRange.actionDefs.length - 1;
  }
  if (activeActionIndex === actionIndex) {
    activeActionIndex = 0;
  }

  renderActionConfig();
  renderActionBar();
  renderMatrix();
  updateStats();
}

// === SAVE / BACK ===

function readFormIntoRange() {
  currentRange.name = document.getElementById('editor-name').value.trim() || 'Range sans nom';

  const sitSelect = document.getElementById('editor-situation');
  if (sitSelect.value !== '__custom__') {
    currentRange.situation = sitSelect.value;
  }

  currentRange.depthMin = parseFloat(document.getElementById('editor-depth-min').value) || 10;
  currentRange.depthMax = parseFloat(document.getElementById('editor-depth-max').value) || 15;
  if (currentRange.depthMax < currentRange.depthMin) {
    currentRange.depthMax = currentRange.depthMin;
  }

  currentRange.opponentType = document.getElementById('editor-opponent').value;

  const subSelect = document.getElementById('editor-subcategory');
  if (subSelect.value !== '__custom__') {
    currentRange.opponentSubcategory = subSelect.value;
  }
}

function handleSave() {
  readFormIntoRange();
  onSave(currentRange);
  showToast('Range sauvegardée');
}

function handleBack() {
  onBack();
}

export function getCurrentRange() {
  return currentRange;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
