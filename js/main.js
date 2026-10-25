// The shell: hash routes in, canvas out, records in between. Nothing here knows the rules
// of the sword — those live in js/core — and nothing here draws — that is js/view.js.

import { createGame, click, undo, reset, hint, grade, remaining, overPar, nextRing, tableRoute, bitsOf, isOn, RINGS, SOLVED } from './core/game.js';
import { createSession } from './core/session.js';
import { table, buildTable, summary } from './core/solve.js';
import { store } from './core/storage.js';
import {
  TIERS, ALL, byId, levelAt, levelsIn, randomLevel, dailyLevel, tierByKey, stats as poolStats, closedForm,
} from './core/library.js';
import { todayKey } from './core/rng.js';
import { createView } from './view.js';
// 听觉与触觉这两路反馈：视觉与数值之外，桌面上还该有"听得见"的一路。
// 音频模块自己管手势解锁与真静音（suspend），这里只管把音接到真实事件上。
import { audio } from './audio.js';
import { haptics } from './haptics.js';

const $ = (id) => document.getElementById(id);
const el = {
  modes: $('modes'), totals: $('totals'), crumbs: $('crumbs'), readout: $('readout'),
  shelf: $('shelf'), hintline: $('hintline'), curtain: $('curtain'), stars: $('stars'),
  verdict: $('verdict'), tally: $('tally'), undo: $('undo'), hint: $('hint'), demo: $('demo'),
  restart: $('restart'), share: $('share'), next: $('next'), again: $('again'),
  toast: $('toast'), canvas: $('sword'), wipe: $('wipe'),
  pause: $('pause'), resume: $('resume'), veil: $('pause-veil'),
};

const LEVELS = ALL.length;
const bfs = table(RINGS);
const app = {
  mode: 'campaign',
  index: 1,
  route: null,
  level: null,
  game: null,
  hints: 0,
  label: '',
  day: null,
};

// The stopwatch and the pause, in one place. The clock is the only thing that
// knows how long the player has been at this board; the pause is the only
// thing that knows whether the board is live. Both live in js/core/session.js
// so `node --test` can drive them without a browser.
const session = createSession();

// The exhaustive sweep, timed once. This is the repo's whole claim in three numbers: 512
// nodes, all of them reached, and it cost well under a frame — which is why the browser is
// allowed to hold the entire solution table in memory (see DESIGN.md §1.1).
let graphProbe = null;
function probeGraph() {
  if (graphProbe) return graphProbe;
  const t0 = performance.now();
  const fresh = buildTable(RINGS, SOLVED);
  const ms = performance.now() - t0;
  graphProbe = { ...summary(fresh), buildMs: Number(ms.toFixed(3)) };
  return graphProbe;
}
probeGraph();

function clampIndex(n) {
  return Math.min(LEVELS, Math.max(1, Number(n) || 1));
}

