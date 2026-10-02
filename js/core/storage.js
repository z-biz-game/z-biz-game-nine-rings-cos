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
    tutorial: false,
    dropped: 0,
  };
}

let cache = null;

// The save is read in two stages on purpose. Stage 1 accepts or rejects the *envelope*
// (parse, then shape); stage 2 validates every record on its own, so one bad row costs that
// row and nothing else. A single `Object.assign(default, JSON.parse(raw))` would either
// throw on `records: { "novice-03": null }` and freeze the game at boot, or hand back
// `best: null` to `renderCrumbs`, which then prints a level that never happened.
const MAX_RECORDS = 4096;
const MAX_ID = 64;
const MAX_MOVES = 1e6; // the 9-ring graph is 512 wide; anything past a million is junk
const MAX_DAYS = 4096;

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= MAX_MOVES ? Math.floor(n) : null;
}

function cleanRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const best = count(raw.best);
  const plays = count(raw.plays);
  if (best === null || plays === null) return null;
  return { solved: raw.solved === true, best, plays, perfect: raw.perfect === true };
}

function cleanRecords(input) {
  const out = {};
  let dropped = 0;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { records: out, dropped: input == null ? 0 : 1 };
  }
  for (const id of Object.keys(input)) {
    if (typeof id !== 'string' || !id.length || id.length > MAX_ID) { dropped++; continue; }
    const rec = cleanRecord(input[id]);
    if (!rec) { dropped++; continue; }
    if (Object.keys(out).length >= MAX_RECORDS) { dropped++; continue; }
    out[id] = rec;
  }
  return { records: out, dropped };
}

function cleanDaily(input) {
  const out = {};
  let dropped = 0;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { daily: out, dropped: input == null ? 0 : 1 };
  }
  for (const key of Object.keys(input)) {
    const row = input[key];
    if (typeof key !== 'string' || key.length > 16 || !row || typeof row !== 'object') { dropped++; continue; }
    const id = row.id;
    if (typeof id !== 'string' || !id.length || id.length > MAX_ID) { dropped++; continue; }
    if (Object.keys(out).length >= MAX_DAYS) { dropped++; continue; }
    out[key] = { id, at: count(row.at) === null ? 0 : count(row.at) };
  }
  return { daily: out, dropped };
}

function cleanStats(input) {
  const base = blank().stats;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { stats: base, dropped: 0 };
  const stats = { ...base };
  let dropped = 0;
  for (const key of Object.keys(base)) {
    const n = count(input[key]);
    if (n === null) dropped += 1;
    else stats[key] = n;
  }
  return { stats, dropped };
}

function decode(raw) {
  const parsed = JSON.parse(raw); // stage 1: throws on unparseable, caller starts clean
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const base = blank();
  const records = cleanRecords(parsed.records);
  const daily = cleanDaily(parsed.daily);
  const stats = cleanStats(parsed.stats);
  const unlocked = count(parsed.unlocked);
  return {
    save: {
      records: records.records,
      daily: daily.daily,
      // Unlocking is monotone and bounded by the pool, so a save claiming level 4e9 cannot
      // open a shelf of buttons that lead nowhere.
      unlocked: unlocked === null || unlocked < 1 ? base.unlocked : Math.min(unlocked, MAX_RECORDS),
      tutorial: parsed.tutorial === true,
      stats: stats.stats,
      dropped: records.dropped + daily.dropped + stats.dropped,
    },
  };
}

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
      const out = decode(raw);
      if (out) {
        cache = out.save;
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
  // How many rows stage 2 threw away — the number a save-robustness test asserts on.
  get dropped() { return load().dropped; },
  get tutorialSeen() { return load().tutorial; },
  markTutorialSeen() {
    const s = load();
    s.tutorial = true;
    persist();
    return true;
  },
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
