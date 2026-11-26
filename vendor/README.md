# Vendored libraries

| Library | Version | Source | Licence |
| --- | --- | --- | --- |
| three | 0.187.0 | https://www.npmjs.com/package/three (build/three.module.js, build/three.core.js) | MIT (vendor/three-0.187.0/LICENSE) |
| qrcode-generator | 2.0.4 | https://www.npmjs.com/package/qrcode-generator (dist/qrcode.js) | MIT (vendor/qrcode-generator-2.0.4/LICENSE) |

Folder names carry the version, so upgrading is a new URL and the cache-first rule can never serve an old copy.
Check for newer releases with `node tools/check-deps.mjs`.
