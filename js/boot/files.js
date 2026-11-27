/* Every static file of the app, relative to index.html. Read by the service worker (importScripts) and the page. */
self.APP_FILES = [
  'index.html',
  'manifest.webmanifest',
  'css/main.css', 'css/hud.css', 'css/overlays.css', 'css/mobile.css',
  'js/boot/diagnostics.js',
  'js/boot/version.js',
  'js/boot/files.js',
  'js/boot/sizes.js',
  'js/boot/share-config.js',
  'js/share.js',
  'js/pwa.js',
  'js/main.js',
  'js/game.js',
  'js/constants.js', 'js/math.js', 'js/textures.js', 'js/audio.js', 'js/vfx.js', 'js/autopilot.js',
  'js/input.js', 'js/level.js', 'js/flight.js', 'js/combat.js', 'js/enemies.js', 'js/lidar.js', 'js/progress.js', 'js/ui.js', 'js/hud.js',
  'vendor/qrcode-generator-2.0.4/qrcode.js',
  'vendor/three-0.187.0/three.module.js',
  'vendor/three-0.187.0/three.core.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];
