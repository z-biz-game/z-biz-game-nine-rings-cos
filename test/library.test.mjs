// The shipped data, re-measured. tools/bake.mjs certifies each level as it writes it; this
// suite certifies whatever is actually on disk, so a hand-edit to a `par`, a stale bake or
// a band that quietly drifted fails here rather than in someone's face.

import { test, run, ok, eq } from '../tools/harness.mjs';
import {
  TIERS, ENVELOPES, ALL, byId, levelAt, levelsIn, campaign, tierByKey, randomLevel, dailyLevel,
  stats, validateLevel, closedForm,
} from '../js/core/library.js';
import { LEVELS, HISTOGRAM } from '../js/data/levels.js';
import { table, formula, fullRing } from '../js/core/solve.js';
import { RINGS, canToggle } from '../js/core/game.js';

const t = table(RINGS);

test('the pool is not empty and every row passes the model validator', () => {
  ok(ALL.length >= 32, `there should be a game here, got ${ALL.length} levels`);
  const wrong = ALL.map((l) => [l.id, validateLevel(l)]).filter(([, e]) => e);
  eq(wrong, [], 'a level is a measurement, so it has to still be one');
});

test('the validator itself catches bad rows, clause by clause', () => {
  const good = { id: 'novice-01', tier: 'novice', n: 9, state: 1, par: 1, rings: 1, movable: 2 };
  eq(validateLevel(good), null, 'the shape bake.mjs writes is legal');
  ok(validateLevel(null), 'nothing');
  ok(validateLevel({ ...good, id: '' }), 'an id is required for a shareable link');
  ok(validateLevel({ ...good, tier: 'nonsense' }), 'an unknown band');
  ok(validateLevel({ ...good, n: 0 }), 'n must be a ring count');
  ok(validateLevel({ ...good, state: 512 }), 'a tenth ring does not fit in nine');
  ok(validateLevel({ ...good, state: -1 }), 'nor a negative position');
  ok(validateLevel({ ...good, state: 1.5 }), 'a position is a whole number of bits');
  ok(validateLevel({ ...good, par: 0 }), 'par 0 is the already-solved sword, not a level');
  ok(validateLevel({ ...good, par: 2 }), `a par the table disagrees with (${t.dist[1]} for state 1)`);
  // par 400 is a real distance in the table — position 344 sits there — so this row passes
  // every check except the band it claims to belong to.
  eq(t.dist[344], 400, 'first: the number this fixture leans on is true');
  ok(validateLevel({ ...good, state: 344, par: 400, rings: 4 }), 'a par the table agrees with but the band does not');
  ok(validateLevel({ ...good, rings: 12 }), 'more rings on the sword than there are rings');
});

test('every printed par reproduces from the serialised row', () => {
  const wrong = [];
  for (const row of LEVELS) {
    if (row.par !== t.dist[row.state]) wrong.push(`${row.id}: prints ${row.par}, table ${t.dist[row.state]}`);
  }
  eq(wrong, [], 're-solving the data on disk has to give the number on screen');
  // 511 is "all nine rings on the sword" — the classical puzzle, and the one position whose
  // par the closed form predicts independently. bake.mjs spreads pars across a band, so it
  // has to show up exactly once, in the band its own distance falls in, and nowhere else.
  const classic = LEVELS.filter((r) => r.state === fullRing(9));
  eq(classic.length, 1, 'the all-on sword is shipped, once, not twice under different ids');
  eq(classic[0].par, formula(9), 'and its printed par is the closed form, not a nearby number');
  ok(TIERS.some((x) => classic[0].par >= x.min && classic[0].par <= x.max), 'the classical par is inside some band');
  for (const row of LEVELS) ok(row.state >= 0 && row.state < 512, `${row.id} is a nine-bit position`);
});

test('ids are unique, shaped after their band, and every band ships levels', () => {
  const seen = new Set();
  const states = new Set();
  for (const l of ALL) {
    ok(!seen.has(l.id), `${l.id} appears twice`);
    seen.add(l.id);
    ok(new RegExp(`^${l.tier}-\\d+$`).test(l.id), `${l.id} does not look like a ${l.tier} id`);
    ok(!states.has(l.state), `${l.id} reuses position ${l.state} from another level`);
    states.add(l.state);
    ok(l.par >= 1, `${l.id} starts with the sword already clear`);
  }
  for (const tier of TIERS) ok(levelsIn(tier.key).length > 0, `${tier.key} shipped nothing`);
  eq(byId('not-a-level'), null);
  eq(byId(ALL[5].id), ALL[5]);
});

test('the bands on screen are the bands in the file, and they do not overlap', () => {
  eq(TIERS.map((x) => x.key), ENVELOPES.map((x) => x.key), 'the bands the UI shows are the bands the generator cuts');
  const s = stats();
  eq(s.levels, ALL.length);
  for (const tier of TIERS) {
    const measured = levelsIn(tier.key).map((l) => l.par);
    eq([tier.min, tier.max], [Math.min(...measured), Math.max(...measured)], `${tier.key} band`);
    eq([s.byTier[tier.key].min, s.byTier[tier.key].max], [tier.min, tier.max], `${tier.key} stats`);
    ok(/步/.test(tier.blurb), `${tier.key} advertises its band in the blurb`);
  }
  for (let i = 1; i < TIERS.length; i++) {
    ok(TIERS[i].min > TIERS[i - 1].max, `bands must not overlap: ${TIERS.map((x) => `${x.key} ${x.min}-${x.max}`).join(' · ')}`);
  }
});

