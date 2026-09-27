// The generator. In most games in this family a generator has to be tested by sampling it
// thousands of times and looking at the distribution; here a level is nine bits and its
// difficulty is one lookup in a completed BFS, so the generator can be tested by *proof*:
// the band arithmetic, the one-position-per-distance fact, and the determinism of a seed.
//
// The numbers below are worked out against js/core/solve.js's table (recomputed in this file
// rather than trusted from memory) and against the closed form, not against a previous run.

import { test, run, ok, eq } from '../tools/harness.mjs';
import {
  TIERS, BAND_COUNT, tierByKey, statesAtPar, makeLevel, makeSet, spreadPars, census,
} from '../js/core/make.js';
import { table, bandCuts, formula, fullRing, summary } from '../js/core/solve.js';
import { RINGS, SOLVED, canToggle, movable } from '../js/core/game.js';

const t = table(RINGS);

test('the bands are four, named, and cut from the measured histogram', () => {
  eq(TIERS.length, BAND_COUNT, 'four bands is what the UI promises');
  eq(TIERS.map((x) => x.key), ['novice', 'linked', 'twined', 'master'], 'the order is easiest first');
  eq(TIERS.map((x) => x.label), ['初摘', '连环', '缠枝', '九转']);
  eq(TIERS.map((x) => `${x.min}-${x.max}`), ['1-128', '129-256', '257-383', '384-511'],
    'the cut points are the quartiles of 511 distances, not round numbers somebody liked');
  eq(TIERS.map((x) => x.states), [128, 128, 127, 128], 'equal-count slices (511 positions do not divide by 4 evenly)');
  eq(TIERS.reduce((a, x) => a + x.states, 0), t.size - 1, 'together they cover every non-terminal position');
  for (const tier of TIERS) eq(tier.blurb, `${tier.min}-${tier.max} 步`, `${tier.key} advertises its own range`);
});

test('bandCuts tiles the distance axis with no gaps and no overlaps', () => {
  for (const parts of [1, 2, 3, 4, 5, 7]) {
    const cuts = bandCuts(t, parts);
    eq(cuts.length, parts, `parts=${parts}`);
    eq(cuts[0].min, 1, `parts=${parts}: the easiest position is one click from the end`);
    eq(cuts[parts - 1].max, t.maxDist, `parts=${parts}: the last slice reaches the deepest position`);
    let states = 0;
    for (let i = 1; i < parts; i++) {
      ok(cuts[i].min === cuts[i - 1].max + 1, `parts=${parts} slices ${i - 1}/${i} are not contiguous`);
    }
    for (const c of cuts) {
      ok(c.n > 0, `parts=${parts}: an empty slice would be a band with no levels in it`);
      states += c.n;
    }
    eq(states, t.size - 1, `parts=${parts} must account for all 511 solvable positions`);
  }
});

test('bandCuts on a small graph, hand-computed', () => {
  // n = 3: distances 0..7 over 8 positions, one position each. Sorted non-zero pars are
  // 1,2,3,4,5,6,7 (seven of them). Cutting into three slices puts the edges at index
  // round(7/3) = 2 -> 3 and round(14/3) = 5 -> 6, i.e. the bands 1-2, 3-5, 6-7.
  const three = table(3);
  eq(Array.from(three.dist), [0, 1, 3, 2, 7, 6, 4, 5], 'the eight positions of a three-ring sword');
  eq(bandCuts(three, 3), [{ min: 1, max: 2, n: 2 }, { min: 3, max: 5, n: 3 }, { min: 6, max: 7, n: 2 }]);
  eq(bandCuts(three, 1), [{ min: 1, max: 7, n: 7 }]);
  // n = 4: sixteen positions, still a path, so the distances are 0..15 even though the
  // all-on sword itself sits at formula(4) = 10. Sorted non-zero pars are 1..15, and the
  // single cut index is round(15/2) = 8 -> pars[8] = 9, i.e. the bands 1-8 and 9-15.
  const four = table(4);
  eq(four.dist[fullRing(4)], formula(4));
  eq(four.dist[fullRing(4)], 10, 'the full four-ring sword is not the deepest position');
  eq(four.maxDist, 15);
  eq(bandCuts(four, 2), [{ min: 1, max: 8, n: 8 }, { min: 9, max: 15, n: 7 }]);
});

test('one distance, one position: the fact that makes generation trivial', () => {
  // The state graph is a path (test/solve.test.mjs proves the degree bound), so every
  // distance 0..511 is held by exactly one position. `statesAtPar` does not assume that —
  // it scans — so this is a check on the graph, not on the scan.
  eq(statesAtPar(SOLVED), [SOLVED], 'distance 0 is the cleared sword itself');
  for (let d = 1; d <= t.maxDist; d++) {
    const at = statesAtPar(d);
    eq(at.length, 1, `distance ${d} is held by ${at.length} positions`);
    eq(t.dist[at[0]], d, 'and the scan agrees with the table');
  }
  eq(statesAtPar(t.maxDist + 1), [], 'nothing is further than the deepest position');
  eq(statesAtPar(formula(9)), [fullRing(9)], 'the classical 341 belongs to the all-on sword');
  eq(statesAtPar(511), [256], 'the deepest position is the lone ninth ring — 511 clicks to come off');
});

