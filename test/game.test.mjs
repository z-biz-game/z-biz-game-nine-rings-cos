// A game in progress: the object the canvas mutates and the win screen reads. The rule
// itself is covered by test/solve.test.mjs and test/formula.test.mjs; this suite is about
// counting, undoing, finishing and grading — the parts a player can break.
//
// Every expectation below is worked out by hand against the rule ("ring 1 always moves;
// ring k>1 moves iff ring k-1 is on the sword and every ring below it is off"), not copied
// out of a run. The positions used are small enough to trace on paper:
//
//   0b100  ring 3 on, rings 1-2 off   -> ring 3 is STUCK (needs ring 2 on); ring 4 can go
//                                        ON (ring 3 is on, nothing under it); ring 1 always.
//   0b101  rings 1,3 on               -> ring 1 moves, ring 4 moves; ring 3 still stuck.
//   0b11   rings 1,2 on              -> ring 2 comes off (ring 1 on, nothing below), then
//                                        ring 1: two clicks, so this position is par 2.
//   0b111111111 all nine on           -> 341 (the classical number).

import { test, run, ok, eq } from '../tools/harness.mjs';
import { readFileSync } from 'node:fs';
import {
  createGame, click, undo, reset, hint, grade, remaining, overPar, nextRing, routeToZero,
  tableRoute, movable, canToggle, bitsOf, bitAt, isOn, RINGS, SOLVED,
} from '../js/core/game.js';
import { table } from '../js/core/solve.js';
import { HAND } from './fixture.mjs';

const t = table(RINGS);
const level = (over = {}) => ({ id: 'test', tier: 'novice', n: RINGS, par: 0, state: 0, table: t, ...over });

function solveIn(g) {
  const route = tableRoute(g.table, g.state);
  for (const k of route) ok(click(g, k), `the solver's own click ${k} has to be legal where it is played`);
  return route.length;
}

test('a level with nothing on the sword is already won', () => {
  const g = createGame(level({ state: SOLVED, par: 0 }));
  eq([g.moves, g.done, remaining(g)], [0, true, 0], 'the terminal position is recognised at once');
  eq(g.start, SOLVED);
  ok(!click(g, 0), 'and clicking a cleared sword is not a move');
  eq(g.moves, 0);
});

test('par, distance and over-par agree at every step of a hand-written solution', () => {
  for (const h of HAND) {
    if (!h.route) continue;
    const g = createGame(level({ state: h.state, par: h.par }));
    eq(remaining(g), h.par, `${h.state.toString(2)}: the lookup matches the hand-written par`);
    eq(routeToZero(g).length, h.par, 'and the suggested route is exactly that long');
    for (const ring of h.route) {
      eq(nextRing(g), ring - 1, 'the suggestion is the next click of the hand route');
      const before = remaining(g);
      ok(click(g, ring - 1));
      eq(remaining(g), before - 1, 'and each one gets a click closer');
      eq(overPar(g), 0, 'never over par');
    }
    eq([g.moves, g.done, g.state], [h.par, true, SOLVED], 'finishes exactly on par');
    eq(grade(g), { key: 'perfect', label: '完美解环', stars: 3 });
  }
});

