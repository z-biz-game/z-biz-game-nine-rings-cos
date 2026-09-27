// The save file. The discipline tested here is narrow and it matters more than the size of
// the code suggests:
//
//   * a record must never get worse by itself — a best of 6 does not become 8 because the
//     player replayed the level badly;
//   * unlocking is monotone — replaying level 3 must not hide level 40 again;
//   * storage that is refused outright (private windows, blocked third-party storage,
//     embedded webviews) must cost the player their persistence, never their session;
//   * a corrupt save is recovered from, not trusted.
//
// Each scenario gets its own instance of js/core/storage.js via a cache-busting import query,
// because the module keeps its parsed save at module scope — which is exactly the state a
// page reload starts with, and therefore the thing worth simulating. The module reads
// `window` when it is first used, so a scenario installs its fake before touching its
// instance (see `use`).

import { test, run, ok, eq } from '../tools/harness.mjs';

const KEY = 'rings.save.v1';

class FakeStorage {
  constructor(initial = {}) {
    this.map = { ...initial };
    this.blocked = false;
    this.writes = 0; // successful writes, like the browser: a refused call changes nothing
    this.reads = 0;
  }

  deny() {
    this.blocked = true;
    return this;
  }

  getItem(k) {
    if (this.blocked) throw new Error('SecurityError: storage is blocked');
    this.reads++;
    return Object.prototype.hasOwnProperty.call(this.map, k) ? this.map[k] : null;
  }

  setItem(k, v) {
    if (this.blocked) throw new Error('SecurityError: storage is blocked');
    this.writes++;
    this.map[k] = String(v);
  }

  removeItem(k) {
    if (this.blocked) throw new Error('SecurityError: storage is blocked');
    delete this.map[k];
  }
}

let caseNo = 0;

// One copy of the storage module, reading through `fake`.
async function makeInstance(fake) {
  use(fake);
  const mod = await import(`../js/core/storage.js?case=${++caseNo}`);
  return { store: mod.store, SAVE_KEY: mod.SAVE_KEY, fake };
}

// What the browser gives the module to work against: a localStorage, or nothing at all.
function use(fake) {
  globalThis.window = fake ? { localStorage: fake } : undefined;
}

function disk(fake) {
  const text = fake.map[KEY];
  return text === undefined ? null : JSON.parse(text);
}

// A hand-made save with one record in it, used for the blocked-storage scenario: the file is
// there, but the browser refuses to read it. Written out here rather than produced by a call,
// so "what a previous version left behind" is visible in the test instead of implied by it.
function savedWith(record) {
  return JSON.stringify({
    records: { 'novice-01': record },
    daily: { '2026-09-26': { id: 'daily-2026-09-26', at: 1 } },
    unlocked: 7,
    stats: { solves: 4, perfect: 2, clicks: 512, hints: 3 },
  });
}

const good = { solved: true, best: 6, plays: 2, perfect: true };

const blankStore = await makeInstance(new FakeStorage({}));
const corruptStore = await makeInstance(new FakeStorage({ [KEY]: '{not json' }));
const textStore = await makeInstance(new FakeStorage({ [KEY]: '"just a string"' }));
const partialStore = await makeInstance(new FakeStorage({ [KEY]: JSON.stringify({ records: { 'novice-01': good } }) }));
const blockedStore = await makeInstance(new FakeStorage({ [KEY]: savedWith(good) }).deny());

// Four instances over one disk: the reload story, start to finish.
const sharedDisk = new FakeStorage({});
const beforeA = await makeInstance(sharedDisk);
const beforeB = await makeInstance(sharedDisk);
const afterReload = await makeInstance(sharedDisk);
const afterWipe = await makeInstance(sharedDisk);

test('the key is versioned, so a future format change can be recognised', () => {
  use(blankStore.fake);
  eq(blankStore.SAVE_KEY, KEY, 'one key, and this test pins the version in its name');
  eq([blankStore.store.unlocked, blankStore.store.daily, blankStore.store.stats], [1, {}, { solves: 0, perfect: 0, clicks: 0, hints: 0 }],
    'a brand new device starts clean');
  eq(Object.keys(blankStore.store.records).length, 0, 'and has no records');
  eq(blankStore.fake.reads, 1, 'the save is read once, then cached for the session');
});

test('a corrupt or unexpected save is recovered from, not trusted', () => {
  use(corruptStore.fake);
  eq(corruptStore.store.unlocked, 1, 'truncated JSON does not crash the shell');
  eq(corruptStore.store.stats.solves, 0);
  use(textStore.fake);
  eq(Object.keys(textStore.store.records).length, 0, 'valid JSON of the wrong shape is discarded too');
  eq(textStore.store.unlocked, 1, 'and the defaults are filled in');
});

test('a partial save keeps what it has and defaults what it lacks', () => {
  use(partialStore.fake);
  eq(partialStore.store.record('novice-01'), good, 'the one record in the file survives');
  eq(partialStore.store.unlocked, 1, 'missing fields come back as defaults');
  eq(partialStore.store.daily, {});
  eq(partialStore.store.stats, { solves: 0, perfect: 0, clicks: 0, hints: 0 });
});

