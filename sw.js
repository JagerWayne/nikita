/* NIKITA // SHADOW OPS service worker: makes the game installable and playable offline.
   Bump VERSION (and APP_VERSION in index.html) on every release: clients re-check this file on each launch
   and swap to the new version automatically. */
const VERSION = 'nikita-v1.0';
const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(CORE);
    // Best effort (max 4s, never blocks install): also cache the Three.js build the page imports,
    // so the very first offline launch works.
    const cacheThree = (async () => {
      try {
        const html = await (await fetch('index.html', { cache: 'no-cache' })).text();
        const m = html.match(/https:\/\/unpkg\.com\/three@[\d.]+\/build\/three\.module\.js/);
        if (m) {
          const core = m[0].replace('three.module.js', 'three.core.js');
          await Promise.all([m[0], core].map((u) => cache.add(u).catch(() => {})));
        }
      } catch (_) { /* offline install: runtime caching will fill in later */ }
    })();
    await Promise.race([cacheThree, new Promise((r) => setTimeout(r, 4000))]);
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

  // Page loads: network first (so updates arrive), cached copy when offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put('index.html', res.clone());
        return res;
      } catch (_) {
        return (await caches.match('index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Versioned Three.js files never change: cache first.
  if (url.hostname === 'unpkg.com') {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(VERSION)).put(req, res.clone());
      return res;
    })());
    return;
  }

  // Own files: serve the cached copy immediately and refresh it in the background.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(req);
      const refresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
      return hit || (await refresh) || Response.error();
    })());
  }
});