// #/c/12 · #/daily · #/random/twined/4kq2 · #/lot/novice-03
// A campaign id in the URL resolves to the same nine bits on another device without the
// receiver needing the sender's save file.
function parseHash(hash = location.hash) {
  const p = String(hash).replace(/^#\/?/, '').split('/').filter(Boolean);
  if (p[0] === 'daily') return { mode: 'daily' };
  if (p[0] === 'random') return { mode: 'random', tier: p[1] || TIERS[0].key, key: p[2] || null };
  if (p[0] === 'lot') return { mode: 'lot', id: p[1] };
  const n = p[0] === 'c' || p[0] === 'campaign' ? Number(p[1]) : Number(p[0]);
  return { mode: 'campaign', index: clampIndex(n) };
}

function linkFor(rt) {
  if (rt.mode === 'daily') return '#/daily';
  if (rt.mode === 'random') return `#/random/${rt.tier}/${rt.key}`;
  if (rt.mode === 'lot') return `#/lot/${rt.id}`;
  return `#/c/${rt.index}`;
}

function resolve(rt) {
  if (rt.mode === 'daily') {
    const day = todayKey();
    return { level: dailyLevel(day), label: `每日九连环 · ${day}`, note: day, day };
  }
  if (rt.mode === 'random') {
    const tier = tierByKey(rt.tier);
    return { level: randomLevel(rt.key, tier.key), label: `随机 · ${tier.label}`, note: tier.blurb };
  }
  if (rt.mode === 'lot') {
    const level = byId(rt.id) || ALL[0];
    return { level, label: `关卡 ${level.id}`, note: tierByKey(level.tier).blurb };
  }
  const level = levelAt(rt.index - 1);
  return { level, label: `第 ${rt.index} 关`, note: `共 ${LEVELS} 关 · ${tierByKey(level.tier).label}` };
}

const view = createView(el.canvas, {
  onClick: (k) => commit(k),
  onIllegal: (k) => say(`第 <b>${k + 1}</b> 环现在拨不动 —— 先把它下面那一环拨上、其余环拨下`),
  session,
});

function setGame(level, label) {
  stopDemo('');
  app.level = level;
  app.label = label || app.label;
  app.game = createGame(level);
  app.hints = 0;
  session.reset(); // a new board is a new attempt: the clock starts at zero, the pause is lifted
  applyPauseUi(); // and the veil goes with it
  view.attach(app.game);
  el.curtain.hidden = true;
  say('');
}

function say(html) {
  el.hintline.innerHTML = html;
}

function starText(n) {
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

function renderCrumbs() {
  const tier = tierByKey(app.level.tier);
  const rec = store.record(app.level.id);
  const left = remaining(app.game);
  el.crumbs.innerHTML = `${app.label}<b>${tier.label}<span class="band"> ${tier.blurb}</span></b>`;
  el.readout.innerHTML = [
    field('步数', app.game.moves, '已拨的环'),
    field('最少', app.level.par, '穷尽 512 态', 'par'),
    field('距最优', left, '还需拨环', 'over'),
    field('超出', overPar(app.game), '步 vs 最少'),
    field('最佳', rec && rec.best ? rec.best : '—', rec && rec.perfect ? '等于最少' : '你的纪录', 'best'),
    field('剑上', bitsOf(app.game.state, app.game.n).reduce((a, b) => a + b, 0), `共 ${app.game.n} 环`),
    field('用时', clockText(), '本局用时', 'clock', 'elapsed'),
  ].join('');
  // 暂停时这几个按钮一并收起来：撤销改局面、提示改局面、演示自己往前跑——
  // 都是"盘面在动"的动作，暂停期间一个都不该发生。
  el.undo.disabled = !app.game.moves || app.game.done || session.paused;
  el.hint.disabled = app.game.done || session.paused;
  el.demo.disabled = app.game.done || session.paused;
  el.pause.disabled = app.game.done; // 通关之后没有可暂停的东西了
}

// The clock reads M:SS. It is the same number the win card prints, and the
// same number the pause freezes.
function clockText() {
  const s = Math.floor(session.elapsedMs() / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function field(label, value, note, cls = '', id = '') {
  return `<div class="${cls}"><dt>${label}</dt><dd${id ? ` id="${id}"` : ''}>${value}</dd><dt><small>${note}</small></dt></div>`;
}

function renderTotals() {
  const solvedN = ALL.filter((l) => {
    const r = store.record(l.id);
    return r && r.solved;
  }).length;
  const perfectN = ALL.filter((l) => {
    const r = store.record(l.id);
    return r && r.perfect;
  }).length;
  el.totals.innerHTML = `已通 <b>${solvedN}</b>/${LEVELS} · 完美 <b>${perfectN}</b> · 提示 <b>${store.stats.hints}</b>`;
}

function renderShelf() {
  if (app.mode === 'campaign') {
    const unlocked = store.unlocked;
    let html = '';
    for (const tier of TIERS) {
      html += `<p class="tier">${tier.label} · ${tier.blurb}</p>`;
      for (const level of levelsIn(tier.key)) {
        const n = ALL.indexOf(level) + 1;
        const rec = store.record(level.id);
        const cls = [
          n === app.index ? 'here' : '',
          rec && rec.perfect ? 'perfect' : rec && rec.solved ? 'done' : '',
        ].filter(Boolean).join(' ');
        html += `<button type="button" data-index="${n}" class="${cls}" title="${level.par} 步" ${n > unlocked ? 'disabled' : ''}>${n}</button>`;
      }
    }
    el.shelf.innerHTML = html;
    el.shelf.querySelectorAll('button[data-index]').forEach((b) => {
      b.addEventListener('click', () => go(`#/c/${b.dataset.index}`));
    });
    return;
  }
  if (app.mode === 'random') {
    let html = '<p class="tier">选一段（数字是实测步数带）</p>';
    for (const tier of TIERS) {
      const on = tier.key === app.route.tier ? 'here' : '';
      html += `<button type="button" class="${on}" data-tier="${tier.key}">${tier.label}<br><small>${tier.blurb}</small></button>`;
    }
    html += '<button type="button" class="wide" data-reroll="1">换一局</button>';
    el.shelf.innerHTML = html;
    el.shelf.querySelectorAll('button[data-tier]').forEach((b) => {
      b.addEventListener('click', () => go(`#/random/${b.dataset.tier}/${token()}`));
    });
    el.shelf.querySelector('[data-reroll]').addEventListener('click', () => go(`#/random/${app.route.tier}/${token()}`));
    return;
  }
  if (app.mode === 'daily') {
    const done = app.day && store.dailyDone(app.day);
    el.shelf.innerHTML = `<p class="tier">今天这一局对所有人相同${done ? ' · 已通过' : ''}</p>`
      + `<button type="button" class="wide" data-back="1">回到战役 第 ${store.unlocked} 关</button>`;
  } else {
    el.shelf.innerHTML = '<p class="tier">分享的关卡</p>';
  }
  const back = el.shelf.querySelector('[data-back]');
  if (back) back.addEventListener('click', () => go(`#/c/${store.unlocked}`));
}

function token() {
  // `Math.random()` can in principle return exactly 0, which would stringify to "0" and mint
  // an empty token — and an empty token is a route that re-mints itself forever.
  return Math.random().toString(36).slice(2) || 'roll';
}

function render() {
  el.modes.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-current', String(b.dataset.mode === app.mode));
  });
  renderCrumbs();
  renderTotals();
  renderShelf();
}

// The one place a click happens: a finger on the canvas, a replay from a test link, and the
// solver's own route on the demo all arrive here, and all get held to the same rule.
//
// 声音接在这条路径上，因为这条路径上发生的是**真实事件**：
//   · 暂停中 → blocked（闸挡住了，不是"错"）
//   · 规则拒了这一拨 → wrong（canToggle 说不行：这一环此刻动不了）
//   · 规则认了这一拨 → correct（一次有效操作成功）
//   · 剑空了（全部下剑）→ win（在 finish 里）
function commit(k) {
  // 暂停时这一口是硬的：手指、拖拽、测试钩子、演示走的一步，全都从这里过。
  // 所以暂停期间不可能偷偷落子——遮罩挡住的是画布，这一行挡住的是其余所有入口。
  if (!session.acceptsInput()) {
    audio.play('blocked');
    view.redraw();
    return false;
  }
  const moved = click(app.game, k);
  if (!moved) {
    audio.play('wrong');
    haptics.wrong();
    view.redraw();
    return false;
  }
  if (app.game.done) {
    finish();                      // 收官那一响是 win，在 finish 里
    haptics.correct();
    return true;
  }
  audio.play('correct');           // 一次有效操作成功
  haptics.correct();
  view.redraw();
  renderCrumbs();
  const nowOn = isOn(app.game.state, k);
  say(`第 <b>${k + 1} 环</b> ${nowOn ? '上了剑' : '离了剑'} · 已用 ${app.game.moves} 步 · 距最优 <b>${remaining(app.game)}</b> 步`);
  return true;
}

function finish() {
  const level = app.level;
  const g = app.game;
  audio.play('win');               // 剑空了：全部环下了剑
  const rec = store.solve(level.id, { moves: g.moves, par: level.par, hints: app.hints });
  if (app.day) store.markDaily(app.day, level.id);
  let nextIndex = 0;
  if (app.mode === 'campaign') {
    store.unlock(Math.max(store.unlocked, app.index + 1));
    nextIndex = app.index < LEVELS ? app.index + 1 : 0;
  }
  stopDemo('');
  session.finish(); // 停表：通关卡上印的用时是最终读数，不再往上跑
  const gr = grade(g);
  el.stars.textContent = starText(gr.stars);
  el.verdict.textContent = gr.label;
  el.tally.innerHTML = `你的 <b>${g.moves}</b> 步 · 穷尽最少 <b>${level.par}</b> 步 · 提示 <b>${app.hints}</b> · 用时 <b>${clockText()}</b>`
    + (rec.best === g.moves ? '<br>这是这一关的最好成绩' : '');
  el.next.hidden = !nextIndex;
  el.curtain.hidden = false;
  render();
}

function go(hash) {
  if (location.hash === hash) apply();
  else location.hash = hash;
}

function apply() {
  const rt = parseHash();
  app.route = rt;
  app.mode = rt.mode;
  if (rt.mode === 'random' && !rt.key) {
    // A bare #/random/twined would mean a different position on every visit and an
    // unreproducible link, so the token is minted once and written back into the URL.
    location.replace(`${location.pathname}${location.search}#/random/${rt.tier}/${token()}`);
    return;
  }
  const r = resolve(rt);
  if (!r.level) {
    say('这一段还没有关卡');
    return;
  }
  app.day = r.day || null;
  app.index = rt.mode === 'campaign' ? rt.index : ALL.indexOf(r.level) + 1;
  setGame(r.level, r.label);
  render();
}

let toastTimer = 0;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 1800);
}

