---
description: Make this static HTML app/game an installable, offline, auto-updating PWA with a version display, Check for updates button and Delete save
argument-hint: "[app name] [optional: short description]"
---

Turn this web app into a Progressive Web App (PWA). Arguments (app name / description): $ARGUMENTS
If no name was given, take it from `<title>` or the README. If the app already has PWA pieces (manifest, `sw.js`, version file), **audit and fix them instead of duplicating**; keep what already works.

It must be installable on phones (home screen, full screen like a native app), work offline, and always update to the newest version without users clearing anything. It is hosted as static files on GitHub Pages, so there is no build step.

Work through sections 1-12 (including 5b, libraries) in order, then do the checks in section 13 and report each result as pass / fail / not testable here.

## 1. Ground rules
- Served over HTTPS (GitHub Pages); localhost works for testing.
- May live in a sub-folder (`https://user.github.io/my-app/`), so **every path is relative** (`./`, `icons/...`, `js/...`), never starting with `/`. File names are lowercase (the host is case-sensitive).
- Keep an empty `.nojekyll` file in the root so GitHub Pages serves everything as-is.
- Pick a unique cache prefix from the app's slug (e.g. `my-app-`). Two apps on one domain (`user.github.io`) must never share a prefix, or they delete each other's caches. Same for the save key (section 9).

## 2. Manifest (`manifest.webmanifest`, in the root)
```json
{
  "id": "./",
  "name": "My App",
  "short_name": "My App",
  "description": "One sentence about the app.",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "display_override": ["standalone"],
  "orientation": "any",
  "background_color": "#070b14",
  "theme_color": "#070b14",
  "categories": ["games", "entertainment"],
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```
- `id`, `start_url` and `scope` are `./` so it works from a sub-folder and the install identity stays stable.
- Use the app's real name, colours (background colour = loading-screen colour) and categories. Set `orientation` to `landscape` or `portrait` if the game only works in one.
- Icons: create the PNGs in `icons/`: `icon-192.png`, `icon-512.png`, **maskable** 192/512 (artwork inside the central 80% safe zone on a full-bleed background), and `apple-touch-icon.png` (180x180, no transparency). If the app has no artwork, generate icons from its logo/title/colours (Python Pillow, or Playwright rendering an SVG). Look at the result.

## 3. `<head>` of `index.html`
```html
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="My App" />
<meta name="theme-color" content="#070b14" />
<link rel="manifest" href="./manifest.webmanifest" />
<link rel="icon" type="image/png" href="./icons/icon-192.png" />
<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png" />
<title>My App</title>
```
- `viewport-fit=cover` + `black-translucent` draws under the notch. Pad the UI with `env(safe-area-inset-top/right/bottom/left)`.
- Games: also add `touch-action: none`/`manipulation` and `overscroll-behavior: none` on the play area so pull-to-refresh and double-tap zoom don't interfere.

## 4. One version number (`js/boot/version.js`)
```js
window.APP_VERSION = '1.0';   // bump for every release
```
Load it first (a classic `<script>` before the app). **This is the only number changed for a release.** It names the offline cache and the service worker URL, so each release replaces the old copy automatically. There is no second cache number anywhere.
- Show it clearly in the UI (section 8) and in `document.title`.

## 5. One list of files (`js/boot/files.js`)
```js
/* Every static file of the app, relative to index.html. Read by the service worker (importScripts) and the page. */
self.APP_FILES = [
  'index.html',
  'manifest.webmanifest',
  // ... every css, js, image, audio, font and data file the app needs offline ...
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];
```
- Uses `self.` so both the page and the service worker can read it. Every new or renamed file must be added.
- Scan the project and **verify the list is complete** (nothing the app loads is missing) and that every listed file exists. Do both with a small script and report any mismatch.
- If the app is one big `index.html` with inline CSS/JS, the list is just the page, manifest, icons and any vendor/asset files.