test('the bands are the histogram, not a opinion about hardness', () => {
  // The provenance chain the deliverable claims: TIERS_META.min/max == the shipped levels'
  // own range, and each shipped range sits inside the quantile cut it was drawn from, which
  // in turn comes out of the 512-position distance histogram baked into the same file.
  ok(HISTOGRAM.flat, 'the measured histogram is flat, i.e. one position per distance');
  eq(HISTOGRAM.nodes, 512);
  eq(HISTOGRAM.distinctDistances, 512);
  eq(HISTOGRAM.maxCount, 1);
  eq(HISTOGRAM.allOnDist, HISTOGRAM.closedForm);
  eq(HISTOGRAM.closedForm, formula(9));
  eq(HISTOGRAM.maxDist, 511);
  for (const tier of TIERS) {
    const cut = HISTOGRAM.cuts.find((c) => c.key === tier.key);
    ok(cut, `${tier.key} is not in the baked histogram`);
    ok(tier.min >= cut.min && tier.max <= cut.max, `${tier.key} shipped outside its quantile cut`);
    const env = ENVELOPES.find((e) => e.key === tier.key);
    eq([env.min, env.max], [cut.min, cut.max], `${tier.key} envelope matches the histogram cut`);
    ok(cut.states >= 120 && cut.states <= 135, `${tier.key} cut holds ${cut.states} of 511 positions`);
  }
  const s = stats();
  for (const tier of TIERS) {
    const s2 = s.byTier[tier.key];
    for (const [k, v] of Object.entries(s2)) ok(Number.isFinite(v), `${tier.key}.${k} is ${v}, not a number`);
    ok(s2.parMed >= tier.min && s2.parMed <= tier.max, `${tier.key} median ${s2.parMed} outside ${tier.min}-${tier.max}`);
    ok(s2.ringsMin >= 1 && s2.ringsMax <= RINGS, `${tier.key} ring counts`);
  }
});

test('the campaign walks upwards and wraps around', () => {
  eq(campaign().length, ALL.length);
  for (const tier of TIERS) {
    const pars = levelsIn(tier.key).map((l) => l.par);
    eq(pars, [...pars].sort((a, b) => a - b), `${tier.key} is not sorted easiest first`);
    eq(new Set(pars).size, pars.length, `${tier.key} repeats a par, so four levels would be one level`);
  }
  const order = campaign().map((l) => TIERS.findIndex((x) => x.key === l.tier));
  eq(order, [...order].sort((a, b) => a - b), 'a band must not reappear after a harder one');
  eq(levelAt(0).id, ALL[0].id);
  eq(levelAt(-1).id, ALL[ALL.length - 1].id, 'walking off the front lands at the back');
  eq(levelAt(ALL.length).id, ALL[0].id, 'and off the end lands at the start');
});

test('a shared pick is the same pick, on any device', () => {
  eq(closedForm(9), { n: 9, search: 341, formula: 341 }, 'the headline number, recomputed');
  const today = '2026-09-27';
  eq(dailyLevel(today), dailyLevel(today), 'the daily level is a function of the date');
  eq(dailyLevel(today).id, 'daily-2026-09-27', 'and its id is too, so the record lands in the right slot');
  ok(dailyLevel(today).par !== dailyLevel('2026-09-28').par || dailyLevel(today).state !== dailyLevel('2026-09-28').state,
    'tomorrow is a different sword');
  for (const tier of TIERS) {
    const a = randomLevel('4kq2', tier.key);
    eq(a, randomLevel('4kq2', tier.key), `${tier.key} is not deterministic`);
    eq(a.tier, tier.key, `${tier.key} handed out someone else's level`);
    ok(a.par >= tier.min && a.par <= tier.max, `${tier.key} par ${a.par} outside the shipped band`);
    eq(a.par, t.dist[a.state], `${tier.key} par must be the table, always`);
    ok(canToggle(a.state, 0, 9), 'every generated position can at least move ring 1');
  }
  // tierByKey is the generator's own lookup, so it answers with an envelope, not with the
  // display metadata — the two shapes are allowed to differ, the fallback is the point.
  eq(tierByKey('nonsense'), ENVELOPES[0], 'an unknown band falls back to the easiest one rather than crashing the route');
  eq(tierByKey('master'), ENVELOPES[3], 'and a known band comes back as itself');
  eq(ENVELOPES.map((x) => x.key), TIERS.map((x) => x.key), 'every band the UI names is a band the generator knows');
});

test('no level is unreachable-legal: every position the pool sells has a click', () => {
  for (const l of ALL) {
    const any = canToggle(l.state, 0, l.n) || canToggle(l.state, 1, l.n);
    ok(any, `${l.id} has nothing to click`);
    eq(l.rings, Array.from({ length: l.n }, (_, k) => (l.state >> k) & 1).reduce((a, b) => a + b, 0), `${l.id} ring count`);
    eq(l.movable, Array.from({ length: l.n }, (_, k) => k).filter((k) => canToggle(l.state, k, l.n)).length, `${l.id} movable count`);
  }
});

run();
