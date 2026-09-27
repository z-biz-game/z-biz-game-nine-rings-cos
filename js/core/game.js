// The rules of 九连环 (the Chinese nine linked rings) and nothing else.
//
// A position is `n` bits: bit k is ring k+1, and 1 means the ring is on the sword.
// One click拨s one ring on or off, and only one rule says whether that click counts.
// That rule is `canToggle` below — the single source of legality in this repo, and the
// reason every difficulty number in the game is a fact rather than an opinion.
//
// No DOM, no window, no canvas: `node --test` and tools/playtest.mjs have to be able to
// drive the same object the screen does.

export const RINGS = 9;
export const SOLVED = 0;

// bit k of `state`: is ring k+1 on the sword?
export function bitAt(state, k) {
  return (state >> k) & 1;
}

// The predicate the *picture* reads: `js/view.js` uses it to decide which row a ring is drawn
// in, and `js/main.js` uses it for the "上了剑 / 离了剑" line after a click. Neither of them
// shifts the mask itself — the bit layout belongs to this file, and a second copy of it in the
// shell is how a rendering quietly starts disagreeing with the rule.
export function isOn(state, k) {
  return bitAt(state, k) === 1;
}

// THE rule. Ring 1 (k=0) always moves. Ring k+1 moves only when ring k is on the sword
// AND every ring below k is already off it.
//
// Two details here are load-bearing, and both were got wrong during development:
//   * k=1 is NOT special-cased into "always moves". Ring 2 needs ring 1 on the sword, and
//     dropping that requirement changes the whole graph: 拨全上→全下 comes out at 171
//     instead of the classical 341 (test/solve.test.mjs pins this down).
//   * the mask is `(1 << (k-1)) - 1`, i.e. bits 0..k-2 — it must not include bit k-1,
//     which the clause above requires to be 1.
export function canToggle(state, k, n = RINGS) {
  if (k < 0 || k >= n) return false;
  if (k === 0) return true;
  return bitAt(state, k - 1) === 1 && (state & ((1 << (k - 1)) - 1)) === 0;
}

// Which rings a finger could move from here. On the true rule this is 1 or 2 for every
// position — that is why the state graph is a path and not a tangle (see DESIGN.md 1.2).
export function movable(state, n = RINGS) {
  const out = [];
  for (let k = 0; k < n; k++) if (canToggle(state, k, n)) out.push(k);
  return out;
}

export function toggle(state, k) {
  return state ^ (1 << k);
}

export function bitsOf(state, n = RINGS) {
  const out = new Uint8Array(n);
  for (let k = 0; k < n; k++) out[k] = bitAt(state, k);
  return out;
}

// There is deliberately no `stateOfBits(bits)` alongside `bitsOf`. A position *is* its mask, so
// bits -> state is only ever wanted by something checking `bitsOf` from the other side, and the
// one place that happens — test/solve.test.mjs, 'bitsOf and toggle round-trip a position' —
// rebuilds the expected mask by hand precisely so the shipped helper cannot be its own oracle.
// A function with no honest caller is a ghost, so it is not here.

// A level in the shape `createGame` wants; also what tests hand around.
export function createGame(level) {
  if (!level) throw new Error('createGame needs a level');
  return {
    id: level.id,
    tier: level.tier,
    n: level.n,
    par: level.par,
    table: level.table || null,
    start: level.state,
    state: level.state,
    moves: 0,
    history: [],
    done: level.state === SOLVED,
  };
}

// One click. Returns true when the ring actually moved and the click is billed as a step;
// false means the rules refused, in which case nothing about the position or the count
// changed — the view is allowed to shake, but that is all it is allowed to do.
export function click(game, k) {
  if (game.done) return false;
  if (!canToggle(game.state, k, game.n)) return false;
  const from = game.state;
  game.state = toggle(from, k);
  game.history.push({ ring: k, from, to: game.state });
  game.moves++;
  if (game.state === SOLVED) game.done = true;
  return true;
}

export function undo(game) {
  const last = game.history.pop();
  if (!last) return false;
  game.state = last.from;
  game.moves--;
  game.done = false;
  return true;
}

export function reset(game) {
  game.state = game.start;
  game.moves = 0;
  game.history = [];
  game.done = game.start === SOLVED;
}

// How many 拨环 are left if every one of them is on a shortest route. `table` is the
// exhaustive BFS over all 2^n positions, so this is not an estimate: it is a lookup.
export function remaining(game) {
  if (!game.table) return -1;
  return game.table.dist[game.state];
}

// Steps wasted so far. Adding the optimal distance left to the steps spent and subtracting
// the level's par is the same arithmetic a round of golf keeps score with.
export function overPar(game) {
  const left = remaining(game);
  if (left < 0) return 0;
  return Math.max(0, game.moves + left - game.par);
}

// The ring the exhaustive search would move next, or -1 when the board is already clear.
export function nextRing(game) {
  if (!game.table || game.state === SOLVED) return -1;
  return game.table.next[game.state];
}

export function hint(game) {
  const k = nextRing(game);
  if (k < 0) return null;
  return { ring: k, left: remaining(game) };
}

// Walks the precomputed `next[]` chain down to the cleared sword. Bounded by construction
// (each step strictly lowers `dist`, and `dist` is a finite lookup table), so the guard is
// only here to make that auditable rather than assumed.
export function routeToZero(game) {
  return tableRoute(game.table, game.state);
}

export function tableRoute(table, state) {
  const out = [];
  if (!table) return out;
  let s = state;
  const cap = table.size + 1;
  for (let i = 0; i < cap && s !== SOLVED; i++) {
    const k = table.next[s];
    if (k < 0) break; // unreachable on a fully reachable graph; never spin forever
    out.push(k);
    s = toggle(s, k);
  }
  return out;
}

// Three grades, defined against the measured par so the win screen and the tests read the
// same rule. `over` is 0 only when the player matched the exhaustive search exactly.
export function grade(game) {
  const over = game.moves - game.par;
  if (over <= 0) return { key: 'perfect', label: '完美解环', stars: 3 };
  if (over <= 3) return { key: 'clean', label: '顺手解环', stars: 2 };
  return { key: 'long', label: '历尽连环', stars: 1 };
}
