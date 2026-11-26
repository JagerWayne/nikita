/* Every static file of the app, relative to index.html. Read by the service worker (importScripts) and the page. */
self.APP_FILES = [
  'index.html',
  'manifest.webmanifest',
  'js/boot/version.js',
  'js/boot/files.js',
  'js/boot/sizes.js',
  // ... every css, js, image, audio, font and data file the app needs offline ...
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];
