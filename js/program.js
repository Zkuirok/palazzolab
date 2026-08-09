/* ============================================
   PokerLab — Spaced Repetition Program
   Data model and scheduling logic (no DOM)
   ============================================ */

const PROGRAM_KEY = 'pokerlab_program';

// ============================================
// DATE UTILITIES
// ============================================

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysDiff(fromStr, toStr) {
  const a = new Date(fromStr + 'T00:00:00');
  const b = new Date(toStr + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

// ============================================
// STORAGE
// ============================================

export function loadProgram() {
  try {
    const raw = localStorage.getItem(PROGRAM_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveProgram(program) {
  localStorage.setItem(PROGRAM_KEY, JSON.stringify(program));
}

export function deleteProgram() {
  localStorage.removeItem(PROGRAM_KEY);
}

// ============================================
// PROGRAM CREATION
// ============================================

function makeProgressEntry(id, allRanges) {
  const range = allRanges.find(r => r.id === id);
  return {
    rangeId: id,
    name: range ? range.name : id,
    calibrationScore: null,
    calibrationCompletedAt: null,
    lastScore: null,
    lastReviewedAt: null,
    nextDue: null,
    interval: null,
    streak98: 0,
    addedAt: todayStr(),
  };
}

export function createProgram(selectedRangeIds, dailyLimit, allRanges) {
  const progress = {};
  selectedRangeIds.forEach(id => {
    progress[id] = makeProgressEntry(id, allRanges);
  });

  return {
    id: `prog_${Date.now()}`,
    status: 'CALIBRATING',
    dailyLimit,
    selectedRangeIds: [...selectedRangeIds],
    activatedAt: null,
    progress,
  };
}

// ============================================
// CALIBRATION
// ============================================

// Initial schedule derived from a calibration score (no regression rule)
function initialIntervalFor(score) {
  if (score >= 98) return { interval: 7, streak98: 1 };
  if (score > 95) return { interval: 5, streak98: 0 };
  if (score > 89) return { interval: 3, streak98: 0 };
  return { interval: 1, streak98: 0 };
}

// First day at or after `startDay` that is not already at dailyLimit
function findFreeSlot(program, startDay) {
  const counts = {};
  Object.values(program.progress).forEach(p => {
    if (p.nextDue) counts[p.nextDue] = (counts[p.nextDue] || 0) + 1;
  });
  let day = startDay;
  while ((counts[day] || 0) >= program.dailyLimit) {
    day = addDays(day, 1);
  }
  return day;
}

export function recordCalibrationScore(program, rangeId, score) {
  const p = program.progress[rangeId];
  if (!p) return program;

  const today = todayStr();
  p.calibrationScore = score;
  p.calibrationCompletedAt = today;
  p.lastScore = score;
  p.lastReviewedAt = today;

  // Range added to an already-running program: schedule it on the spot
  // instead of dragging the whole program back into calibration.
  if (program.status === 'ACTIVE') {
    const { interval, streak98 } = initialIntervalFor(score);
    p.interval = interval;
    p.streak98 = streak98;
    p.nextDue = findFreeSlot(program, addDays(today, interval));
    saveProgram(program);
    return program;
  }

  // Check if all ranges are calibrated → transition to ACTIVE
  tryActivateProgram(program);

  return program;
}

export function tryActivateProgram(program) {
  if (program.status !== 'CALIBRATING') return program;

  const progresses = Object.values(program.progress);
  const allCalibrated = progresses.length > 0 && progresses.every(p => p.calibrationScore !== null);
  if (!allCalibrated) {
    saveProgram(program);
    return program;
  }

  progresses.forEach(p => {
    const { interval, streak98 } = initialIntervalFor(p.calibrationScore);
    p.interval = interval;
    p.streak98 = streak98;
  });

  // Bucket seeding: distribute across future days respecting dailyLimit
  // Sort: lowest score first, then smallest interval
  const sorted = [...progresses].sort((a, b) => {
    if (a.calibrationScore !== b.calibrationScore) return a.calibrationScore - b.calibrationScore;
    return a.interval - b.interval;
  });

  const today = todayStr();
  // Seed each range at today + its interval, pushed forward while the day is full
  sorted.forEach(p => {
    p.nextDue = findFreeSlot(program, addDays(today, p.interval));
  });

  program.status = 'ACTIVE';
  program.activatedAt = today;
  saveProgram(program);
  return program;
}

// ============================================
// ACTIVE SCHEDULING
// ============================================

export function recordActiveScore(program, rangeId, score) {
  if (!program.progress[rangeId]) return { program, intervalDays: 1 };

  const p = program.progress[rangeId];
  const prevInterval = p.interval;
  let interval, streak98;

  // Regression rule: checked FIRST
  if (prevInterval !== null && prevInterval >= 14 && score <= 95) {
    interval = 1;
    streak98 = 0;
  } else if (score <= 89) {
    interval = 1;
    streak98 = 0;
  } else if (score <= 95) {
    interval = 3;
    streak98 = 0;
  } else if (score < 98) {
    interval = 5;
    streak98 = 0;
  } else {
    // score >= 98
    streak98 = (p.streak98 || 0) + 1;
    if (streak98 === 1) interval = 7;
    else if (streak98 === 2) interval = 14;
    else interval = 30;
  }

  const today = todayStr();
  p.lastScore = score;
  p.lastReviewedAt = today;
  p.interval = interval;
  p.streak98 = streak98;
  p.nextDue = addDays(today, interval);

  saveProgram(program);
  return { program, intervalDays: interval };
}

// ============================================
// DAILY PLAN
// ============================================

export function getDailyPlan(program) {
  const today = todayStr();
  const limit = program.dailyLimit;
  const all = Object.values(program.progress);

  // Due: nextDue <= today
  const due = all
    .filter(p => p.nextDue !== null && p.nextDue <= today)
    .sort((a, b) => {
      // Most overdue first (earliest nextDue)
      if (a.nextDue !== b.nextDue) return a.nextDue.localeCompare(b.nextDue);
      // Then lowest lastScore
      return (a.lastScore ?? 0) - (b.lastScore ?? 0);
    })
    .slice(0, limit);

  const dueIds = new Set(due.map(p => p.rangeId));
  const remaining = limit - due.length;

  // Reinforcement: not due, fill remaining slots
  const reinforcement = remaining > 0
    ? all
        .filter(p => !dueIds.has(p.rangeId) && p.nextDue !== null && p.nextDue > today)
        .sort((a, b) => {
          if (a.interval !== b.interval) return (a.interval ?? 999) - (b.interval ?? 999);
          return (a.lastScore ?? 0) - (b.lastScore ?? 0);
        })
        .slice(0, remaining)
    : [];

  return { due, reinforcement };
}

// ============================================
// SKIP
// ============================================

export function skipRange(program, rangeId) {
  if (!program.progress[rangeId]) return program;
  program.progress[rangeId].nextDue = addDays(todayStr(), 1);
  saveProgram(program);
  return program;
}

// ============================================
// PROGRAM MANAGEMENT
// ============================================

// Add ranges to an existing program. On an ACTIVE program the newcomers stay
// unscheduled (nextDue null) until their own calibration quiz is done.
export function addRangesToProgram(program, rangeIds, allRanges) {
  const added = [];
  rangeIds.forEach(id => {
    if (program.progress[id]) return;
    program.progress[id] = makeProgressEntry(id, allRanges);
    if (!program.selectedRangeIds.includes(id)) program.selectedRangeIds.push(id);
    added.push(id);
  });
  saveProgram(program);
  return { program, added: added.length };
}

export function removeRangeFromProgram(program, rangeId) {
  if (!program.progress[rangeId]) return program;
  delete program.progress[rangeId];
  program.selectedRangeIds = program.selectedRangeIds.filter(id => id !== rangeId);

  // Dropping the last uncalibrated range can unblock activation
  if (program.status === 'CALIBRATING') {
    tryActivateProgram(program);
  } else {
    saveProgram(program);
  }
  return program;
}

export function setDailyLimit(program, limit) {
  const parsed = parseInt(limit, 10);
  program.dailyLimit = Math.max(1, Math.min(10, Number.isNaN(parsed) ? 3 : parsed));
  saveProgram(program);
  return program;
}

// Ranges awaiting their first quiz (never calibrated)
export function getPendingCalibration(program) {
  return Object.values(program.progress).filter(p => p.calibrationScore === null);
}

// Mastery bucket derived from the current interval — used for sorting/labelling
export function getMasteryLevel(p) {
  if (!p || p.calibrationScore === null) return { key: 'pending', label: 'À calibrer', rank: 0 };
  const i = p.interval ?? 0;
  if (i >= 30) return { key: 'mastered', label: 'Maîtrisée', rank: 4 };
  if (i >= 14) return { key: 'solid', label: 'Solide', rank: 3 };
  if (i >= 5) return { key: 'progress', label: 'En cours', rank: 2 };
  return { key: 'fragile', label: 'Fragile', rank: 1 };
}

// ============================================
// BACKUP BUNDLE (program + ranges + history)
// ============================================

export const BUNDLE_KIND = 'pokerlab-program-bundle';
export const BUNDLE_VERSION = 1;

export function buildProgramBundle({ program, ranges, history }) {
  return {
    kind: BUNDLE_KIND,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    program: program || null,
    ranges: ranges || [],
    history: history || {},
  };
}

// Validates a parsed JSON payload; throws on anything unusable.
// Also accepts a plain ranges export so a single import path covers both files.
export function parseProgramBundle(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Fichier invalide');

  const ranges = Array.isArray(parsed) ? parsed : (parsed.ranges || []);
  if (!Array.isArray(ranges)) throw new Error('Fichier invalide : ranges illisibles');

  const program = (parsed.program && typeof parsed.program === 'object') ? parsed.program : null;
  if (program && (!program.progress || typeof program.progress !== 'object')) {
    throw new Error('Fichier invalide : programme corrompu');
  }

  const history = (parsed.history && typeof parsed.history === 'object' && !Array.isArray(parsed.history))
    ? parsed.history
    : {};

  return { ranges, program, history };
}

// ============================================
// HELPERS
// ============================================

export function getRangeProgress(program, rangeId) {
  return program.progress[rangeId] || null;
}

export function daysOverdue(nextDue) {
  return daysDiff(nextDue, todayStr());
}