function shareLink() {
  const url = `${location.origin}${location.pathname}#/lot/${app.level.id}`;
  const done = () => toast('链接已复制');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done, () => toast(url));
  } else {
    toast(url);
  }
}

// The auto-demo is the solver made visible: it walks `next[]`, the same table every other
// number in this game comes from. Bounded by the size of the state space it reads.
let demoTimer = 0;
let demoSteps = 0;
function startDemo() {
  if (demoTimer || !app.game || app.game.done) return;
  demoSteps = 0;
  el.demo.textContent = '停止';
  el.demo.setAttribute('aria-pressed', 'true');
  demoTimer = setInterval(() => {
    // 暂停期间演示不自己往前跑：这就是本仓唯一那个"会自己往前跑"的东西，
    // 玩家按下暂停，它就得停。
    if (!session.acceptsInput()) return;
    const k = nextRing(app.game);
    if (k < 0 || app.game.done || ++demoSteps > bfs.size) {
      stopDemo('演示到此为止');
      return;
    }
    commit(k);
    if (app.game.done) stopDemo('演示走完了一条最短路线');
  }, 150);
}

function stopDemo(note) {
  if (demoTimer) clearInterval(demoTimer);
  demoTimer = 0;
  el.demo.textContent = '演示';
  el.demo.setAttribute('aria-pressed', 'false');
  if (note) say(note);
}

