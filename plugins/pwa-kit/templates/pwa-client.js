/* PWA client: install progress, update check, silent/explicit update, offline badge, in-app confirm.
 * Paste into the app's startup script (after js/boot/version.js and the markup in pwa-ui.html).
 * Replace __PREFIX__ with the cache prefix used in sw.js. Needs: window.APP_VERSION, self.APP_FILES (optional),
 * buttons #btn-update (+ #update-status text), optional #app-version.  Game hook: window.pwaIsOnMenu(). */
const APP_VER = window.APP_VERSION || '?';
{ const el = document.getElementById('app-version'); if (el) el.textContent = 'v' + APP_VER; }   // every place that shows the version reads APP_VERSION
document.title = document.title.replace(/ v[\d.]+$/, '') + ' v' + APP_VER;

const PWA = { prefix: '__PREFIX__', reloadOnSwap: false, mode: null, target: null, failed: 0, hideTimer: 0 };
const $nk = (id) => document.getElementById(id);

/* In-app confirm dialog (window.confirm is ugly or blocked in installed apps). Resolves true / false; CANCEL has the focus. */
function nkConfirm(title, text, okLabel) {
  return new Promise((resolve) => {
    const box = $nk('nk-confirm'), ok = $nk('nk-confirm-ok'), cancel = $nk('nk-confirm-cancel');
    $nk('nk-confirm-title').textContent = title;
    $nk('nk-confirm-text').textContent = text;
    ok.textContent = okLabel || 'OK';
    box.style.display = 'flex';
    const done = (v) => { box.style.display = 'none'; ok.onclick = cancel.onclick = null; document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } };
    document.addEventListener('keydown', onKey, true);
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
    cancel.focus();
  });
}

/* Progress bar. pct = 0..100, or null to hide. Updates by the player are a modal over the whole app;
   the first download (offline readiness) is a small non-blocking strip. */
function formatBytes(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
function setProgress(pct, text) {
  clearTimeout(PWA.hideTimer);
  const modal = $nk('nk-progress'), strip = $nk('nk-strip');
  if (pct === null) { modal.style.display = 'none'; strip.style.display = 'none'; PWA.mode = null; return; }
  const box = PWA.mode === 'strip' ? strip : modal;
  box.style.display = PWA.mode === 'strip' ? 'block' : 'flex';
  box.querySelector('.pbar i').style.width = pct + '%';
  box.querySelector('.pbar').setAttribute('aria-valuenow', String(pct));
  (PWA.mode === 'strip' ? $nk('nk-strip-text') : $nk('nk-progress-text')).textContent = text || '';
  if (PWA.mode !== 'strip') { $nk('nk-progress-retry').style.display = 'none'; $nk('nk-progress-close').style.display = 'none'; }
}
function progressFailed(text) {            // keep the old version running, offer Retry
  if (PWA.mode !== 'modal') { setProgress(null); return; }
  $nk('nk-progress-text').textContent = text;
  const r = $nk('nk-progress-retry'), c = $nk('nk-progress-close');
  r.style.display = c.style.display = '';
  r.onclick = () => installVersion(PWA.target);
  c.onclick = () => setProgress(null);
}

/* Offline copy + service worker. The version is in the worker's URL, so every release installs a fresh worker
   and cache. A worker for the version this page already runs swaps in silently; a newer one waits for UPDATE NOW. */
function workerVersion(w) { try { return new URL(w.scriptURL).searchParams.get('v'); } catch (_) { return null; } }
function watchWorker(w) {
  const check = () => { if (w.state === 'installed' && navigator.serviceWorker.controller) onUpdateReady(w); };
  w.addEventListener('statechange', check);
  check();
}
function onUpdateReady(w) {
  if (workerVersion(w) === APP_VER) { w.postMessage('skipWaiting'); return; }   // this page is already the new version: no reload
  whenOnMenu(() => showUpdateBanner(workerVersion(w), () => { PWA.reloadOnSwap = true; setProgress(100, 'Installing...'); w.postMessage('skipWaiting'); }));
}
function whenOnMenu(fn) {                  // never interrupt a flight: wait until the title screen is showing
  // Define window.pwaIsOnMenu = () => boolean in the game (true on the title screen / between games).
  if (typeof window.pwaIsOnMenu !== 'function' || window.pwaIsOnMenu()) fn(); else setTimeout(() => whenOnMenu(fn), 3000);
}
function showUpdateBanner(ver, onTap) {
  if ($nk('nk-update')) return;
  const bar = document.createElement('button');
  bar.id = 'nk-update';
  bar.textContent = 'NEW VERSION ' + (ver || '') + ' — TAP TO UPDATE';
  bar.style.cssText = 'position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:99999;padding:10px 16px;font:bold 12px monospace;letter-spacing:.08em;background:#00ff88;color:#02120a;border:0;border-radius:6px;box-shadow:0 0 14px rgba(0,255,136,.6)';
  bar.addEventListener('click', () => { bar.remove(); onTap(); });
  document.body.appendChild(bar);
}
// Hard fallback when no service worker is available: wipe caches and load the new copy.
async function hardReload(ver) {
  try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((g) => g.unregister())); } catch (_) {}
  try { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); } catch (_) {}
  location.replace(location.pathname + '?u=' + encodeURIComponent(ver));
}
/* Install a specific release from this page: register its worker, show the byte progress while every file
   downloads, then switch to it (the page reloads once it has taken over). */