## 5b. Third-party libraries: latest versions, hosted locally
Find every external library the app uses (three.js, Phaser, Howler, matter.js, etc.: `<script src>`, `import ... from 'https://...'`, importmaps, CDN links) and make sure each one is **current and works offline**.
1. **Look up the real latest stable version at run time**; never rely on memory. Use `npm view <package> version` (or `curl https://registry.npmjs.org/<package>/latest`) and the library's release notes / migration guide. Skip pre-release tags (`alpha`, `beta`, `rc`, `next`).
2. **Compare with what the app uses** and list each library as: current version -> latest version. Upgrade anything outdated. For a major-version jump, read the migration guide and fix the breaking changes in the app's code. Examples for three.js: use ES modules via an importmap rather than the old removed `examples/js/` builds, and check renamed or removed APIs, colour-management defaults, and lighting units.
3. **Download the files into `vendor/`** (from the npm tarball or jsDelivr: `https://cdn.jsdelivr.net/npm/<pkg>@<exact-version>/...`) instead of loading from a CDN at runtime. A CDN link breaks offline play, and an unpinned `@latest` link can silently break the game later. Put the version in the file or folder name (e.g. `vendor/three-0.XXX.0/three.module.min.js`) so a new version is a new URL and the cache-first rule can never serve an old copy. Include the library's licence file/notice. Add only the files actually imported (e.g. three's `examples/jsm/` add-ons used, not the whole package).
4. **Add every vendor file to `APP_FILES`** and reference it with a relative path. Add a short `vendor/README.md` listing each library, exact version, source URL and licence.
5. **Make staleness visible:** add `tools/check-deps.mjs` (or `.sh`) that reads the versions in `vendor/README.md`, queries the npm registry, and prints which libraries are behind. Mention in the README's release steps to run it before each release. Do not make the app call the registry at runtime.
6. **Test after upgrading:** run the app in Playwright, fail on any console error or warning about deprecated or removed APIs, and take a screenshot of the main screen/game to confirm it renders. If an upgrade cannot be made to work, keep the old version and report why; do not leave the app broken.
7. Also drop libraries the app no longer uses, and prefer built-in browser APIs over a dependency where trivial.

## 6. Service worker (`sw.js`, in the root next to `index.html`)
```js
/* Installable + offline.
 * - Cache name comes from the version in this script's URL (sw.js?v=1.0), set by the page from APP_VERSION:
 *   a new release installs a fresh worker and cache; `activate` deletes every older cache.
 * - The page is network-first (never from the HTTP cache), falling back to the cached copy offline.
 * - The app's own code (css/, js/) is network-first and revalidated, so a release never mixes old and new files.
 * - Everything else static (icons, manifest, images, audio, vendor libs) is cache-first. */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const PREFIX = 'my-app-';
const CACHE = PREFIX + VERSION;
importScripts('./js/boot/files.js');
const PRECACHE = ['./'].concat(self.APP_FILES || []);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const total = PRECACHE.length;
    let done = 0, failed = 0;
    const report = async (final) => {                         // tell every open page how far the download is
      const pages = await self.clients.matchAll({ includeUncontrolled: true });
      pages.forEach(p => p.postMessage({ type: 'progress', version: VERSION, done, total, failed, final: !!final }));
    };
    await report();
    // fresh copies (skip the HTTP cache), in parallel; one missing file must not block the install
    await Promise.all(PRECACHE.map(url =>
      cache.add(new Request(url, { cache: 'reload' }))
        .catch(() => { failed++; })
        .then(() => { done++; return report(); })
    ));
    await report(true);
    // NOTE: no skipWaiting() here, see "update flow" below
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
  if (url.origin !== self.location.origin) return;          // other sites go straight to the network

  if (req.mode === 'navigate') {                             // the page: network first, offline copy as fallback
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('index.html', copy)).catch(() => {}); return res; })
        .catch(() => caches.match('index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  if (/\.(css|js)$/.test(url.pathname) && !/\/vendor\//.test(url.pathname)) {   // the app's own code: network first, revalidated
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
```
- **Update flow (important):** the install step does *not* call `skipWaiting()`. A new worker waits until the player chooses "Update now" (section 7), so an update never swaps files out from under a game in progress. The page sends `'skipWaiting'` on that tap. (If the user prefers silent instant updates, call `self.skipWaiting()` at the end of `install` instead and say so in the report.)
- Change `PREFIX` to this app's unique prefix (the same one used in section 7). The worker must sit in the root so its scope covers the whole app.
- Adjust the `css/js` network-first rule to the app's real layout (if the code is inline in `index.html`, it is already covered by the navigate rule).

