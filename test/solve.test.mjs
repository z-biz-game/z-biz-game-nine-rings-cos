// The solver, checked against things the solver did not produce.
//
// Two independent levers are used here, and both matter:
//   * hand-written click routes from test/fixture.mjs, re-verified one click at a time
//     against `canToggle` — the same predicate a finger is held to;
//   * iterative-deepening DFS that enumerates every shorter click sequence and asserts none
//     of them clears the sword. That is the "no shorter solution exists" half of the claim,
//     and it is a different algorithm from the BFS whose answer it checks.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { HAND, ILLEGAL, LEGAL, FULL9 } from './fixture.mjs';
import { canToggle, toggle, bitsOf, createGame, click, remaining, overPar, tableRoute, RINGS } from '../js/core/game.js';
import { table, buildTable, formula, fullRing, bandCuts } from '../js/core/solve.js';

// Depth-limited DFS over the click graph. Every path-visited state is excluded, which is
// sound for a shortest-route question (a route that revisits a state is never shortest),
// and the whole walk is on a hard node budget so "no route" can never silently mean
// "I gave up".
function routeWithin(start, n, maxDepth, budget = 3000000) {
  const seen = new Set([start]);
  let left = budget;
  const walk = (s, d) => {
    if (s === 0) return true;
    if (d >= maxDepth) return false;
    if (--left <= 0) throw new Error(`DFS out of budget at depth ${maxDepth}: the negative answer would not be trustworthy`);
    for (let k = 0; k < n; k++) {
      if (!canToggle(s, k, n)) continue;
      const t = toggle(s, k);
      if (seen.has(t)) continue;
      seen.add(t);
      if (walk(t, d + 1)) return true;
      seen.delete(t);
    }
    return false;
  };
  return walk(start, 0);
}

function legalRoute(state, route, n = RINGS) {
  let s = state;
  for (const ring of route) {
    ok(canToggle(s, ring - 1, n), `ring ${ring} is not legal to 拨 from ${s.toString(2)}`);
    s = toggle(s, ring - 1);
  }
  return s;
}

test('the hand-written routes are legal and they clear the sword', () => {
  for (const h of HAND) {
    if (!h.route) continue;
    eq(legalRoute(h.state, h.route), 0, `${h.state.toString(2)} via [${h.route}] must land empty`);
    eq(h.route.length, h.par, `the hand route for ${h.state.toString(2)} has exactly par clicks`);
  }
});

test('no shorter click sequence clears those positions (exhaustive)', () => {
  for (const h of HAND) {
    const r = routeWithin(h.state, RINGS, h.par - 1);
    ok(!r, `nothing shorter than ${h.par} clicks exists for ${h.state.toString(2)}`);
    if (h.par <= 15) {
      ok(routeWithin(h.state, RINGS, h.par), `and ${h.par} clicks does do it, so the bound is tight`);
    }
  }
});

test('a(9) = 511: the deepest single ring is the far end of the graph', () => {
  const t = table(RINGS);
  eq(t.dist[256], 511, 'ring 9 alone takes 2^9 - 1 clicks');
  eq(t.maxDist, 511, 'and that is the maximum over all 512 positions');
  eq(t.argMaxDist, 256, 'attained at exactly one position');
  ok(!routeWithin(256, RINGS, 510), 'no 510-click route exists');
  ok(routeWithin(256, RINGS, 511), 'the 511-click route does');
});

test('the rule says no where the fixture says no', () => {
  for (const x of ILLEGAL) {
    ok(!canToggle(x.state, x.ring - 1, RINGS), `ring ${x.ring} in ${x.state.toString(2)}: ${x.why}`);
  }
});

test('the rule says yes where the fixture says yes', () => {
  for (const x of LEGAL) {
    ok(canToggle(x.state, x.ring - 1, RINGS), `ring ${x.ring} in ${x.state.toString(2)}: ${x.why}`);
  }
});

test('the exhaustive sweep really covers all 512 positions, and is fast', () => {
  const t0 = performance.now();
  const fresh = buildTable(RINGS);
  const ms = performance.now() - t0;
  eq(fresh.size, 512, 'the space is 2^9');
  eq(fresh.reached, 512, 'every one of them is reachable from the cleared sword');
  ok(fresh.complete, 'no position is stranded');
  ok(ms < 20, `a whole-table BFS took ${ms.toFixed(2)}ms — the budget the browser boot asserts`);
});

test('the graph is a path: at most two clicks out of any position', () => {
  const t = table(RINGS);
  eq(t.degMax, 2, 'nothing has three legal clicks');
  eq(t.degMin, 1, 'the two ends of the path have exactly one');
  ok(t.isPath, 'connected + max degree 2 = a single path through all 512 positions');
  // One position per distance is the fingerprint of that fact, and it is what makes the
  // difficulty bands equal-width instead of geometric.
  const counts = new Map();
  for (let s = 0; s < t.size; s++) counts.set(t.dist[s], (counts.get(t.dist[s]) || 0) + 1);
  eq(counts.size, 512, '512 distinct distances');
  eq(Math.max(...counts.values()), 1, 'each of them exactly once');
});

