/* Share Game: shows the game's link (copy / native share sheet) and a QR code.
 * Needs the #nk-share markup (pwa-ui.html), a vendored qrcode-generator, and any button with the attribute data-pwa-share.
 * Optional config before this script loads:  window.PWA_SHARE = { qr: 'vendor/qrcode-generator-2.0.4/qrcode.js', url, title, text }.
 * Works offline: the link and QR are generated on the device from the app's own address. */
(function () {
  var cfg = window.PWA_SHARE || {};
  var QR_SRC = cfg.qr || 'vendor/qrcode-generator-2.0.4/qrcode.js';
  var $ = function (id) { return document.getElementById(id); };
  var qrPromise = null, lastFocus = null;

  function appTitle() { return cfg.title || document.title.replace(/\s+v[\d.]+$/, ''); }
  function appUrl() {                                   // the app's own address, without ?query or #hash
    if (cfg.url) return cfg.url;
    var u = new URL('./', location.href);
    u.search = ''; u.hash = '';
    return u.href;
  }
  function loadQR() {                                   // lazy: the library is only fetched when Share is first opened
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (!qrPromise) qrPromise = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = QR_SRC; s.onload = function () { window.qrcode ? res(window.qrcode) : rej(new Error('qrcode missing')); };
      s.onerror = function () { qrPromise = null; rej(new Error('qr load failed')); };
      document.head.appendChild(s);
    });
    return qrPromise;
  }
  function drawQR(canvas, text) {                       // dark modules on a white quiet zone, so any scanner can read it on a dark UI
    var qr = window.qrcode(0, 'M');
    qr.addData(text); qr.make();
    var n = qr.getModuleCount(), quiet = 4, total = n + quiet * 2;
    var css = 260, dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    var cell = Math.max(1, Math.floor(css * dpr / total)), px = cell * total;
    canvas.width = px; canvas.height = px;
    canvas.style.width = css + 'px'; canvas.style.height = css + 'px';
    var g = canvas.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, px, px);
    g.fillStyle = '#000000';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
  }
  function flash(btn, text) {
    var old = btn.dataset.label || btn.textContent;
    btn.dataset.label = old; btn.textContent = text;
    clearTimeout(btn._t); btn._t = setTimeout(function () { btn.textContent = old; }, 1800);
  }
  function copy(text, input, btn) {
    function fallback() {
      try { input.focus(); input.select(); input.setSelectionRange(0, text.length); flash(btn, document.execCommand('copy') ? 'COPIED!' : 'PRESS AND HOLD TO COPY'); }
      catch (e) { flash(btn, 'PRESS AND HOLD TO COPY'); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { flash(btn, 'COPIED!'); }, fallback);
    else fallback();
  }
  function close() {
    var box = $('nk-share'); if (!box) return;
    box.style.display = 'none';
    document.removeEventListener('keydown', onKey, true);
    try { lastFocus && lastFocus.focus(); } catch (e) {}
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }

  function open() {
    var box = $('nk-share'); if (!box) return;
    var url = appUrl(), input = $('nk-share-link'), msg = $('nk-share-qr-msg'), canvas = $('nk-share-qr');
    lastFocus = document.activeElement;
    input.value = url;
    msg.textContent = 'Preparing QR code...';
    canvas.style.visibility = 'hidden';
    box.style.display = 'flex';
    document.addEventListener('keydown', onKey, true);
    loadQR().then(function () { drawQR(canvas, url); canvas.style.visibility = ''; msg.textContent = 'Scan with a phone camera'; })
      .catch(function () { msg.textContent = 'QR code unavailable right now. The link still works.'; });
    var nat = $('nk-share-native'); nat.hidden = !navigator.share;
    $('nk-share-copy').onclick = function () { copy(url, input, $('nk-share-copy')); };
    nat.onclick = function () { navigator.share({ title: appTitle(), text: cfg.text || ('Play ' + appTitle()), url: url }).catch(function () {}); };
    $('nk-share-close').onclick = close;
    box.onclick = function (e) { if (e.target === box) close(); };
    input.onfocus = function () { try { input.select(); } catch (e) {} };
    try { $('nk-share-copy').focus(); } catch (e) {}
  }

  window.pwaShare = { open: open, close: close, url: appUrl };
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-pwa-share]');
    if (t) { e.preventDefault(); open(); }
  });
})();
