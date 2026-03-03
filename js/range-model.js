/* ============================================
   PokerLab — Range Data Model
   Stores and manages ranges with metadata
   ============================================ */

import { HANDS_MATRIX, getHandCombos, TOTAL_COMBOS } from './poker-hands.js';
import { DEFAULT_ACTION_DEFS } from './range-config.js';

const STORAGE_KEY = 'pokerlab_ranges';

// Generate a simple UUID
function generateId() {
  return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
}

// Create a new empty range
export function createRange({
  name = 'Nouvelle Range',
  situation = 'HU_SB',
  depthMin = 10,
  depthMax = 15,
  opponentType = 'reg',
  opponentSubcategory = '',
  actionDefs = null,
} = {}) {
  return {
    id: generateId(),
    name,
    situation,
    depthMin,
    depthMax,
    opponentType,
    opponentSubcategory,
    actionDefs: actionDefs || DEFAULT_ACTION_DEFS.map(a => ({ ...a })),
    cells: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// Calculate stats for a range (dynamic actions)
export function getRangeStats(range) {
  const actionCount = range.actionDefs.length;
  const handCounts = new Array(actionCount).fill(0);
  const comboCounts = new Array(actionCount).fill(0);
  let unassignedHands = 0;
  let unassignedCombos = 0;
  const isGTO = range.opponentType === 'gto';

  HANDS_MATRIX.forEach((hand, i) => {
    const cell = range.cells[i];
    const combos = getHandCombos(hand);

    if (isGTO && Array.isArray(cell)) {
      // GTO format: cell is an array of frequencies per action
      let totalFreq = 0;
      cell.forEach((freq, j) => {
        if (j < actionCount && freq > 0) {
          comboCounts[j] += freq * combos;
          totalFreq += freq;
        }
      });
      // Count combos proportionally for handCounts (dominant action)
      const maxFreq = Math.max(...cell);
      if (maxFreq > 0) {
        handCounts[cell.indexOf(maxFreq)]++;
      }
      const unassignedFreq = Math.max(0, 1 - totalFreq);
      unassignedCombos += unassignedFreq * combos;
      if (unassignedFreq > 0.99) unassignedHands++;
    } else {
      // Regular format: cell is an action index integer
      const actionIdx = cell;
      if (actionIdx !== undefined && actionIdx >= 0 && actionIdx < actionCount) {
        handCounts[actionIdx]++;
        comboCounts[actionIdx] += combos;
      } else {
        unassignedHands++;
        unassignedCombos += combos;
      }
    }
  });

  const percentages = comboCounts.map(c => Math.round(c / TOTAL_COMBOS * 100));
  const unassignedPct = Math.round(unassignedCombos / TOTAL_COMBOS * 100);

  return {
    hands: handCounts,
    combos: comboCounts,
    percentages,
    unassignedHands,
    unassignedCombos,
    unassignedPct,
  };
}

// Duplicate a range
export function duplicateRange(range) {
  return {
    ...structuredClone(range),
    id: generateId(),
    name: range.name + ' (copie)',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// Get depth display string
export function getDepthLabel(range) {
  if (range.depthMin === range.depthMax) {
    return `${range.depthMin}bb`;
  }
  return `${range.depthMin}-${range.depthMax}bb`;
}

// Create a new empty Nash range
export function createNashRange({
  name = 'Nouvelle Table Nash',
  chartType = 'push',  // 'push' | 'call'
  format = 'HU',       // 'HU' | '3H'
  position = 'SB',     // 'SB' | 'BB' | 'BTN'
} = {}) {
  return {
    id: generateId(),
    type: 'nash',
    name,
    chartType,
    format,
    position,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cells: {},
  };
}

// Calculate stats for a Nash range
export function getNashStats(range) {
  let definedHands = 0;
  let totalCombos = 0;

  HANDS_MATRIX.forEach((hand, i) => {
    const threshold = range.cells[i];
    if (threshold !== undefined) {
      definedHands++;
      totalCombos += getHandCombos(hand);
    }
  });

  const definedPct = Math.round(totalCombos / TOTAL_COMBOS * 100);

  return {
    definedHands,
    totalCombos,
    definedPct,
    totalHands: HANDS_MATRIX.length,
  };
}

// === MIGRATION ===

function migrateRange(range) {
  // Nash ranges don't need migration
  if (range.type === 'nash') return range;
  // Already new format
  if (range.actionDefs) return range;

  // Old format: actions map with string values ('raise', 'call', 'fold')
  // position + format -> situation
  const oldActions = range.actions || {};
  const positionMap = {
    'BTN': { '3H': '3H_BTN_open', 'HU': 'HU_SB' },
    'SB':  { '3H': '3H_SB_vs_BB', 'HU': 'HU_SB' },
    'BB':  { '3H': '3H_BB_vs_SB', 'HU': 'HU_BB' },
  };
  const situation = positionMap[range.position]?.[range.format] || 'HU_SB';

  // Map old string actions to indices
  const actionMap = { raise: 0, call: 1, fold: 2 };
  const cells = {};
  for (const [idx, action] of Object.entries(oldActions)) {
    if (actionMap[action] !== undefined) {
      cells[idx] = actionMap[action];
    }
  }

  return {
    id: range.id,
    name: range.name || 'Range migrée',
    situation,
    depthMin: range.depthMin || 10,
    depthMax: range.depthMax || 15,
    opponentType: range.profile === 'fish' ? 'fish' : 'reg',
    opponentSubcategory: '',
    actionDefs: DEFAULT_ACTION_DEFS.map(a => ({ ...a })),
    cells,
    createdAt: range.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// === LOCAL STORAGE ===

export function saveRanges(ranges) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ranges));
}

export function loadRanges() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    const ranges = JSON.parse(data);
    // Migrate old format ranges
    const migrated = ranges.map(migrateRange);
    // Re-save if any standard ranges were migrated
    if (ranges.some(r => r.type !== 'nash' && !r.actionDefs)) {
      saveRanges(migrated);
    }
    return migrated;
  } catch {
    return [];
  }
}

export function saveRange(range, allRanges) {
  range.updatedAt = new Date().toISOString();
  const idx = allRanges.findIndex(r => r.id === range.id);
  if (idx >= 0) {
    allRanges[idx] = range;
  } else {
    allRanges.push(range);
  }
  saveRanges(allRanges);
  return allRanges;
}

export function deleteRange(rangeId, allRanges) {
  const filtered = allRanges.filter(r => r.id !== rangeId);
  saveRanges(filtered);
  return filtered;
}

// === EXPORT / IMPORT ===

export function exportRanges(ranges) {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    ranges,
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pokerlab-ranges-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Returns a promise resolving to { added, skipped, total }
export function importRangesFromFile(file, existingRanges) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        const imported = Array.isArray(parsed) ? parsed : (parsed.ranges || []);
        const existingIds = new Set(existingRanges.map(r => r.id));
        const toAdd = imported.filter(r => r && r.id && !existingIds.has(r.id));
        const merged = [...existingRanges, ...toAdd];
        saveRanges(merged);
        resolve({ added: toAdd.length, skipped: imported.length - toAdd.length, total: merged.length, ranges: merged });
      } catch {
        reject(new Error('Fichier invalide'));
      }
    };
    reader.onerror = () => reject(new Error('Erreur de lecture'));
    reader.readAsText(file);
  });
}
