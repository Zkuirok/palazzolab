/* ============================================
   PokerLab — Range List View
   Renders range cards, filtering, CRUD triggers
   ============================================ */

import { loadRanges, deleteRange, duplicateRange, saveRange, getRangeStats, getDepthLabel } from './range-model.js';
import { getSituationLabel, getAllSituations } from './range-config.js';
import { showToast } from './toast.js';

let allRanges = [];
let onEditRange = null;
let onPreviewRange = null;
let selectedRangeId = null;

export function initRangeList({ onEdit, onPreview }) {
  onEditRange = onEdit;
  onPreviewRange = onPreview;
  allRanges = loadRanges();

  document.getElementById('btn-new-range').addEventListener('click', () => {
    onEditRange(null); // null = create new
  });

  document.getElementById('filter-situation').addEventListener('change', renderList);
  document.getElementById('filter-opponent').addEventListener('change', renderList);

  populateSituationFilter();
  renderList();
}

export function refreshList() {
  allRanges = loadRanges();
  populateSituationFilter();
  renderList();
  updateNavBadge();
}

export function clearPreview() {
  selectedRangeId = null;
  const splitLayout = document.querySelector('.list-split-layout');
  if (splitLayout) splitLayout.classList.remove('has-preview');
  const previewPanel = document.getElementById('range-preview-panel');
  if (previewPanel) previewPanel.style.display = 'none';
  // Remove selected state from cards
  document.querySelectorAll('.range-card.selected').forEach(c => c.classList.remove('selected'));
}

export function getAllRangesData() {
  return allRanges;
}

function populateSituationFilter() {
  const select = document.getElementById('filter-situation');
  const current = select.value;
  select.innerHTML = '<option value="">Toutes situations</option>';
  const situations = getAllSituations();
  situations.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.label;
    select.appendChild(opt);
  });
  select.value = current;
}

function getFilteredRanges() {
  const sitFilter = document.getElementById('filter-situation').value;
  const oppFilter = document.getElementById('filter-opponent').value;

  return allRanges.filter(range => {
    // Nash ranges have no situation/opponent — always show them
    if (range.type === 'nash') return true;
    if (sitFilter && range.situation !== sitFilter) return false;
    if (oppFilter && range.opponentType !== oppFilter) return false;
    return true;
  });
}

function renderList() {
  const container = document.getElementById('range-cards-container');
  const emptyState = document.getElementById('range-empty-state');
  const filtered = getFilteredRanges();

  container.innerHTML = '';

  // Show compare button only when 2+ ranges exist
  const compareBtn = document.getElementById('btn-compare-mode');
  if (compareBtn) {
    compareBtn.style.display = allRanges.length >= 2 ? '' : 'none';
  }

  if (filtered.length === 0) {
    emptyState.style.display = 'block';
    if (allRanges.length > 0) {
      emptyState.querySelector('p').textContent = 'Aucune range ne correspond aux filtres.';
    } else {
      emptyState.querySelector('p').textContent = 'Aucune range pour le moment.';
    }
    clearPreview();
    return;
  }

  emptyState.style.display = 'none';

  filtered.forEach(range => {
    container.appendChild(createRangeCard(range));
  });

  // If the previously selected range is no longer visible, clear preview
  if (selectedRangeId && !filtered.find(r => r.id === selectedRangeId)) {
    clearPreview();
  }

  updateNavBadge();
}

function selectRange(range) {
  selectedRangeId = range.id;

  // Update card selected state
  document.querySelectorAll('.range-card.selected').forEach(c => c.classList.remove('selected'));
  const card = document.querySelector(`.range-card[data-range-id="${range.id}"]`);
  if (card) card.classList.add('selected');

  // Show preview panel
  const splitLayout = document.querySelector('.list-split-layout');
  if (splitLayout) splitLayout.classList.add('has-preview');

  const previewPanel = document.getElementById('range-preview-panel');
  if (previewPanel) previewPanel.style.display = '';

  // Call preview callback
  if (onPreviewRange) onPreviewRange(range);
}

