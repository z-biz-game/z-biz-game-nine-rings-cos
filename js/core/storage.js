// Save file. One localStorage key, plain JSON, and a versioned shape so an old save can be
// recognised rather than mistaken for a new one.
//
// Records are keyed by level id (the campaign ids in js/data/levels.js plus the date-derived
// daily id), with a campaign unlock pointer and a lifetime tally. Everything degrades to
// memory when storage is refused — private windows, blocked third-party storage, embedded
// webviews — because losing the game to a SecurityError is not an acceptable trade.

const KEY = 'rings.save.v1';

export const SAVE_KEY = KEY;

function blank() {
  return {
    records: {},
    daily: {},
    unlocked: 1,
    stats: { solves: 0, perfect: 0, clicks: 0, hints: 0 },
  };
}

let cache = null;

function load() {
  if (cache) return cache;
  let raw = null;
  try {
    raw = typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem(KEY) : null;
  } catch (err) {
    raw = null;
  }
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        const base = blank();
        cache = {
          records: p.records && typeof p.records === 'object' ? p.records : base.records,
          daily: p.daily && typeof p.daily === 'object' ? p.daily : base.daily,
          unlocked: Number(p.unlocked) > 0 ? Number(p.unlocked) : base.unlocked,
          stats: { ...base.stats, ...(p.stats || {}) },
        };
        return cache;
      }
    } catch (err) {
      // A corrupt save is not worth keeping; start clean rather than crash the shell.
    }
  }
  cache = blank();
  return cache;
}

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch (err) {
    /* memory-only session */
  }
}

export const store = {
  get records() { return load().records; },
  get stats() { return load().stats; },
  get daily() { return load().daily; },
  get unlocked() { return load().unlocked; },

  record(id) {
    return load().records[id] || null;
  },

  // Unlocking is monotone: replaying an early level must never hide a later one.
  unlock(n) {
    const s = load();
    if (n > s.unlocked) s.unlocked = n;
    persist();
    return s.unlocked;
  },

  markDaily(dateKey, id) {
    const s = load();
    s.daily[dateKey] = { id, at: Date.now() };
    persist();
  },

  dailyDone(dateKey) {
    return load().daily[dateKey] || null;
  },

  // `par` is the exhaustive-search distance, so "perfect" is a fact about this position
  // rather than a feeling: you cleared the sword in the proven minimum number of clicks.
  solve(id, { moves, par, hints }) {
    const s = load();
    const prev = s.records[id];
    const cur = {
      solved: true,
      best: !prev || !prev.best || moves < prev.best ? moves : prev.best,
      plays: (prev && prev.plays ? prev.plays : 0) + 1,
      perfect: moves <= par || !!(prev && prev.perfect),
    };
    s.records[id] = cur;
    s.stats.solves += 1;
    s.stats.clicks += moves;
    s.stats.hints += hints || 0;
    if (moves <= par && !hints) s.stats.perfect += 1;
    persist();
    return cur;
  },

  // Wipe the save: both the in-memory cache and whatever is on disk. `js/main.js` arms this
  // behind a double click, and test/storage.test.mjs asserts that after it the game really
  // does read as untouched — a stale cache that survives a wipe would be worse than no
  // wipe at all, because the screen would say "cleared" while the records came back.
  reset() {
    cache = blank();
    try {
      window.localStorage.removeItem(KEY);
    } catch (err) {
      /* nothing was ever persisted */
    }
    return cache;
  },
};
