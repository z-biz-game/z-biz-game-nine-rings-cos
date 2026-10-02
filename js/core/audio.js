// Sound. Three verbs — a ring seating on the blade, a click the rule refused, a sword
// cleared — synthesised from short exponential envelopes, so the shipped bytes stay in the
// bitmaps and the frequencies stay reviewable numbers rather than opaque assets.
//
// The rule worth more than the code: while the player is muted, no oscillator node is
// created at all, and the context is really suspended. A "mute" implemented as
// `gain.value = 0` still allocates and schedules voices on every click — it costs CPU, keeps
// the audio hardware awake on a phone, and is precisely what a player who muted the game
// asked not to happen. `js/core/audio.js` is testable on that: `stats().created` stays 0.
//
// The context is created lazily on the first sound that is allowed to play, so loading the
// page makes no audio promise, and an environment without AudioContext (`file://` restrictions
// aside, node harnesses are the real case) gets `false` back rather than an exception.

const VOICE_CAP = 24; // concurrent voices: a held finger must not queue an unbounded graph
const MASTER = 0.5; // headroom, so three partials never clip

// [Hz, seconds, gain, type]. The clink is deliberately inharmonic (roughly 1 : 1.5 : 2.51)
// because that is what reads as brass against a steel bar; a harmonic stack reads as a bell.
const NOTES = {
  clink: { partials: [[1180, 0.09, 0.32, 'triangle'], [1770, 0.07, 0.18, 'sine'], [2960, 0.05, 0.07, 'sine']] },
  seat: { partials: [[523, 0.16, 0.30, 'triangle'], [784, 0.12, 0.16, 'sine'], [1310, 0.08, 0.06, 'sine']], glide: 0.86 },
  refuse: { partials: [[148, 0.16, 0.34, 'triangle'], [99, 0.20, 0.20, 'sine']], glide: 0.7 },
  clear: { partials: [[660, 0.50, 0.24, 'triangle'], [880, 0.50, 0.20, 'sine'], [1320, 0.60, 0.16, 'sine']], spread: 0.10 },
};

export function createAudio(host = globalThis) {
  let ctx = null;
  let master = null;
  let muted = false;
  const ends = []; // voice end-times in context seconds, for the concurrency cap
  const stats = {
    created: 0, played: 0, refusedByMute: 0, refusedByEngine: 0, drops: 0,
    suspends: 0, resumes: 0, unlocks: 0,
  };

  function engine() {
    if (ctx) return ctx;
    const Ctor = host.AudioContext || host.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch (err) {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = MASTER;
    master.connect(ctx.destination);
    return ctx;
  }

  // Browsers hand out a context in `suspended` until a real gesture exists. That is not
  // something this game can fight, so the click that plays is also the click that unlocks.
  function unlock() {
    const ac = engine();
    if (!ac) return null;
    if (ac.state === 'suspended' && ac.resume) {
      stats.unlocks += 1;
      Promise.resolve(ac.resume()).catch(() => {});
    }
    return ac;
  }

  function active(now) {
    for (let i = ends.length - 1; i >= 0; i -= 1) if (ends[i] <= now) ends.splice(i, 1);
    return ends.length;
  }

  function play(name) {
    if (muted) {
      stats.refusedByMute += 1;
      return false;
    }
    const note = NOTES[name];
    if (!note) return false;
    const ac = unlock();
    if (!ac) {
      stats.refusedByEngine += 1;
      return false;
    }
    const t0 = ac.currentTime;
    if (active(t0) >= VOICE_CAP) {
      // Drop the newest voice rather than queueing it: a queued game sounds late, and a
      // fast demo walk is the common way to get here.
      stats.drops += 1;
      return false;
    }
    const spread = note.spread || 0;
    let voicing = 0;
    note.partials.forEach(([freq, dur, gain, type], i) => {
      const at = t0 + i * spread;
      if (active(t0) + voicing >= VOICE_CAP) return;
      const osc = ac.createOscillator();
      const env = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq * (note.glide || 1), at);
      // Exponential, twice: a gate clicks, and a linear ramp to zero audibly stops halfway
      // through the ring. The floor is 0.0001 because exponential ramps cannot reach 0.
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(gain, at + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(env);
      env.connect(master);
      osc.start(at);
      osc.stop(at + dur + 0.02);
      ends.push(at + dur + 0.02);
      voicing += 1;
    });
    if (!voicing) {
      stats.drops += 1;
      return false;
    }
    stats.created += voicing;
    stats.played += 1;
    return true;
  }

  // Pause is not mute: a paused game holds no audio in the air but comes back audible,
  // whether or not the player had muted it. Suspension is what makes the two different,
  // and it is observable from outside through `state()`.
  function suspend() {
    if (!ctx || !ctx.suspend || ctx.state !== 'running') return false;
    stats.suspends += 1;
    Promise.resolve(ctx.suspend()).catch(() => {});
    return true;
  }

  function resume() {
    if (muted || !ctx || !ctx.resume || ctx.state !== 'suspended') return false;
    stats.resumes += 1;
    Promise.resolve(ctx.resume()).catch(() => {});
    return true;
  }

  function setMuted(on) {
    const next = !!on;
    if (next === muted) return muted;
    muted = next;
    if (muted) suspend();
    else resume();
    return muted;
  }

  return {
    // up = the ring went onto the sword, down = it came off. Two pieces of metal, two sounds.
    clink(up) { return play(up ? 'clink' : 'seat'); },
    illegal() { return play('refuse'); },
    clear() { return play('clear'); },
    setMuted,
    toggleMuted() { return setMuted(!muted); },
    get muted() { return muted; },
    suspend,
    resume,
    state() { return ctx ? ctx.state : 'none'; },
    stats() { return { ...stats, voices: ends.length, muted, engine: ctx ? ctx.state : 'none' }; },
  };
}