// ---- 暂停（HUD 按钮 / P / Esc）----
//
// 暂停要真的停，三件事一起停：秒表不走（js/core/session.js 把这一段存起来，
// 恢复时从原处接着加）、环不再位移（js/view.js 的 rAF 在暂停时跳过 update）、
// 盘面不吃输入（遮罩压住画布 + commit() 再挡一道）。恢复不丢状态：已拨的环、
// 已走的步数、已用的时间都留在原处。
// The pause's visible state: the button's wording, the veil, and the readout.
// Kept apart from the message so that a level change (which resets the
// session) can put the screen back in order without writing a line of text.
function applyPauseUi() {
  const on = session.paused;
  el.pause.textContent = on ? '继续' : '暂停';
  el.pause.setAttribute('aria-pressed', String(on));
  el.veil.hidden = !on;
}

function syncPause(note) {
  applyPauseUi();
  if (note) say(note);
  renderCrumbs();
}

function togglePause() {
  const before = session.paused;
  session.toggle();
  if (session.paused === before) return session.paused; // 已经通关，没什么可暂停的
  syncPause(session.paused ? '已暂停 —— 计时停住，盘面不吃输入（按 <b>P</b> 或 <b>Esc</b> 继续）' : '继续');
  return session.paused;
}

// 秒表自己走，所以「用时」是一个活的读数，而不是碰巧点了一下才变的数字。
// 它只写自己那一个格子：每 200ms 重建整块读数板是白费力气。
const clockTimer = setInterval(() => {
  if (session.state === 'finished') return;
  const cell = document.getElementById('elapsed');
  if (cell) cell.textContent = clockText();
}, 200);