## 7. Startup script: register the worker + update checking
Put this in the app's startup code, called once after the first screen shows (so it doesn't slow first paint). Use the same `PREFIX` as `sw.js`.
```js
const PWA = { prefix: 'my-app-', reg: null, waiting: null };

function refreshOfflineCache() {
  const V = window.APP_VERSION, CACHE = PWA.prefix + V;
  try {
    if (window.caches) {
      caches.keys().then(keys => Promise.all(keys.filter(k => k.indexOf(PWA.prefix) === 0 && k !== CACHE).map(k => caches.delete(k)))).catch(() => {});
      caches.open(CACHE).then(c => {
        (self.APP_FILES || []).filter(u => u.indexOf('vendor/') !== 0).forEach(u => {
          fetch(u, { cache: 'reload' }).then(r => { if (r.ok) c.put(u, r); }).catch(() => {});
        });
      }).catch(() => {});
    }
  } catch (e) {}
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js?v=' + encodeURIComponent(V), { updateViaCache: 'none' })
      .then(reg => {
        PWA.reg = reg;
        if (reg.waiting && navigator.serviceWorker.controller) onUpdateReady(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w && w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) onUpdateReady(w);
          });
        });
        reg.update().catch(() => {});
      }).catch(() => {});
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {   // new worker took over -> load the new files
      if (reloading) return; reloading = true; location.reload();
    });
  }
}

function onUpdateReady(worker) {            // a newer version is downloaded and waiting
  PWA.waiting = worker;
  showUpdateBanner();                       // small non-blocking bar: "New version ready" [Update now] [Later]
}
function applyUpdate() {
  if (PWA.waiting) { setProgress(100, 'Installing...'); PWA.waiting.postMessage('skipWaiting'); }   // files are already downloaded
  else location.reload();
}

/* ---- progress bar: the new worker reports how many files it has downloaded ---- */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => {
    const d = e.data;
    if (!d || d.type !== 'progress') return;
    const pct = d.total ? Math.round(d.done / d.total * 100) : 0;
    setProgress(pct, 'Updating to v' + d.version + '... ' + pct + '% (' + d.done + '/' + d.total + ' files)');
    if (d.final && d.failed) setUpdateStatus(d.failed + ' file(s) could not be downloaded. Check your connection and try again.');
  });
}
/* setProgress(pct, text): shows/updates the bar (see "Progress bar UI" below); hides it when pct is null. */

/* Install a specific release from the current page: register its worker, watch the download, then switch to it. */
async function installVersion(v) {
  setProgress(0, 'Updating to v' + v + '... 0%');
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) { location.reload(); return; }
  const reg = await navigator.serviceWorker.register('sw.js?v=' + encodeURIComponent(v), { updateViaCache: 'none' });
  const w = reg.installing || reg.waiting;
  if (!w) { location.reload(); return; }
  const go = () => { setProgress(100, 'Installing...'); w.postMessage('skipWaiting'); };   // then `controllerchange` reloads
  if (w.state === 'installed') go();
  else w.addEventListener('statechange', () => { if (w.state === 'installed') go(); if (w.state === 'redundant') setProgress(null); });
}
```

### Progress bar UI (required, shown for every update)
- A bar with a **percentage and a file count** ("Updating to v1.3... 42% (20/48 files)") that fills from 0 to 100%. Use a `<progress>`-style element or a div with `width: X%` and `role="progressbar"` + `aria-valuenow`; animate smoothly; make it large enough to read on a phone (>= 12 px tall).
- Show it in a modal layer over the whole app (not only inside Settings) so it is visible whether the update was started from the banner, the Check for updates button or a silent check. Block input during the final "Installing..." step; keep a **Cancel** only before the download starts.
- It reflects **every file in `APP_FILES`** (the count comes from the worker), so 100% means everything is cached and the app can run fully offline.
- On finish: show 100% for a moment, then reload into the new version. On failure (`failed > 0`, offline, worker `redundant`): hide the bar, keep the old version running, show the error and a **Retry** button. Never reload into a half-downloaded version.
- Also use the same bar on the very first visit ("Downloading for offline play... 63%") so the player knows when offline mode is ready, but do not block the app then; show it as a small non-blocking strip.