async function installVersion(v) {
  PWA.target = v; PWA.failed = 0; PWA.mode = 'modal'; PWA.reloadOnSwap = true;
  setProgress(0, 'Updating to v' + v + '... 0%');
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) { hardReload(v); return; }
  try {
    const reg = await navigator.serviceWorker.register('sw.js?v=' + encodeURIComponent(v), { updateViaCache: 'none' });
    const w = reg.installing || reg.waiting;
    if (!w) { hardReload(v); return; }
    const go = () => { setProgress(100, 'Installing...'); w.postMessage('skipWaiting'); };   // `controllerchange` then reloads
    w.addEventListener('statechange', () => {
      if (w.state === 'installed') { if (PWA.failed) progressFailed('Some files could not be downloaded. Check your connection and retry.'); else go(); }
      if (w.state === 'redundant') progressFailed(navigator.onLine ? 'The update could not be installed. Please retry.' : 'You are offline. Connect to the internet and retry.');
    });
    if (w.state === 'installed') go();
  } catch (e) { progressFailed('Could not start the update. Check your connection and retry.'); }
}

function refreshOfflineCache() {
  const CACHE = PWA.prefix + APP_VER;
  try {
    if (window.caches) {
      // a new release: drop older caches and re-download the app's own files into the current one
      caches.keys().then((keys) => Promise.all(keys.filter((k) => k.indexOf(PWA.prefix) === 0 && k !== CACHE).map((k) => caches.delete(k)))).catch(() => {});
    }
  } catch (e) {}
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.addEventListener('message', (e) => {   // the worker reports BYTES downloaded
      const d = e.data;
      if (!d || d.type !== 'progress') return;
      if (!PWA.mode) { if (!navigator.serviceWorker.controller) PWA.mode = 'strip'; else return; }   // silent background refresh: no UI
      const pct = d.final ? 100 : Math.min(99, Math.floor(d.loaded / Math.max(1, d.total) * 100));
      PWA.failed = d.failed;
      if (PWA.mode === 'strip') {
        setProgress(pct, (d.final ? 'Ready for offline play' : 'Downloading for offline play... ' + pct + '%') + ' (' + formatBytes(d.loaded) + ' / ' + formatBytes(d.total) + ')');
        if (d.final) PWA.hideTimer = setTimeout(() => setProgress(null), 2500);
      } else if (!d.final) {
        setProgress(pct, 'Updating to v' + d.version + '... ' + pct + '% (' + formatBytes(d.loaded) + ' / ' + formatBytes(d.total) + ')');
      }
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {   // a new worker took over: load its files (only when the player asked)
      if (PWA.reloadOnSwap && !PWA.reloading) { PWA.reloading = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js?v=' + encodeURIComponent(APP_VER), { updateViaCache: 'none' })
      .then((reg) => {
        if (reg.waiting) watchWorker(reg.waiting);
        reg.addEventListener('updatefound', () => { if (reg.installing) watchWorker(reg.installing); });
        reg.update().catch(() => {});
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      }).catch(() => {});
  }
}
window.addEventListener('load', () => setTimeout(refreshOfflineCache, 1500));

// Update check: ask the server which version is current (cache-busted). Returns { ok, latest, newer }.
async function fetchLatestVersion() {
  try {
    const r = await fetch('js/boot/version.js?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return { ok: false };
    const m = /APP_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(await r.text());
    if (!m) return { ok: false };
    return { ok: true, latest: m[1], newer: m[1] !== APP_VER };
  } catch (_) { return { ok: false }; }
}
// Silent stale-copy guard (on start and when the app comes back to the foreground, at most every 30 minutes).
let lastUpdateCheck = 0;
async function checkForNewVersion() {
  if (!/^https?:$/.test(location.protocol) || !navigator.onLine || $nk('nk-update')) return;
  if (Date.now() - lastUpdateCheck < 30 * 60 * 1000) return;
  lastUpdateCheck = Date.now();
  const v = await fetchLatestVersion();
  if (!v.ok || !v.newer) return;
  whenOnMenu(() => showUpdateBanner('v' + v.latest, () => installVersion(v.latest)));
}
// Options-screen button
(() => {
  const btn = $nk('btn-update'), msg = $nk('update-status');
  if (!btn || !msg) return;
  let pending = null;
  const say = (t) => { msg.textContent = t; msg.style.display = 'block'; };
  btn.addEventListener('click', async () => {
    if (pending) { installVersion(pending); return; }
    btn.textContent = 'CHECKING…'; btn.disabled = true;
    const v = await fetchLatestVersion();
    btn.disabled = false;
    if (!v.ok) { btn.textContent = 'CHECK FOR UPDATES'; say(navigator.onLine ? 'Could not reach the server. Try again in a moment.' : 'You are offline. Connect to the internet and try again.'); return; }
    if (v.newer) { pending = v.latest; btn.textContent = 'UPDATE TO v' + v.latest; say('New version v' + v.latest + ' is available (you have v' + APP_VER + '). Tap the button to update.'); }
    else { btn.textContent = 'CHECK FOR UPDATES'; say('You have the latest version (v' + APP_VER + ').'); }
  });
})();
window.addEventListener('load', () => setTimeout(checkForNewVersion, 2500));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForNewVersion(); });

// Offline badge + ask the browser to keep the saved game (persistent storage), after the first tap
(() => {
  const badge = $nk('nk-offline');
  const sync = () => { badge.style.display = navigator.onLine ? 'none' : 'block'; };
  window.addEventListener('online', sync); window.addEventListener('offline', sync); sync();
  const ask = () => { try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (_) {} };
  window.addEventListener('pointerdown', ask, { once: true });
})();

