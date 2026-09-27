// The balance rig. Nothing here is a pass/fail gate — it is the instrument every difficulty
// number in README.md, DESIGN.md and deliverable.md was read off, kept in the repo so those
// numbers stay checkable with one command:
//
//   node test/balance.mjs
//   SAMPLES=2000 BANDS=novice,master node test/balance.mjs
//
// Three things get measured, in this order: the state space itself (exhaustively, so the
// numbers are facts), the generator that samples from it, and the pool that shipped.

import { table, buildTable, bandCuts, formula, fullRing, summary } from '../js/core/solve.js';
import { TIERS, makeLevel, statesAtPar } from '../js/core/make.js';
import { ALL, stats } from '../js/core/library.js';
import { RINGS, SOLVED, createGame, click, nextRing, routeToZero, movable } from '../js/core/game.js';

const N = Math.max(1, Number(process.env.SAMPLES || 500));
const want = (process.env.BANDS || '').split(',').filter(Boolean);
const bands = want.length ? TIERS.filter((t) => want.includes(t.key)) : TIERS;

function pct(sorted, p) {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

function time(fn, runs) {
  const ms = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn(i);
    ms.push(performance.now() - t0);
  }
  const sum = ms.reduce((a, b) => a + b, 0);
  ms.sort((a, b) => a - b);
  return { med: pct(ms, 0.5), min: ms[0], max: ms[ms.length - 1], sum };
}

const head = (title) => console.log(`\n${title}`);
const row = (...cells) => console.log(cells.join(' | '));

// ---------------------------------------------------------------- the space, exhaustively
const BUILD_RUNS = 25;
const build = time(() => buildTable(RINGS, SOLVED), BUILD_RUNS); // a fresh sweep each time
const t = table(RINGS);
const s = summary(t);

head('# 状态空间（穷尽）');
row('项', '值');
row('环数 n', RINGS);
row('位置数 2^n', t.size);
row('到达数', t.reached);
row('全部可达', t.complete);
row('图形状', t.isPath ? '一条路径（度 1-2）' : `度 ${t.degMin}-${t.degMax}`);
row(`全上→全下（搜索）`, t.dist[fullRing(RINGS)]);
row(`全上→全下（闭式 (2^${RINGS + 1}-${RINGS % 2 ? 1 : 2})/3）`, formula(RINGS));
row('最深的距离', `${t.maxDist} @ 位置 ${t.argMaxDist} (0b${t.argMaxDist.toString(2)})`);
row(`不同距离数`, s.distinctDists);
row(`每个距离的位置数最多`, Math.max(...Array.from(t.counts)));
row(`${BUILD_RUNS} 次完整 BFS (ms)`, `中位 ${build.med.toFixed(3)} · 最快 ${build.min.toFixed(3)} · 最慢 ${build.max.toFixed(3)}`);

head('# 实测距离直方图的等分点（难度带就长在这儿）');
for (const parts of [2, 3, 4, 5]) {
  row(`parts=${parts}`, bandCuts(t, parts).map((c) => `${c.min}-${c.max}(${c.n})`).join('  '));
}
row('n=9 每一格', TIERS.map((x) => `${x.key} ${x.min}-${x.max}(${x.states})`).join('  '));

head('# 每一带的形状');
row('band', 'par 范围', '位置数', '实测: 剑上环数 min/med/max', '可拨环数分布');
for (const tier of TIERS) {
  const states = [];
  for (let d = tier.min; d <= tier.max; d++) states.push(statesAtPar(d)[0]);
  const on = states.map((x) => Array.from({ length: RINGS }, (_, k) => (x >> k) & 1).reduce((a, b) => a + b, 0)).sort((a, b) => a - b);
  const mv = {};
  for (const x of states) {
    const n = movable(x, RINGS).length;
    mv[n] = (mv[n] || 0) + 1;
  }
  row(tier.key, `${tier.min}-${tier.max}`, states.length,
    `${pct(on, 0)}/${pct(on, 0.5)}/${pct(on, 1)}`,
    Object.entries(mv).map(([k, v]) => `${k}:${v}`).join(' '));
}

// --------------------------------------------------------------------------- the generator
head(`# 生成器（每带 ${N} 个种子）`);
row('band', '接受', 'par min/med/max', 'ms 中位', 'ms 最慢');
for (const tier of bands) {
  const accept = { tried: 0, accepted: 0, rejected: 0 };
  const pars = [];
  const run = time((i) => {
    const g = makeLevel(`balance-${i}`, tier.key, accept);
    pars.push(g.par);
  }, N);
  pars.sort((a, b) => a - b);
  row(tier.key, `${accept.accepted}/${accept.tried}${accept.rejected ? ` (拒 ${accept.rejected})` : ''}`,
    `${pct(pars, 0)}/${pct(pars, 0.5)}/${pct(pars, 1)}`,
    run.med.toFixed(4), run.max.toFixed(4));
}
console.log('说明: 生成一个关卡 = 在带内抽一个距离 + 查它唯一的位置, 所以接受率恒为 100%, 没有重试环。');

// ---------------------------------------------------------------------- the shipped pool
head('# 已发布关卡池');
const st = stats();
row('关数', st.levels);
row('总关 par 合计', ALL.reduce((a, l) => a + l.par, 0));
row('最难一关', `${ALL.reduce((a, l) => (l.par > a.par ? l : a)).id} · ${Math.max(...ALL.map((l) => l.par))} 步`);
row('各带 par 中位数', TIERS.map((x) => `${x.key} ${st.byTier[x.key].parMed}`).join(' · '));
row('各带跨度', TIERS.map((x) => `${x.key} ±${st.byTier[x.key].parSpread}`).join(' · '));
row('各带剑上环数', TIERS.map((x) => `${x.key} ${st.byTier[x.key].ringsMin}-${st.byTier[x.key].ringsMax}`).join(' · '));

head('# 逐关复验（照 next[] 走一遍，看是不是恰好 par 步）');
let worst = null;
let total = 0;
const walk = time((i) => {
  const level = ALL[i];
  const g = createGame(level);
  const suggested = routeToZero(g).length;
  let steps = 0;
  while (!g.done && steps <= level.par + 1) {
    const k = nextRing(g);
    if (k < 0 || !click(g, k)) throw new Error(`${level.id}: 路由在第 ${steps} 步失效`);
    steps++;
  }
  if (steps !== level.par || suggested !== level.par) throw new Error(`${level.id}: par ${level.par} 但走了 ${steps}`);
  total += steps;
  if (!worst || steps > worst.steps) worst = { id: level.id, steps };
}, ALL.length);
row('关数', ALL.length);
row('全部走完 par 合计', total);
row('最难', `${worst.id} · ${worst.steps} 步`);
row(`走完 ${ALL.length} 关的总耗时 (ms)`, walk.sum.toFixed(2));
console.log('\n以上每一行都可用 `node test/balance.mjs` 复现。');
