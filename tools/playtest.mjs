// Minimal CDP driver for headless playtesting (Node 21+ global WebSocket/fetch).
// env: CDP_PORT (devtools port, default 9341), BASE_URL (page to attach to, default
//      http://127.0.0.1:5181/)
// usage:
//   node playtest.mjs open  <url>          # reuse-or-create our page and navigate
//   node playtest.mjs nav   <url>
//   node playtest.mjs eval  '<js expression>'   # pass `nonav` to skip the reload
//   node playtest.mjs eval  '@boot'        # | @play | @routes | @save | @reloaded | @pointer
//   node playtest.mjs tap   <k>            # one real mouse press+release on ring k
//   node playtest.mjs shot  <path.png>
//   node playtest.mjs logs
//
// Every scenario reports { rows, fail } in the same shape as tools/harness.mjs, so
// tools/verify.sh aggregates node suites and browser suites on one line.
const PORT = process.env.CDP_PORT || 9341;
// Which page to attach to. Hard-coding the dev-server port silently evaluates
// against a fresh about:blank tab when pointed at any other origin.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5181/';
const SHELL_TIMEOUT = Number(process.env.SHELL_TIMEOUT || 30000);
const ORIGIN = new URL(BASE).origin;
const isOurs = (u) => typeof u === 'string' && u.startsWith(ORIGIN);
const cmd = process.argv[2];
const arg = process.argv[3];

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        if (globalThis.__printEvents) globalThis.__printEvents(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One real mouse event at a client-space coordinate. Shared by the @pointer suite and the
// `tap` command so the two cannot drift apart in what "a press" means over the wire.
const mouseAt = (cdp, sessionId, type, x, y, buttons) => cdp.send('Input.dispatchMouseEvent', {
  type, x, y, button: 'left', buttons, clickCount: type === 'mousePressed' ? 1 : 0,
}, sessionId);

// Press and release at the point the page says ring k occupies right now.
async function tapRingAt(cdp, sessionId, runJS, k, hold = 30, rest = 80) {
  const p = await runJS(`window.rings.ringPoint(${k})`);
  if (!p) return null;
  await mouseAt(cdp, sessionId, 'mousePressed', p.x, p.y, 1);
  await sleep(hold);
  await mouseAt(cdp, sessionId, 'mouseReleased', p.x, p.y, 0);
  await sleep(rest);
  return p;
}

async function main() {
  const info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  let list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  if (cmd === 'open') {
    for (const t of list) if (t.type === 'page' && isOurs(t.url)) {
      try { await cdp.send('Target.closeTarget', { targetId: t.id || t.targetId }); } catch { /* gone already */ }
    }
    await sleep(300);
    list = [];
  }
  const existing = cmd === 'open' ? null : list.find((t) => t.type === 'page' && isOurs(t.url));
  let targetId, sessionId;
  if (existing) {
    targetId = existing.id || existing.targetId;
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  } else {
    ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  }
  const logs = [];
  globalThis.__printEvents = (m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      logs.push(`[EXCEPTION] ${e.exception?.description || e.text}\n  at ${e.url}:${e.lineNumber}`);
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error' || e.source === 'rendering') logs.push(`[log:${e.level}] ${e.text} ${e.url || ''}`);
    }
  };
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);

  const runJS = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  // Wait on the shell, not on a timer. The page is a module graph fetched over the network:
  // a fixed sleep is long enough for a localhost server and too short for GitHub Pages, where
  // it made an innocent deployment look broken (`window.rings` still undefined, canvas still
  // the unstyled 300x150 default). The floor keeps the local case as fast as it was.
  const waitShell = async (floorMs, budgetMs = SHELL_TIMEOUT) => {
    await sleep(floorMs);
    const deadline = Date.now() + budgetMs;
    for (;;) {
      let ready = false;
      try {
        ready = await runJS('!!(window.rings && window.rings.state && window.rings.state.id)');
      } catch { ready = false; }
      if (ready) return true;
      if (Date.now() > deadline) return false;
      await sleep(150);
    }
  };

  if (cmd === 'open') {
    await cdp.send('Page.navigate', { url: arg || BASE }, sessionId);
    await waitShell(600);
    console.log('opened ' + (arg || BASE) + '\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'nav') {
    await cdp.send('Page.navigate', { url: arg }, sessionId);
    await waitShell(400);
    console.log('navigated\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'tap') {
    // One ring, pressed and released for real, against the page that is already open (no
    // navigation, so the game keeps running between commands). This is the same primitive
    // @pointer uses; having it on the command line means the win screenshot a human reviews
    // can be produced by a finger rather than by an injected call.
    const k = Number(arg);
    if (!Number.isInteger(k) || k < 0) {
      console.log('tap wants a ring index, got: ' + arg);
      process.exit(1);
    }
    const p = await tapRingAt(cdp, sessionId, runJS, k);
    if (!p) {
      console.log('EVAL THROW: no ring ' + k + ' on screen');
      process.exit(1);
    }
    const now = await runJS('window.rings.state.moves + "/" + window.rings.state.par + " done=" + window.rings.state.done');
    console.log(`tapped ring ${k + 1} at ${p.x},${p.y} -> ${now}`);
  } else if (cmd === 'eval') {
    if (process.argv[4] !== 'nonav') {
      await cdp.send('Page.navigate', { url: BASE }, sessionId);
      await waitShell(300);
    }
    if (arg && arg.startsWith('@')) {
      const name = arg.slice(1);
      let value = null;
      if (name === 'pointer') {
        value = await pointerScenario(cdp, sessionId, runJS);
      } else if (SCENARIOS[name]) {
        // Clear the row buffer *before* running. With `nonav` every scenario is evaluated in
        // the same page, so if this suite throws at parse time the fallback below would
        // otherwise hand back the previous suite's rows and verify.sh would print them as if
        // they belonged to this one — a broken suite that looks green.
        await runJS('window.__lastRows = null; 1');
        try {
          value = await runJS(SCENARIOS[name]);
        } catch (err) {
          const dumped = await runJS('JSON.stringify(window.__lastRows||[])').catch(() => '[]');
          value = { rows: JSON.parse(dumped) };
          value.rows.push({ test: `@${name} threw`, pass: false, detail: String(err.message).slice(0, 300) });
        }
      } else {
        console.log('unknown scenario ' + name + ' — have ' + Object.keys(SCENARIOS).join(', ') + ', pointer');
        process.exit(1);
      }
      value.fail = (value.rows || []).filter((r) => !r.pass).map((r) => r.test);
      console.log(JSON.stringify(value, null, 2));
    } else {
      try {
        console.log(JSON.stringify(await runJS(arg), null, 2));
      } catch (err) {
        console.log('EVAL THROW: ' + err.message);
      }
    }
    if (logs.length) console.log('--- console ---\n' + logs.join('\n'));
  } else if (cmd === 'shot') {
    await runJS('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    (await import('node:fs')).writeFileSync(arg, Buffer.from(data, 'base64'));
    console.log('wrote ' + arg + ' (' + Math.round(data.length / 1024) + 'kB b64)');
  } else if (cmd === 'logs') {
    await sleep(800);
    console.log(logs.join('\n') || '(none)');
  }
  ws.close();
  process.exit(0);
}

// The one suite a page-side script cannot run: real input. Everything below goes through
// Chrome's own mouse and keyboard over CDP, so what gets asserted is the pointer-to-ring
// wiring in js/view.js rather than the rule behind it. Rings are tapped, not dragged: a
// 九连环 click is "拨这一环", and js/core/game.js decides whether that tap counts.
async function pointerScenario(cdp, sessionId, runJS) {
  const rows = [];
  const rec = (name, pass, detail) => rows.push({
    test: name, pass: !!pass,
    detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)),
  });
  const mouse = (type, x, y, buttons) => mouseAt(cdp, sessionId, type, x, y, buttons);
  const key = (k) => cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', text: k, key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0),
  }, sessionId);

  // A real press-and-release where the hook says ring k currently is. `ringPoint` reports the
  // animated position, so this stays accurate while a ring is travelling between the two rows.
  const tapRing = (k) => tapRingAt(cdp, sessionId, runJS, k, 24, 60);

  const ids = await runJS(`['sword','modes','totals','crumbs','readout','hintline','curtain','stars','verdict','tally','again','next','undo','hint','demo','restart','share','shelf','wipe','toast']
    .map((i) => [i, !!document.getElementById(i)])`);
  rec('every control the shell reaches for exists', ids.every(([, on]) => on), Object.fromEntries(ids));

  await runJS(`window.rings.load('#/lot/novice-02'); 'ok'`);
  await sleep(400);
  const start = await runJS(`(() => {
    const g = window.rings;
    return { state: g.state, level: g.level(), path: g.path(), bits: g.bits(), live: g.liveRings(), px: g.pixels(), lit: g.painted() };
  })()`);
  const par = start.state.par;
  rec('a level loads with a certified par and a route to match', start.state.id === 'novice-02' && par === 9 && start.path.length === par,
    { id: start.state.id, par, path: start.path.length });
  rec('the canvas is painted with something on it', start.lit > 50 && start.px > 0, { lit: start.lit, px: start.px });

  // An illegal tap: a ring the rule refuses. It must not be billed, must not move, must not
  // change the position — and after its shake decays the picture must be the same picture.
  const dead = await runJS(`(() => {
    const g = window.rings;
    const live = g.liveRings();
    for (let k = 0; k < 9; k++) if (!live.includes(k)) return { k, hint: document.getElementById('hintline').textContent };
    return null;
  })()`);
  if (!dead) {
    rec('an illegal tap is refused', false, 'no stuck ring on this position');
  } else {
    const said = await tapRing(dead.k);
    const after = await runJS(`(() => { const g = window.rings; return {
      moves: g.state.moves, left: g.state.left, bits: g.bits(), said: document.getElementById('hintline').textContent, live: g.liveRings(),
    }; })()`);
    rec('an illegal tap is refused: no step, no distance change', !!said && after.moves === 0 && after.left === par,
      { ring: dead.k, moves: after.moves, left: after.left });
    rec('and the shell says which ring is stuck', /拨不动/.test(after.said), after.said);
    rec('the stuck ring is still stuck, the legal ones still legal', JSON.stringify(after.live) === JSON.stringify(start.live) && !after.live.includes(dead.k),
      { before: start.live, after: after.live });
    await sleep(700); // the refusal's shake decays; nothing else was allowed to change
    const back = await runJS(`(() => { const g = window.rings; g.reset(); return { px: g.pixels(), moves: g.state.moves, bits: g.bits() }; })()`);
    rec('an illegal tap leaves nothing behind', back.px === start.px && back.bits.join('') === start.bits.join(''), { before: start.px, after: back.px });
  }

  // A legal tap: billed, and visible.
  const first = start.path[0];
  const tap1 = await tapRing(first);
  const after1 = await runJS(`(() => { const g = window.rings; return {
    moves: g.state.moves, bits: g.bits(), left: g.state.left, px: g.pixels(),
    said: document.getElementById('hintline').textContent, point: g.ringPoint(${first}),
  }; })()`);
  rec('a legal tap on ring ' + (first + 1) + ' is billed as one move', after1.moves === 1 && after1.left === par - 1, { moves: after1.moves, left: after1.left });
  rec('and it moved exactly that ring', after1.bits.join('') === start.bits.map((b, k) => (k === first ? 1 - b : b)).join(''),
    { ring: first, before: start.bits.join(''), after: after1.bits.join('') });
  // The shell's sentence and the renderer's own "is this ring on the sword" are both read
  // through js/core's isOn, so they cannot disagree with the position they describe. main.js
  // used to hand-roll (state >> k) & 1 for this line and view.js used to compare bitAt() === 1
  // for its two rows; test/game.test.mjs forbids that in source, this forbids it on screen.
  rec('the panel and the picture report the ring the position says', (() => {
    const onNow = after1.bits[first] === 1;
    return /上了剑/.test(after1.said) === onNow && /离了剑/.test(after1.said) === !onNow
      && !!after1.point && after1.point.on === onNow && after1.point.ring === first;
  })(), { ring: first + 1, bits: after1.bits.join(''), said: after1.said, pointOn: after1.point && after1.point.on });
  await sleep(700);
  rec('a legal tap changes the picture', (await runJS('window.rings.pixels()')) !== start.px, { before: start.px });

  // 撤销 returns both the count and the pixels.
  await runJS(`document.getElementById('undo').click(); 'ok'`);
  await sleep(800);
  const undone = await runJS(`(() => { const g = window.rings; return { moves: g.state.moves, bits: g.bits(), px: g.pixels(), state: g.stateOf() }; })()`);
  rec('undo takes the step back and the picture back with it',
    undone.moves === 0 && undone.px === start.px && undone.state === start.level.state, undone);

  // A tap on bare board is not a tap on a ring: no move, and no refusal message either.
  const miss = await runJS(`(() => {
    const g = window.rings;
    const box = document.getElementById('sword').getBoundingClientRect();
    const probe = g.ringPoint(0);
    const grab = probe ? probe.r + probe.pitch * 0.2 : 24;
    const cands = [[box.left + 3, box.top + 3], [box.right - 3, box.top + 3], [box.left + 3, box.bottom - 3], [box.right - 3, box.bottom - 3], [box.left + box.width / 2, box.top + 3]];
    for (const [x, y] of cands) {
      // A point outside the viewport would dispatch a mouse event that never reaches the
      // page, which would make "nothing happened" true for the wrong reason.
      if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1) continue;
      let far = true;
      for (let k = 0; k < 9; k++) { const p = g.ringPoint(k); if (p && Math.hypot(x - p.x, y - p.y) <= grab) far = false; }
      if (far) return { x: Math.round(x), y: Math.round(y), grab };
    }
    return null;
  })()`);
  if (!miss) {
    rec('a tap on bare board is ignored', false, 'every corner of the canvas is within reach of a ring');
  } else {
    const saidBefore = await runJS(`document.getElementById('hintline').textContent`);
    await mouse('mousePressed', miss.x, miss.y, 1);
    await sleep(24);
    await mouse('mouseReleased', miss.x, miss.y, 0);
    await sleep(120);
    const afterMiss = await runJS(`(() => { const g = window.rings; return { moves: g.state.moves, said: document.getElementById('hintline').textContent }; })()`);
    rec('a tap on bare board is ignored: no move and no refusal', afterMiss.moves === 0 && afterMiss.said === saidBefore, { miss, after: afterMiss });
  }

  // The whole certified route, tapped for real. par = 9 for this level, which is the
  // "playable by hand" end of the pool: the bands above it run to 511 taps.
  await runJS(`document.getElementById('restart').click(); 'ok'`);
  await sleep(400);
  let played = 0;
  const log = [];
  for (const k of start.path) {
    const p = await tapRing(k);
    if (!p) { rec(`ring ${k + 1} is on screen`, false, p); break; }
    const now = await runJS(`(() => { const g = window.rings; return { moves: g.state.moves, left: g.state.left, done: g.state.done }; })()`);
    played++;
    log.push({ ring: k + 1, ...now });
    if (now.moves !== played) { rec(`tap ${played} counted as one move`, false, log); break; }
  }
  rec('the mouse taps the whole certified route, one move per tap', played === par && played === 9, log);
  await sleep(700);
  const end = await runJS(`(() => {
    const g = window.rings;
    return {
      state: g.state,
      stars: document.getElementById('stars').textContent,
      verdict: document.getElementById('verdict').textContent,
      tally: document.getElementById('tally').textContent,
      curtain: !document.getElementById('curtain').hidden,
      record: g.store.record(g.state.id),
    };
  })()`);
  rec('the sword is empty and the level is won', end.state.done && end.state.moves === par && end.state.left === 0, end.state);
  rec('the win card goes up with three stars', end.curtain && end.stars === '★★★' && end.verdict === '完美解环', { stars: end.stars, verdict: end.verdict, curtain: end.curtain });
  rec('the card prints the player count against the measured minimum', end.tally.indexOf('你的 ' + par + ' 步') >= 0 && end.tally.indexOf('穷尽最少 ' + par + ' 步') >= 0, end.tally);
  rec('the run is on record at par', end.record && end.record.best === par && end.record.perfect === true, end.record);

  // Keyboard shortcuts the panel advertises: u/h/r, and the demo that walks the same table.
  await runJS(`document.getElementById('again').click(); 'ok'`);
  await sleep(300);
  rec('再来一次 clears the card as well as the count', await runJS(`window.rings.state.moves === 0 && document.getElementById('curtain').hidden`), await runJS('window.rings.state'));
  await runJS(`window.rings.play(window.rings.path().slice(0, 1)); 'ok'`);
  await key('u');
  await sleep(200);
  rec('the u key undoes', (await runJS('window.rings.state.moves')) === 0, await runJS('window.rings.state.moves'));
  await key('h');
  await sleep(200);
  rec('the h key asks for a hint', (await runJS('window.rings.state.hints')) === 1, await runJS('window.rings.state.hints'));
  await key('r');
  await sleep(200);
  rec('the r key restarts', (await runJS('window.rings.state.moves')) === 0, await runJS('window.rings.state'));
  await key('d');
  await sleep(500);
  const demoing = await runJS(`(() => { const g = window.rings; return { on: g.state.demo, moves: g.state.moves, left: g.state.left }; })()`);
  rec('the d key runs the solver on screen', demoing.on && demoing.moves >= 2 && demoing.left === par - demoing.moves, demoing);
  await key('d');
  await sleep(200);
  rec('and stops it again', (await runJS('window.rings.state.demo')) === false, await runJS('window.rings.state.demo'));

  return { rows };
}

