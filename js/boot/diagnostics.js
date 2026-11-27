/* Boot diagnostics: remember anything that goes wrong while the page starts, so it can be shown on screen. */
window.__bootErrors = [];
window.addEventListener('error', function (e) {
  var t = e.target;
  if (t && t !== window && (t.src || t.href)) window.__bootErrors.push('failed to load: ' + (t.src || t.href).split('/').slice(-2).join('/'));
  else window.__bootErrors.push((e.message || 'error') + (e.filename ? ' @' + e.filename.split('/').pop() + ':' + e.lineno : ''));
}, true);
window.addEventListener('unhandledrejection', function (e) {
  window.__bootErrors.push('promise: ' + ((e.reason && e.reason.message) || e.reason));
});
