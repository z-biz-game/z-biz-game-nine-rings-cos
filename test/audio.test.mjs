// Audio, tested against a fake AudioContext that counts what the engine asks for.
//
// The claim under test is not "a sound plays" — that is a pair of ears. It is the narrower,
// checkable one from the brief: a muted game must allocate **no** audio nodes, and a game
// that has not been unlocked by a real gesture must allocate none either. The common mute
// implementation (`gain.value = 0`) passes a listening test and fails this one, because it
// still creates and schedules an oscillator on every click and leaves the context running.
// So the fake records every `createOscillator` call, and both tests assert the count does not
// move.
//
// The module under test is `js/audio.js` — the one-singleton engine the shell imports
// (`import { audio } from './audio.js'`). Its contract, in three lines:
//   · `unlock()` is the gesture gate: before it, `play()` returns false and builds nothing;
//   · `setMuted(true)` really suspends the context (`ctx.suspend()`), not a gain ramp;
//   · `play()` returns false whenever the sound did **not** go out — unknown name, not
//     unlocked, or muted. `true` means a node was actually scheduled.
//
// The fake is also strict where browsers are strict: `exponentialRampToValueAtTime(0)` throws
// a RangeError in WebAudio, so a ramp that reaches exactly zero would be a real bug that only
// shows up as a silent game on some devices.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { createAudio } from '../js/audio.js';

class FakeParam {
  constructor(ctx) {
    this.ctx = ctx;
    this.value = 0;
  }

  setValueAtTime(v) {
    this.ctx.events.push(['set', v]);
    this.value = v;
    return this;
  }

  linearRampToValueAtTime(v, t) {
    this.ctx.events.push(['linear', v, t]);
    return this;
  }

  exponentialRampToValueAtTime(v, t) {
    // The spec's own restriction, enforced here so the engine has to respect it.
    if (v === 0) throw new RangeError('exponentialRampToValueAtTime: 0 is not a valid target');
    this.ctx.events.push(['exp', v, t]);
    return this;
  }
}

class FakeNode {
  constructor(ctx) {
    this.ctx = ctx;
    this.gain = new FakeParam(ctx);
    this.frequency = new FakeParam(ctx);
    this.type = 'sine';
    this.out = null;
  }

  connect(target) {
    this.out = target;
    this.ctx.connections += 1;
  }

  start(t) { this.ctx.starts.push(t); }

  stop(t) { this.ctx.stops.push(t); }
}

// The context the module is handed. `new Ctor()` returns this very object, so the `state`
// the engine reads is the state `resume()` / `suspend()` write — a fake whose state lived on
// the constructed instance instead would leave `ctx.state` at 'suspended' forever, and every
// assertion about it would pass while proving nothing.
class FakeContext {
  constructor() {
    this.state = 'suspended'; // where browsers put a context before any gesture
    this.currentTime = 0;
    this.destination = { name: 'destination' };
    this.events = [];
    this.starts = [];
    this.stops = [];
    this.oscillators = 0;
    this.gains = 0;
    this.connections = 0;
    this.resumes = 0;
    this.suspends = 0;
  }

  createOscillator() {
    this.oscillators += 1;
    return new FakeNode(this);
  }

  createGain() {
    this.gains += 1;
    return new FakeNode(this);
  }

