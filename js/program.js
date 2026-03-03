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

export function createProgram(selectedRangeIds, dailyLimit, allRanges) {
  const progress = {};
  selectedRangeIds.forEach(id => {
    const range = allRanges.find(r => r.id === id);
    progress[id] = {
      rangeId: id,
      name: range ? range.name : id,
      calibrationScore: null,
      calibrationCompletedAt: null,
      lastScore: null,
      lastReviewedAt: null,
      nextDue: null,
      interval: null,
      streak98: 0,
    };
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

export function recordCalibrationScore(program, rangeId, score) {
  if (!program.progress[rangeId]) return program;

  const today = todayStr();
  program.progress[rangeId].calibrationScore = score;
  program.progress[rangeId].calibrationCompletedAt = today;
  program.progress[rangeId].lastScore = score;
  program.progress[rangeId].lastReviewedAt = today;

  // Check if all ranges are calibrated → transition to ACTIVE
  tryActivateProgram(program);

  return program;
}

export function tryActivateProgram(program) {
  if (program.status !== 'CALIBRATING') return program;

  const progresses = Object.values(program.progress);
  const allCalibrated = progresses.every(p => p.calibrationScore !== null);
  if (!allCalibrated) {
    saveProgram(program);
    return program;
  }

  // Compute initial interval per range from calibrationScore (no regression rule)
  progresses.forEach(p => {
    const score = p.calibrationScore;
    if (score >= 98) {
      p.interval = 7;
      p.streak98 = 1;
    } else if (score > 95) {
      p.interval = 5;
      p.streak98 = 0;
    } else if (score > 89) {
      p.interval = 3;
      p.streak98 = 0;
    } else {
      p.interval = 1;
      p.streak98 = 0;
    }
  });

  // Bucket seeding: distribute across future days respecting dailyLimit
  // Sort: lowest score first, then smallest interval
  const sorted = [...progresses].sort((a, b) => {
    if (a.calibrationScore !== b.calibrationScore) return a.calibrationScore - b.calibrationScore;
    return a.interval - b.interval;
  });

  const today = todayStr();
  const buckets = {}; // { dateStr: count }
  const limit = program.dailyLimit;

  sorted.forEach(p => {
    // Start from tomorrow + interval to avoid overloading day 1
    let day = addDays(today, p.interval);
    while ((buckets[day] || 0) >= limit) {
      day = addDays(day, 1);
    }
    buckets[day] = (buckets[day] || 0) + 1;
    p.nextDue = day;
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
// HELPERS
// ============================================

export function getRangeProgress(program, rangeId) {
  return program.progress[rangeId] || null;
}

export function daysOverdue(nextDue) {
  return daysDiff(nextDue, todayStr());
}
