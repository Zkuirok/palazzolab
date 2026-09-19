/* ============================================
   PokerLab — Session History
   Shared store for graded sessions (Colosseum + Fresco + Programme)

   One store per exercise, same entry shape everywhere:
     { date, correct, total, mistakes: [{ hand, chosen, correct }] }
   Every function takes the store key last and defaults to the quiz store.
   ============================================ */

export const QUIZ_HISTORY_KEY = 'pokerlab_colosseum_history';
export const FRESCO_HISTORY_KEY = 'pokerlab_fresco_history';

// Sessions kept per range. Raised from 5 → 30 so the tracking hub
// can show a real trend line instead of a handful of points.
export const MAX_HISTORY = 30;

export function loadSessionHistory(key = QUIZ_HISTORY_KEY) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveSessionHistory(history, key = QUIZ_HISTORY_KEY) {
  localStorage.setItem(key, JSON.stringify(history));
}

// Append one session for a range, trimming to MAX_HISTORY (oldest dropped)
export function recordSession(rangeId, entry, key = QUIZ_HISTORY_KEY) {
  const history = loadSessionHistory(key);
  if (!history[rangeId]) history[rangeId] = [];
  history[rangeId].push(entry);
  if (history[rangeId].length > MAX_HISTORY) {
    history[rangeId] = history[rangeId].slice(-MAX_HISTORY);
  }
  saveSessionHistory(history, key);
  return history;
}

// Normalized, chronologically sorted sessions for one range
export function getSessions(rangeId, history = null, key = QUIZ_HISTORY_KEY) {
  const store = history || loadSessionHistory(key);
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
export function mergeSessionHistory(incoming, key = QUIZ_HISTORY_KEY) {
  const local = loadSessionHistory(key);
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

  saveSessionHistory(local, key);
  return { added, history: local };
}
