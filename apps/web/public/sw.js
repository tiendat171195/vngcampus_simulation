// Service worker of the game (docs/04 §9): files with a content hash in their name never change,
// so they are served from the cache after the first visit and the daily visit starts almost at
// once. Pages go to the network first and fall back to the last copy. Nothing under /api, /rt or
// /admin is touched: sessions, live state and the admin always come from the server.
const ASSETS = 'campus-assets-v1';
const PAGES = 'campus-pages-v1';
const KEEP = [ASSETS, PAGES];
/** Hashed files kept at most; older deploys' files are dropped first. */
const MAX_ASSETS = 120;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !KEEP.includes(key)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const request of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)))
    await cache.delete(request);
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    await trim(cache);
  }
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(PAGES);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put('/', response.clone());
    return response;
  } catch (error) {
    const copy = await cache.match('/');
    if (copy) return copy;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (path.startsWith('/api/') || path.startsWith('/rt/') || path.startsWith('/admin')) return;
  if (path.startsWith('/assets/')) event.respondWith(cacheFirst(request));
  else if (request.mode === 'navigate') event.respondWith(networkFirst(request));
});