### Check for updates (button)
Because the version lives in the worker's URL, the *only* reliable way to see if a newer release exists is to ask the server for the latest `js/boot/version.js` (bypassing every cache) and compare it with the running `APP_VERSION`. Do exactly that, as well as `reg.update()`:
```js
async function checkForUpdates() {
  setUpdateStatus('Checking...');                       // disable the button while running
  if (!navigator.onLine) { setUpdateStatus('You are offline. Connect to the internet and try again.'); return; }
  try {
    const res = await fetch('js/boot/version.js?_=' + Date.now(), { cache: 'no-store' });
    const m = (await res.text()).match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
    const latest = m && m[1];
    if (!latest) throw new Error('no version');
    if (latest === window.APP_VERSION) { setUpdateStatus('You have the latest version (v' + window.APP_VERSION + ').'); return; }
    setUpdateStatus('Version v' + latest + ' is available.');
    // The worker URL contains the version, so reg.update() alone never finds a new release.
    // Register sw.js?v=<latest> from here: it downloads every file (progress bar), then takes over and the page reloads.
    await installVersion(latest);
  } catch (e) { setUpdateStatus('Could not check for updates. Try again later.'); }
}
```
- Compare versions as strings for equality. "Different" means update (also covers a rollback). Never show a stale "up to date".
- Also run a **silent check** on app start and whenever the tab becomes visible again (`visibilitychange`, max once per 30 minutes). If a newer version exists, show the banner. Show it only between games / on a menu screen if the app is a game.
- States to show in the UI: *Checking...*, *Up to date (vX)*, *Update available -> Update now*, *Offline*, *Error*.
- Make sure the old cache is not served after the update: after the reload only `PREFIX + newVersion` may remain.

## 8. Version display + Settings/About panel
Add (or extend) a Settings / About panel reachable from the main menu, containing:
- **Version:** clearly visible text, e.g. `Version 1.0`, always read from `window.APP_VERSION` (never hard-coded a second time). Also show a small `v1.0` in a corner of the title/menu screen. Optionally append a "Running offline copy" or "Installed app" tag (`display-mode: standalone`).
- **Check for updates** button (section 7) with its status line underneath; tapping "Update now" shows the percentage progress bar (section 7).
- **Install app** button (section 10), hidden unless installable; iOS hint if applicable.
- **Delete save data** (section 9), if the app saves anything.
- Make buttons at least 44x44 px and legible on phones; respect the safe-area insets.

## 9. Delete save data (only if the app stores anything)
1. **Find every piece of persisted data**: grep for `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, and `caches` used as data. List the keys found and what each holds (progress, settings, high scores...).
2. If nothing is stored, **skip this section and say so in the report**; don't add a dead button.
3. If anything is stored, give each key the app's unique prefix (e.g. `my-app.save`, `my-app.prefs`). If existing keys must stay as they are, keep them, and keep one list `SAVE_KEYS = [...]` in one place.
4. Add a **Delete save data** button in the Settings panel (styled as dangerous: red, set apart from the other buttons):
   - Opens an in-app confirm dialog (not `window.confirm`; it is ugly or blocked in some standalone PWAs) saying exactly what is deleted ("Your progress, scores and settings on this device. This cannot be undone.") with **Cancel** (default focus) and **Delete**.
   - On Delete, remove only the app's own keys (never `localStorage.clear()`, since other apps on the same `user.github.io` origin share it), clear IndexedDB databases the app created, reset the in-memory state, then reload or return to the start screen, and show a "Save deleted" toast.
   - It must **not** unregister the service worker or delete the offline cache (the app must keep working offline). Offer a separate small "Reset app & re-download files" action only if useful: it clears the `PREFIX*` caches, unregisters the worker, and reloads.
5. Optional but recommended: **Export / Import save** (download and upload a `.json` file) so players can back up before deleting or move between devices. Validate imported data before applying it.

## 10. Install button (Android / Chrome / Edge) + iOS hint
```html
<div id="row-install" hidden><button id="btn-install">📲 Install app</button></div>
```
```js
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById('row-install').hidden = false;
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  document.getElementById('row-install').hidden = true;
  showToast('📲 Installed! Find My App on your home screen.');
});
document.getElementById('btn-install').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  try { await deferredInstallPrompt.userChoice; } catch {}
  deferredInstallPrompt = null;
  document.getElementById('row-install').hidden = true;
});
```
- iPhone/iPad Safari never fires `beforeinstallprompt`. There, show a hint instead when on iOS and not already installed: "Tap Share, then *Add to Home Screen*".
  - iOS: `/iphone|ipad|ipod/i.test(navigator.userAgent)` (also treat `navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1` as iPadOS).
  - Installed: `navigator.standalone === true || matchMedia('(display-mode: standalone)').matches` (hide the install UI then).

## 11. Offline & reliability extras
- Show a small "Offline" indicator (listen to `online`/`offline` events). Disable only features that truly need the network.
- Request persistent storage so the browser won't evict saves: `navigator.storage && navigator.storage.persist && navigator.storage.persist()` (after the user's first interaction).
- Audio / video / large assets: precache what the first play needs; lazily cache the rest (the cache-first rule already stores them as they are fetched). Mention any file larger than a few MB in the report.
- Wrap all storage / cache / service-worker calls in `try/catch`; the app must still run in private mode and on `file://` (just without offline).
- Add a **README "Releasing"** section with the 4 steps below.