el.pause.addEventListener('click', () => togglePause());
el.resume.addEventListener('click', () => togglePause());

el.modes.addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-mode]');
  if (!b) return;
  if (b.dataset.mode === 'campaign') go(`#/c/${clampIndex(store.unlocked)}`);
  else if (b.dataset.mode === 'daily') go('#/daily');
  else go(`#/random/${TIERS[0].key}/${token()}`);
});

el.undo.addEventListener('click', () => {
  stopDemo('');
  if (undo(app.game)) {
    audio.play('move');        // 撤销一步：盘面退了一步
    view.redraw();
    renderCrumbs();
    if (app.game.moves === 0) say('回到起点');
  }
});

el.hint.addEventListener('click', () => {
  const h = hint(app.game);
  if (!h) {
    say('剑已经空了 —— 没有该拨的环');
    audio.play('wrong');
    return;
  }
  app.hints++;
  stopDemo('');
  audio.play('move');          // 提示：只点一环，不代拨
  view.showHint(h.ring);
  say(`提示：动 <b>第 ${h.ring + 1} 环</b>（${h.ring === 0 ? '首环随时能拨' : '它下面那一环在剑上，其余都下了'}）—— 之后还需 <b>${h.left - 1}</b> 步`);
  renderCrumbs();
});

el.demo.addEventListener('click', () => {
  if (demoTimer) stopDemo('演示已停止');
  else startDemo();
});

function restart() {
  stopDemo('');
  reset(app.game);
  app.hints = 0;
  session.reset(); // 重开也是一次新的尝试：秒表归零，暂停解除
  applyPauseUi();
  el.curtain.hidden = true;
  view.redraw(); // the rings travel back on the animation loop rather than teleporting
  render();
  say('回到起点');
}

el.restart.addEventListener('click', restart);
el.share.addEventListener('click', shareLink);
el.again.addEventListener('click', restart);
el.next.addEventListener('click', () => go(`#/c/${Math.min(LEVELS, app.index + 1)}`));

// Wiping the save is the one destructive thing this game can do, so it asks twice instead
// of firing on a stray click.
let wipeArmed = false;
el.wipe.addEventListener('click', () => {
  if (!wipeArmed) {
    wipeArmed = true;
    toast('再点一次会清空本机全部成绩');
    setTimeout(() => { wipeArmed = false; }, 4000);
    return;
  }
  store.reset();
  wipeArmed = false;
  toast('存档已清空');
  apply();
});

window.addEventListener('hashchange', apply);
window.addEventListener('resize', () => view.measure());
window.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const k = ev.key.toLowerCase();
  // Esc 先关通关卡（老行为）；卡不在的时候，Esc 就是暂停键。
  if (k === 'escape' && !el.curtain.hidden) { el.curtain.hidden = true; return; }
  // P 与 Esc：暂停 / 继续。
  if (k === 'p' || k === 'escape') { togglePause(); return; }
  // 暂停期间别的键一律不接：撤销、提示、重开、演示，每一个都会动盘面。
  if (session.paused) return;
  if (k === 'u') el.undo.click();
  else if (k === 'h') el.hint.click();
  else if (k === 'r') el.restart.click();
  else if (k === 'd') el.demo.click();
});

