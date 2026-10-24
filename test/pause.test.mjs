// The pause: a switch the player can reach that really stops the game.
//
// Three things have to be true at once, and only the third one is about the
// code:
//
//   1. the stopwatch stops — the time the player spent on this board does not
//      grow while the game is paused, and it picks up from the same number
//      when the pause is lifted (no double count, no jump);
//   2. the board stops — the rings do not travel and the canvas takes no
//      clicks while the game is paused;
//   3. the shell honours it — every route into a move (a finger, a drag, the
//      auto-demo, the keyboard) asks the pause first.
//
// The clock is injected, so "the clock did not run" is arithmetic here and not
// timing luck. The renderer is the real js/view.js; only the pixels are fake,
// so "the ring did not move" is measured from the geometry the renderer itself
// reports. The shell (js/main.js) is a browser entry point and cannot be
// imported here, so its wiring is checked by reading the source — the same
// trick test/game.test.mjs already uses for the bit layout.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { readFileSync } from 'node:fs';
import { createGame, click, RINGS } from '../js/core/game.js';
import { createSession, RUNNING, PAUSED, FINISHED } from '../js/core/session.js';
import { createView } from '../js/view.js';

// A clock the test moves by hand. `advance` is the only way time passes here.
function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance(ms) { t += ms; return t; },
  };
}

// A canvas that draws nothing and remembers who listened. The view is the
// shipped one; the 2d context is a proxy that swallows every call.
function fakeCanvas() {
  const listeners = new Map();
  const ctx = new Proxy({}, {
    get(_t, key) {
      if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (key === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return () => {};
    },
    set() { return true; },
  });
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 320 }),
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    fire(type, ev) {
      for (const fn of listeners.get(type) || []) fn(ev);
    },
  };
}

// The animation loop, driven by hand: one pump = one frame.
let rafQueue = [];
globalThis.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };
globalThis.cancelAnimationFrame = () => {};
function pump(now) {
  const queued = rafQueue;
  rafQueue = [];
  for (const fn of queued) fn(now);
}
globalThis.window = { devicePixelRatio: 1 };

const level = { id: 'pause', tier: 'novice', n: RINGS, par: 0, state: 0b111111111 };

// ---- the clock ----

test('the clock counts the time the board has been live', () => {
  const c = fakeClock();
  const s = createSession({ now: c.now });
  eq(s.elapsedMs(), 0, 'a fresh session has read nothing yet');
  c.advance(5000);
  eq(s.elapsedMs(), 5000, 'five seconds of play is five seconds on the clock');
  eq(s.state, RUNNING);
});

test('a paused clock does not move, however long the pause lasts', () => {
  const c = fakeClock();
  const s = createSession({ now: c.now });
  c.advance(5000);
  ok(s.pause(), 'the pause takes effect');
  eq(s.state, PAUSED);
  c.advance(600000); // ten minutes away from the keyboard
  eq(s.elapsedMs(), 5000, 'a ten-minute pause adds nothing to the clock');
  ok(s.paused);
});

test('resuming continues from the pause: no double count, no jump', () => {
  const c = fakeClock();
  const s = createSession({ now: c.now });
  c.advance(5000);
  s.pause();
  c.advance(600000);
  ok(s.resume(), 'the resume takes effect');
  c.advance(2000);
  eq(s.elapsedMs(), 7000, 'the clock picks up where it stopped: 5 s before the pause, 2 s after it');
  eq(s.state, RUNNING);
});

test('three pause/resume cycles in a row still add up exactly', () => {
  const c = fakeClock();
  const s = createSession({ now: c.now });
  let live = 0;
  for (let i = 0; i < 3; i++) {
    c.advance(1000); // one second of play
    live += 1000;
    const before = s.elapsedMs();
    s.pause();
    eq(s.elapsedMs(), before, `cycle ${i + 1}: the reading does not move the moment it is paused`);
    c.advance(10000); // ten minutes away from the keyboard
    eq(s.elapsedMs(), before, `cycle ${i + 1}: ten paused seconds add nothing`);
    s.resume();
  }
  eq(s.elapsedMs(), live, 'three live seconds, and none of the thirty paused seconds leaked in');
  eq([s.paused, s.state], [false, RUNNING]);
});

test('the pause is a switch, not a one-way door', () => {
  const c = fakeClock();
  const s = createSession({ now: c.now });
  c.advance(1000);
  ok(s.pause(), 'pause takes effect');
  ok(!s.pause(), 'pausing an already paused board changes nothing');
  eq(s.elapsedMs(), 1000, 'and the reading is untouched by the second press');
  ok(s.resume(), 'resume takes effect');
  ok(!s.resume(), 'resuming a running board changes nothing');
  eq(s.elapsedMs(), 1000);
});

