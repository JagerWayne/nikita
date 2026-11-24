/* Every static file of the app, relative to index.html. Read by the service worker (importScripts) and the page. */
self.APP_FILES = [
  'index.html',
  'manifest.webmanifest',
  'js/boot/version.js',
  'js/boot/files.js',
  'vendor/three/three.module.js',
  'vendor/three/three.core.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];
