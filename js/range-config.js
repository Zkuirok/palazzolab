/* ============================================
   PokerLab — Range Configuration & Registries
   Shared constants for the range builder
   ============================================ */

// === SITUATIONS ===

export const BUILTIN_SITUATIONS = [
  { id: 'HU_SB',         label: 'HU SB' },
  { id: 'HU_BB',         label: 'HU BB' },
  { id: '3H_BTN_open',   label: '3H BTN open' },
  { id: '3H_BB_vs_SB',   label: '3H BB vs SB' },
  { id: '3H_SB_vs_BB',   label: '3H SB vs BB' },
  { id: '3H_SB_vs_BTN',  label: '3H SB vs BTN' },
  { id: '3H_BB_vs_BTN',  label: '3H BB vs BTN' },
];

const SITUATIONS_KEY = 'pokerlab_situations';

export function loadCustomSituations() {
  try {
    const data = localStorage.getItem(SITUATIONS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveCustomSituations(situations) {
  localStorage.setItem(SITUATIONS_KEY, JSON.stringify(situations));
}

export function getAllSituations() {
  return [...BUILTIN_SITUATIONS, ...loadCustomSituations()];
}

export function addCustomSituation(label) {
  const id = 'custom_' + Date.now().toString(36);
  const custom = loadCustomSituations();
  custom.push({ id, label });
  saveCustomSituations(custom);
  return { id, label };
}

export function getSituationLabel(situationId) {
  const all = getAllSituations();
  const found = all.find(s => s.id === situationId);
  return found ? found.label : situationId;
}

// === ACTION COLOR PALETTE ===

export const ACTION_COLOR_PALETTE = [
  '#c05040', // Crimson
  '#3a7a50', // Emerald
  '#7a6a50', // Slate
  '#4a70b0', // Royal Blue
  '#c89030', // Amber
  '#8860a8', // Violet
  '#3a8a8a', // Teal
  '#b06080', // Rose
];

export function getNextAvailableColor(usedColors) {
  for (const color of ACTION_COLOR_PALETTE) {
    if (!usedColors.includes(color)) return color;
  }
  // All used — cycle from start
  return ACTION_COLOR_PALETTE[usedColors.length % ACTION_COLOR_PALETTE.length];
}

// === DEFAULT ACTIONS ===

export const DEFAULT_ACTION_DEFS = [
  { label: 'Raise', color: '#c05040' },
  { label: 'Call',  color: '#3a7a50' },
  { label: 'Fold',  color: '#7a6a50' },
];

// === OPPONENT SUBCATEGORIES ===

const SUBCATEGORIES_KEY = 'pokerlab_subcategories';

const DEFAULT_SUBCATEGORIES = {
  reg: ['Standard', 'Tight', 'Agro'],
  fish: ['Passive', 'Calling Station', 'Maniac'],
  gto: ['6-max', 'HU', 'MTT'],
};

export function loadSubcategories() {
  try {
    const data = localStorage.getItem(SUBCATEGORIES_KEY);
    return data ? JSON.parse(data) : { ...DEFAULT_SUBCATEGORIES };
  } catch {
    return { ...DEFAULT_SUBCATEGORIES };
  }
}

export function saveSubcategories(subcategories) {
  localStorage.setItem(SUBCATEGORIES_KEY, JSON.stringify(subcategories));
}

export function addSubcategory(opponentType, subcategory) {
  const subs = loadSubcategories();
  if (!subs[opponentType]) subs[opponentType] = [];
  if (!subs[opponentType].includes(subcategory)) {
    subs[opponentType].push(subcategory);
    saveSubcategories(subs);
  }
  return subs;
}

export function getSubcategoriesFor(opponentType) {
  const subs = loadSubcategories();
  return subs[opponentType] || [];
}

// === NASH COLOR SCALE ===

export const NASH_COLOR_STOPS = [
  { min: 15,  color: '#3a7a50' }, // green — always push territory
  { min: 8,   color: '#7a9a30' }, // yellow-green
  { min: 4,   color: '#b07030' }, // orange
  { min: 0,   color: '#a03030' }, // red — very short stack
];

// Returns a CSS color string for a given BB threshold value
export function nashCellColor(threshold) {
  if (threshold === undefined || threshold === null) return null;
  if (threshold >= 999) return '#3a7a50'; // sentinel "always" = green
  for (const stop of NASH_COLOR_STOPS) {
    if (threshold >= stop.min) return stop.color;
  }
  return '#a03030';
}