test('a paused board refuses clicks; a live one takes them', () => {
  const s = createSession({ now: fakeClock().now });
  ok(s.acceptsInput(), 'a live board takes clicks');
  s.pause();
  ok(!s.acceptsInput(), 'a paused board refuses them');
  s.resume();
  ok(s.acceptsInput(), 'and it takes them again once the pause is lifted');
});

test('a finished board is not a paused board', () => {
  const c = fakeClock();
  const s = createSession({ now: c.now });
  c.advance(4000);
  ok(s.finish(), 'the game ends');
  eq(s.state, FINISHED);
  ok(!s.acceptsInput(), 'a finished board takes no clicks');
  eq(s.elapsedMs(), 4000, 'and the time it finished with is the time on the card');
  ok(!s.pause(), 'a finished board cannot be paused');
  eq(s.elapsedMs(), 4000, 'and its clock stays where it stopped');
});

// ---- the board ----

test('a pause moves no ring and rewinds no step', () => {
  const s = createSession({ now: fakeClock().now });
  const g = createGame(level);
  click(g, 0);
  const before = [g.moves, g.state];
  s.pause();
  eq([g.moves, g.state], before, 'the position is exactly where the player left it');
  s.resume();
  ok(click(g, 0), 'and the next legal move still lands after the pause');
  eq(g.moves, 2);
});

test('a paused board takes no clicks at all', () => {
  const canvas = fakeCanvas();
  const clicks = [];
  const s = createSession({ now: fakeClock().now });
  const view = createView(canvas, {
    onClick: (k) => clicks.push(k),
    onIllegal: () => { clicks.push('illegal'); },
    session: s,
  });
  const g = createGame(level);
  view.attach(g);
  const p = view.ringPoint(0);

  canvas.fire('pointerdown', { clientX: p.x, clientY: p.y, preventDefault() {} });
  eq(clicks, [0], 'a live board takes the click');

  s.pause();
  canvas.fire('pointerdown', { clientX: p.x, clientY: p.y, preventDefault() {} });
  eq(clicks, [0], 'a paused board takes no click — not even an illegal one');

  s.resume();
  canvas.fire('pointerdown', { clientX: p.x, clientY: p.y, preventDefault() {} });
  eq(clicks, [0, 0], 'and it takes clicks again once the pause is lifted');
});

test('the rings do not travel while the game is paused', () => {
  const canvas = fakeCanvas();
  const s = createSession({ now: fakeClock().now });
  const view = createView(canvas, { onClick: () => {}, onIllegal: () => {}, session: s });
  const g = createGame(level);
  view.attach(g);
  view.start(); // the animation loop has to be running before there is travel to watch
  click(g, 0); // ring 1 comes off the sword, so the renderer has travel to do

  const start = view.ringPoint(0).y;
  pump(1000);
  const running = view.ringPoint(0).y;
  ok(running > start, 'the ring travels down while the game is running');

  s.pause();
  pump(2000);
  eq(view.ringPoint(0).y, running, 'a paused board does not move the ring');
  pump(3000);
  eq(view.ringPoint(0).y, running, 'and it stays still for as long as the pause lasts');

  s.resume();
  pump(4000);
  ok(view.ringPoint(0).y > running, 'and it travels again once the pause is lifted');
});

// ---- the shell ----

test('the shell routes every move through the pause gate', () => {
  const src = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const body = src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');

  const commit = body.slice(body.indexOf('function commit(k)'), body.indexOf('function finish()'));
  const gate = commit.indexOf('acceptsInput');
  const move = commit.indexOf('click(app.game');
  ok(gate >= 0 && move >= 0, 'the commit path and its gate are both there');
  ok(gate < move, 'and the gate comes BEFORE the click: a pause checked after the move is no pause');

  const demo = body.slice(body.indexOf('demoTimer = setInterval'), body.indexOf('function stopDemo'));
  ok(demo.indexOf('acceptsInput') >= 0, 'the auto-demo waits while the game is paused');

  const keys = body.slice(body.indexOf("window.addEventListener('keydown'"), body.indexOf('view.start()'));
  const paused = keys.indexOf('session.paused');
  const undo = keys.indexOf('el.undo.click()');
  ok(paused >= 0 && paused < undo, 'the keyboard asks the pause before it touches the board');
  ok(keys.indexOf("'p'") >= 0, 'and P is one of the keys that reach the pause');
});

run();
