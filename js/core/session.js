// The session stopwatch, and the pause that freezes it.
//
// One piece of state, two jobs. `elapsedMs()` is how long this attempt has
// actually been *played* — the time the player spends looking at the board,
// which is what a puzzle game prints next to the step count. `paused` is the
// player's "leave me alone" switch: while it is on the stopwatch does not
// advance, the board takes no clicks, and the ring animation does not move.
//
// The clock is injected (`now`) on purpose: a test moves time by hand instead
// of sleeping, so every assertion about "the clock did not run" is arithmetic
// and not timing luck.
//
// No DOM, no window: `node --test` drives the same object the screen does.

export const RUNNING = 'running';
export const PAUSED = 'paused';
export const FINISHED = 'finished';

export function createSession({ now = () => Date.now() } = {}) {
  let state = RUNNING;
  let banked = 0; // ms already counted
  let since = now(); // when the current running stretch began

  // The freeze lives here and nowhere else: while the session is not running,
  // the reading is exactly what was banked at the moment it stopped. This is
  // the line that makes "paused means the clock stopped" true.
  function elapsedMs() {
    if (state !== RUNNING) return banked;
    return banked + (now() - since);
  }

  function pause() {
    if (state !== RUNNING) return false;
    banked += now() - since;
    state = PAUSED;
    return true;
  }

  function resume() {
    if (state !== PAUSED) return false;
    since = now();
    state = RUNNING;
    return true;
  }

  function toggle() {
    return state === PAUSED ? resume() : pause();
  }

  // The win card prints the final time, so finishing has to stop the clock
  // the same way pausing does — but it is not a pause: the board is over.
  function finish() {
    if (state !== RUNNING) return false;
    banked += now() - since;
    state = FINISHED;
    return true;
  }

  // A new level is a new attempt: the clock starts from zero again.
  function reset() {
    banked = 0;
    since = now();
    state = RUNNING;
  }

  return {
    get state() {
      return state;
    },
    get paused() {
      return state === PAUSED;
    },
    elapsedMs,
    pause,
    resume,
    toggle,
    finish,
    reset,
    // The one question the board asks before it accepts a click. A finished
    // board and a paused board both say no; a live one says yes.
    acceptsInput() {
      return state === RUNNING;
    },
  };
}
