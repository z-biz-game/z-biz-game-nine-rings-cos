// Canvas renderer + pointer handling. This file owns pixels and gestures and decides
// nothing: `js/core/game.js` is the only place a click is judged legal. The view *asks* for
// a ring to be toggled, and reads the rule back from the same pure function purely for
// styling — there is exactly one implementation of the rule in the repo, never a second
// copy in here.
//
// Almost everything drawn is generated in code: a sword (grip, guard, blade, tip) and nine
// rings. The two bitmaps are the physical stuff a vector cannot fake — the woven stand cloth
// and the brass spark — and both are optional: `assets/gen/make_art.py` mints them, and if
// either fails to load the board falls back to the procedural fill rather than skipping a
// frame. The one thing the picture has to get right is the physics of the toy: a ring that
// is on the sword is threaded *through* the bar, a ring that has been 拨 off hangs *below*
// it — and rings must visibly travel between those two rows, which is what `drop[k]`
// animates. Getting this right is gameplay, not decoration: it is how the player sees which
// rule is in front of them.
//
// Time: the sim advances on a fixed accumulator (SIM_STEP), never on the frame's dt, so a
// 30Hz laptop, a 120Hz phone and a headless probe agree on where every ring is after N
// ticks. Everything rate-dependent — travel, shake decay, spark gravity, the hint pulse —
// lives inside `tick()`.

import { movable, isOn } from './core/game.js';

const PAD = 26;
const TOP = 34; // room above the bar so the blade and its tip read as a sword
const SIM_STEP = 1 / 60; // fixed sim tick, in seconds
const MAX_STEPS = 8; // catch-up budget: 0.133s, past that a stalled tab drops time
const TRAVEL_PER_TICK = 11 / 60; // ring travel stiffness, expressed at the sim tick
const SHAKE_PER_TICK = 2.6 / 60; // illegal-click decay, same
const DRAG_PER_TICK = 1 - 1.9 / 60; // spark air drag, same (0.968 of last tick)
const GRAVITY_PER_TICK = 240 / 60; // px/s^2 on the sparks, integrated once per tick
const HINT_PERIOD = 1.1; // seconds of sim time per pulse
const MIN_GRAB = 22; // CSS px: a 44px-wide touch target is the floor, whatever the layout did
const SPARK_CAP = 220;

const TEXTURE_URL = 'assets/img/texture-weave-96.png';
const SPARK_URL = 'assets/img/sprite-spark-64.png';

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Optional bitmaps. A stub environment (node harnesses) has an Image that never fires load,
// which is the same as a 404: the caller must already have a procedural fallback.
function loadImage(url, onReady) {
  if (typeof Image !== 'function') return null;
  const img = new Image();
  img.addEventListener('load', () => onReady(img));
  img.addEventListener('error', () => {});
  img.decoding = 'async';
  img.src = url;
  return img;
}