test('best only ever goes down, and plays only ever goes up', () => {
  use(blankStore.fake);
  const id = 'twined-04'; // baked par 282, so 282 is the floor a record can reach
  eq(blankStore.store.solve(id, { moves: 300, par: 282, hints: 0 }).best, 300, 'the first clear is the record');
  eq(blankStore.store.record(id).perfect, false, 'and a detour is not marked perfect');
  eq(blankStore.store.solve(id, { moves: 282, par: 282, hints: 0 }).best, 282, 'a match of the exhaustive minimum replaces it');
  eq(blankStore.store.solve(id, { moves: 400, par: 282, hints: 5 }).best, 282, 'a worse one does not');
  eq(blankStore.store.record(id).plays, 3, 'but every attempt is counted');
  eq(blankStore.store.record(id).perfect, true, 'and a perfect clear is never taken back');
  eq(blankStore.store.stats, { solves: 3, perfect: 1, clicks: 982, hints: 5 }, 'the tally adds up: 300+282+400, one clean perfect');
});

test('the perfect flag counts clicks, the perfect tally also counts hints', () => {
  use(blankStore.fake);
  // Deliberate split, and worth stating out loud: the record answers "did this position take
  // its proven minimum?", which is a fact about the BFS distance and the click count. The
  // lifetime tally answers "how much of this game was played without help?", so a hint costs
  // the tally point but not the record.
  const before = blankStore.store.stats.perfect;
  blankStore.store.solve('novice-02', { moves: 9, par: 9, hints: 3 });
  eq(blankStore.store.record('novice-02').perfect, true, 'on par is on par');
  eq(blankStore.store.stats.perfect, before, 'but a hinted solve is not a clean one');
  blankStore.store.solve('novice-03', { moves: 18, par: 18, hints: 0 });
  eq(blankStore.store.stats.perfect, before + 1, 'unhinted is what the tally rewards');
});

test('unlocking is monotone in both directions', () => {
  use(blankStore.fake);
  eq(blankStore.store.unlock(12), 12, 'clearing level 11 opens 12');
  eq(blankStore.store.unlock(4), 12, 'replaying an early level hides nothing again');
  eq(blankStore.store.unlock(12), 12, 'and re-opening the same door is a no-op');
  eq(blankStore.store.unlocked, 12);
});

test('the daily slot is per date, and an unseen date is empty', () => {
  use(blankStore.fake);
  eq(blankStore.store.dailyDone('2026-09-27'), null, 'nothing has been played today yet');
  blankStore.store.markDaily('2026-09-27', 'daily-2026-09-27');
  const done = blankStore.store.dailyDone('2026-09-27');
  eq(done.id, 'daily-2026-09-27', 'the id lands in the date slot, so the link and the record agree');
  eq(typeof done.at, 'number', 'and it is stamped');
  eq(blankStore.store.dailyDone('2026-09-28'), null, 'tomorrow is still unplayed');
  blankStore.store.markDaily('2026-09-28', 'daily-2026-09-28');
  eq(blankStore.store.dailyDone('2026-09-27').id, 'daily-2026-09-27', 'and yesterday is not overwritten');
});

test('a save survives a reload, and a wipe really wipes', () => {
  use(beforeA.fake);
  eq(beforeA.fake.map[KEY], undefined, 'the disk starts empty');
  beforeA.store.solve('master-03', { moves: 401, par: 401, hints: 0 });
  beforeA.store.unlock(2);
  eq(beforeA.fake.writes, 2, 'every change is written through, not batched into a pagehide');
  eq(disk(beforeA.fake).records['master-03'].best, 401, 'and it is on disk in the shape the shell reads');

  use(afterReload.fake);
  ok(afterReload.fake === beforeA.fake, 'same disk, new page');
  eq(Object.keys(afterReload.fake.map), [KEY], 'and the only thing on that disk is the one key');
  eq(afterReload.store.record('master-03').best, 401, 'the record comes back');
  eq(afterReload.store.unlocked, 2, 'so does the pointer');
  eq(afterReload.store.stats.solves, 1, 'and the tally');

  use(beforeB.fake);
  beforeB.store.solve('master-04', { moves: 500, par: 409, hints: 1 });
  use(afterReload.fake);
  eq(afterReload.store.record('master-03').best, 401, 'a second instance reading the same disk still sees the first record');

  use(beforeA.fake);
  beforeA.store.reset();
  eq(beforeA.fake.map[KEY], undefined, 'reset removes the key rather than overwriting it with blanks');
  use(afterWipe.fake);
  eq(Object.keys(afterWipe.store.records).length, 0, 'a reload after a wipe really is a clean device');
  eq(afterWipe.store.unlocked, 1);
  eq(afterWipe.store.stats, { solves: 0, perfect: 0, clicks: 0, hints: 0 });
});

test('blocked storage costs persistence, not the session', () => {
  use(blockedStore.fake);
  eq(blockedStore.store.unlocked, 1, 'the module never reads what it cannot read');
  eq(blockedStore.store.solve('novice-01', { moves: 1, par: 1, hints: 0 }), { solved: true, best: 1, plays: 1, perfect: true },
    'a solve in a private window still works');
  eq(blockedStore.store.unlock(9), 9, 'unlocking still works');
  eq(blockedStore.store.record('novice-01').plays, 1, 'records are kept in memory');
  eq(blockedStore.fake.writes, 0, 'and nothing was ever written');
  eq(blockedStore.fake.reads, 0, 'nor read: the refused getItem was not worked around');
  eq(disk(blockedStore.fake).unlocked, 7, 'the file that is on disk there is untouched and unread');
});

test('no window at all is the same story', () => {
  use(null);
  // `node --test` has no window at all, which is how this file can import the module in the
  // first place: the browser-only call sites are guarded, so the rules and the records are
  // testable without a DOM.
  eq(blankStore.store.solve('novice-05', { moves: 35, par: 35, hints: 0 }).best, 35, 'the store works headless');
  eq(blankStore.store.record('novice-05').perfect, true);
});

run();
