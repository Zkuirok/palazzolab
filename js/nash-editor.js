/* ============================================
   PokerLab — Nash Editor
   Handles editing of Nash push/fold threshold tables
   ============================================ */

import { HANDS_MATRIX, getHandCombos, TOTAL_COMBOS } from './poker-hands.js';
import { getNashStats } from './range-model.js';
import { nashCellColor } from './range-config.js';
import { showToast } from './toast.js';

let currentRange = null;
let onSave = null;
let onBack = null;

export function initNashEditor({ onSaveRange, onBackToList }) {
  onSave = onSaveRange;
  onBack = onBackToList;

  document.getElementById('btn-save-nash').addEventListener('click', handleNashSave);
  document.getElementById('btn-back-from-nash').addEventListener('click', () => onBack());
  document.getElementById('btn-nash-clear-all').addEventListener('click', handleNashClearAll);
}

const POSITION_OPTIONS = {
  HU: ['SB', 'BB'],
  '3H': ['BTN', 'SB', 'BB'],
};

export function openNashEditor(range) {
  currentRange = structuredClone(range);
  document.getElementById('nash-editor-name').value = currentRange.name;

  // Populate chartType
  document.getElementById('nash-editor-charttype').value = currentRange.chartType || 'push';

  // Populate format and position
  const formatEl = document.getElementById('nash-editor-format');
  const positionEl = document.getElementById('nash-editor-position');
  formatEl.value = currentRange.format || 'HU';
  populatePositionOptions(formatEl.value, positionEl, currentRange.position || 'SB');

  // Wire format change → update position options
  formatEl.onchange = () => {
    populatePositionOptions(formatEl.value, positionEl, null);
  };

  renderNashMatrix();
  updateNashStats();
}

function populatePositionOptions(format, positionEl, currentPosition) {
  const options = POSITION_OPTIONS[format] || ['SB', 'BB'];
  positionEl.innerHTML = '';
  options.forEach(pos => {
    const opt = document.createElement('option');
    opt.value = pos;
    opt.textContent = pos;
    positionEl.appendChild(opt);
  });
  // Restore selection if valid
  if (currentPosition && options.includes(currentPosition)) {
    positionEl.value = currentPosition;
  }
}

// === MATRIX ===

function renderNashMatrix() {
  const matrixEl = document.getElementById('nash-editor-matrix');
  matrixEl.innerHTML = '';

  HANDS_MATRIX.forEach((hand, i) => {
    const cell = document.createElement('div');
    cell.className = 'mini-cell nash-cell';
    cell.dataset.index = i;

    const threshold = currentRange.cells[i];
    applyNashCellStyle(cell, hand, threshold);

    cell.addEventListener('click', () => {
      // Prevent opening multiple inputs simultaneously
      if (matrixEl.querySelector('.nash-cell-input')) return;
      openNashCellInput(cell, i, hand);
    });

    matrixEl.appendChild(cell);
  });
}

function openNashCellInput(cell, index, hand) {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'nash-cell-input';
  input.min = '0';
  input.max = '999';
  input.step = '0.5';
  input.placeholder = '—';

  const existing = currentRange.cells[index];
  if (existing !== undefined && existing < 999) {
    input.value = existing;
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitNashInput(input, index, cell, hand);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      input.remove();
      // Restore cell appearance without saving
      applyNashCellStyle(cell, hand, currentRange.cells[index]);
    }
    // Delete/Backspace on empty input clears the cell value
    if ((e.key === 'Delete' || e.key === 'Backspace') && input.value === '') {
      e.preventDefault();
      delete currentRange.cells[index];
      input.remove();
      applyNashCellStyle(cell, hand, undefined);
      updateNashStats();
    }
  });

  // Auto-commit on blur (clicking elsewhere or moving to next cell)
  input.addEventListener('blur', () => {
    commitNashInput(input, index, cell, hand);
  });

  cell.appendChild(input);
  input.focus();
  input.select();
}

function commitNashInput(input, index, cell, hand) {
  // Guard: already removed (e.g., by keydown handler)
  if (!input.isConnected) return;

  const val = input.value.trim();

  if (val === '' || val === '-') {
    delete currentRange.cells[index];
  } else {
    const num = parseFloat(val);
    if (!isNaN(num) && num >= 0) {
      currentRange.cells[index] = num;
    }
  }

  input.remove();
  applyNashCellStyle(cell, hand, currentRange.cells[index]);
  updateNashStats();
}

function applyNashCellStyle(cell, hand, threshold) {
  // Remove any lingering input before restyling
  const existingInput = cell.querySelector('.nash-cell-input');
  if (existingInput) existingInput.remove();

  if (threshold === undefined) {
    cell.classList.remove('painted');
    cell.style.background = '';
    cell.style.color = '';
    cell.textContent = hand;
    cell.title = `${hand} — non défini`;
  } else {
    const color = nashCellColor(threshold);
    const displayText = threshold >= 999 ? '∞' : String(threshold);
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    const darker = `rgb(${Math.max(0, r - 30)},${Math.max(0, g - 30)},${Math.max(0, b - 30)})`;
    cell.classList.add('painted');
    cell.style.background = `linear-gradient(135deg, ${color}, ${darker})`;
    cell.textContent = displayText;
    cell.title = threshold >= 999 ? `${hand} — toujours` : `${hand} — push ≤ ${threshold} BB`;
  }
}

// === STATS ===

function updateNashStats() {
  const stats = getNashStats(currentRange);
  const container = document.getElementById('nash-stats-row');
  container.innerHTML = `
    <div class="stat-pill">
      <span class="stat-value" style="color:var(--gold-light)">${stats.definedHands}</span>
      <span class="stat-label">Mains définies</span>
    </div>
    <div class="stat-pill">
      <span class="stat-value" style="color:var(--gold-light)">${stats.definedPct}%</span>
      <span class="stat-label">Combos couverts</span>
    </div>
    <div class="stat-pill">
      <span class="stat-value" style="color:var(--cream-muted)">${169 - stats.definedHands}</span>
      <span class="stat-label">Non défini</span>
    </div>
  `;
}

// === SAVE / CLEAR ===

function handleNashSave() {
  const nameVal = document.getElementById('nash-editor-name').value.trim();
  currentRange.name = nameVal || 'Table Nash sans nom';
  currentRange.chartType = document.getElementById('nash-editor-charttype').value;
  currentRange.format = document.getElementById('nash-editor-format').value;
  currentRange.position = document.getElementById('nash-editor-position').value;
  onSave(currentRange);
  showToast('Table Nash sauvegardée');
}

function handleNashClearAll() {
  if (!confirm('Effacer toutes les valeurs de cette table Nash ?')) return;
  currentRange.cells = {};
  renderNashMatrix();
  updateNashStats();
}