test('the three grades are defined against the measured par', () => {
  const perfect = createGame(level({ state: 0b11, par: 2 }));
  ok(click(perfect, 1), 'ring 2 off: ring 1 is on and nothing is under it');
  ok(click(perfect, 0), 'ring 1 off');
  eq([perfect.moves, perfect.done, perfect.state], [2, true, 0]);
  eq(overPar(perfect), 0);
  eq(grade(perfect), { key: 'perfect', label: '完美解环', stars: 3 }, 'two clicks against a par of two');

  const detour = createGame(level({ state: 0b11, par: 2 }));
  ok(click(detour, 0), 'ring 1 off first — legal, and a mistake');
  eq([detour.state, detour.moves], [0b10, 1]);
  ok(click(detour, 0), 'put it back on');
  eq(detour.state, 0b11);
  eq(remaining(detour), 2, 'back where we were, two clicks from the end');
  eq(overPar(detour), 2, 'two clicks spent, two still needed, against a par of two');
  ok(click(detour, 1));
  ok(click(detour, 0));
  eq([detour.moves, detour.done], [4, true]);
  eq(overPar(detour), 2, 'two wasted clicks are on the record');
  eq(grade(detour), { key: 'clean', label: '顺手解环', stars: 2 }, 'within three of par is 顺手');

  const sloppy = createGame(level({ state: 0b11, par: 2 }));
  for (let i = 0; i < 6; i++) ok(click(sloppy, 0), 'toggle ring 1 back and forth six times');
  eq([sloppy.state, sloppy.moves], [0b11, 6], 'six clicks, nothing achieved');
  eq(solveIn(sloppy), 2, 'then the two real clicks');
  eq([sloppy.moves, sloppy.done], [8, true]);
  eq(overPar(sloppy), 6);
  eq(grade(sloppy), { key: 'long', label: '历尽连环', stars: 1 }, 'four times over par is one star');
});

test('illegal clicks are free: no step, no position change, no history', () => {
  const g = createGame(level({ state: 0b100, par: 7 }));
  // Ring 3 is on the sword but stuck (ring 2 is off); ring 4 may go on, ring 1 may do as it
  // likes. Everything else is refused.
  eq(movable(0b100, RINGS), [0, 3], 'the two legal clicks, by hand');
  for (const k of [1, 2, 4, 8]) {
    ok(!click(g, k), `ring ${k + 1} is not movable from 0b100`);
  }
  eq([g.moves, g.state, g.history.length], [0, 0b100, 0], 'and none of them cost anything');
  ok(!click(g, -1), 'a tap left of the grip is not a ring');
  ok(!click(g, 9), 'nor is a tenth ring');
  ok(!click(g, 42), 'nor a negative index past the end');
  ok(!canToggle(0b100, 9, RINGS), 'and the rule itself refuses k >= n');
});

test('undo walks the history back and un-wins the level', () => {
  const g = createGame(level({ state: 0b101, par: 6 }));
  ok(!undo(g), 'nothing to undo at the start');
  ok(click(g, 0));
  eq([g.state, g.moves], [0b100, 1], 'ring 1 off leaves ring 3 alone on the sword');
  ok(undo(g));
  eq([g.state, g.moves, g.done, g.history.length], [0b101, 0, false, 0], 'one step back to where we were');
  eq(solveIn(g), 6, 'six clicks is what this position needs');
  ok(g.done);
  ok(undo(g), 'undoing the winning click un-wins it');
  eq([g.done, g.moves], [false, 5]);
  eq([g.state, remaining(g)], [0b1, 1], 'one click from the end again');
});

test('reset returns to the level as baked, not to somewhere near it', () => {
  const g = createGame(level({ state: 0b100, par: 7 }));
  eq(solveIn(g), 7);
  ok(g.done);
  reset(g);
  eq([g.state, g.moves, g.done, g.history.length], [0b100, 0, false, 0]);
  eq(remaining(g), 7, 'the table still says the same thing about it');
});

test('hint names a ring and the clicks left after it', () => {
  const g = createGame(level({ state: 0b100, par: 7 }));
  const h = hint(g);
  eq([h.ring, h.left], [0, 7], 'ring 1 first, seven clicks including it');
  ok(click(g, h.ring));
  eq(hint(g).left, 6, 'and the count goes down by exactly one');
  eq(solveIn(g), 6);
  eq(hint(g), null, 'a cleared sword has no suggestion');

  // The hint chain terminates: following it is the same walk `routeToZero` does, so it has
  // to land on the empty sword in par clicks and never wander.
  reset(g);
  let steps = 0;
  while (!g.done && steps < 512) {
    const x = hint(g);
    ok(x, 'a position on the sword always has a suggestion until it is clear');
    ok(click(g, x.ring), 'and the suggestion is always a legal click');
    steps++;
  }
  eq([steps, g.moves, g.state], [7, 7, SOLVED], 'seven hinted clicks, no spin');
});