function createRangeCard(range) {
  if (range.type === 'nash') return createNashRangeCard(range);

  const card = document.createElement('div');
  card.className = 'range-card' + (range.id === selectedRangeId ? ' selected' : '');
  card.dataset.rangeId = range.id;

  const stats = getRangeStats(range);
  const sitLabel = getSituationLabel(range.situation);
  const depthLabel = getDepthLabel(range);
  const oppLabel = range.opponentType === 'fish' ? 'Fish' : range.opponentType === 'gto' ? 'GTO' : 'Reg';
  const subLabel = range.opponentSubcategory ? ` (${range.opponentSubcategory})` : '';

  // Clicking the card body selects it for preview
  card.addEventListener('click', (e) => {
    // Don't trigger if a button was clicked
    if (e.target.closest('button')) return;
    selectRange(range);
  });

  // Info
  const info = document.createElement('div');
  info.className = 'range-card-info';
  info.innerHTML = `
    <div class="range-card-name">${escapeHtml(range.name)}</div>
    <div class="range-card-meta">${escapeHtml(sitLabel)} — ${depthLabel} — vs ${oppLabel}${escapeHtml(subLabel)}</div>
  `;

  // Stats badges
  const statsDiv = document.createElement('div');
  statsDiv.className = 'range-card-stats';
  range.actionDefs.forEach((action, i) => {
    const badge = document.createElement('span');
    badge.className = 'range-stat-badge';
    badge.style.background = colorMix(action.color, 0.15);
    badge.style.color = action.color;
    badge.innerHTML = `<span class="badge-dot" style="background:${action.color}"></span>${stats.percentages[i]}%`;
    badge.title = action.label;
    statsDiv.appendChild(badge);
  });

  // Actions
  const actions = document.createElement('div');
  actions.className = 'range-card-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-stone btn-small';
  editBtn.textContent = 'Editer';
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onEditRange(range);
  });

  const dupBtn = document.createElement('button');
  dupBtn.className = 'btn-stone btn-small';
  dupBtn.textContent = 'Dupliquer';
  dupBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const dup = duplicateRange(range);
    allRanges = saveRange(dup, allRanges);
    renderList();
    showToast('Range dupliquée');
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'btn-stone btn-small';
  delBtn.textContent = '✕';
  delBtn.title = 'Supprimer';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (confirm(`Supprimer « ${range.name} » ?`)) {
      allRanges = deleteRange(range.id, allRanges);
      if (selectedRangeId === range.id) clearPreview();
      renderList();
      showToast('Range supprimée');
    }
  });

  actions.appendChild(editBtn);
  actions.appendChild(dupBtn);
  actions.appendChild(delBtn);

  card.appendChild(info);
  card.appendChild(statsDiv);
  card.appendChild(actions);

  return card;
}

function createNashRangeCard(range) {
  const card = document.createElement('div');
  card.className = 'range-card' + (range.id === selectedRangeId ? ' selected' : '');
  card.dataset.rangeId = range.id;

  card.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    selectRange(range);
  });

  const definedCount = Object.keys(range.cells).length;

  const info = document.createElement('div');
  info.className = 'range-card-info';
  const chartLabel = range.chartType === 'call' ? 'Call/Fold' : 'Push/Fold';
  const situationLabel = range.format && range.position
    ? `${range.format} ${range.position}`
    : '';
  const metaParts = [chartLabel, situationLabel].filter(Boolean).join(' • ');
  info.innerHTML = `
    <div class="range-card-name">${escapeHtml(range.name)}<span class="nash-type-badge">Nash</span></div>
    <div class="range-card-meta">${metaParts} — ${definedCount} main${definedCount !== 1 ? 's' : ''} définie${definedCount !== 1 ? 's' : ''}</div>
  `;

  const statsDiv = document.createElement('div');
  statsDiv.className = 'range-card-stats';
  const badge = document.createElement('span');
  badge.className = 'range-stat-badge nash-stat-badge';
  badge.innerHTML = `<span class="badge-dot" style="background:var(--gold-mid)"></span>${definedCount}/169`;
  badge.title = 'Mains définies';
  statsDiv.appendChild(badge);

  const actions = document.createElement('div');
  actions.className = 'range-card-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-stone btn-small';
  editBtn.textContent = 'Editer';
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onEditRange(range);
  });

  const dupBtn = document.createElement('button');
  dupBtn.className = 'btn-stone btn-small';
  dupBtn.textContent = 'Dupliquer';
  dupBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const dup = duplicateRange(range);
    allRanges = saveRange(dup, allRanges);
    renderList();
    showToast('Table Nash dupliquée');
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'btn-stone btn-small';
  delBtn.textContent = '✕';
  delBtn.title = 'Supprimer';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (confirm(`Supprimer « ${range.name} » ?`)) {
      allRanges = deleteRange(range.id, allRanges);
      if (selectedRangeId === range.id) clearPreview();
      renderList();
      showToast('Table Nash supprimée');
    }
  });

  actions.appendChild(editBtn);
  actions.appendChild(dupBtn);
  actions.appendChild(delBtn);

  card.appendChild(info);
  card.appendChild(statsDiv);
  card.appendChild(actions);

  return card;
}

function updateNavBadge() {
  const badge = document.querySelector('.nav-item[data-page="ranges"] .nav-badge');
  if (badge) {
    badge.textContent = allRanges.length || '';
    badge.style.display = allRanges.length > 0 ? '' : 'none';
  }
}

function colorMix(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
