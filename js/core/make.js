// The generator — which, for once, is a boring file. A level is a position on the sword,
// and a position is nine bits, so "generating a level" is choosing a state whose measured
// distance-to-goal lands in the band being offered. The distance came out of
// js/core/solve.js over all 512 positions, so there is nothing to search at generation
// time and nothing to reject: the accept rate is 100% by construction and a level costs
// microseconds, which is why this repo can generate in the browser (see README).
//
// The bands below are *measured* off the distance histogram of the 512 positions — see
// `bandsFromHistogram()` — not written from a feeling about what counts as hard.

import { table, bandCuts, summary } from './solve.js';
import { RINGS } from './game.js';
import { rngFrom } from './rng.js';

export const BAND_COUNT = 4;

const NAMES = [
  { key: 'novice', label: '初摘' },
  { key: 'linked', label: '连环' },
  { key: 'twined', label: '缠枝' },
  { key: 'master', label: '九转' },
];

// Recomputed at load from the exhaustive table, so a change to the rules moves the bands
// with it instead of leaving four stale numbers in a comment.
function bandsFromHistogram(n = RINGS, parts = BAND_COUNT) {
  const cuts = bandCuts(table(n), parts);
  return cuts.map((c, i) => ({
    key: NAMES[i].key,
    label: NAMES[i].label,
    n,
    min: c.min,
    max: c.max,
    states: c.n,
    blurb: `${c.min}-${c.max} 步`,
  }));
}

export const TIERS = bandsFromHistogram();

export function tierByKey(key) {
  return TIERS.find((t) => t.key === key) || TIERS[0];
}

// Every position at exactly `par` clicks from the cleared sword. On a path graph this holds
// one position; the code does not assume that, and test/make.test.mjs asserts the size.
export function statesAtPar(par, n = RINGS) {
  const t = table(n);
  const out = [];
  for (let s = 0; s < t.size; s++) if (t.dist[s] === par) out.push(s);
  return out;
}

// One deterministic level out of one deterministic seed. Nothing here can fail to produce a
// level: the band is a range of distances that the table proves has positions in it.
export function makeLevel(seed, tierKey, stats) {
  const tier = tierByKey(tierKey);
  const t = table(tier.n);
  const rng = rngFrom(`${tier.key}|${seed}`);
  const width = tier.max - tier.min + 1;
  const par = tier.min + rng.int(width);
  const pool = statesAtPar(par, tier.n);
  if (stats) {
    stats.tried = (stats.tried || 0) + 1;
    if (pool.length) stats.accepted = (stats.accepted || 0) + 1;
    else stats.rejected = (stats.rejected || 0) + 1;
  }
  if (!pool.length) throw new Error(`band ${tier.key} advertises par ${par} but the table has no position at that distance`);
  const state = pool.length === 1 ? pool[0] : rng.pick(pool);
  return {
    n: tier.n,
    tier: tier.key,
    state,
    par: t.dist[state],
    poolSize: pool.length,
  };
}

// The campaign wants spread, not a random draw: distinct pars, evenly spaced across the
// band, each pinned to the position that has that par. Deterministic in `seed`, and every
// published par is inside the measured band by construction.
export function spreadPars(tier, count) {
  const width = tier.max - tier.min + 1;
  const k = Math.min(count, width);
  const out = [];
  for (let i = 0; i < k; i++) out.push(tier.min + Math.round((i * (width - 1)) / Math.max(1, k - 1)));
  return [...new Set(out)].sort((a, b) => a - b);
}

export function makeSet(tierKey, count, seed = 'bake') {
  const tier = tierByKey(tierKey);
  const t = table(tier.n);
  return spreadPars(tier, count).map((want, i) => {
    const pool = statesAtPar(want, tier.n);
    const rng = rngFrom(`${seed}|${tier.key}|${i}|${want}`);
    const state = pool.length === 1 ? pool[0] : rng.pick(pool);
    return { n: tier.n, tier: tier.key, state, par: t.dist[state], poolSize: pool.length };
  });
}

// What bake prints: the whole measured shape of the space, so the README table is copied
// from a command and not from somebody's head.
export function census() {
  const t = table();
  return { bands: TIERS, table: summary(t) };
}
