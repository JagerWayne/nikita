/* Makes the app installable and playable offline.
 * - The cache name comes from the version in this script's URL (sw.js?v=1.0), set by the page from APP_VERSION:
 *   a new release installs a fresh worker and cache, and `activate` deletes every older cache.
 * - The page is fetched network-first (never from the HTTP cache), falling back to the cached copy offline.
 * - The app's own code (css/, js/) is network-first and revalidated, so a new release never mixes with old files.
 * - Other static files (icons, manifest, images, vendor libraries) are cache-first. */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `nikita-${VERSION}`;
importScripts('./js/boot/files.js');
const PRECACHE = ['./'].concat(self.APP_FILES || []);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // fresh copies (skip the HTTP cache), one by one, so one missing file can't block the install
      .then(cache => Promise.all(PRECACHE.map(url => cache.add(new Request(url, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('nikita-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
  if (event.data === 'version' && event.source) event.source.postMessage({ version: VERSION });
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // other sites (CDNs, APIs) go straight to the network

  if (req.mode === 'navigate') {                             // the page: network first, offline copy as fallback
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('index.html', copy)).catch(() => {}); return res; })
        .catch(() => caches.match('index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  if (/\/(css|js)\/[^/]+(\/[^/]+)*\.(css|js)$/.test(url.pathname)) {   // the app's own code: network first, revalidated
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); } return res; })
        .catch(() => caches.match(req).then(r => r || Response.error()))
    );
    return;
  }

  event.respondWith(                                         // everything else: cache first, then network (and keep it)
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
      return res;
    }))
  );
});