## 12. Releasing an update (document in README)
1. Change the files.
2. Add any new file to `js/boot/files.js`. Run `tools/check-deps` and upgrade outdated libraries in `vendor/` (new versioned file name, update `APP_FILES` and `vendor/README.md`).
3. Bump `APP_VERSION` (the only number to change).
4. Commit and push; GitHub Pages deploys in about 1 minute.

Installed phones pick up the new version on the next launch (or immediately via **Check for updates**). Offline, they keep the last copy. Never bump a cache name by hand anywhere else. Optionally add a one-line `CHANGELOG` shown under the version in About ("What's new in this version").

## 13. Verify (do all of these and report each result honestly)
Use the pre-installed Playwright + Chromium and a local static server (`python3 -m http.server`). State what you could not test (real phones).
- **Manifest:** loads, name/icons (incl. maskable) resolve, no errors; every icon file exists and has the declared size.
- **Files list:** every entry in `APP_FILES` exists, and nothing the page loads is missing from it.
- **Libraries:** none loaded from a CDN or unpinned URL (grep for `cdn.`, `unpkg`, `@latest`); each vendored library is the latest stable at the time (show the version table from section 5b); `tools/check-deps` runs and reports nothing outdated; no console errors with the upgraded versions.
- **Service worker:** `sw.js?v=<version>` activates; Cache Storage has exactly one `<prefix><version>` cache holding every file in `APP_FILES`.
- **Offline test:** load once, go offline (`context.setOffline(true)`), reload: the app starts and plays.
- **Update test:** bump the version -> reload -> new worker waits, banner appears, "Update now" activates it; old cache deleted, only the new one remains; the UI shows the new version.
- **Progress bar:** during an update (and the first-visit download) the bar goes 0 -> 100% monotonically, the file count matches `APP_FILES.length` (+1 for `./`), it is visible on a phone-size viewport (390x844), and an offline/failed download (block one file with `page.route`) hides the bar, shows Retry and does not reload. Screenshot it mid-way (throttle the network or delay responses so the intermediate state can be captured).
- **Check for updates button:** shows "latest" when equal, "available" when the server version differs (simulate by changing `version.js`), and "offline" when offline.
- **Version display:** the Settings/About text and the corner label equal `APP_VERSION`.
- **Delete save:** create a save, press Delete -> Cancel keeps it, Delete wipes only the app's keys (add a foreign key first to prove it survives), the app resets cleanly, and offline still works afterwards.
- **Sub-folder test:** serve from one level up and open `/my-app/`; everything loads (no `/`-rooted paths; grep the project for `href="/`, `src="/`, `url(/`, `fetch('/`).
- **Lighthouse (PWA / installability)** if available: installable, no manifest/service-worker warnings.
- **Real devices (tell me to test, don't claim):**
  - Android Chrome: install button appears, installs, icon is cropped correctly, app opens full screen, Check for updates works after pushing a new version.
  - iPhone Safari: Share -> Add to Home Screen gives the right icon and name and opens full screen; the iOS hint shows only before install.

Finish with a short summary: files added/changed, the unique cache prefix and save-key prefix chosen, what was skipped (and why), anything that failed, and the "Releasing" steps.
