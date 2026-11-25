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

## Lidar view (v2.0)

The facility is seen only through the rocket's lidar. The screen is near-black green; a spinning scanner (rows of beams all around plus a dense forward focus cone) paints every surface it hits as green dots. Fresh dots flash, then settle into a dim memory; nearby dots are brighter and a sweep line circles the rocket. Cracked walls scan amber and shaft openings cyan. The view is always the nose camera (the third-person view is gone); the short orbit kill-cam after a target is destroyed stays.

- **Map memory.** Each sector remembers its dots. Retrying or replaying a sector starts with everything you scanned before; the last few sectors are also saved on the device and survive closing the app. A shattered cracked wall erases its old dots.
- **Thermal.** Sentries, targets, turrets, barrels, turbines, bulkheads, grates and laser emitters are drawn as heat (white-hot core to dark-red edge); laser beams are white-hot lines with a red-orange glow, and a disabled grid cools down. They only appear within thermal range and with a clear line of sight. Power-ups appear the same way.
- **Two scans.** The lidar maps walls (edges appear as breathing green lines where walls meet floors, ceilings and corners; surfaces as dots). The thermal scan finds enemies; the badge shows both ranges, and the radar draws the lidar range (green) and thermal range (red) around the rocket. You can only lock onto what thermal currently sees, and `[ ]` brackets mark visible sentries, CIWS turrets and laser control boxes (which can be locked too).
- **Radar.** The minimap shows only what you have scanned, plus target markers; enemies appear on it only while you can see them. The badge at the top right shows how much of the sector you have scanned.
- **Performance.** Up to 100,000 dots per sector. If frames get slow the scanner lowers its ray count automatically (AUTO-THROTTLED); low-spec mode halves it. The Blackout modifier now cuts lidar range by 40%, and ECM fields scramble the scanner.

### Lidar upgrades (LIDAR tab of the upgrade screen)

| Upgrade | Level 0 | Level 10 | Cost per level |
| --- | --- | --- | --- |
| Range | 32 units | 80 units | 100 + 70 x level |
| Resolution | 600 rays per frame | 1,800 | 100 + 70 x level |
| Focus beam | 30% of rays in a 25 degree cone | 70% in a 45 degree cone | 100 + 70 x level |
| Thermal | 18 units | 60 units, sees through one wall | 100 + 70 x level |
| Memory | 2 s glow, dim old dots, 3 sectors kept | 6 s glow, brighter old dots, 10 sectors | 100 + 70 x level |
| Deep scan (3 levels) | off | 1: cracked walls visible from afar (and on the radar); 2: secret chambers outlined and their power-ups shown; 3: shaft interiors and power-ups shown | 400 + 300 x level |

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

**Shafts.** Slots with cyan rails cut through some walls. A shaft's opening is only a third of the wall height: the bottom, middle or top third (cyan squares on the radar). The rocket must be at the right height to fit; at the wrong height it hits the wall. A power-up floats inside every shaft. Most shafts go all the way through; some are dead ends: grab the power-up, then flip and burn back out or detonate at the end.

**Points.** Everything destroyable scores: primary targets 150, CIWS turrets 60, sentries 40, lasers 35, fuel barrels 10, vent grates 10, cracked walls 40, plus clear-all, direct-hit, combo, stealth, rank and medal bonuses. Kill points are multiplied by your speed at impact: x0.75 at minimum speed, about x1.2 at cruise, x2 at full speed. Every 100 points pays a package of 10 rockets (outside the sector reward cap). Collecting a power-up is worth 30 points. The score carries from sector to sector and restarts with a new campaign; the HUD shows `score / next package`.

**Upgrades.** Every point you earn is also a credit. Spend credits on five rocket upgrades (saved on the device) from the title screen, the sector-clear screen, the mission-failed screen, or after EXIT TO MENU in the burger menu (it asks twice so a stray tap cannot throw away a sector).

| Upgrade | Effect | Levels |
| --- | --- | --- |
| Max speed | Starts at 20 m/s (x2 points at full speed) and rises by 0.5 per purchase to 30 m/s (x3 points); the speed lever's top end is your max speed | 20 |
| Fuel | Less fuel burned (-13% at level 1, over -50% at level 10) | 10 |
| Boost | Boost drains slower and recharges faster | 10 |
| Hull | Less damage from impacts, grates and laser relays | 10 |
| Explosion force | Bigger blast radius (+6% per level) | 10 |

**Laser grids.** The control box that shuts a laser grid down is on the left or the right end, chosen per grid.

**Flight.** There is no pitch limit: hold the stick up (or down) and the rocket keeps rotating, so loops are possible when there is room. The camera always stays upright and never banks. After every rocket you press FIRE to launch the next one. While waiting on the pad, the stick (or keys, mouse or gyro) adjusts the launch angle, and the FIRE button shows the yaw and pitch. The rocket leaves the rail with cold thrusters, falls for about a third of a second, then the engine ignites.

**Flip and burn.** The FLIP & BURN button (key `X`) fires two small attitude jets that backflip the rocket 180 degrees with the engine cut, then the engine burns hard to reverse course. Once per rocket. After the flip the controls stay exactly as before (stick left still turns left, stick up still looks up).

The speed lever is locked at minimum while the rocket waits on the pad and works once it is launched.

**Title screen.** INITIATE LAUNCH sits in the middle; CONTROLS and OPTIONS fold away (closed by default). EXIT shuts the game down completely: it stops the game loop, silences audio, releases fullscreen and sensors, and closes the window. Browsers only let a page close itself in an installed app or a script-opened tab; elsewhere a "Game closed" screen replaces the game so you can close the tab.

## Mobile controls

| Control | Action |
| --- | --- |
| Left half (drag) | Floating flight stick (pitch and yaw) |
| Right half (drag) | Fine aim |
| LOCK | Lock the target highlighted in the 15 degree seeker cone |
| HOLD DET (hold 0.3 s) | Manual warhead detonation |
| Speed lever (screen edge) | Analog throttle from minimum to maximum speed. Above cruise it drains the boost capacitor, which recharges below cruise |
| FIRE | Launches the rocket at the start of a sector |
| MENU | Pause sheet: gyro, invert pitch, haptics, low-spec mode, left-handed layout, button size and opacity, radar, sound |
| Radar (tap) | Enlarge or shrink the minimap |

Desktop: click to capture the mouse, `WASD` or arrows steer, `L` lock, `Shift`/`Space` boost, `Ctrl` brake, `Enter`/`Space` fire, `[` `]` fine throttle, `R` detonate, `1-3` speed, `Tab` radar, `~` developer overrides.

## Notes

- Preferences (left-handed layout, button size/opacity, low-spec mode) are stored in `localStorage`.
- Low-spec mode drops the CRT, blend-mode and blur overlays and renders at 1x resolution. The game suggests it if the frame rate stays low.
- Requires a browser with import-map support (iOS/Safari 16.4+, Chrome/Edge 89+, Firefox 108+).
