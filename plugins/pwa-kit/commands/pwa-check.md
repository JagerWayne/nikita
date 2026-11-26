---
description: Audit (and optionally verify in a headless browser) the PWA setup of this static app without changing anything
argument-hint: "[subfolder name used for the sub-folder test]"
---

Audit the PWA status of this project. Change nothing unless the user asks afterwards.

1. Find the templates folder (`${CLAUDE_PLUGIN_ROOT}/templates`, or Glob `**/pwa-kit/templates/verify-pwa.mjs`).
2. Run `node <templates>/verify-pwa.mjs . --sub ${ARGUMENTS:-app}` from the project root and show the PASS/FAIL table.
3. Read `sw.js`, `js/boot/*.js`, the manifest and the update code and compare with the pwa-kit rules (`/pwa-kit:pwa` sections 1-5): no `skipWaiting()` in `install`, byte progress, throws on incomplete precache, version only in `version.js`, Check for updates present and comparing against the server's `version.js`, delete save keyed to the app's own keys, vendored libraries with versions in the path, unique cache prefix, landscape handling.
4. Run `node tools/check-deps.mjs` if it exists (outdated libraries).
5. Report: pass / fail / missing per item, the 3 most valuable fixes first, and offer to run `/pwa-kit:pwa` to apply them.
