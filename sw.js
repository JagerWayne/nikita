/* NIKITA // SHADOW OPS service worker: makes the game installable and playable offline.
   Bump VERSION (and APP_VERSION in index.html) on every release: clients re-check this file on each launch
   and swap to the new version automatically. Everything the game needs is served from this origin. */
const VERSION = 'nikita-v1.0.2';
const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'vendor/three/three.module.js',
  'vendor/three/three.core.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Fetch around the HTTP cache so a release is never mixed with stale files.
    const results = await Promise.allSettled(CORE.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    // The page and the 3D engine are mandatory; a missing icon must not block the install.
    const mustHave = [0, 1, 7, 8];
    if (mustHave.some((i) => results[i].status === 'rejected')) throw new Error('precache failed');
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // never touch other origins

  // Page loads: network first (so updates arrive), but fall back to the cached page when the network
  // is offline or slower than 6 seconds.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const cached = (await cache.match('index.html')) || (await cache.match('./'));
      try {
        const res = await Promise.race([
          fetch(req),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), cached ? 6000 : 30000))
        ]);
        // A redirected response must never be stored or served for a navigation.
        if (res.ok && !res.redirected) { cache.put('index.html', res.clone()); return res; }
        return cached || res;
      } catch (_) {
        return cached || Response.error();
      }
    })());
    return;
  }

  // The 3D engine is versioned and immutable: cache first.
  if (url.pathname.includes('/vendor/')) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(VERSION)).put(req, res.clone());
      return res;
    })());
    return;
  }

  // Everything else: serve the cached copy at once and refresh it in the background.
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req);
    const refresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    return hit || (await refresh) || Response.error();
  })());
});
