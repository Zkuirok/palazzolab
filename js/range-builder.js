/* ============================================
   PokerLab — Range Builder Orchestrator
   Wires list, editor, preview, and compare views
   ============================================ */

import { createRange, createNashRange, saveRange, loadRanges, getRangeStats, getNashStats, getDepthLabel } from './range-model.js';
import { getSituationLabel, nashCellColor } from './range-config.js';
import { HANDS_MATRIX } from './poker-hands.js';
import { initRangeList, refreshList, clearPreview, getAllRangesData } from './range-list.js';
import { initEditor, openEditor } from './range-editor.js';
import { initNashEditor, openNashEditor } from './nash-editor.js';

let allRanges = [];

export function initRangeBuilder() {
  allRanges = loadRanges();

  // Init sub-modules
  initRangeList({
    onEdit: handleEdit,
    onPreview: handlePreview,
  });

  initEditor({
    onSaveRange: handleSave,
    onBackToList: showListView,
  });

  // Nash editor
  initNashEditor({
    onSaveRange: handleSave,
    onBackToList: showListView,
  });

  // Type-choice modal
  document.getElementById('choice-standard').addEventListener('click', () => {
    closeRangeTypeModal();
    openEditor(createRange());
    showEditorView();
  });
  document.getElementById('choice-nash').addEventListener('click', () => {
    closeRangeTypeModal();
    openNashEditor(createNashRange());
    showNashEditorView();
  });
  document.getElementById('btn-cancel-range-type').addEventListener('click', closeRangeTypeModal);

  // Preview "Editer" button
  document.getElementById('btn-preview-edit').addEventListener('click', () => {
    const rangeId = document.getElementById('range-preview-panel').dataset.rangeId;
    if (!rangeId) return;
    const range = loadRanges().find(r => r.id === rangeId);
    if (range) handleEdit(range);
  });

  // Compare mode
  document.getElementById('btn-compare-mode').addEventListener('click', showCompareView);
  document.getElementById('btn-back-from-compare').addEventListener('click', showListView);

  // When navigating to the ranges page, always show list view
  const navItem = document.querySelector('.nav-item[data-page="ranges"]');
  if (navItem) {
    navItem.addEventListener('click', () => showListView());
  }
  const dashboardCard = document.querySelector('.card[onclick*="ranges"]');
  if (dashboardCard) {
    dashboardCard.addEventListener('click', () => showListView());
  }
}

function handleEdit(range) {
  if (range === null) {
    showRangeTypeModal();
    return;
  }
  if (range.type === 'nash') {
    openNashEditor(range);
    showNashEditorView();
  } else {
    openEditor(range);
    showEditorView();
  }
}

function handleSave(range) {
  allRanges = loadRanges();
  allRanges = saveRange(range, allRanges);
  showListView();
  refreshList();
}

// === PREVIEW ===

function handlePreview(range) {
  const panel = document.getElementById('range-preview-panel');
  panel.dataset.rangeId = range.id;

  if (range.type === 'nash') {
    const chartLabel = range.chartType === 'call' ? 'Call/Fold' : 'Push/Fold';
    const situationLabel = range.format && range.position ? ` • ${range.format} ${range.position}` : '';
    document.getElementById('preview-panel-title').textContent = `${range.name} — ${chartLabel}${situationLabel}`;
    document.getElementById('preview-action-bar').innerHTML = '';
    renderNashReadOnlyMatrix(range, 'preview-matrix');
    renderNashPreviewStats(range, 'preview-stats-row');
  } else {
    // Title
    const sitLabel = getSituationLabel(range.situation);
    const depthLabel = getDepthLabel(range);
    const oppLabel = range.opponentType === 'fish' ? 'Fish' : range.opponentType === 'gto' ? 'GTO' : 'Reg';
    const subLabel = range.opponentSubcategory ? ` (${range.opponentSubcategory})` : '';
    document.getElementById('preview-panel-title').textContent =
      `${range.name} — ${sitLabel} — ${depthLabel} — vs ${oppLabel}${subLabel}`;

    // Action bar (read-only labels)
    renderPreviewActionBar(range, 'preview-action-bar');

    // Matrix
    renderReadOnlyMatrix(range, 'preview-matrix');

    // Stats
    renderPreviewStats(range, 'preview-stats-row');
  }
}

// === COMPARE VIEW ===

let compareSelectedIds = new Set();

