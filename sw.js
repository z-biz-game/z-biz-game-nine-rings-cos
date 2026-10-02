// Offline shell for the browser build. Versioned cache name, and *network first* for every
// same-origin subresource: this game ships un-bundled ES modules by hand-edited filename, so
// a cache-first rule would pin js/core/solve.js to whatever the player got on day one and
// serve a new index.html on top of old rules — the ghost state where the numbers on screen
// stop matching the code that produced them.
//
// Registered only over http(s) from js/main.js; `file://` has no SW and no origin to scope
// to, so there nothing here ever runs.

const CACHE = 'rings-v1';
const CORE = ['./', './index.html', './css/game.css', './manifest.webmanifest'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(CACHE)
      // addAll rejects as a unit, and one unavailable core file must not cost the whole
      // install — each entry settles on its own and the promise still resolves.
      .then((cache) => Promise.all(CORE.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const CACHEABLE = /(text\/html|text\/css|text\/javascript|application\/javascript|application\/json|image\/png|image\/svg|image\/x-icon)/;

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch (err) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  ev.respondWith(networkFirst(req, url));
});

async function networkFirst(req, url) {
  let res = null;
  let netError = null;
  try {
    res = await fetch(req);
  } catch (err) {
    netError = err;
  }
  if (res && res.ok && CACHEABLE.test(res.headers.get('content-type') || '')) {
    const clone = res.clone();
    const cache = await caches.open(CACHE).catch(() => null);
    if (cache) await cache.put(req, clone).catch(() => {});
  }
  if (res) return res;
  const hit = await caches.match(req);
  if (hit) return hit;
  // A navigated-to level link (#/c/12) is still this page: answer it with the cached shell
  // so the hash route resolves and the solver rebuilds the position from js/core.
  if (netError && req.mode === 'navigate') {
    const page = await caches.match('./index.html');
    if (page) return page;
  }
  throw netError || new TypeError('offline and not cached: ' + url.pathname);
}
