// Audio, tested against a fake AudioContext that counts what the engine asks for.
//
// The claim under test is not "a sound plays" — that is a pair of ears. It is the narrower,
// checkable one from the brief: a muted game must allocate **no** audio nodes. The common
// implementation (`gain.value = 0`) passes a listening test and fails this one, because it
// still creates and schedules an oscillator on every click and leaves the context running.
// So the fake records every `createOscillator` call, and the mute test asserts the count does
// not move.
//
// The fake is also strict where browsers are strict: `exponentialRampToValueAtTime(0)` throws
// a RangeError in WebAudio, so a ramp that reaches exactly zero would be a real bug that only
// shows up as a silent game on some devices.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { createAudio } from '../js/core/audio.js';

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

function withAudio() {
  const ctx = new FakeContext();
  const audio = createAudio({ AudioContext: function () { return ctx; } });
  return { ctx, audio };
}

test('the first allowed sound creates the context and unlocks it', () => {
  const { ctx, audio } = withAudio();
  eq(ctx.oscillators, 0, 'loading the game must not have asked for a voice');
  ok(audio.clink(true), 'a legal click is allowed to play');
  ok(ctx.oscillators > 0, `and it allocated ${ctx.oscillators} oscillators`);
  eq(ctx.state, 'running', 'the click that played is the click that unlocked the context');
  eq(audio.state(), 'running');
  ok(ctx.gains >= ctx.oscillators, 'every voice goes through its own envelope before the master');
});

test('a muted game creates no audio nodes at all', () => {
  const { ctx, audio } = withAudio();
  audio.clink(true);
  const before = ctx.oscillators;
  const graphBefore = ctx.connections;
  eq(audio.setMuted(true), true, 'mute is reported back');
  for (let i = 0; i < 8; i += 1) {
    eq(audio.clink(i % 2 === 0), false, 'a muted click plays nothing');
    eq(audio.illegal(), false);
  }
  eq(ctx.oscillators, before, 'not one oscillator was created while muted');
  eq(ctx.connections, graphBefore, 'and the audio graph grew by nothing');
  ok(audio.stats().refusedByMute >= 16, 'the refusals are counted rather than silently swallowed');
  eq(audio.state(), 'suspended', 'mute really suspends the context instead of turning it down');
  eq(ctx.suspends, 1, 'once, not once per click');

  eq(audio.setMuted(true), true, 'a redundant mute is a no-op');
  eq(ctx.suspends, 1);
  ok(audio.setMuted(false) === false, 'and unmuting reports the new state');
  eq(audio.state(), 'running', 'unmuting resumes it');
  ok(audio.clink(false), 'playback comes back');
  ok(ctx.oscillators > before, 'with new nodes, and only now');
});

test('pause suspends, and comes back audible even when muted', () => {
  const { ctx, audio } = withAudio();
  audio.clink(true);
  eq(ctx.state, 'running');
  ok(audio.suspend(), 'pausing suspends a running context');
  eq(audio.state(), 'suspended');
  ok(audio.resume(), 'and resuming brings it back');
  eq(audio.state(), 'running');

  audio.setMuted(true);
  ok(audio.resume() === false, 'a muted game never resumes itself');
  eq(audio.state(), 'suspended');
  audio.setMuted(false);
  eq(audio.state(), 'running', 'unmuting after a paused-while-muted stretch still leaves it audible');
});

test('an engine that will not start costs sound, not the game', () => {
  const audio = createAudio({}); // no AudioContext in this environment at all
  eq(audio.clink(true), false, 'a headless host plays nothing');
  eq(audio.illegal(), false);
  eq(audio.clear(), false);
  eq(audio.state(), 'none', 'and says so instead of throwing');
  eq(audio.stats().refusedByEngine, 3, 'the refusals are visible');
  audio.setMuted(true);
  audio.clink(true);
  audio.illegal();
  eq(audio.stats().refusedByMute, 2, 'mute short-circuits before the engine is even asked');
  eq(audio.stats().refusedByEngine, 3, 'and the engine was not retried for those two');

  const broken = createAudio({ AudioContext: function Boom() { throw new Error('NotAllowedError'); } });
  eq(broken.clink(true), false, 'a constructor that refuses is handled too');
});

test('envelopes never ramp to zero, and voices are capped', () => {
  const { ctx, audio } = withAudio();
  audio.clink(true);
  audio.illegal();
  audio.clear();
  const ramps = ctx.events.filter((e) => e[0] === 'exp');
  ok(ramps.length >= 9, `the envelopes were written (${ramps.length} ramps)`);
  ok(ramps.every((e) => e[1] > 0), 'every exponential target is above zero — 0 throws in a real browser');
  ok(ctx.stops.every((t) => Number.isFinite(t) && t > 0), 'every voice is given an end, so nothing leaks');

  // The fake clock never advances, so every voice is still "in the air": a held finger or a
  // fast demo has to hit the cap rather than grow the graph forever.
  let played = 0;
  for (let i = 0; i < 60; i += 1) if (audio.clink(true)) played += 1;
  const s = audio.stats();
  ok(s.voices <= 24, `concurrent voices stayed at or under the cap (${s.voices})`);
  ok(s.drops > 0, `and the overflow was dropped instead of queued (${s.drops} drops)`);
  ok(played < 60, 'the engine stopped saying yes');
});

run();
