// Hand-written expectations. Nothing in here is read out of js/core — that is the point:
// if every number in the test file were produced by the code it tests, the suite would be
// a mirror and not a check.
//
// HOW THESE NUMBERS WERE DERIVED (by hand, on paper, then re-derived below by exhaustive
// search so nobody has to trust the arithmetic):
//
// Let a(k) = the number of clicks needed to clear the sword when ring k is the only ring on
// it (rings 1..k-1 all off, rings above k do not exist or are off).
//
//   a(1) = 1.  Ring 1 always moves; it is the only thing on the sword; take it off.
//
//   a(k) = 2*a(k-1) + 1 for k >= 2.  To move ring k at all, the rules demand ring k-1 on the
//     sword and rings 1..k-2 off it. Starting from "only ring k on", building that position
//     is the *same* problem as clearing ring k-1 from "only ring k-1 on" — the graph is
//     undirected (one click toggles one bit and can be stepped straight back), so reversing
//     a clearing route gives a building route of the same length: a(k-1) clicks. Then one
//     click takes ring k off, leaving "only ring k-1 on" — which is exactly the situation a(k-1)
//     starts from, so it costs a(k-1) more.
//
//   a(k) = 2^k - 1 by induction on that recurrence: 1, 3, 7, 15, 31, 63, 127, 255, 511.
//
// And the classical 九连环 result for the whole sword, b(n) = clicks from "all n on" to
// "all n off": b(n) = (2^(n+1) - 1)/3 when n is odd and (2^(n+1) - 2)/3 when n is even, i.e.
// 1, 2, 5, 10, 21, 42, 85, 170, 341 for n = 1..9. The routes below are hand-written by
// following the same recurrence, and each one is re-verified click-by-click against
// js/core/game.js's `canToggle` in test/solve.test.mjs, which then *exhaustively searches*
// every shorter click sequence and asserts that none of them clears the sword.

// A route is a list of ring numbers, 1-based, exactly as a player counts them on the sword.
export const HAND = [
  {
    state: 0b000000001, // ring 1 alone
    par: 1,
    route: [1],
    why: 'a(1) = 1: one ring, one click.',
  },
  {
    state: 0b000000011, // rings 1 and 2
    par: 2,
    route: [2, 1],
    why: 'ring 2 is legal the moment ring 1 is on the sword and nothing is under it, which is exactly this position.',
  },
  {
    state: 0b000000010, // ring 2 alone, ring 1 off: cannot touch ring 2 until ring 1 is back on
    par: 3,
    route: [1, 2, 1],
    why: 'a(2) = 2*a(1)+1 = 3: put ring 1 on, take ring 2 off, take ring 1 off.',
  },
  {
    state: 0b000000100, // ring 3 alone
    par: 7,
    route: [1, 2, 1, 3, 1, 2, 1],
    why: 'a(3) = 2*a(2)+1 = 7: build "ring 2 alone" upside down to reach rings 2+3, free ring 3, then clear the two below.',
  },
  {
    state: 0b00001000, // ring 4 alone
    par: 15,
    route: [1, 2, 1, 3, 1, 2, 1, 4, 1, 2, 1, 3, 1, 2, 1],
    why: 'a(4) = 2*a(3)+1 = 15. Same shape, one level deeper.',
  },
  {
    state: 0b100000000, // ring 9 alone — the deepest position on the sword, and the far corner
    par: 511,
    route: null, // hand-writing 511 clicks is not a good use of paper; the DFS bound is
    why: 'a(9) = 2^9 - 1 = 511, and it is the graph diameter: max dist over all 512 positions.',
  },
  {
    state: 0b111111111, // the classical starting position: all nine on the sword
    par: 341,
    route: null,
    why: 'b(9) = (2^10 - 1)/3 = 341 — the number the whole family of paper puzzles quotes.',
  },
];

// Positions where the rule must say NO, hand-checked against the wording of the rule:
// "ring k>1 moves only if ring k-1 is on the sword and every ring below k-1 is off it".
// state is nine bits (bit 0 = ring 1); ring is 1-based as the player counts.
export const ILLEGAL = [
  { state: 0b000000000, ring: 2, why: 'ring 1 is off the sword, so ring 2 cannot move' },
  { state: 0b000000000, ring: 3, why: 'ring 2 is off the sword' },
  { state: 0b000000101, ring: 3, why: 'rings 1 and 3 are on, ring 2 is off — ring 3 still cannot move' },
  { state: 0b000000111, ring: 3, why: 'ring 2 is on but ring 1 is still on too, and that is the blocker' },
  { state: 0b000001011, ring: 4, why: 'ring 3 is off the sword' },
  { state: 0b000111111, ring: 7, why: 'rings 1..6 are on: ring 6 is where it has to be, but ring 1 never went off' },
  { state: 0b000000001, ring: 9, why: 'ring 8 is off the sword' },
  { state: 0b100000000, ring: 9, why: 'ring 9 is itself on the sword with nothing under it — that is the far corner, and it cannot come off yet' },
];

// ...and the positions where it must say YES, for the same reason spelled out.
export const LEGAL = [
  { state: 0b000000000, ring: 1, why: 'ring 1 always moves' },
  { state: 0b111111111, ring: 1, why: 'ring 1 always moves, even here' },
  { state: 0b000000001, ring: 2, why: 'ring 1 on, nothing below ring 1' },
  { state: 0b000000010, ring: 3, why: 'ring 2 on and ring 1 off — this is the position ring 3 needs' },
  { state: 0b000000011, ring: 2, why: 'ring 1 on; toggling ring 2 off is legal from here' },
  { state: 0b001000000, ring: 8, why: 'ring 7 on (bit 6) and bits 0..5 clear' },
  { state: 0b010000000, ring: 9, why: 'ring 8 on (bit 7) and bits 0..6 clear' },
  { state: 0b110000000, ring: 9, why: 'ring 8 on, nothing under it; ring 9 itself being on does not stop it coming off' },
];

// The 512-state table is asserted complete; these two constants are what "complete" means
// for the two corners the docs quote.
export const FULL9 = 0b111111111;