test('next[] walks every position home in exactly dist[] clicks', () => {
  const t = table(RINGS);
  for (let s = 0; s < t.size; s++) {
    let cur = s;
    let steps = 0;
    while (cur !== 0) {
      const k = t.next[cur];
      ok(k >= 0, `position ${cur} must offer a ring on a shortest route`);
      ok(canToggle(cur, k, RINGS), `next[] suggests an illegal click at ${cur}`);
      cur = toggle(cur, k);
      steps++;
      ok(steps <= t.dist[s] + 1, 'and the walk cannot overshoot the table');
    }
    eq(steps, t.dist[s], `replay from ${s}`);
  }
  eq(t.next[0], -1, 'the cleared sword suggests nothing');
});

test('fullRing(9) is the classical starting position and costs 341', () => {
  const t = table(RINGS);
  eq(fullRing(9), FULL9);
  eq(t.dist[FULL9], 341, 'the number on every paper puzzle card');
  eq(formula(9), 341);
});

test('the solver is a function: it cannot corrupt the table the game reads', () => {
  const t = table(RINGS);
  const distCopy = Int32Array.from(t.dist);
  const nextCopy = Int32Array.from(t.next);
  const g = createGame({ id: 'x', tier: 'novice', n: RINGS, state: FULL9, par: 341, table: t });
  eq(tableRoute(t, FULL9).length, 341, 'walking the route reads 341 suggestions');
  eq(remaining(g), 341);
  eq(g.state, FULL9, 'routeToZero did not touch the position it was asked about');
  for (const k of tableRoute(g.table, g.state).slice(0, 50)) ok(click(g, k));
  eq(Array.from(t.dist), Array.from(distCopy), 'dist[] survives a game being played');
  eq(Array.from(t.next), Array.from(nextCopy), 'next[] survives it too');
  eq(t.dist[g.state], remaining(g), 'and the lookup still agrees with where the player stands');
  const again = buildTable(RINGS);
  eq(Array.from(again.dist), Array.from(distCopy), 'two independent builds agree exactly');
});

test('a game bills legal clicks and refuses illegal ones', () => {
  const t = table(RINGS);
  const g = createGame({ id: 'y', n: RINGS, state: 0b100, par: 7, table: t });
  ok(!click(g, 2), 'ring 3 cannot come off while ring 2 is off the sword');
  eq([g.moves, g.state], [0, 0b100], 'an illegal click changed nothing but the shake');
  ok(click(g, 0));
  eq([g.moves, g.state, remaining(g)], [1, 0b101, 6], 'ring 1 is always legal and one step closer');
  eq(overPar(g), 0, 'a step on a shortest route is never over par');
  ok(click(g, 1));
  ok(click(g, 0));
  eq([g.moves, g.state, remaining(g), overPar(g)], [3, 0b110, 4, 0], 'still exactly on the route');
  ok(!click(g, 1), 'ring 2 needs ring 1 on the sword, and it is off now');
  eq([g.moves, g.state], [3, 0b110], 'so it costs nothing');
  ok(click(g, 2), 'ring 3 moves now: ring 2 is on and ring 1 is off');
  eq([g.state, remaining(g)], [0b010, 3]);
});

test('wasting a step is measurable', () => {
  const t = table(RINGS);
  const g = createGame({ id: 'z', n: RINGS, state: 0b11, par: 2, table: t });
  ok(click(g, 0), 'ring 1 off — legal, and a mistake');
  eq([g.moves, remaining(g), overPar(g)], [1, 3, 2], '2 clicks spent, 3 to go, par was 2: two over');
  ok(click(g, 0), 'put it back');
  eq([g.moves, remaining(g), overPar(g)], [2, 2, 2]);
});

test('bands are cut from the measured histogram, in order and without gaps', () => {
  const t = table(RINGS);
  const bands = bandCuts(t, 4);
  eq(bands.length, 4);
  eq(bands[0].min, 1, 'no band starts at the already-solved position');
  eq(bands[3].max, 511, 'the top band reaches the diameter');
  for (let i = 1; i < bands.length; i++) eq(bands[i].min, bands[i - 1].max + 1, 'bands tile the range with no hole and no overlap');
  eq(bands.reduce((a, b) => a + b.n, 0), 511, 'and together they hold every non-trivial position');
  for (const b of bands) ok(b.n >= 120 && b.n <= 135, `band ${b.min}-${b.max} holds ${b.n} positions, i.e. an equal-count quartile`);
});

test('a distance belongs to the bits, not to the ring count named', () => {
  // Why there is no `distOf(state, n)` in js/core/solve.js: measured over every ring count
  // this repo can name, the distance and the shortest-route ring of a position are the same
  // numbers as the nine-ring table the game ships. A caller handed an extra `n` could only
  // disagree with the level it was given, so the table travels with the level instead.
  const nine = table(RINGS);
  for (let n = 1; n <= RINGS; n++) {
    const t = table(n);
    eq(t.size, 1 << n, `n=${n} names ${t.size} positions`);
    for (let s = 0; s < t.size; s++) {
      eq(t.dist[s], nine.dist[s], `n=${n} state ${s} distance`);
      if (s) eq(t.next[s], nine.next[s], `n=${n} state ${s} first click of the route`);
    }
    eq(t.dist[t.size - 1], formula(n), `and n=${n} still ends at the closed form`);
  }
});

test('bitsOf and toggle round-trip a position', () => {
  for (const s of [0, 1, 2, 5, 13, 255, 511]) {
    const bits = bitsOf(s, RINGS);
    eq(bits.length, RINGS);
    let back = 0;
    bits.forEach((b, k) => { if (b) back |= 1 << k; });
    eq(back, s, `${s} survives the bit round trip`);
    eq(toggle(toggle(s, 3), 3), s, 'a click undone is the position you started from');
  }
});

run();
