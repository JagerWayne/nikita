/* Makes the app installable and playable offline. The install step reports byte progress to the page.
 * - The cache name comes from the version in this script's URL (sw.js?v=1.0), set by the page from APP_VERSION:
 *   a new release installs a fresh worker and cache, and `activate` deletes every older cache.
 * - The page is fetched network-first (never from the HTTP cache), falling back to the cached copy offline.
 * - The app's own code (css/, js/) is network-first and revalidated, so a new release never mixes with old files.
 * - Other static files (icons, manifest, images, vendor libraries) are cache-first. */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const PREFIX = 'nikita-';
const CACHE = PREFIX + VERSION;
importScripts('./js/boot/files.js', './js/boot/sizes.js');
const PRECACHE = ['./'].concat(self.APP_FILES || []);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const sizes = self.APP_SIZES || {};
    const FALLBACK = 50 * 1024;                               // guess for a file whose size is unknown
    const size = {};                                          // url -> expected bytes
    PRECACHE.forEach(u => { size[u] = sizes[u] || (u === './' ? sizes['index.html'] : 0) || FALLBACK; });
    let total = PRECACHE.reduce((n, u) => n + size[u], 0);
    let loaded = 0, files = 0, failed = 0, last = 0, timer = 0;
    const report = async (final) => {                         // tell every open page how far the download is
      const now = Date.now();
      if (!final && now - last < 100) {                       // at most ~10 messages a second, but never drop the latest value
        if (!timer) timer = setTimeout(() => { timer = 0; report(); }, 100 - (now - last));
        return;
      }
      last = now;
      const pages = await self.clients.matchAll({ includeUncontrolled: true });
      pages.forEach(p => p.postMessage({ type: 'progress', version: VERSION, loaded, total: Math.max(total, loaded), files, count: PRECACHE.length, failed, final: !!final }));
    };
    async function grab(url) {                                // download one file, counting bytes as they arrive
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (!res.ok) throw new Error(res.status);
      let got = 0;
      const parts = [];
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value); got += value.length; loaded += value.length;
          if (got > size[url]) { total += got - size[url]; size[url] = got; }   // size list was outdated: grow the total, never exceed 100%
          await report();
        }
      } else { const b = await res.blob(); parts.push(b); got = b.size; loaded += got; }
      if (got < size[url]) { total -= size[url] - got; size[url] = got; }       // file was smaller than listed: shrink the total
      await cache.put(url, new Response(new Blob(parts), { status: res.status, headers: res.headers }));
    }
    await report(false);
    const queue = PRECACHE.slice();
    // a few files at a time; one missing file must not block the install
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const url = queue.shift();
        try { await grab(url); } catch (e) { failed++; loaded += size[url]; }   // count it as "handled" so the bar still reaches 100%
        files++;
        await report();
      }
    }));
    await report(true);
    if (failed) throw new Error('precache incomplete');   // never install a half-downloaded version: the old one keeps running
    // No skipWaiting() here: the page decides when to switch (silently when it is already the new version, or when the player taps UPDATE NOW).
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))))
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
