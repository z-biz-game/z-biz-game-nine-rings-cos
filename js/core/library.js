// The level pool the game reads from.
//
// Two kinds of level exist here and they are deliberately different things:
//
//   * the campaign — the baked rows in js/data/levels.js, each with a stable id so
//     `#/lot/<id>` is a link another device can open, and each carrying the par that
//     `tools/bake.mjs` measured and `test/library.test.mjs` re-measures;
//   * daily / random — generated on the spot by js/core/make.js. That is the opposite of
//     the usual choice in this family, and the reason is cheap: a level here is nine bits
//     and its difficulty is one array lookup in an already-completed BFS, so generation
//     costs microseconds and never fails (measured in tools/bake.mjs: 800/800 accepted,
//     0.0025 ms each). There is no search on the player's clock.
//
// Everything is a pure lookup plus a seed, which is what makes the daily puzzle and a
// shared `#/lot/<id>` the same position on every device with no state to carry.

import { LEVELS, TIERS_META, HISTOGRAM } from '../data/levels.js';
import { table, formula, fullRing, summary } from './solve.js';
import { RINGS } from './game.js';
import { hashSeed } from './rng.js';
import { makeLevel, tierByKey, TIERS as ENVELOPE } from './make.js';

// Display-side bands: measured min/max of the levels that actually shipped in each band.
// The generation envelope they were drawn from is `envelope`, kept separate on purpose.
export const TIERS = TIERS_META;
export const ENVELOPES = ENVELOPE;

const bfs = table(RINGS);

// A baked row has to stand on its own, so it is checkable on its own. Every clause here is
// a way a hand-edited js/data/levels.js could otherwise print a difficulty number that no
// search agrees with, and test/library.test.mjs drives each one with a negative fixture.
export function validateLevel(row) {
  if (!row || typeof row !== 'object') return 'not an object';
  if (typeof row.id !== 'string' || !row.id.length) return 'missing id';
  if (!TIERS.some((t) => t.key === row.tier)) return `unknown tier ${row.tier}`;
  if (!Number.isInteger(row.n) || row.n < 1 || row.n > 12) return `n ${row.n} out of range`;
  if (!Number.isInteger(row.state) || row.state < 0 || row.state >= (1 << row.n)) return `state ${row.state} does not fit in ${row.n} rings`;
  if (!Number.isInteger(row.par) || row.par < 1) return `par ${row.par} is not a positive number of clicks`;
  if (row.par !== bfs.dist[row.state]) return `par ${row.par} disagrees with the table (${bfs.dist[row.state]})`;
  const tier = TIERS.find((t) => t.key === row.tier);
  if (row.par < tier.min || row.par > tier.max) return `par ${row.par} outside band ${tier.key} ${tier.min}-${tier.max}`;
  if (!Number.isInteger(row.rings) || row.rings < 0 || row.rings > row.n) return `rings ${row.rings} impossible`;
  return null;
}

const prepared = LEVELS.map((row) => ({
  id: row.id,
  tier: row.tier,
  n: row.n,
  state: row.state,
  par: row.par,
  rings: row.rings,
  movable: row.movable,
  table: bfs,
  generated: false,
}));

export const ALL = prepared;

export { tierByKey };

export function levelsIn(key) {
  return prepared.filter((l) => l.tier === key);
}

export function byId(id) {
  return prepared.find((l) => l.id === id) || null;
}

// The campaign: every baked level, lowest band first and within a band the measured par
// ascending — which is the order tools/bake.mjs wrote them in.
export function campaign() {
  return prepared;
}

export function levelAt(index) {
  return prepared[((index % prepared.length) + prepared.length) % prepared.length];
}

function wrap(gen, id) {
  return {
    id,
    tier: gen.tier,
    n: gen.n,
    state: gen.state,
    par: gen.par,
    table: gen.n === bfs.n ? bfs : table(gen.n),
    generated: true,
  };
}

// Endless play in one band. The seed is in the URL, so the link is the level.
export function randomLevel(seed, tierKey) {
  const tier = tierByKey(tierKey);
  const token = String(seed);
  return wrap(makeLevel(token, tier.key), `rand-${tier.key}-${(hashSeed(token) % 46656).toString(36)}`);
}

// One puzzle per calendar day, the same for everyone: the date picks a band and then picks
// the position inside it.
export function dailyLevel(dateKey) {
  const h = hashSeed(`daily|${dateKey}`);
  const tier = TIERS[h % TIERS.length];
  return wrap(makeLevel(`daily|${dateKey}`, tier.key), `daily-${dateKey}`);
}

function median(sorted) {
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2);
}

// What the shipped pool actually contains, measured rather than claimed. README and
// deliverable.md copy their band table out of this function, so it is asserted in
// test/library.test.mjs rather than eyeballed.
export function stats() {
  const byTier = {};
  for (const l of prepared) {
    const s = byTier[l.tier] || (byTier[l.tier] = { n: 0, min: Infinity, max: 0, pars: [], ringsMin: Infinity, ringsMax: 0 });
    s.n++;
    if (l.par < s.min) s.min = l.par;
    if (l.par > s.max) s.max = l.par;
    if (l.rings < s.ringsMin) s.ringsMin = l.rings;
    if (l.rings > s.ringsMax) s.ringsMax = l.rings;
    s.pars.push(l.par);
  }
  for (const s of Object.values(byTier)) {
    s.pars.sort((a, b) => a - b);
    s.parMed = median(s.pars);
    s.parSpread = s.pars[s.pars.length - 1] - s.pars[0];
    delete s.pars;
  }
  return { levels: prepared.length, byTier, graph: summary(bfs), histogram: HISTOGRAM };
}

// The number the whole repo is staked on, recomputed rather than quoted.
export function closedForm(n = RINGS) {
  return { n, search: table(n).dist[fullRing(n)], formula: formula(n) };
}
