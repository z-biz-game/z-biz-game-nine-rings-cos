// Canvas renderer + pointer handling. This file owns pixels and gestures and decides
// nothing: `js/core/game.js` is the only place a click is judged legal. The view *asks* for
// a ring to be toggled, and reads the rule back from the same pure function purely for
// styling — there is exactly one implementation of the rule in the repo, never a second
// copy in here.
//
// Everything drawn is generated: a sword (grip, guard, blade, tip) and nine rings. No image
// files, no fonts, no sprites. The one thing the picture has to get right is the physics of
// the toy: a ring that is on the sword is threaded *through* the bar, a ring that has been
// 拨 off hangs *below* it — and rings must visibly travel between those two rows, which is
// what `drop[k]` animates. Getting this right is gameplay, not decoration: it is how the
// player sees which rule is in front of them.

import { movable, isOn } from './core/game.js';

const PAD = 26;
const TOP = 34; // room above the bar so the blade and its tip read as a sword
const TRAVEL_RATE = 11; // ring travel stiffness, per second

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

export function createView(canvas, { onClick, onIllegal } = {}) {
  // `willReadFrequently` because tools/playtest.mjs reads the bitmap back to prove that a
  // legal click changes the picture and an illegal one does not; without it Chrome logs a
  // warning on every readback, which would drown the console-clean check.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let game = null;
  let geom = { pitch: 44, r: 18, x0: 40, barY: 110, swing: 130, w: 320, h: 320 };
  const drop = new Float64Array(9); // 0 = threaded on the bar, 1 = hanging below it
  const shake = new Float64Array(9); // decays after an illegal click
  let live = []; // rings the rule allows right now, refreshed once per draw
  let hint = null; // { ring, until }
  let raf = 0;
  let last = 0;
  let warm = 0; // first frames always repaint, so the canvas is never blank

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

  function localPoint(ev) {
    const box = canvas.getBoundingClientRect();
    return { x: ev.clientX - box.left, y: ev.clientY - box.top };
  }

  // Canvas-local point -> client pixels: the mapping the hit test reads, run backwards so an
  // automated finger presses where a ring actually is.
  function toClient(ux, uy) {
    const box = canvas.getBoundingClientRect();
    return {
      x: Math.round(box.left + ux),
      y: Math.round(box.top + uy),
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

  function down(ev) {
    if (!game || game.done) return;
    const p = localPoint(ev);
    let hitRing = -1;
    let best = Infinity;
    for (let k = 0; k < game.n; k++) {
      const c = ringCentre(k);
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      const grab = geom.r + geom.pitch * 0.2;
      if (d <= grab && d < best) {
        best = d;
        hitRing = k;
      }
    }
    if (hitRing < 0) return; // bare board is not a ring, and costs nothing
    ev.preventDefault();
    if (hint && hint.ring === hitRing) hint = null;
    if (onClick) {
      const movedIt = onClick(hitRing);
      if (!movedIt) {
        shake[hitRing] = 1; // feedback is all an illegal click is allowed to buy
        if (onIllegal) onIllegal(hitRing);
      }
    }
    draw();
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
      const t = (performance.now() % 1100) / 1100;
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
    ctx.fillStyle = '#181b21';
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
  }

  function step(dt) {
    if (!game) return false;
    let busy = false;
    for (let k = 0; k < game.n; k++) {
      const want = isOn(game.state, k) ? 0 : 1;
      const d = want - drop[k];
      if (Math.abs(d) > 0.002) {
        drop[k] += d * Math.min(1, Math.max(0.12, dt * TRAVEL_RATE));
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
        shake[k] = Math.max(0, shake[k] - dt * 2.6);
        busy = true;
      } else if (shake[k] !== 0) {
        shake[k] = 0;
        busy = true;
      }
    }
    return busy;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.064, (now - (last || now)) / 1000);
    last = now;
    const busy = step(dt);
    const hintAlive = !!(hint && now < hint.until);
    if (busy || hintAlive || warm < 4) {
      warm++;
      draw();
    }
    if (hint && !hintAlive) {
      hint = null;
      draw();
    }
  }

  canvas.addEventListener('pointerdown', down);

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
    measure,
    redraw: draw,
    settle,
    showHint(ring) {
      hint = { ring, until: performance.now() + 2600 };
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