  resume() {
    this.resumes += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  suspend() {
    this.suspends += 1;
    this.state = 'suspended';
    return Promise.resolve();
  }
}

function withAudio(opts = {}) {
  const ctx = new FakeContext();
  const audio = createAudio({ AudioContextCtor: function () { return ctx; }, ...opts });
  return { ctx, audio };
}

test('no gesture, no sound: play() refuses until unlock()', () => {
  const { ctx, audio } = withAudio();
  eq(ctx.oscillators, 0, 'importing the module must not have asked for a voice');
  eq(audio.unlocked, false, 'and it does not claim to be unlocked');
  eq(audio.play('tap'), false, 'a sound before a real gesture did not go out');
  eq(ctx.oscillators, 0, 'and it built nothing — a suspended context would just batch them up');
  eq(ctx.gains, 0, 'not even the master gain');

  eq(audio.unlock(), true, 'the gesture creates the context');
  eq(audio.unlocked, true);
  eq(ctx.state, 'running', 'and resumes it in the same call');
  ok(audio.play('tap'), 'now the same sound goes out');
  ok(ctx.oscillators > 0, `and it allocated ${ctx.oscillators} oscillators`);
  ok(ctx.gains >= ctx.oscillators, 'every voice goes through its own envelope before the master');
});

test('a muted game creates no audio nodes at all', () => {
  const { ctx, audio } = withAudio();
  audio.unlock();
  audio.play('tap');
  const before = ctx.oscillators;
  const graphBefore = ctx.connections;
  audio.setMuted(true);
  eq(audio.muted, true, 'mute is reported back');
  for (let i = 0; i < 8; i += 1) {
    eq(audio.play(i % 2 === 0 ? 'correct' : 'wrong'), false, 'a muted sound plays nothing');
    eq(audio.play('nope'), false, 'and an unknown name is refused the same way');
  }
  eq(ctx.oscillators, before, 'not one oscillator was created while muted');
  eq(ctx.connections, graphBefore, 'and the audio graph grew by nothing');
  eq(ctx.state, 'suspended', 'mute really suspends the context instead of turning it down');
  eq(ctx.suspends, 1, 'once, not once per sound');

  audio.setMuted(true);
  eq(ctx.suspends, 1, 'a redundant mute is a no-op');
  audio.setMuted(false);
  eq(audio.muted, false, 'and unmuting reports the new state');
  eq(ctx.state, 'running', 'unmuting resumes it');
  ok(audio.play('correct'), 'playback comes back');
  ok(ctx.oscillators > before, 'with new nodes, and only now');
});

test('an engine that will not start costs sound, not the game', () => {
  const audio = createAudio({ AudioContextCtor: null }); // no AudioContext in this environment
  eq(audio.unlock(), false, 'there is nothing to unlock');
  eq(audio.play('tap'), false, 'a headless host plays nothing');
  eq(audio.play('win'), false);
  eq(audio.unlocked, false, 'and it says so instead of pretending');
  audio.setMuted(true);
  eq(audio.muted, true, 'the preference itself still flips — it is a UI state, not a device state');
});

test('envelopes never ramp to zero, every voice gets an end, arps expand', () => {
  const { ctx, audio } = withAudio();
  audio.unlock();
  audio.play('tap');
  audio.play('wrong');
  audio.play('win'); // the arpeggio voice: four notes, not one
  const ramps = ctx.events.filter((e) => e[0] === 'exp');
  // tap 与 wrong 各一个振荡器、各一条指数尾；win 是四音的 arp，四条。
  ok(ramps.length >= 6, `the envelopes were written (${ramps.length} ramps)`);
  ok(ramps.every((e) => e[1] > 0), 'every exponential target is above zero — 0 throws in a real browser');
  ok(ctx.stops.length >= 6, `every voice is given an end (${ctx.stops.length} stops), so nothing leaks`);
  ok(ctx.stops.every((t) => Number.isFinite(t) && t > 0), 'with a real stop time');
  ok(ctx.oscillators >= 6, `tap/wrong are one oscillator each, win is four (${ctx.oscillators} total)`);
});

test('a muted start never lets a node through, not even the first one', () => {
  // The preference can be read back from storage before the player ever clicks; in that case
  // the context must come up suspended and stay silent until setMuted(false).
  const { ctx, audio } = withAudio({ muted: true });
  eq(audio.muted, true);
  eq(audio.play('tap'), false, 'still nothing before the gesture');
  eq(ctx.suspends, 0, 'a muted game does not even build a context before the gesture');
  audio.unlock();
  eq(ctx.suspends, 1, 'it comes up suspended rather than running');
  eq(ctx.state, 'suspended', 'unlocking a muted game does not resume it');
  eq(audio.play('tap'), false, 'and it stays silent');
  eq(ctx.oscillators, 0, 'with zero nodes built');
  audio.setMuted(false);
  eq(ctx.state, 'running', 'unmuting is what brings it back');
  ok(audio.play('tap'), 'and then it plays');
});

run();