export function createView(canvas, { onClick, onIllegal, onSimTick } = {}) {
  // `willReadFrequently` because tools/playtest.mjs reads the bitmap back to prove that a
  // legal click changes the picture and an illegal one does not; without it Chrome logs a
  // warning on every readback, which would drown the console-clean check.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let game = null;
  let geom = { pitch: 44, r: 18, x0: 40, barY: 110, swing: 130, w: 320, h: 320 };
  const drop = new Float64Array(9); // 0 = threaded on the bar, 1 = hanging below it
  const shake = new Float64Array(9); // decays after an illegal click
  let live = []; // rings the rule allows right now, refreshed once per draw
  let hint = null; // { ring, left }
  let raf = 0;
  let last = 0;
  let warm = 0; // first frames always repaint, so the canvas is never blank
  let accum = 0;
  let simClock = 0;
  let simSteps = 0;
  let paused = false;
  const sparks = [];
  let cloth = null; // stand texture, once decoded
  let spark = null; // spark sprite, once decoded
  let reducedMotion = false;
  const rmq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (rmq) {
    reducedMotion = !!rmq.matches;
    const onChange = (ev) => { reducedMotion = !!ev.matches; };
    if (typeof rmq.addEventListener === 'function') rmq.addEventListener('change', onChange);
    else if (typeof rmq.addListener === 'function') rmq.addListener(onChange); // Safari < 14
  }

  function measure() {
    const box = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const W = Math.max(200, Math.round(box.width));
    const H = Math.max(200, Math.round(box.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!game) return;
    const n = game.n;
    // Nine rings side by side is the binding constraint; the height budget keeps the two
    // rows from colliding.
    const pitch = Math.max(18, Math.floor(Math.min((W - PAD * 2) / (n + 0.9), (H - PAD * 2) / 3.6)));
    geom = {
      pitch,
      r: Math.max(8, Math.round(pitch * 0.40)),
      x0: Math.round((W - pitch * (n - 1)) / 2),
      barY: Math.round(TOP + pitch * 1.25),
      swing: Math.round(Math.max(pitch * 2.3, H * 0.3)),
      w: W,
      h: H,
    };
    draw();
  }

  // Canvas-local point from a pointer/touch/mouse event, scaled by the *rendered* box. A
  // phone's visual viewport can differ from the layout box the canvas was measured against,
  // so the divisor is the box width rather than 1 — otherwise the finger lands left of the
  // ring it is on.
  function localPoint(ev) {
    const box = canvas.getBoundingClientRect();
    const src = ev.touches && ev.touches.length ? ev.touches[0] : ev;
    const sx = box.width ? (geom.w / box.width) : 1;
    const sy = box.height ? (geom.h / box.height) : 1;
    return { x: (src.clientX - box.left) * sx, y: (src.clientY - box.top) * sy };
  }

  // Canvas-local point -> client pixels: the mapping the hit test reads, run backwards so an
  // automated finger presses where a ring actually is.
  function toClient(ux, uy) {
    const box = canvas.getBoundingClientRect();
    const sx = box.width ? (box.width / geom.w) : 1;
    const sy = box.height ? (box.height / geom.h) : 1;
    return {
      x: Math.round(box.left + ux * sx),
      y: Math.round(box.top + uy * sy),
      r: geom.r,
      pitch: geom.pitch,
    };
  }

  function slotX(k) {
    return geom.x0 + k * geom.pitch;
  }

  // Visual centre of ring k right now, canvas-local.
  function ringCentre(k) {
    const jitter = shake[k] > 0 ? Math.sin(shake[k] * 26) * shake[k] * geom.r * 0.6 : 0;
    return { x: slotX(k) + jitter, y: geom.barY + drop[k] * geom.swing };
  }

  // Snaps every ring to where the position says it belongs — used on load, when animating
  // a whole board from scratch would just be noise.
  function settle() {
    for (let k = 0; k < game.n; k++) drop[k] = isOn(game.state, k) ? 0 : 1;
    shake.fill(0);
  }

  // The whole board back to a cold start: rings, decay, sparks, clocks. `js/main.js` calls
  // this from 重开/再来一次, and a restart that left a spark or a half-travelled ring behind
  // would be a restart that only looked like one.
  function rewind() {
    sparks.length = 0;
    shake.fill(0);
    accum = 0;
    simClock = 0;
    simSteps = 0;
    hint = null;
    if (game) settle();
  }

  function hitTest(p) {
    let hitRing = -1;
    let best = Infinity;
    for (let k = 0; k < game.n; k++) {
      const c = ringCentre(k);
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      const grab = Math.max(geom.r + geom.pitch * 0.2, MIN_GRAB);
      if (d <= grab && d < best) {
        best = d;
        hitRing = k;
      }
    }
    return hitRing;
  }

  function press(ev) {
    if (!game || game.done || paused) return;
    const hitRing = hitTest(localPoint(ev));
    if (hitRing < 0) return; // bare board is not a ring, and costs nothing
    if (ev.cancelable) ev.preventDefault();
    if (hint && hint.ring === hitRing) hint = null;
    if (onClick) {
      const movedIt = onClick(hitRing);
      if (!movedIt) {
        if (!reducedMotion) shake[hitRing] = 1; // feedback is all an illegal click is allowed to buy
        if (onIllegal) onIllegal(hitRing);
      } else {
        puff(hitRing, 6);
      }
    }
    draw();
  }

  // pointerdown first (one code path for finger, pen and mouse); touchstart/mousedown only
  // where PointerEvent is missing, which in practice means an old Safari or a synthetic
  // dispatch from a test driver.
  const hasPointer = typeof window !== 'undefined' && 'PointerEvent' in window;
  if (hasPointer) {
    canvas.addEventListener('pointerdown', press);
  } else {
    canvas.addEventListener('touchstart', press, { passive: false });
    canvas.addEventListener('mousedown', press);
  }

  function band(k, front) {
    const { r } = geom;
    const c = ringCentre(k);
    const can = live.indexOf(k) >= 0;
    const on = isOn(game.state, k);
    const threaded = drop[k] < 0.5;

    ctx.save();
    if (front && threaded) {
      // Below the bar only: the top of the band stays behind the blade, so an "on" ring
      // reads as threaded through it rather than pasted over it.
      ctx.beginPath();
      ctx.rect(c.x - r * 2.2, geom.barY - 1, r * 4.4, geom.swing + r * 2.2);
      ctx.clip();
    }
    ctx.lineWidth = Math.max(3, r * 0.36);
    ctx.lineCap = 'round';
    ctx.strokeStyle = front
      ? (can ? (on ? '#d8a13c' : '#b98a34') : '#4b515c')
      : 'rgba(86, 66, 28, 0.65)';
    if (front && can) {
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 9;
      ctx.shadowOffsetY = 3;
    }
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
    if (!front) { ctx.restore(); return; }

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    // Specular sweep on the lower right of the band.
    ctx.lineWidth = Math.max(1.5, r * 0.16);
    ctx.strokeStyle = can ? 'rgba(255, 238, 205, 0.6)' : 'rgba(200, 210, 225, 0.16)';
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * 0.84, Math.PI * 0.12, Math.PI * 0.72);
    ctx.stroke();

    // A live ring gets an aura, so "which ones move right now" is readable at a glance.
    if (can) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(120, 220, 255, 0.28)';
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * 1.3, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (hint && hint.ring === k) {
      // Pulse off the sim clock, not the wall clock: paused freezes it, reduced-motion
      // replaces it with a still ring, and neither can leave a "live" hint on a dead frame.
      const t = reducedMotion ? 0.34 : (simClock % HINT_PERIOD) / HINT_PERIOD;
      ctx.lineWidth = 2 + t * 4;
      ctx.strokeStyle = `rgba(120, 220, 255, ${(0.9 - t * 0.6).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * (1.42 + t * 0.55), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSword() {
    const { pitch, barY, w } = geom;
    const n = game.n;
    const left = PAD * 0.55;
    const right = Math.min(w - PAD * 0.4, slotX(n - 1) + pitch * 0.8);
    const thick = Math.max(5, Math.round(pitch * 0.17));

    ctx.save();
    // Grip, then the guard: a sword, not a ruler.
    ctx.fillStyle = '#5a3f2c';
    roundRect(ctx, left, barY - thick * 1.15, pitch * 0.72, thick * 2.3, thick);
    ctx.fill();
    ctx.fillStyle = '#3d2a1e';
    for (let i = 0; i < 3; i++) {
      roundRect(ctx, left + pitch * 0.1 + i * pitch * 0.21, barY - thick * 1.15, thick * 0.45, thick * 2.3, 2);
      ctx.fill();
    }
    ctx.fillStyle = '#8d7a4a';
    roundRect(ctx, left + pitch * 0.72, barY - thick * 2.2, thick * 1.1, thick * 4.4, 3);
    ctx.fill();

    const grad = ctx.createLinearGradient(0, barY - thick, 0, barY + thick);
    grad.addColorStop(0, '#e4ebf4');
    grad.addColorStop(0.5, '#9fabb9');
    grad.addColorStop(1, '#68727f');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(left + pitch * 0.82, barY - thick);
    ctx.lineTo(right, barY - thick * 0.6);
    ctx.lineTo(right + pitch * 0.55, barY);
    ctx.lineTo(right, barY + thick * 0.6);
    ctx.lineTo(left + pitch * 0.82, barY + thick);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(35, 40, 48, 0.45)';
    ctx.lineWidth = Math.max(1, thick * 0.18);
    ctx.beginPath();
    ctx.moveTo(left + pitch * 0.95, barY);
    ctx.lineTo(right + pitch * 0.45, barY);
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    const { w, h, pitch, r, barY, swing } = geom;
    ctx.clearRect(0, 0, w, h);
    if (!game) return;
    const n = game.n;
    live = movable(game.state, n);

    // The stand the sword lies on, and the row the freed rings hang in.
    ctx.fillStyle = cloth || '#181b21';
    roundRect(ctx, 10, 10, w - 20, h - 20, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.08)';
    ctx.lineWidth = 1;
    roundRect(ctx, 10, 10, w - 20, h - 20, 16);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.05)';
    ctx.setLineDash([4, 7]);
    ctx.beginPath();
    ctx.moveTo(pitch * 0.4, barY + swing);
    ctx.lineTo(w - pitch * 0.4, barY + swing);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let k = 0; k < n; k++) {
      ctx.fillStyle = 'rgba(226, 232, 240, 0.07)';
      ctx.beginPath();
      ctx.arc(slotX(k), barY + swing, Math.max(2, r * 0.13), 0, Math.PI * 2);
      ctx.fill();
    }

    for (let k = 0; k < n; k++) if (drop[k] < 0.5) band(k, false); // behind the bar
    drawSword();
    for (let k = 0; k < n; k++) band(k, true);
    drawSparks();
  }

  function drawSparks() {
    if (!sparks.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of sparks) {
      const a = Math.max(0, Math.min(1, p.life / p.life0));
      const s = p.size * (0.5 + a * 0.75);
      if (spark) {
        ctx.globalAlpha = a;
        ctx.drawImage(spark, p.x - s / 2, p.y - s / 2, s, s);
        continue;
      }
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = a > 0.5 ? '#ffeecd' : '#d8a13c';
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.6, s * 0.16), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // A legal 拨ring throws a few brass sparks off the ring: the toy makes that sound and that
  // flash, and clearing the whole sword (9 rings, ~341 clicks) ends in a real burst.
  function puff(k, count) {
    if (reducedMotion || !game) return;
    const c = ringCentre(k);
    spawn(c.x, c.y, count, geom.r * 2.6);
  }

  function burst() {
    if (reducedMotion || !game) return;
    for (let k = 0; k < game.n; k++) {
      const c = ringCentre(k);
      spawn(c.x, c.y, 10, geom.r * 5.2);
    }
  }

  function spawn(x, y, count, speed) {
    for (let i = 0; i < count; i++) {
      if (sparks.length >= SPARK_CAP) sparks.shift();
      const a = (i / count) * Math.PI * 2 + simClock;
      const v = speed * (0.45 + 0.55 * ((i % 3) + 1) / 3);
      sparks.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - speed * 0.35,
        life: 0.62 + 0.1 * (i % 4),
        life0: 0.62 + 0.1 * (i % 4),
        size: geom.r * 1.5,
      });
    }
  }

  // One fixed tick. Every term below is a per-tick constant on purpose: at 30, 60 or 120Hz
  // the same N ticks produce the same numbers, which is what makes the frame-rate probe a
  // measurement instead of a vibe.
  function tick() {
    if (!game) return false;
    simClock += SIM_STEP;
    simSteps++;
    let busy = false;
    for (let k = 0; k < game.n; k++) {
      const want = isOn(game.state, k) ? 0 : 1;
      const d = want - drop[k];
      if (Math.abs(d) > 0.002) {
        drop[k] += d * TRAVEL_PER_TICK;
        busy = true;
      } else if (drop[k] !== want) {
        // Snap *and* repaint, so the last frame of a travel is exactly the settled geometry
        // rather than a frame that is 0.001 off. That is what makes "the picture came back to
        // the same place" a checkable statement (tools/playtest.mjs @pointer compares pixel
        // fingerprints across an undo).
        drop[k] = want;
        busy = true;
      }
      if (shake[k] > 0.002) {
        shake[k] = Math.max(0, shake[k] - SHAKE_PER_TICK);
        busy = true;
      } else if (shake[k] !== 0) {
        shake[k] = 0;
        busy = true;
      }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.life -= SIM_STEP;
      if (p.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      p.vy += GRAVITY_PER_TICK;
      p.vx *= DRAG_PER_TICK;
      p.vy *= DRAG_PER_TICK;
      p.x += p.vx * SIM_STEP;
      p.y += p.vy * SIM_STEP;
      busy = true;
    }
    return busy;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const elapsed = Math.min(0.25, (now - (last || now)) / 1000);
    last = now;
    let busy = false;
    if (paused) {
      accum = 0; // pause must not bank time: resuming would replay the whole freeze
    } else {
      accum += elapsed;
      let steps = 0;
      while (accum >= SIM_STEP && steps < MAX_STEPS) {
        accum -= SIM_STEP;
        steps++;
        busy = tick() || busy;
        // Per tick, not per frame: anything that has to wait for the game to advance (the
        // solver demo, a probe taking a reading) must see the same tick count at the same
        // position whatever the display's refresh rate is.
        if (onSimTick) onSimTick(simClock, simSteps);
      }
      if (steps === MAX_STEPS) accum = 0;
    }
    const hintAlive = !!(hint && simClock < hint.until);
    if (busy || hintAlive || warm < 4) {
      warm++;
      draw();
    }
    if (hint && !hintAlive) {
      hint = null;
      draw();
    }
  }

  // The canvas's box is decided by CSS, and a `window` resize event is not enough to follow
  // it: a phone rotating, the panel's text reflowing or a devtools split all change the box
  // without changing the window. Since the hit test maps client pixels through the geometry
  // measured from that box, measuring late means clicking on the wrong ring — so watch the
  // box itself. (Guarded: this file is also loaded by `node --check`.)
  if (typeof ResizeObserver === 'function') {
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) { first = false; return; } // the initial callback is the layout we already measured
      measure();
    });
    ro.observe(canvas);
  }

  loadImage(TEXTURE_URL, (img) => {
    try {
      cloth = ctx.createPattern(img, 'repeat');
    } catch (err) {
      cloth = null; // an undecoded bitmap is not worth a frame
    }
    draw();
  });
  loadImage(SPARK_URL, (img) => {
    spark = img;
    draw();
  });

  return {
    attach(next) {
      game = next;
      hint = null;
      settle();
      measure();
    },
    detach() {
      game = null;
    },
    // Client-space centre of ring k as it stands right now — what an automated finger needs.
    ringPoint(k) {
      if (!game || k < 0 || k >= game.n) return null;
      const c = ringCentre(k);
      return {
        ...toClient(c.x, c.y),
        ring: k,
        on: isOn(game.state, k),
        live: movable(game.state, game.n).indexOf(k) >= 0,
      };
    },
    // Which rings the rule would accept right now, for the panel and the test hooks.
    liveRings() {
      return game ? movable(game.state, game.n).slice() : [];
    },
    // A cheap fingerprint of what is on screen: the browser suite uses it to assert that a
    // legal click changes pixels and an illegal one does not.
    pixelsHash() {
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      for (let i = 0; i + 2 < d.length; i += 4 * 617) sum = (sum * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 2147483647;
      return sum;
    },
    painted() {
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) n++;
      return n;
    },
    // What the sim believes, in its own units. The frame-rate harness (and any future probe)
    // reads this instead of guessing from wall time: two rates that disagree about
    // `dropSum` at equal `simSteps` are frame-rate dependent, full stop.
    anim() {
      let dropSum = 0;
      let shakeSum = 0;
      for (let k = 0; k < 9; k++) {
        dropSum += drop[k];
        shakeSum += shake[k];
      }
      let energy = 0;
      for (const p of sparks) energy += p.life * (Math.abs(p.vx) + Math.abs(p.vy));
      return {
        simSteps,
        simClock: Number(simClock.toFixed(6)),
        accum: Number(accum.toFixed(6)),
        dropSum: Number(dropSum.toFixed(9)),
        shakeSum: Number(shakeSum.toFixed(9)),
        sparks: sparks.length,
        energy: Number(energy.toFixed(6)),
        paused,
        reducedMotion,
        hintRing: hint ? hint.ring : -1,
      };
    },
    // Pause is the view's, not the shell's: it is the only thing holding the accumulator,
    // and freezing the picture without freezing the sim is how a resume replays a freeze.
    setPaused(on) {
      paused = !!on;
      accum = 0;
      if (paused) draw();
      return paused;
    },
    get paused() {
      return paused;
    },
    rewind,
    burst,
    reducedMotion() {
      return reducedMotion;
    },
    measure,
    redraw: draw,
    settle,
    showHint(ring) {
      hint = { ring, until: simClock + 2.6 };
      draw();
    },
    start() {
      if (!raf) {
        last = 0;
        warm = 0;
        raf = requestAnimationFrame(frame);
      }
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