view.start();
// Deliberately not paused on visibilitychange: the ring travel animation and the win card
// are driven from the same loop, and a tab that reports itself hidden (headless Chrome does)
// must still be able to finish a level.
apply();

window.rings = {
  version: 1,
  get state() {
    return {
      mode: app.mode,
      label: app.label,
      id: app.level && app.level.id,
      tier: app.level && app.level.tier,
      index: app.index,
      moves: app.game && app.game.moves,
      par: app.level && app.level.par,
      left: app.game ? remaining(app.game) : -1,
      over: app.game ? overPar(app.game) : 0,
      hints: app.hints,
      done: !!(app.game && app.game.done),
      unlocked: store.unlocked,
      solved: ALL.filter((l) => store.record(l.id) && store.record(l.id).solved).length,
      curtain: !el.curtain.hidden,
      demo: !!demoTimer,
      paused: session.paused,
      elapsedMs: session.elapsedMs(),
      n: app.game && app.game.n,
    };
  },
  get pool() { return poolStats(); },
  get bands() { return TIERS; },
  // What the exhaustive search says about the space, timed on this device.
  graph() { return probeGraph(); },
  formula(n) { return closedForm(n); },
  load(hash) { go(hash); return app.level && app.level.id; },
  // Where ring k sits right now, in client pixels — what an automated finger needs, as
  // opposed to the maths in js/core.
  ringPoint(k) { return view.ringPoint(k); },
  liveRings() { return view.liveRings(); },
  bits() { return app.game ? Array.from(bitsOf(app.game.state, app.game.n)) : null; },
  stateOf() { return app.game ? app.game.state : null; },
  level() { return app.level ? { id: app.level.id, n: app.level.n, state: app.level.state, par: app.level.par } : null; },
  // The certified shortest route out of this level's start position, as ring numbers — the
  // same chain of `next[]` the panel bills `par` against, recomputed here so a test can
  // prove the browser agrees with the number printed on screen.
  path() { return app.game ? tableRoute(app.game.table, app.game.start) : []; },
  route() { return app.game ? tableRoute(app.game.table, app.game.state) : []; },
  // Play a solver route through the same commit() a finger uses.
  play(route) {
    for (const k of route || []) commit(k);
    return app.game.moves;
  },
  clickRing(k) { return commit(k); },
  hintOnce() { el.hint.click(); return { hints: app.hints, ring: app.game ? nextRing(app.game) : -1, line: el.hintline.textContent }; },
  undoOnce() { el.undo.click(); return app.game.moves; },
  demoStart() { startDemo(); return !!demoTimer; },
  demoStop() { stopDemo(''); return demoTimer === 0; },
  pixels() { return view.pixelsHash(); },
  painted() { return view.painted(); },
  reset() { restart(); return app.game.moves; },
  // The pause, for an automated finger: it flips the same switch the HUD
  // button and the P key flip, so there is one pause and not three.
  get paused() { return session.paused; },
  elapsedMs() { return session.elapsedMs(); },
  pauseToggle() { return togglePause(); },
  store,
};