function showCompareView() {
  document.getElementById('range-list-view').style.display = 'none';
  document.getElementById('range-editor-view').style.display = 'none';
  document.getElementById('range-compare-view').style.display = '';
  document.getElementById('range-nash-editor-view').style.display = 'none';

  const view = document.getElementById('range-compare-view');
  view.style.animation = 'none';
  view.offsetHeight;
  view.style.animation = '';

  allRanges = loadRanges();
  compareSelectedIds = new Set();

  // Pre-select first 2 ranges
  if (allRanges.length >= 2) {
    compareSelectedIds.add(allRanges[0].id);
    compareSelectedIds.add(allRanges[1].id);
  }

  renderCompareSelector();
  renderCompareGrid();
}

function renderCompareSelector() {
  const container = document.getElementById('compare-range-selector');
  container.innerHTML = '';

  allRanges.forEach(range => {
    const chip = document.createElement('div');
    chip.className = 'compare-range-chip' + (compareSelectedIds.has(range.id) ? ' active' : '');
    chip.textContent = range.name;
    chip.title = range.type === 'nash'
      ? 'Table Nash'
      : `${getSituationLabel(range.situation)} — ${getDepthLabel(range)}`;
    chip.addEventListener('click', () => {
      if (compareSelectedIds.has(range.id)) {
        compareSelectedIds.delete(range.id);
      } else if (compareSelectedIds.size < 4) {
        compareSelectedIds.add(range.id);
      }
      renderCompareSelector();
      renderCompareGrid();
    });
    container.appendChild(chip);
  });
}

function renderCompareGrid() {
  const grid = document.getElementById('compare-grid');
  grid.innerHTML = '';
  grid.dataset.count = compareSelectedIds.size;

  allRanges
    .filter(r => compareSelectedIds.has(r.id))
    .forEach(range => {
      const subLabel = range.type === 'nash'
        ? 'Table Nash'
        : `${escapeHtml(getSituationLabel(range.situation))} — ${getDepthLabel(range)}`;
      const panel = document.createElement('div');
      panel.className = 'matrix-panel ornamented';
      panel.innerHTML = `
        <div class="corner-tl"></div><div class="corner-tr"></div>
        <div class="corner-bl"></div><div class="corner-br"></div>
        <div class="panel-header">
          <h3>${escapeHtml(range.name)}</h3>
          <span style="font-family:var(--font-body);font-size:12px;color:var(--cream-muted)">
            ${subLabel}
          </span>
        </div>
        <div class="panel-body">
          <div class="action-bar" id="compare-actions-${range.id}"></div>
          <div class="matrix-container">
            <div class="matrix-felt-bg"></div>
            <div class="mini-matrix show-labels" id="compare-matrix-${range.id}"></div>
          </div>
          <div class="stats-row" id="compare-stats-${range.id}"></div>
        </div>
      `;
      grid.appendChild(panel);

      if (range.type === 'nash') {
        renderNashReadOnlyMatrix(range, `compare-matrix-${range.id}`);
        renderNashPreviewStats(range, `compare-stats-${range.id}`);
      } else {
        renderPreviewActionBar(range, `compare-actions-${range.id}`);
        renderReadOnlyMatrix(range, `compare-matrix-${range.id}`);
        renderPreviewStats(range, `compare-stats-${range.id}`);
      }
    });
}

// === NASH PREVIEW RENDERING ===

function renderNashReadOnlyMatrix(range, containerId) {
  const matrixEl = document.getElementById(containerId);
  if (!matrixEl) return;
  matrixEl.innerHTML = '';

  HANDS_MATRIX.forEach((hand, i) => {
    const cell = document.createElement('div');
    cell.className = 'mini-cell';
    const threshold = range.cells[i];

    if (threshold !== undefined) {
      const color = nashCellColor(threshold);
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      const darker = `rgb(${Math.max(0, r - 30)},${Math.max(0, g - 30)},${Math.max(0, b - 30)})`;
      cell.classList.add('painted');
      cell.style.background = `linear-gradient(135deg, ${color}, ${darker})`;
      cell.textContent = threshold >= 999 ? '∞' : String(threshold);
      cell.title = threshold >= 999 ? `${hand} — toujours` : `${hand} — push ≤ ${threshold} BB`;
    } else {
      cell.textContent = hand;
      cell.title = `${hand} — non défini`;
    }

    matrixEl.appendChild(cell);
  });
}

