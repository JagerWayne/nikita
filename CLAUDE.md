# NIKITA // SHADOW OPS: working notes for Claude

Dependency-free HTML5 game: plain HTML, CSS and ES modules on a vendored Three.js. No build step, no bundler, no framework. Keep it that way.

## File layout

```
index.html          markup (HUD, menus, modals), the import map and <link>/<script> tags only. No inline CSS or JS.
css/                main.css -> hud.css -> overlays.css -> mobile.css (link order = cascade order; later files override)
js/main.js          entry module: checks Three.js can load, then dynamically imports js/game.js
js/game.js          NikitaGame: constructor, loop(), stepSimulation(), sector flow; mixes in the groups below
js/input.js level.js flight.js combat.js enemies.js lidar.js progress.js ui.js hud.js
                    NikitaGame prototype mixins: each exports `<name>Methods`, a plain object of methods
js/constants.js math.js hazards.js textures.js audio.js vfx.js autopilot.js    leaf modules (no NikitaGame knowledge)
js/pwa.js           CLASSIC script (not a module): service worker, install, update check, boot watchdog
js/boot/            classic scripts: version.js, files.js (cache manifest), sizes.js (generated), diagnostics.js, share-config.js
js/share.js         classic script: Share Game dialog
sw.js               service worker; app code (css/, js/) is network-first, everything else cache-first
vendor/             vendored libraries in version-named folders (three-0.187.0, qrcode-generator-2.0.4); documented in vendor/README.md
tools/              make-sizes.mjs, check-deps.mjs
```

The game must be served over HTTP (ES modules do not load from `file://`).

## Mixin rule: zero circular dependencies

- `NikitaGame` is declared only in `js/game.js`. The mixin files (`input`, `level`, `flight`, `combat`, `enemies`, `lidar`, `progress`, `ui`, `hud`) **never import `js/game.js`**, and never import each other.
- Mixins import only leaf modules (`constants`, `math`, `hazards`, `textures`, `audio`, `vfx`, `autopilot`) and `three`. Leaf modules never import mixins or `game.js`.
- Mixin methods use `this` for all state and for calling methods of other groups. A new method goes in the group that owns the behaviour; `game.js` throws at load if two groups define the same name.
- Shared per-frame scratch objects (`_v1`, `_e1`, ...) live in `js/math.js`. They are reused by everything: never keep a reference across calls or into a callback.
- Classic scripts (`pwa.js`, `boot/*`) and modules share only globals. `nkConfirm` and `NIKITA_VERSION` come from `pwa.js`; modules declare them with a `/* global ... */` comment.

## Physics determinism

- The simulation is a fixed step: `FIXED_DT = 1 / 60` in `js/constants.js`, driven by the accumulator in `loop()` and capped by `MAX_STEPS_PER_FRAME` (8). Never feed a variable frame time into `stepSimulation()` or anything it calls.
- Seeded sectors must play out identically on any refresh rate. Never use wall-clock time (`performance.now()`, `Date.now()`) or `rawDt` in simulation code.
- Simulation code already uses `Math.random()` (shot accuracy, recoil, lidar rays, debris). That is the same at every refresh rate but differs from run to run; do not add new uses. A seeded simulation RNG is future work.
- **Lidar is split.** `stepLidar(dt)` runs inside `stepSimulation()`: rays, the explore map (`xgrid`), scan %, thermal contacts and map hazards, from the missile's pose (`lidarSimOrigin()`) on `gameClock`. `updateLidar(rawDt)` runs per frame and is visual only (uniforms, GPU uploads, fades, badge). The render path (camera, HUD, radar) must never write simulation state such as `xgrid` or `thermalVis`.
- **Render interpolation is visual only.** `snapshotRenderPose()` runs at the start of each step and `updateRenderPose(alpha)` runs once per frame in `loop()`; both write only `this.prevPose` / `this.renderPose`. **Never write `missile.pos` (or other physics state) from the render path**, and never scale physics by `alpha`. The camera reads `renderPose`; the simulation reads `missile`.
- A change to simulation code is checked by stepping seeded sectors before and after and comparing positions: the numbers must match exactly.

## Autopilot rules

- Every tuning number is in `AUTOPILOT_TUNING` (`js/constants.js`). Change it there, not inline.
- Turret range and laser beam timing come from `js/hazards.js`. The game (`enemies.js`, `level.js`) and the autopilot both call it: never copy those formulas.
- The step path (`sense`, `steer`, `fire` and what they call) allocates no objects, arrays or closures: it fills structs made in the constructor and walks arrays with indexed loops (no `for...of`). `steer()` returns a reused struct: read it at once. Planning and the once-a-second `decide()` may allocate.
- The autopilot never detonates or changes game state from inside `steer()`: it sets a flag (`breachFire`) and `autoPlayTick()` acts on it at the start of the next step.
- Map colour (`LIDAR_MODE_COLORS`) is read in `updateLidar()` from `pilot.mission`: visual only.
- Check autopilot changes with seeded `autoPlay` runs at 60 and 120 Hz: the step-by-step trace must be identical.

## Mandatory release checklist (before every commit that changes the app)

1. Every new or renamed file under `css/` or `js/` (and any new static file) is listed in `js/boot/files.js`. Do not list `sw.js`.
2. Bump `APP_VERSION` in `js/boot/version.js`. It is the only version number and it names the offline cache; without a bump, installed copies keep the old files.
3. Run `node tools/make-sizes.mjs` after the last file change. It rewrites `js/boot/sizes.js` and fails if a listed file is missing.
4. Run `node tools/check-deps.mjs` (needs network). If a vendored library is outdated, upgrade it into a new `vendor/<name>-<version>/` folder and update `files.js`, the import map in `index.html` and `vendor/README.md`.
5. Add a short note to `README.md` for user-visible changes.

Commit `js/boot/sizes.js` together with the change. If an install gets stuck, the page accepts `?reset` to wipe its cache.