// In-page suites. Each returns { rows: [{ test, pass, detail }] }.
const SCENARIOS = {
  boot: `(async () => {
    const g = window.rings;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    rec('the shell boots straight into a game', g && g.version === 1 && g.state && g.state.mode === 'campaign', g && g.state);
    rec('the game is nine rings wide', g.state.n === 9 && g.bits().length === 9, { n: g.state.n });
    const c = document.getElementById('sword');
    rec('the canvas has real pixels', c.width > 0 && c.height > 0 && !!c.getContext('2d'), { w: c.width, h: c.height });
    // A canvas whose CSS was never applied is still the 300x150 box the HTML spec hands out,
    // and the game would then draw nine rings into a strip nobody designed. The screenshot
    // catches that by eye; this line is the same check inside the gate, so a stale stylesheet
    // or a collapsed grid cannot pass 90-odd assertions on a page that renders as a footnote.
    const box = c.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    rec('the canvas is laid out, not the unstyled 300x150 default',
      box.width > 300 && box.height > 300
        && Math.abs(c.width - box.width * dpr) <= dpr + 1 && Math.abs(c.height - box.height * dpr) <= dpr + 1,
      { css: [Math.round(box.width), Math.round(box.height)], backing: [c.width, c.height], dpr });
    rec('the sword was actually painted', g.painted() > 50, { litSamples: g.painted() });
    const pool = g.pool;
    rec('the shipped pool loaded', pool && pool.levels >= 32, pool && pool.levels);
    rec('every band reports a measured range', Object.values(pool.byTier).every((t) => t.n > 0 && t.min <= t.max && t.ringsMin >= 1), pool.byTier);
    rec("the browser's own search agrees with the printed par", g.path().length === g.state.par, { path: g.path().length, par: g.state.par });
    const readout = document.getElementById('readout').textContent;
    rec('the panel prints steps, the measured minimum and the record', /步数/.test(readout) && /最少/.test(readout) && /最佳/.test(readout), readout);

    // The repo's claim, measured on this device rather than quoted from a laptop.
    const gr = g.graph();
    rec('the whole state space is 512 positions and all of them are reached', gr.nodes === 512 && gr.reached === 512 && gr.complete === true, gr);
    rec('that search ran at boot in well under a frame', gr.buildMs < 20, { buildMs: gr.buildMs });
    rec('the graph is a path, so one position owns each distance', gr.isPath === true && gr.degree === '1-2' && gr.distinctDists === 512, gr);
    rec('the deepest distance is 511, at the lone ninth ring', gr.maxDist === 511 && gr.atState === 256, { maxDist: gr.maxDist, atState: gr.atState });
    rec('all nine on the sword costs the classical 341', gr.allOn === 341 && gr.closedForm === 341, { allOn: gr.allOn, closedForm: gr.closedForm });

    // Independent anchor, recomputed in the page: the closed form for n = 1..12.
    const want = (n) => (2 ** (n + 1) - (n % 2 ? 1 : 2)) / 3;
    const pairs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => g.formula(n));
    rec('n = 1..12: the exhaustive search equals (2^(n+1) − 1 or 2)/3',
      pairs.every((p) => p.search === p.formula && p.formula === want(p.n)), pairs.map((p) => p.n + ':' + p.search));
    rec('the published table reads 1,2,5,10,21,42,85,170,341',
      pairs.slice(0, 9).map((p) => p.search).join(',') === '1,2,5,10,21,42,85,170,341', pairs.slice(0, 9).map((p) => p.search));
    rec('and the page refuses an out-of-range ring count', (() => { try { g.formula(0); return false; } catch { return true; } })(), 'formula(0) throws instead of answering 0');
    return { rows };
  })()`,

  play: `(async () => {
    const g = window.rings;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const D = (id) => document.getElementById(id);

    g.store.reset();
    // Level two, not level one: a one-click level cannot demonstrate a wasted move, and every
    // number below is arithmetic against a par of nine.
    g.load('#/c/2'); await sleep(180);
    const par = g.state.par;
    const path = g.path();
    const startState = g.level().state;
    rec('the route the page finds is exactly par', path.length === par && par === 9, { path: path.length, par });
    rec('every step of that route is a legal click', path.every((k) => k >= 0 && k < 9), path);

    // A wasted round trip. Ring 1 is always legal, so toggling it twice is legal, costs two
    // moves and lands exactly where it started — the cheapest way to be over par.
    g.play([path[0]]);
    const out = { moves: g.state.moves, left: g.state.left, at: g.stateOf() };
    g.play([path[0]]);
    const back = { moves: g.state.moves, at: g.stateOf(), over: g.state.over };
    rec('a round trip on ring 1 costs two moves and returns the position',
      out.moves === 1 && back.moves === 2 && back.at === startState, { out, back });
    rec('and it puts the player exactly two over par', back.over === 2 && g.state.left === par, back);

    g.play(g.route());
    rec('over par still wins, two stars instead of three',
      g.state.done && g.state.moves === par + 2 && D('stars').textContent === '★★☆' && D('verdict').textContent === '顺手解环',
      { moves: g.state.moves, par, stars: D('stars').textContent, verdict: D('verdict').textContent });
    rec('the win card offers the next level', !D('curtain').hidden && !D('next').hidden, { nextHidden: D('next').hidden });
    const sloppy = g.store.record(g.state.id);
    rec('a run over par is a solve without the perfect flag', sloppy.best === par + 2 && sloppy.perfect === false, sloppy);

    D('next').click(); await sleep(180);
    rec('下一关 advances the campaign', g.state.index === 3 && g.state.moves === 0, g.state);

    g.load('#/c/2'); await sleep(180);
    g.play(path);
    const clean = g.store.record(g.state.id);
    rec('matching par later takes the record down and earns the flag', clean.best === par && clean.perfect === true && clean.plays === 2, clean);

    // The rule is in front of the picture, not behind it: a refused click changes nothing.
    D('restart').click(); await sleep(180);
    const live = g.liveRings();
    const stuck = [1, 2, 3, 4, 5, 6, 7, 8].filter((k) => !live.includes(k));
    const before = { moves: g.state.moves, at: g.stateOf() };
    const refused = stuck.map((k) => g.clickRing(k));
    rec('the shell reports every illegal click as refused', refused.every((r) => r === false) && stuck.length > 0, { stuck, refused });
    rec('and refuses it without billing anything', g.state.moves === before.moves && g.stateOf() === before.at, g.state);
    const accepted = g.clickRing(live[0]);
    rec('the legal click on the same position is accepted', accepted === true && g.state.moves === before.moves + 1, { live: live[0], moves: g.state.moves });

    const billed = g.store.stats.hints;
    const flawless = g.store.stats.perfect;
    const h = g.hintOnce();
    rec('the hint names a ring and a count of clicks left', h.hints === 1 && /提示/.test(h.line) && /第 \\d+ 环/.test(h.line), h);
    g.play(g.route()); await sleep(180);
    rec('a hinted run bills the hint but not the perfect tally',
      g.store.stats.hints === billed + 1 && g.store.stats.perfect === flawless && g.store.record(g.state.id).perfect === true,
      { hints: g.store.stats.hints, perfect: g.store.stats.perfect, record: g.store.record(g.state.id) });
    D('restart').click(); await sleep(180);
    rec('重开 clears the count, the card and the hints', g.state.moves === 0 && g.state.hints === 0 && D('curtain').hidden, g.state);

    // The demo is the solver made visible, so it can never be cheaper than par. Level two is
    // used here because a nine-click level leaves something to see; level one would finish
    // before the first frame.
    g.load('#/c/2'); await sleep(180);
    const par2 = g.state.par;
    const on = g.demoStart();
    await sleep(700);
    const moved = g.state.moves;
    g.demoStop();
    rec('the demo taps real moves off the same table', on && moved >= 2 && par2 === 9 && g.state.left === par2 - moved, { moved, left: g.state.left, par2 });
    g.reset();
    rec('and stopping it mid-route leaves a plain game, not a finished one',
      g.state.moves === 0 && g.state.left === par2 && document.getElementById('curtain').hidden === true, g.state);
    return { rows };
  })()`,

  routes: `(async () => {
    const g = window.rings;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    g.load('#/c/7'); await sleep(160);
    rec('#/c/7 is level seven', g.state.index === 7 && g.state.mode === 'campaign', g.state);
    g.load('#/c/99999'); await sleep(160);
    rec('a huge index clamps to the last level', g.state.index === g.pool.levels, { index: g.state.index, levels: g.pool.levels });
    g.load('#/c/0'); await sleep(160);
    rec('index zero clamps up to one', g.state.index === 1, g.state.index);
    g.load('#/c/64'); await sleep(160);
    rec('the last campaign level is the deepest position in the game', g.state.par === 511 && g.state.tier === 'master', g.state);

    g.load('#/daily'); await sleep(160);
    const daily = g.state.id;
    const dailyPar = g.state.par;
    g.load('#/c/1'); await sleep(160);
    g.load('#/daily'); await sleep(160);
    rec('the daily route is the same puzzle twice', g.state.mode === 'daily' && g.state.id === daily, { first: daily, again: g.state.id });
    rec('the daily label carries the date', /^每日九连环 · \\d{4}-\\d{2}-\\d{2}$/.test(g.state.label), g.state.label);
    rec('and its par is a measured distance, not a guess', g.state.par === dailyPar && g.path().length === dailyPar, { par: dailyPar });

    for (const band of g.bands) {
      g.load('#/random/' + band.key + '/fixedseed'); await sleep(150);
      const first = { id: g.state.id, par: g.state.par, tier: g.state.tier };
      g.load('#/c/1'); await sleep(150);
      g.load('#/random/' + band.key + '/fixedseed'); await sleep(150);
      rec('#/random/' + band.key + ' stays in its band and repeats itself',
        first.tier === band.key && g.state.id === first.id && g.state.par >= band.min && g.state.par <= band.max,
        { band: [band.min, band.max], got: first, again: { id: g.state.id, par: g.state.par } });
    }
    g.load('#/random/twined/fixedseed'); await sleep(150);
    const twined = g.state.par;
    g.load('#/random/novice/fixedseed'); await sleep(150);
    rec('the same token in two bands gives two different difficulties', g.state.par < twined, { novice: g.state.par, twined });
    g.load('#/random'); await sleep(320);
    rec('a bare #/random mints a token into the URL', /^#\\/random\\/[a-z]+\\/[a-z0-9]+$/.test(location.hash), location.hash);

    g.load('#/c/5'); await sleep(160);
    const sample = g.state.id;
    g.load('#/c/1'); await sleep(160);
    g.load('#/lot/' + sample); await sleep(160);
    rec('#/lot/<id> opens that level', g.state.id === sample && g.state.mode === 'lot', { want: sample, got: g.state.id });
    g.load('#/lot/twined-11'); await sleep(160);
    rec('the classical all-on sword is a shareable level at 341', g.state.id === 'twined-11' && g.state.par === 341 && g.bits().every((b) => b === 1), g.state);
    g.load('#/lot/not-a-real-level'); await sleep(160);
    rec('an unknown level id falls back instead of blanking the board', !!g.state.id && g.state.mode === 'lot' && g.state.par >= 1, g.state);
    g.load('#/nonsense'); await sleep(160);
    rec('an unparseable route still deals a level', g.state.mode === 'campaign' && g.state.index === 1, g.state);
    return { rows };
  })()`,

  save: `(async () => {
    const g = window.rings;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const D = (id) => document.getElementById(id);
    const KEY = 'rings.save.v1';

    // Wipe first, through the real double-armed control, so what follows starts clean.
    g.load('#/c/1'); await sleep(160);
    g.play(g.path()); await sleep(160);
    const had = Object.keys(g.store.records).length;
    rec('a solve is on record before the wipe is tried', had >= 1 && g.store.record('novice-01').best === 1, { had });
    D('wipe').click(); await sleep(90);
    rec('the first click only arms it', Object.keys(g.store.records).length === had && !D('toast').hidden && /清空/.test(D('toast').textContent),
      { records: Object.keys(g.store.records).length, toast: D('toast').textContent });
    D('wipe').click(); await sleep(260);
    rec('清空存档 takes two clicks and clears everything',
      Object.keys(g.store.records).length === 0 && g.store.unlocked === 1 && localStorage.getItem(KEY) === null,
      { records: Object.keys(g.store.records), unlocked: g.store.unlocked, key: localStorage.getItem(KEY) });
    // NOTE: innerHTML, not textContent. This assertion is about the tally being rendered
    // inside its emphasis element, and textContent has no markup in it by definition, so the
    // pattern with a b tag in it could never be found there whatever the screen showed.
    rec('and the shell re-renders as a clean device', /已通 <b>0<\\/b>/.test(D('totals').innerHTML), D('totals').innerHTML);

    g.load('#/c/1'); await sleep(160);
    const par = g.state.par;
    g.play(g.path());
    await sleep(180);
    const id = g.state.id;
    const raw = JSON.parse(localStorage.getItem(KEY));
    rec('the solve reaches localStorage, not only memory', !!(raw && raw.records[id] && raw.records[id].best === par), raw && Object.keys(raw.records || {}));
    rec('clearing the first level unlocks the second', g.store.unlocked === 2 && raw.unlocked === 2, { unlocked: g.store.unlocked });
    rec('the record is flagged perfect at the measured minimum', raw.records[id].perfect === true && raw.records[id].plays === 1, raw.records[id]);
    const shelf2 = document.querySelector("#shelf button[data-index='2']");
    rec('the shelf lets level two be clicked', shelf2 && !shelf2.disabled, shelf2 && shelf2.outerHTML);
    const shelf3 = document.querySelector("#shelf button[data-index='3']");
    rec('and keeps level three locked', shelf3 && shelf3.disabled, shelf3 && shelf3.outerHTML);
    g.load('#/c/1'); await sleep(160);
    // NOTE ON ESCAPING (this body is a template literal, so it is *source text* that the
    // page compiles): a regex slash must be written doubled here. A single backslash-slash is
    // eaten by the template, the page receives an unterminated regex literal, and the whole
    // suite dies at parse time with "SyntaxError: Invalid regular expression flags".
    rec('the panel prints the record it just read back', /<div class="best"><dt>最佳<\\/dt><dd>1<\\/dd>/.test(D('readout').innerHTML), D('readout').innerHTML.slice(0, 500));

    g.load('#/daily'); await sleep(180);
    const day = g.state.label.split(' · ')[1];
    g.play(g.path());
    await sleep(180);
    const mark = g.store.dailyDone(day);
    rec('today is logged once solved', !!mark && mark.id === g.state.id, { day, mark });
    rec('the shelf says today is done', /已通过/.test(D('shelf').textContent), D('shelf').textContent);
    const totals = D('totals').innerHTML;
    rec('the header tally counts both solves', /已通 <b>\\d<\\/b>/.test(totals) && /提示/.test(totals), totals);
    return { rows };
  })()`,

  // Run after @save in its own process, so `eval` (without nonav) has really reloaded the
  // page: this is the only suite that can tell a warm module cache from a save on disk.
  reloaded: `(async () => {
    const g = window.rings;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const D = (id) => document.getElementById(id);

    rec('a fresh page reads its progress off disk', g.store.unlocked === 2, { unlocked: g.store.unlocked, records: Object.keys(g.store.records) });
    const r1 = g.store.record('novice-01');
    rec('and the first level\\'s record came back', !!r1 && r1.solved === true && r1.best === 1 && r1.perfect === true, r1);
    g.load('#/c/1'); await sleep(200);
    rec('the shelf shows it as already done', /perfect|done/.test((document.querySelector("#shelf button[data-index='1']") || {}).className || ''),
      (document.querySelector("#shelf button[data-index='1']") || {}).className);
    rec('the header counts the recovered solve', /已通 <b>1<\\/b>/.test(D('totals').innerHTML), D('totals').innerHTML);
    g.load('#/daily'); await sleep(200);
    rec('the daily slot is remembered across the reload', g.store.dailyDone(g.state.label.split(' · ')[1]) !== null, g.state);
    g.store.reset();
    rec('and a reset leaves nothing on disk for the next visitor', localStorage.getItem('rings.save.v1') === null, localStorage.getItem('rings.save.v1'));
    return { rows };
  })()`,
};

main().catch((err) => {
  console.error('playtest failed: ' + ((err && err.stack) || err));
  process.exit(1);
});