function renderNashPreviewStats(range, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const stats = getNashStats(range);
  container.innerHTML = `
    <div class="stat-pill">
      <span class="stat-value" style="color:var(--gold-light)">${stats.definedHands}</span>
      <span class="stat-label">Mains définies</span>
    </div>
    <div class="stat-pill">
      <span class="stat-value" style="color:var(--gold-light)">${stats.definedPct}%</span>
      <span class="stat-label">Combos couverts</span>
    </div>
  `;
}

// === SHARED PREVIEW RENDERING ===

function renderPreviewActionBar(range, containerId) {
  const bar = document.getElementById(containerId);
  if (!bar) return;
  bar.innerHTML = '';
  range.actionDefs.forEach(action => {
    const chip = document.createElement('div');
    chip.className = 'action-chip';
    chip.style.setProperty('--chip-color', action.color);
    chip.innerHTML = `<span class="dot"></span> ${escapeHtml(action.label)}`;
    bar.appendChild(chip);
  });
}

function renderReadOnlyMatrix(range, containerId) {
  const matrixEl = document.getElementById(containerId);
  if (!matrixEl) return;
  matrixEl.innerHTML = '';
  const isGTO = range.opponentType === 'gto';

  HANDS_MATRIX.forEach((hand, i) => {
    const cell = document.createElement('div');
    cell.className = 'mini-cell';
    cell.textContent = hand;

    const cellData = range.cells[i];

    if (isGTO && Array.isArray(cellData)) {
      const bg = gtoCellBackground(cellData, range.actionDefs);
      if (bg) {
        cell.classList.add('painted');
        cell.style.background = bg;
      }
      cell.title = gtoTooltip(hand, cellData, range.actionDefs);
    } else if (!isGTO && cellData !== undefined && cellData >= 0 && cellData < range.actionDefs.length) {
      cell.classList.add('painted');
      cell.style.background = cellBackground(range.actionDefs[cellData].color);
      cell.title = hand;
    } else {
      cell.title = hand;
    }

    matrixEl.appendChild(cell);
  });
}

function gtoCellBackground(freqs, actionDefs) {
  const stops = [];
  let pos = 0;
  freqs.forEach((f, i) => {
    if (f < 0.005 || i >= actionDefs.length) return;
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

function renderPreviewStats(range, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  const stats = getRangeStats(range);

  range.actionDefs.forEach((action, i) => {
    const pill = document.createElement('div');
    pill.className = 'stat-pill';
    pill.innerHTML = `
      <span class="stat-value" style="color:${action.color}">${stats.percentages[i]}%</span>
      <span class="stat-label">${escapeHtml(action.label)}</span>
    `;
    container.appendChild(pill);
  });

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

function cellBackground(color) {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const darker = `rgb(${Math.max(0, r - 30)},${Math.max(0, g - 30)},${Math.max(0, b - 30)})`;
  return `linear-gradient(135deg, ${color}, ${darker})`;
}

// === VIEW SWITCHING ===

function showListView() {
  document.getElementById('range-list-view').style.display = '';
  document.getElementById('range-editor-view').style.display = 'none';
  document.getElementById('range-compare-view').style.display = 'none';
  document.getElementById('range-nash-editor-view').style.display = 'none';
  const listView = document.getElementById('range-list-view');
  listView.style.animation = 'none';
  listView.offsetHeight;
  listView.style.animation = '';
  refreshList();
}

function showEditorView() {
  document.getElementById('range-list-view').style.display = 'none';
  document.getElementById('range-editor-view').style.display = '';
  document.getElementById('range-compare-view').style.display = 'none';
  document.getElementById('range-nash-editor-view').style.display = 'none';
  const editorView = document.getElementById('range-editor-view');
  editorView.style.animation = 'none';
  editorView.offsetHeight;
  editorView.style.animation = '';
}

function showNashEditorView() {
  document.getElementById('range-list-view').style.display = 'none';
  document.getElementById('range-editor-view').style.display = 'none';
  document.getElementById('range-compare-view').style.display = 'none';
  document.getElementById('range-nash-editor-view').style.display = '';
  const nashView = document.getElementById('range-nash-editor-view');
  nashView.style.animation = 'none';
  nashView.offsetHeight;
  nashView.style.animation = '';
}

function showRangeTypeModal() {
  document.getElementById('range-type-modal').style.display = '';
}

function closeRangeTypeModal() {
  document.getElementById('range-type-modal').style.display = 'none';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
