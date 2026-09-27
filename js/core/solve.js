// The solver — and the reason this repo is allowed to print difficulty numbers.
//
// With `n` rings there are exactly 2^n positions and at most `n` legal clicks each, so the
// whole state graph fits in memory and can be searched exhaustively. For n = 9 that is 512
// nodes and 511 edges: a breadth-first sweep from the cleared sword finishes in well under
// a millisecond and yields `dist[state]` — the true minimum number of clicks from that
// position to the goal — for *every* position, plus `next[state]`, the ring to move on such
// a route.
//
// That is what makes "this level is exactly N clicks" a measurement instead of an
// opinion, and it is also why the hint can never be wrong.
//
// The external anchor lives in test/solve.test.mjs and test/formula.test.mjs: the distance
// from "all nine on" to "all nine off" is asserted equal to the classical closed form
// (2^(n+1) - (n odd ? 1 : 2)) / 3, computed here by search and there by arithmetic. Two
// independent derivations agreeing is the evidence that the search is not grading itself.

import { canToggle, RINGS, toggle, SOLVED } from './game.js';

// The position with every ring on the sword.
export function fullRing(n = RINGS) {
  return (1 << n) - 1;
}

// Classical result for 九连环: the number of single-ring moves needed to take all n rings
// off (which equals putting them all on — the graph is undirected).
//   n odd  -> (2^(n+1) - 1) / 3
//   n even -> (2^(n+1) - 2) / 3
// Exact in doubles up to n = 51, and this repo refuses n > 12 anywhere except this function.
export function formula(n) {
  if (!Number.isInteger(n) || n < 1 || n > 51) throw new Error(`formula(${n}) out of range`);
  const v = (2 ** (n + 1) - (n % 2 === 1 ? 1 : 2)) / 3;
  if (!Number.isInteger(v)) throw new Error(`formula(${n}) is not an integer`);
  return v;
}

// One exhaustive BFS. Every loop here is bounded by `size` or by `n`, so a bug in the
// legality rule can make the sweep wrong but never unable to finish.
export function buildTable(n = RINGS, root = SOLVED) {
  if (!Number.isInteger(n) || n < 1 || n > 16) throw new Error(`buildTable(${n}): n out of range`);
  const size = 1 << n;
  const dist = new Int32Array(size).fill(-1);
  const via = new Int8Array(size).fill(-1);
  const parent = new Int32Array(size).fill(-1);
  const queue = new Int32Array(size); // a BFS queue on `size` nodes never holds a node twice
  const next = new Int32Array(size).fill(-1);
  const counts = new Int32Array(size); // distance histogram: counts[d] = positions at depth d
  const degree = new Int8Array(size);

  let head = 0;
  let tail = 0;
  dist[root] = 0;
  queue[tail++] = root;
  let reached = 1;
  while (head < tail) {
    const s = queue[head++];
    for (let k = 0; k < n; k++) {
      if (!canToggle(s, k, n)) continue;
      const t = toggle(s, k);
      if (dist[t] !== -1) continue;
      dist[t] = dist[s] + 1;
      via[t] = k;
      parent[t] = s;
      queue[tail++] = t;
      reached++;
    }
  }

  let maxDist = -1;
  let argMaxDist = -1;
  let degMax = 0;
  let degMin = n + 1;
  for (let s = 0; s < size; s++) {
    let d = 0;
    for (let k = 0; k < n; k++) {
      if (!canToggle(s, k, n)) continue;
      d++;
      // On a shortest route to `root` from `s` the ring to move is the neighbour that sits
      // one step closer. The graph is bipartite here (each click changes the bit count by
      // one) so at most one neighbour can be closer, and the loop cannot silently pick two.
      if (root === SOLVED && dist[s] > 0 && dist[toggle(s, k)] === dist[s] - 1) next[s] = k;
    }
    degree[s] = d;
    if (d > degMax) degMax = d;
    if (d < degMin) degMin = d;
    if (dist[s] >= 0 && dist[s] > maxDist) {
      maxDist = dist[s];
      argMaxDist = s;
    }
    if (dist[s] >= 0) counts[dist[s]]++;
  }

  return {
    n,
    size,
    root,
    dist,
    next,
    via,
    parent,
    counts,
    degree,
    reached,
    complete: reached === size,
    maxDist,
    argMaxDist,
    degMin,
    degMax,
    // A connected graph where nothing has three neighbours is a path: one position per
    // distance, which is exactly what makes the histogram flat.
    isPath: reached === size && degMax <= 2 && degMin >= 1,
  };
}

// The table the game runs on, built once per ring count and cached. 512 nodes for n = 9.
//
// This is the only door to a table. Two thin wrappers used to sit here (`distOf(state, n)`
// and `tableForLevel(n)`); both were deleted rather than wired, for one reason each:
//   * `tableForLevel` was `table` under a second name, and two names for one cache is how a
//     future edit gives them different bodies.
//   * `distOf(state, n)` invited a caller to pass an `n` that disagreed with the level being
//     played. A level already carries the table of its own ring count (`library.js` attaches
//     it, `game.js:remaining` reads it), and the distance itself does not depend on which
//     count named it — test/solve.test.mjs "a distance belongs to the bits, not to the ring
//     count named" measures that over every n from 1 to 9.
const cache = new Map();
export function table(n = RINGS) {
  let t = cache.get(n);
  if (!t) {
    t = buildTable(n, SOLVED);
    cache.set(n, t);
  }
  return t;
}

// Difficulty bands, measured off the distance histogram rather than invented: the states
// with par >= 1 are sorted and cut into `parts` equal-count slices. For n = 9 the graph is
// a path, so the histogram is flat and the slices come out as four equal-width ranges of
// par. That is a measurement, and `tools/bake.mjs` prints it so the docs can quote it.
export function bandCuts(t, parts = 4) {
  const pars = [];
  for (let s = 0; s < t.size; s++) if (t.dist[s] > 0) pars.push(t.dist[s]);
  if (!pars.length) return [];
  pars.sort((a, b) => a - b);
  const edges = [pars[0]];
  for (let i = 1; i < parts; i++) {
    const idx = Math.min(pars.length - 1, Math.round((pars.length * i) / parts));
    edges.push(pars[idx]);
  }
  edges.push(pars[pars.length - 1]);
  const bands = [];
  for (let i = 0; i < parts; i++) {
    const min = edges[i];
    const max = i === parts - 1 ? edges[i + 1] : edges[i + 1] - 1;
    let n = 0;
    for (let s = 0; s < t.size; s++) if (t.dist[s] >= min && t.dist[s] <= max) n++;
    bands.push({ min, max, n });
  }
  return bands;
}

// A one-line summary of what the exhaustive search says, for the docs and the bake log.
export function summary(t = table()) {
  return {
    n: t.n,
    nodes: t.size,
    reached: t.reached,
    complete: t.complete,
    isPath: t.isPath,
    degree: `${t.degMin}-${t.degMax}`,
    allOn: t.root === SOLVED ? t.dist[fullRing(t.n)] : -1,
    closedForm: formula(t.n),
    maxDist: t.maxDist,
    atState: t.argMaxDist,
    distinctDists: new Set(Array.from(t.dist.slice(0, t.size))).size,
  };
}