test('over-par only counts what the player actually wasted', () => {
  const g = createGame(level({ state: 0b111111111, par: 341 }));
  eq(overPar(g), 0, 'at the start, standing on a shortest route');
  ok(click(g, 0));
  eq([remaining(g), overPar(g)], [340, 0], 'on the route');
  ok(click(g, 0));
  eq([remaining(g), overPar(g)], [341, 2], 'a round trip is two wasted clicks');
  ok(click(g, 1), 'ring 2 is legal again with ring 1 on the sword — and it goes the wrong way');
  eq([remaining(g), overPar(g)], [342, 4], 'a step away from the route costs double: the click spent and the click gained');
  ok(click(g, 1), 'take it back off again');
  eq([remaining(g), overPar(g)], [341, 4], 'back on a shortest route, but two clicks behind par');
  ok(click(g, 0), 'now the genuine first click of the solution');
  eq([remaining(g), overPar(g)], [340, 4], 'and the wasted pair stays on the record afterwards');
});

test('bitsOf tracks the position the player is looking at', () => {
  const g = createGame(level({ state: 0b10110, par: 0 }));
  eq(Array.from(bitsOf(g.state, RINGS)), [0, 1, 1, 0, 1, 0, 0, 0, 0], 'rings 2, 3 and 5 are on the sword');
  ok(click(g, 0), 'ring 1 on');
  eq(Array.from(bitsOf(g.state, RINGS))[0], 1);
  eq(t.dist[g.state], remaining(g), 'the lookup and the bits describe the same position');
  eq(g.par, 0, 'and createGame did not invent a par for it');
});

test('isOn is the mask for every position and every ring', () => {
  for (let s = 0; s < 512; s++) {
    for (let k = 0; k < RINGS; k++) {
      // Read straight off the integer, the way a caller with no core would: if the bit layout
      // ever changed inside game.js, this is the assertion that says so.
      const expected = ((s >> k) & 1) === 1;
      eq(isOn(s, k), expected, `isOn(${s}, ${k})`);
      eq(isOn(s, k), bitAt(s, k) === 1, 'the predicate and the raw bit agree');
    }
  }
  eq(isOn(0, 0), false, 'nothing is on an empty sword');
  eq(Array.from(bitsOf(511, RINGS)).every((b) => b === 1), true, 'and the full sword is all ones');
});

// js/core/* owns what a bit means, and js/main.js + js/view.js are not allowed to re-derive
// it. Both used to: the win line asked `(state >> k) & 1`, and the renderer compared
// `bitAt(state, k) === 1` in four places. The first is a duplicate of the layout, the second a
// duplicate of the predicate that reads it, and the failure mode of either is silent: the
// panel says a ring went on the sword while the picture says it came off.
// tools/verify.sh's @pointer checks the two agree on screen; this checks the source.
test('no shipped shell or view re-derives the bit layout', () => {
  for (const f of ['js/main.js', 'js/view.js']) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    const body = src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
    for (const bad of ['>> k', '>>k', '& 1)', 'bitAt(']) {
      ok(!body.includes(bad), `${f} hand-rolls a bit read with "${bad.trim()}": import it from js/core/game.js`);
    }
    ok(/isOn\(/.test(body), `${f} should ask js/core/game.js which rings are on the sword`);
  }
});

test('the game object carries the level it came from', () => {
  const g = createGame(level({ id: 'novice-07', tier: 'novice', state: 0b11, par: 2 }));
  eq([g.id, g.tier, g.n, g.par, g.start, g.state], ['novice-07', 'novice', 9, 2, 0b11, 0b11]);
  eq(canToggle(g.state, 1, g.n), true);
  eq(remaining(g), 2);
});

run();