// ---- 全屏开关（#btn-fullscreen）----
// 绑的是本页 HUD 上真实存在的那个按钮。全屏最常见的假实现就是引用一个并不存在的
// id：点下去什么也不会发生，量具却算它"已实现"。所以这里找不到按钮就直接不装。
(function bindFullscreen() {
  const btn = document.getElementById('btn-fullscreen');
  if (!btn) return;
  const root = document.documentElement;
  // 只做特性检测，不嗅探 UA：iOS Safari 是 webkitRequestFullscreen，老 Edge 是 ms 前缀，
  // 而 UA 字符串随时会改。"有没有这个能力"是查出来的，不是猜出来的。
  const req = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
  const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  const current = () => document.fullscreenElement || document.webkitFullscreenElement
    || document.msFullscreenElement || null;

  // 不支持也要给个说法：只把按钮灰掉而不解释，玩家会以为这功能没做完。
  // supported 这枚标记不能省：下面 sync() 每次都会重写 title，不挡住的话，装的时候刚写
  // 进去的人话原因会被随后的 sync() 立刻抹成"全屏 (F)"——禁用就变成一句没有理由的禁用。
  let supported = !!req;
  const unsupported = () => {
    supported = false;
    btn.disabled = true;
    btn.title = '这个浏览器不提供元素全屏（iOS Safari 请用「添加到主屏幕」独立打开）';
  };
  if (!req) unsupported();

  // fullscreen 返回 Promise，被拒时必须吃掉：iOS Safari 对多数非 video 元素直接拒绝，
  // 让这个 rejection 冒泡出去会变成一条未捕获错误，整局游戏跟着挂。
  const settle = (p) => { if (p && p.catch) p.catch(unsupported); };

  // 进出都能走：已经全屏时这次调用是退出，不是"再进一次"。
  function toggle() {
    try {
      if (current()) {
        if (exit) settle(exit.call(document));
      } else if (req) {
        settle(req.call(root));
      } else {
        unsupported();
      }
    } catch (e) {
      unsupported();
    }
  }

  // Esc 和系统手势退出都不经过我们的代码，按钮状态只能靠 fullscreenchange 回写，
  // 否则用户已经退出、HUD 还停在"退出全屏"，下一次点击反而会重新进全屏。
  function sync() {
    const on = !!current();
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? "退出全屏" : "全屏";
    if (supported) btn.title = "全屏" + '（F）';
    const body = document.body;
    if (body && body.classList) body.classList.toggle('fullscreen', on);
  }

  btn.addEventListener('click', toggle);
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'f' && ev.key !== 'F') return;
    const t = ev.target;
    // 盘号 / 种子这类输入框里打字不能触发全屏，否则玩家输 seed 输到一半屏幕没了。
    if (t && /input|textarea|select/i.test(t.tagName || '')) return;
    if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    ev.preventDefault();
    toggle();
  });
  window.addEventListener('fullscreenchange', sync);
  window.addEventListener('webkitfullscreenchange', sync);
  window.addEventListener('MSFullscreenChange', sync);
  sync();
})();

// ---- 减弱动效（prefers-reduced-motion）----
//
// 跟住系统设置，而且**运行中改设置要立刻生效**：只读一次 matchMedia 不够，玩家在系统里
// 把开关拨回来，页面还停在上一次读到的答案上。addEventListener 是标准接口，老 Safari 只有
// addListener —— 特性探测，不做 UA 判断。
const motionQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)') : null;
function applyReduceMotion(on) { view.setReduceMotion(on); }
if (motionQuery) {
  applyReduceMotion(motionQuery.matches);
  if (typeof motionQuery.addEventListener === 'function') {
    motionQuery.addEventListener('change', (e) => applyReduceMotion(e.matches));
  } else if (typeof motionQuery.addListener === 'function') {
    motionQuery.addListener((e) => applyReduceMotion(e.matches));
  }
}
window.rings.setReduceMotion = applyReduceMotion;
window.rings.isReducedMotion = () => view.isReducedMotion();

// ---- 音效开关（#btn-sound）----
//
// 静音走 `audio.setMuted(true)`，那是 `ctx.suspend()`：整个 AudioContext 挂起。
// **不许**改成像"把 master.gain 拧到 0"那样 —— 只拧 gain 是假静音：节点照建、时钟照跑，
// 取消静音之后还有一截尾巴在响。真正的静音必须是挂起整个上下文。
//
// 按钮找不到就不装（和全屏那一条同一条纪律）：留一串没人按的代码等于没做这个功能。
(function bindSound() {
  const btn = document.getElementById('btn-sound');
  if (!btn) return;
  function paint() {
    const on = !audio.muted;
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? '音效：开' : '音效：关';
    btn.title = on ? '点击关闭音效' : '点击开启音效';
  }
  btn.addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    paint();
  });
  paint();
})();
