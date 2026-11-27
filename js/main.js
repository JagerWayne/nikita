/* Entry point (loaded by index.html as a module): checks that the vendored Three.js can be loaded (import map),
 * shows a readable message when it cannot, and only then loads and starts the game modules (js/game.js and what it imports). */

try {
  await import('three');
} catch (err) {
  const noImportMap = !(window.HTMLScriptElement && HTMLScriptElement.supports && HTMLScriptElement.supports('importmap'));
  const t = document.getElementById('offline-title');
  const p = document.getElementById('offline-msg');
  if (noImportMap) {
    t.textContent = '[!] BROWSER TOO OLD';
    p.textContent = 'This game needs a newer browser (import-map support: iOS / Safari 16.4+, Chrome or Edge 89+, Firefox 108+). Please update your browser and reload.';
  } else if (navigator.onLine === false) {
    t.textContent = '[!] YOU ARE OFFLINE';
    p.textContent = 'The 3D engine could not be loaded from the app cache. Connect to a network once and reload.';
  } else {
    t.textContent = '[!] 3D ENGINE BLOCKED';
    p.textContent = 'The Three.js 3D engine could not be loaded. Check your connection and reload; if it persists, clear the app data and reopen it.';
  }
  document.getElementById('offline-banner').style.display = 'flex';
  throw err;
}

const { NikitaGame } = await import('./game.js');
window.__nikitaOps = new NikitaGame();
