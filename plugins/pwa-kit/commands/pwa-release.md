---
description: Cut a release of this PWA: refresh file sizes, check libraries, bump APP_VERSION, verify, commit
argument-hint: "[new version, e.g. 1.4.0 | patch | minor]"
---

Release this PWA. Version argument: $ARGUMENTS (a number like `1.4.0`, or `patch`/`minor`/`major`; default `patch`).

1. Read `js/boot/version.js` and compute the new version (keep the project's existing scheme).
2. Make sure every new/renamed file is in `js/boot/files.js` (compare against what the page loads) and nothing listed is missing.
3. Run `node tools/check-deps.mjs` (if present); report outdated libraries and ask before upgrading across a major version.
4. Bump `APP_VERSION` in `js/boot/version.js` (the only number to change), then run `node tools/make-sizes.mjs`.
5. Run the verifier: `node <pwa-kit templates>/verify-pwa.mjs . --sub <repo>`; stop and fix on any FAIL.
6. Add a short entry to the README/CHANGELOG if the project keeps one.
7. Commit ("vX.Y.Z: <summary>") on the current branch. Push only if the user asked; remind them GitHub Pages deploys in about a minute and installed phones update on next launch (or via Check for updates).
