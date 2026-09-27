// The external anchor.
//
// Everything else in this repo could, in principle, be a self-consistent fiction: the
// generator reads the table, the table is built by our own BFS, the tests read the same
// BFS. This file breaks that circle. The closed form
//
//   b(n) = (2^(n+1) - 1) / 3   for odd n
//   b(n) = (2^(n+1) - 2) / 3   for even n
//
// is the classical result for the Chinese ring puzzle, published long before this code
// existed and derivable by hand from the same recurrence the toy obeys. If our search and
// that arithmetic agree for n = 1..12 — including n values far past the 9 the game ships —
// then the search is measuring the puzzle rather than inventing it.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { canToggle, toggle } from '../js/core/game.js';
import { buildTable, formula, fullRing } from '../js/core/solve.js';

// Published values for 全上 -> 全下, typed out rather than computed: this is the row the
// main agent verified by hand before any of this code was written.
const PUBLISHED = {
  1: 1, 2: 2, 3: 5, 4: 10, 5: 21, 6: 42, 7: 85, 8: 170,
  9: 341, 10: 682, 11: 1365, 12: 2730,
};

test('the published table of ring numbers is the table the closed form gives', () => {
  for (const [n, v] of Object.entries(PUBLISHED)) {
    eq(formula(Number(n)), v, `closed form at n=${n}`);
  }
});

test('for n = 1..12 the search reproduces every one of them', () => {
  for (const [n, v] of Object.entries(PUBLISHED)) {
    const t = buildTable(Number(n), 0);
    eq(t.reached, 1 << Number(n), `all 2^${n} positions are reachable at n=${n}`);
    ok(t.complete, `n=${n}: the sweep is exhaustive, not budgeted`);
    eq(t.dist[fullRing(Number(n))], v, `n=${n}: BFS says 全上->全下 is ${t.dist[fullRing(Number(n))]}, arithmetic says ${v}`);
    eq(t.dist[fullRing(Number(n))], formula(Number(n)), `n=${n}: search == closed form`);
  }
});

test('the same distance read from the all-on end agrees (undirected graph)', () => {
  for (const n of [3, 5, 7, 8, 9, 10]) {
    const fromZero = buildTable(n, 0);
    const fromFull = buildTable(n, fullRing(n));
    eq(fromZero.dist[fullRing(n)], fromFull.dist[0], `n=${n}: the route is the same length either way`);
    eq(fromFull.dist[0], formula(n), `n=${n} read backwards is still the closed form`);
  }
});

test('the eccentricity of the all-on position is 341, its diameter is not', () => {
  // Worth spelling out because it is an easy number to get wrong: BFS rooted at 全上 has a
  // maximum of 341 (reached at the empty sword), while BFS rooted at 全下 — the table the
  // game actually ships — has a maximum of 511 at ring 9 alone. Both are true; they are
  // different questions. DESIGN.md 1.2 keeps them apart.
  const fromFull = buildTable(9, fullRing(9));
  eq(fromFull.maxDist, 341, 'farthest position from 全上 is 341 clicks away');
  eq(fromFull.argMaxDist, 0, 'and it is the empty sword');
  const fromZero = buildTable(9, 0);
  eq(fromZero.maxDist, 511, 'farthest position from 全下 is 511 clicks away');
  eq(fromZero.dist[fullRing(9)], 341, 'which is not the same as where 全上 sits');
});

test('the k=1 special case that was got wrong is pinned down (341, not 171)', () => {
  // The development mistake this guards: treating ring 2 as "always movable" alongside ring
  // 1. It looks like a one-line simplification and it changes the puzzle into a different,
  // easier toy whose all-on -> all-off distance is 171. If that clause ever comes back,
  // this test is the one that says why it cannot.
  const sloppyCanToggle = (s, k, n) => {
    if (k < 0 || k >= n) return false;
    if (k <= 1) return true; // the bug
    return ((s >> (k - 1)) & 1) === 1 && (s & ((1 << (k - 1)) - 1)) === 0;
  };
  const n = 9;
  const size = 1 << n;
  const dist = new Int32Array(size).fill(-1);
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  dist[0] = 0;
  queue[tail++] = 0;
  while (head < tail) {
    const s = queue[head++];
    for (let k = 0; k < n; k++) {
      if (!sloppyCanToggle(s, k, n)) continue;
      const t = toggle(s, k);
      if (dist[t] !== -1) continue;
      dist[t] = dist[s] + 1;
      queue[tail++] = t;
    }
  }
  eq(tail, size, 'the sloppy rule still reaches all 512 positions, so coverage alone would not catch it');
  eq(dist[fullRing(n)], 171, 'the wrong rule reports 171');
  ok(dist[fullRing(n)] !== formula(n), '171 is not 341');
  eq(buildTable(n, 0).dist[fullRing(n)], formula(n), 'the shipped rule reports 341');
  // And the rule under test is the one in game.js, not a copy of this file's fix.
  for (const s of [0, 1, 2, 3, 5, 6, 7, 255, 256, 384, 511]) {
    eq(canToggle(s, 1, n), ((s >> 0) & 1) === 1, `ring 2 in ${s.toString(2)} needs ring 1 on the sword, and nothing else`);
  }
});

test('every intermediate position on the nine-ring graph has a hand-checkable distance', () => {
  // b(n) counts one specific route. The stronger statement the game leans on is that the
  // whole 512-column distance vector is the Gray-code rank of the position: the route from
  // 全下 to any position is unique (the graph is a path), so dist[] doubles as an index.
  // Checked here against the recurrence the path order obeys, computed independently.
  const t = buildTable(9, 0);
  const rankOf = (s) => {
    // The path is the binary reflected Gray code read the other way round:
    // rank(s) = grey^-1(s) where grey(b) = b ^ (b >> 1).
    let g = s;
    let r = g;
    while ((g >>= 1) > 0) r ^= g;
    return r;
  };
  let mismatched = [];
  for (let s = 0; s < t.size; s++) if (t.dist[s] !== rankOf(s)) mismatched.push(`${s}:${t.dist[s]}!=${rankOf(s)}`);
  eq(mismatched, [], 'dist[] is the Gray-code rank of every one of the 512 positions');
  eq(rankOf(fullRing(9)), 341, 'which independently reproduces 341');
});

run();