test('a seed is a level: same in, same out, on any device', () => {
  for (const tier of TIERS) {
    const a = makeLevel('seed-42', tier.key);
    const b = makeLevel('seed-42', tier.key);
    eq(a, b, `${tier.key} is not a function of its seed`);
    eq(a.tier, tier.key);
    eq(a.n, RINGS);
    eq(a.par, t.dist[a.state], `${tier.key} par must be the table`);
    ok(a.par >= tier.min && a.par <= tier.max, `${tier.key} produced par ${a.par} outside ${tier.min}-${tier.max}`);
    eq(a.poolSize, 1, 'and picks the one position that has that distance');
    ok(movable(a.state, RINGS).length >= 1, `${tier.key} handed out a position with no click at all`);
    ok(a.state !== SOLVED, `${tier.key} handed out an already-clear sword`);
    eq(canToggle(a.state, 0, RINGS), true, 'ring 1 is always movable, so no level can be wedged');
    ok(a.state > 0 && a.state < (1 << RINGS), 'and the position fits on nine rings');
  }
  const spread = new Set(Array.from({ length: 60 }, (_, i) => makeLevel(`s${i}`, 'master').state));
  ok(spread.size >= 30, `60 seeds over a 128-position band gave only ${spread.size} distinct swords`);
  ok(makeLevel('a', 'novice').par < makeLevel('a', 'master').par, 'the bands order themselves by difficulty at equal seed');
});

test('generation cannot fail, so it never has to be retried', () => {
  // 100% accept rate: the par is drawn from inside the band and the band is a set of
  // distances the table proves is populated. `stats` is how tools/bake.mjs measures it.
  const stats = { tried: 0, accepted: 0, rejected: 0 };
  const pars = [];
  for (let i = 0; i < 400; i++) {
    const tier = TIERS[i % TIERS.length];
    const gen = makeLevel(`acceptance-${i}`, tier.key, stats);
    pars.push(gen.par);
    ok(gen.par >= tier.min && gen.par <= tier.max, `${tier.key} escaped its band at seed ${i}`);
  }
  eq([stats.tried, stats.accepted, stats.rejected], [400, 400, 0], 'not one rejection, so nothing to retry');
  ok(new Set(pars).size > 250, `only ${new Set(pars).size} distinct pars across 400 seeds — the draw is degenerate`);
  ok(pars.every((p) => p >= TIERS[0].min && p <= TIERS[TIERS.length - 1].max), 'every drawn par is on the measured axis');
});

test('generation is cheap enough to run on the player\'s clock', () => {
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) makeLevel(`clock-${i}`, TIERS[i % TIERS.length].key);
  const ms = performance.now() - t0;
  ok(ms < 120, `1000 levels took ${ms.toFixed(2)} ms; a daily puzzle must not be a search`);
});

test('an unknown band falls back instead of throwing', () => {
  eq(tierByKey('nope'), TIERS[0], 'falls back to the easiest band');
  eq(tierByKey('master'), TIERS[3]);
  eq(tierByKey(undefined), TIERS[0], 'a route with no band in it still gets a sword');
  eq(makeLevel('x', null).tier, 'novice', 'and the generator follows the same fallback');
});

test('the campaign set is spread, sorted and reproducible', () => {
  for (const tier of TIERS) {
    const set = makeSet(tier.key, 16);
    eq(set.length, 16, `${tier.key} shipped the requested count`);
    eq(makeSet(tier.key, 16), set, `${tier.key} makeSet is deterministic`);
    const pars = set.map((l) => l.par);
    eq(pars, [...pars].sort((a, b) => a - b), `${tier.key} must be easiest first`);
    eq(new Set(pars).size, pars.length, `${tier.key} repeats a par, so two of its levels would be one level`);
    eq([pars[0], pars[pars.length - 1]], [tier.min, tier.max], `${tier.key} must span its own band`);
    for (const l of set) {
      eq(l.par, t.dist[l.state], `${tier.key} row disagrees with the table`);
      eq(l.poolSize, 1);
    }
    eq(new Set(set.map((l) => l.state)).size, 16, `${tier.key} repeats a position`);
  }
  // A request larger than the band cannot invent positions: it gets the band's own width.
  const small = spreadPars({ min: 5, max: 8 }, 20);
  eq(small, [5, 6, 7, 8], 'four distances, four levels, no duplicates');
  eq(spreadPars({ min: 5, max: 8 }, 1), [5]);
  eq(spreadPars(TIERS[0], 0), []);
});

test('census describes the space the docs quote', () => {
  const c = census();
  eq(c.bands, TIERS);
  eq(c.table, summary(table(RINGS)));
  eq([c.table.nodes, c.table.reached, c.table.complete], [512, 512, true]);
  eq([c.table.allOn, c.table.closedForm], [341, 341], 'the headline pair: search and arithmetic');
  eq(c.table.maxDist, 511);
  eq(c.table.isPath, true);
});

run();
