/* ============================================
   PokerLab — Session History
   Shared store for quiz sessions (Colosseum + Programme)
   ============================================ */

const HISTORY_KEY = 'pokerlab_colosseum_history';

// Sessions kept per range. Raised from 5 → 30 so the tracking hub
// can show a real trend line instead of a handful of points.
export const MAX_HISTORY = 30;

export function loadSessionHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveSessionHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

// Append one session for a range, trimming to MAX_HISTORY (oldest dropped)
export function recordSession(rangeId, entry) {
  const history = loadSessionHistory();
  if (!history[rangeId]) history[rangeId] = [];
  history[rangeId].push(entry);
  if (history[rangeId].length > MAX_HISTORY) {
    history[rangeId] = history[rangeId].slice(-MAX_HISTORY);
  }
  saveSessionHistory(history);
  return history;
}

// Normalized, chronologically sorted sessions for one range
export function getSessions(rangeId, history = null) {
  const store = history || loadSessionHistory();
  return (store[rangeId] || [])
    .filter(s => s && s.total > 0)
    .map(s => ({
      date: s.date,
      correct: s.correct,
      total: s.total,
      accuracy: Math.round(s.correct / s.total * 100),
      mistakes: s.mistakes || [],
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// Most frequently missed hands across a set of sessions
export function aggregateMistakes(sessions, limit = 12) {
  const map = new Map();
  sessions.forEach(s => {
    (s.mistakes || []).forEach(m => {
      if (!m || !m.hand) return;
      const key = `${m.hand}|${m.chosen}|${m.correct}`;
      const entry = map.get(key) || { hand: m.hand, chosen: m.chosen, correct: m.correct, count: 0 };
      entry.count++;
      map.set(key, entry);
    });
  });
  return [...map.values()]
    .sort((a, b) => b.count - a.count || a.hand.localeCompare(b.hand))
    .slice(0, limit);
}

// Merge an imported history into the local one (dedupe on session date)
export function mergeSessionHistory(incoming) {
  const local = loadSessionHistory();
  let added = 0;

  Object.entries(incoming || {}).forEach(([rangeId, sessions]) => {
    if (!Array.isArray(sessions)) return;
    const existing = local[rangeId] || [];
    const seen = new Set(existing.map(s => s && s.date));
    const fresh = sessions.filter(s => s && s.date && !seen.has(s.date));
    added += fresh.length;
    const merged = [...existing, ...fresh]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    local[rangeId] = merged.length > MAX_HISTORY ? merged.slice(-MAX_HISTORY) : merged;
  });

  saveSessionHistory(local);
  return { added, history: local };
}
