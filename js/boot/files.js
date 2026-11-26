/* Every static file of the app, relative to index.html. Read by the service worker (importScripts) and the page. */
self.APP_FILES = [
  'index.html',
  'manifest.webmanifest',
  'js/boot/version.js',
  'js/boot/files.js',
  'js/boot/sizes.js',
  'js/share.js',
  'vendor/qrcode-generator-2.0.4/qrcode.js',
  'vendor/three-0.187.0/three.module.js',
  'vendor/three-0.187.0/three.core.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];
