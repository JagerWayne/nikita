# pwa-kit

A Claude Code plugin that turns a static HTML app or game (hosted on GitHub Pages) into an installable, offline, self-updating Progressive Web App.

## Commands

| Command | What it does |
| --- | --- |
| `/pwa-kit:pwa [name] [--landscape\|--portrait\|--any] [--audit] [--no-title] [--silent-updates]` | Full conversion: manifest, proper icon, service worker, byte-based update progress bar, Check for updates, version display, title menu (New / Continue / Options / Exit), Delete save, forced landscape, install button, latest vendored libraries, docs, verification. Audits and fixes existing PWA pieces instead of duplicating them. |
| `/pwa-kit:pwa-check` | Read-only audit plus the headless-browser verifier. |
| `/pwa-kit:pwa-release` | Release flow: file list, library check, version bump, file sizes, verify, commit. |

## Install

```
/plugin marketplace add jagerwayne/nikita
/plugin install pwa-kit@jagerwayne-tools
```

(or `claude --plugin-dir ./plugins/pwa-kit` to try it locally). To publish it on its own, copy `plugins/pwa-kit` and `.claude-plugin/marketplace.json` into a new repository.

## templates/

Code the commands copy and adapt: `sw.js`, `pwa-client.js`, `pwa-ui.html`, `manifest.webmanifest`, `version.js`, `files.js`, `make-sizes.mjs`, `check-deps.mjs`, and `verify-pwa.mjs` (static checks, sub-folder serving, service worker, cache contents and offline reload in headless Chromium; needs Playwright).
