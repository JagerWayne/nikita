# NIKITA // SHADOW OPS

A 3D tactical guided-missile simulation for phones (and desktop). Fly a wire-guided Nikita warhead through 100 procedurally generated facility sectors, destroy the primary targets, avoid sentries, lasers, turbines, CIWS turrets, ECM fields and sliding bulkheads.

Single-file game (`index.html`) built on [Three.js](https://threejs.org/) r187, bundled in `vendor/three/` so the game has no external dependencies and works offline.

## Play

GitHub Pages: https://jagerwayne.github.io/nikita/

Use landscape. Gyro tilt flight needs HTTPS, which the Pages link provides.

## Install (v1.0)

The game is a PWA. Open the Pages link, then:

- **Android / Chrome, Edge:** tap INSTALL APP on the briefing screen (or the browser menu, Install app).
- **iPhone / iPad (Safari):** Share, Add to Home Screen.

It then launches full-screen from the home screen and works offline after the first load. Every launch checks for a new version and updates itself automatically.

**Releasing an update:**
1. Change the files.
2. Add any new static file to `js/boot/files.js`.
3. Bump `APP_VERSION` in `js/boot/version.js` (the only version number; it names the offline cache and the `sw.js?v=` URL).
4. Push to `main`.

Installed phones pick up the new version on the next launch. If an install ever gets stuck, open the page with `?reset` appended to wipe its cache.

## Stealth, rewards and secrets (v1.1)

**Hearing.** Sentries hear the rocket as well as see it. The hearing radius grows with the speed lever: about 6 units at minimum speed, 15 at cruise, 46 at full throttle. Walls muffle the sound, so a fast rocket is loud in open halls but quieter next door. Sentries see the rocket only within 14 units, in front of them and with a clear line. A sentry that hears you shows `?`, walks to the noise and looks around; a sentry that hears you at close range at top speed goes straight to alert `!`. An alerted sentry radios nearby guards. The dashed amber ring on the radar is your current noise radius.

**Rocket rewards.** Kills and shutdowns pay a few rockets (sentry +1, laser off +1, turret +2, primary target +2, plus small clear-all, combo, direct-hit, stealth and rank bonuses). Each sector caps rewards at `12 + 2 x tier`; the rack holds 100 rockets and up to 25 unspent rockets carry into the next sector.

**Cracked walls.** Orange cracked walls (amber squares on the radar) shatter when a warhead blows up next to them.
- **Shortcut:** opens a hidden tunnel that cuts across the facility.
- **Secret chamber:** a sealed pocket holding a power-up. Fly into it to collect it.

| Power-up | Effect |
| --- | --- |
| Supply cache | +8 rockets (outside the sector cap) |
| Boost cell | Full boost and unlimited boost for 8 s |
| Repair kit | Hull and fuel restored |
| Silent running | Engine noise and detection cut for 12 s |
| Overcharge | Next warhead blast is 1.6x bigger |

**Hostile fire.** Sentries and CIWS turrets aim true on only 50% of their shots; the rest are deliberate near-misses.

**Decoys.** DECOY (key `Q`) throws a noise-maker ahead of the rocket. For 7 seconds sentries within about 34 units walk over to investigate it instead of you. Two per sector; a decoy never raises an alert by itself.

**Sector modifiers.** From sector 4, some sectors carry one modifier, shown as `MOD:` on the HUD: Blackout (lights out), Low Fuel (60% faster burn), Keen Ears (sentries hear 50% farther) or Heavy Security (50% more sentries). A modified sector raises the reward cap by 4.

**Medals.** Optional challenges, +1 rocket each when you clear the sector: Sharpshooter (few rockets), Silent Hunter (never above 60% throttle), Speedrun (under par time) and Explorer (every secret chamber found).

**Daily seed.** The DAILY button on the briefing screen fills in today's shared facility seed.

**Laser grids.** The control box that shuts a laser grid down is on the left or the right end, chosen per grid.

**Flight.** There is no pitch limit: hold the stick up (or down) and the rocket keeps rotating, so loops are possible when there is room. The camera always stays upright and never banks. After every rocket you press FIRE to launch the next one. While waiting on the pad, the stick (or keys, mouse or gyro) adjusts the launch angle, and the FIRE button shows the yaw and pitch. The rocket leaves the rail with cold thrusters, falls for about two thirds of a second, then the engine ignites.

## Mobile controls

| Control | Action |
| --- | --- |
| Left half (drag) | Floating flight stick (pitch and yaw) |
| Right half (drag) | Fine aim |
| LOCK | Lock the target highlighted in the 15 degree seeker cone |
| HOLD DET (hold 0.3 s) | Manual warhead detonation |
| CAM | Nose-cam or chase-cam |
| Speed lever (screen edge) | Analog throttle from minimum to maximum speed. Above cruise it drains the boost capacitor, which recharges below cruise |
| FIRE | Launches the rocket at the start of a sector |
| MENU | Pause sheet: gyro, invert pitch, haptics, low-spec mode, left-handed layout, button size and opacity, radar, sound |
| Radar (tap) | Enlarge or shrink the minimap |

Desktop: click to capture the mouse, `WASD` or arrows steer, `L` lock, `Shift`/`Space` boost, `Ctrl` brake, `Enter`/`Space` fire, `[` `]` fine throttle, `E` camera, `R` detonate, `1-3` speed, `Tab` radar, `~` developer overrides.

## Notes

- Preferences (left-handed layout, button size/opacity, low-spec mode) are stored in `localStorage`.
- Low-spec mode drops the CRT, blend-mode and blur overlays and renders at 1x resolution. The game suggests it if the frame rate stays low.
- Requires a browser with import-map support (iOS/Safari 16.4+, Chrome/Edge 89+, Firefox 108+).
