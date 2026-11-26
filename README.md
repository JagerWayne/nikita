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

## Landing (v2.9–2.11)

- **LAND button (v2.11).** Speed alone no longer lands the rocket. Press LAND (G on a keyboard) to arm a landing: the engine eases down to about 8 m/s and the next gentle touch on a flat floor (nose no more than about 26 degrees down, sinking slower than 4 m/s) sets the rocket down. Press the button again to cancel; an armed landing also lapses after 14 s. A slow, gentle touch without an armed landing just skims the floor without damage. Ramps can never be landed on.
- **Landing indicator.** Under the flight panel: ▼ LAND AVAILABLE with your height when a flat floor is within 6 m, ▼ LANDING ARMED while armed (red ▼ TOO STEEP — LEVEL OFF if you are sinking too fast or diving), and ▣ LANDED · PRESS LIFT OFF once down.
- **Shafts (v2.11).** A shaft's slab and lintel now count as floor and roof once the rocket is inside the opening, so you can land in a shaft the same way. Take-off inside a shaft rises only as far as the roof allows and keeps the nose level.
- **On the ground.** The engine idles and keeps burning fuel (half the cruise burn; the EFF meter reads IDLE). You can turn on the spot and tilt the nose up to aim, and the gun still fires, so a landed rocket works as a quiet sniper post. An empty tank still self-destructs.
- **Touchdown (v2.10).** The rocket hops once or twice, dips its nose and then leans over onto one fin (the view tilts about 7 degrees). A harder touchdown shakes the view more.
- **Take-off.** Press LIFT OFF (the LAND button turns into it), or bring the lever to minimum once and then raise it past the bottom notch: the engine spools up for half a second (the view shakes, the fin levels), the rocket rises about 1.7 m off the floor while pitching its nose up, then pulls away and is airborne after about 1.4 s. Press the button again (or drop the lever when lifting off by lever) during the spool-up to abort.
- **Crashing.** Dropping onto the floor (sinking faster than 4 m/s), diving steeply into it, or hitting it with the engine out detonates the warhead. A fast, shallow skim still scrapes the hull (-22%) and bounces off as before.

## Collision markers and blast danger (v2.11)

- **Collision markers.** Four markers around the seeker ring read the gap between the hull and the wall on the left, the wall on the right, the roof above and the floor below, out to 12 m: green over 5.5 m, amber under that, red under 2.5 m. Inside a shaft, up and down read the shaft's own slab and lintel. Markers are hidden while nothing is in range.
- **Blast radius kills Nikita.** Every explosion whose radius reaches the rocket, with a clear line to it, sets off the warhead: fuel barrels (including chains and barrels shot by the gun), delayed blasts and so on. Walls between the blast and the rocket still protect it. This includes a landed rocket parked near a barrel.

## Rocket gun (v2.8)

- **Fire.** Hold GUN (bottom middle; E on a keyboard) to fire 9 rounds a second along the rocket's nose. Rounds fly about 70 units and stop at walls, floors and ceilings.
- **Damage.** Sentries take 3 hits, CIWS turrets 6, vent grates 2 and laser switches 2 (which turns the grid off). One round sets off a fuel barrel. Primary targets are armoured and need the warhead. Kills pay the normal points, multiplied by the rocket's speed when you shoot.
- **Noise.** Gunfire is loud: sentries hear it from at least 16 units. A sentry you hit but don't kill turns on you.
- **Ammo.** You start each sector with a full magazine of 50 rounds; the GUN MAGAZINE upgrade (rocket tab) raises it to 200 in 20 steps of 7.5, costing 120 to 1,710 credits per step. Ammo carries over between rockets in a sector. Yellow ammo crates (+30 rounds) lie in rooms on every floor: 5 to 12 per sector, plus 2 for each extra floor. The HUD shows ROUNDS next to ROCKETS.

## Multi-floor sectors (v2.4–2.7)

- **Floors.** From sector 16 (tier 4) the facility has 2 floors, and from sector 31 (tier 7) it has 3. Each floor is a full room-and-corridor level stacked on the one below. You always launch on the ground floor.
- **Ramps.** Two gentle ramps (about 17°, six cells long) join each pair of floors. Each runs in its own one-cell tube: the mouth is in a room on the lower floor, and a short straight run-out at the top opens into the floor above. Touching a ramp at a shallow angle lets the rocket ride up it with no hull damage; flying into it head-on still counts as an impact.
- **Atriums (v2.5).** Each upper floor has one hall-sized opening over a room below, making a double-height space. You can dive through it, climb up out of it, or shoot down into it.
- **Drop holes (v2.5).** Two or three 1- or 2-cell holes per upper floor drop to the floor below. Sentries never walk into them.
- **Lift (v2.5).** Every multi-floor sector has one 2x2 lift shaft open through all floors (⇕ on the radar, cyan corner beams in the lidar view). Inside it the rocket drifts at a quarter speed while the lift carries it: nose up goes up a floor, nose down goes down a floor, and nose level stops at the current floor. Each upper floor has a landing beside the shaft, so turn toward it before you leave.
- **Sentries change floors (v2.6).** Sentries plan a walking route over every floor, using the ramps. A sentry that hears you on another floor, or loses sight of you while alerted, walks over and up or down the ramps to find you; a cross-floor search lasts up to 20 s. Then it walks back to its own patrol. Alerted sentries now chase where the rocket was last heard instead of standing still. Floors are repaired so every room and ramp can be reached on foot, not only by flying over holes. Sentries never walk into holes or lifts.
- **Atrium turrets (v2.6).** A CIWS turret hangs from the ceiling over every atrium and covers both floors of the hall. It counts as a turret for points and the clear-all bonus.
- **Balance (v2.7).** Multi-floor sectors are bigger: the farthest target can be about 40% further to fly to. Fuel burns 13% slower with 2 floors and 23% slower with 3, giving 15% and 30% more range. The first time a rocket reaches each upper floor in a sector it earns 30 points (FLOOR n REACHED). Atrium turrets start at sector 21 (tier 5): one per sector until tier 7, then one over every atrium. Sector 16–20 is a gentle introduction with floors, ramps, holes and a lift, but no new turrets.
- **Openings on the map.** The edge of every hole, atrium and lift is drawn as a green rim line. Line of sight, heat and sound pass through openings, so sentries below can spot a rocket overhead. On the radar, openings are cyan outlines.
- **What is up there.** Primary targets, sentries and fuel barrels are spread across all floors. Lasers, turbines, grates, turrets, ECM zones, bulkheads, shafts and cracked walls stay on the ground floor for now.
- **Sensing across floors.** Lidar, thermal, lock-on, blasts, sentry sight, hearing and hostile fire are all 3D. Floors and ceilings block line of sight except where a ramp opens the slab. Sound passing through a slab is muffled like half a wall.
- **Lidar and memory.** Floors, walls, ceilings and ramps are mapped per floor. Ramps are outlined (side seams up the slope, foot, top and the lintel over the mouth), and the map memory keeps all floors. Maps saved by older versions are not reused.
- **Radar.** Shows every floor at once. The floor you are on is drawn at full strength, the others faded, and enemies on other floors are dimmed. Known ramps show as arrows pointing uphill, and the radar is labelled FLOOR n/N.

## Balance (v2.3)

- **Rockets.** 40 per sector; the rack holds 100 and up to 20 unspent rockets carry into the next sector. Rockets are earned only from points (5 rockets per 250 points), supply caches (+5) and medals (+1 each); the old per-kill rocket payouts are gone.
- **Points.** Primary target 150, CIWS turret 60, sentry 40, laser control box 35, cracked wall 25, vent grate 10, fuel barrel 5, power-up 20. Clear-all bonuses: targets 150, turrets 100, sentries 80, lasers 80, barrels and grates 20. Direct hit 50, 3-kill blast 40, 5-kill blast 120, no-alert sector 150, rank 0/40/80/160, medals 60 each. Kill points are multiplied by speed at impact (x0.75 slow, x2 at full speed, up to x3 with max-speed upgrades).
- **Credits.** Every point is a credit, but replaying a sector only pays for beating your previous best there.
- **Upgrade costs** grow about 28% per level (15% per max-speed step): rocket upgrades 200 to 1,840 per level, lidar and thermal 160 to 1,480, the 3-level perks 600 / 1,200 / 2,400, max speed 150 to 2,130. Buying everything costs about 98,000 credits.
- **Fuel.** Burn follows speed like drag: base x (0.5 + 0.5 x (speed / cruise speed)^2), plus up to 30% more while turning hard, so cruise gives the most distance per tank; full speed burns about 1.8x, minimum speed about 0.7x. Nothing burns in the launch drop. The FUEL readout shows seconds left at the current burn (amber when low, red under 8 s), and the EFFICIENCY meter shows distance per fuel compared with the best possible: ECO (90%+, green), OK (70%+, amber), WASTE (red), or COAST when the engine is not burning. About 42 s straight at cruise before upgrades. FUEL LOW warns at 20%; an empty tank cuts the engine and the warhead self-destructs 2.5 s later.

## Lidar view (v2.0)

The facility is seen only through the rocket's lidar. The screen is near-black green; a spinning scanner (rows of beams all around plus a dense forward focus cone) paints every surface it hits as green dots. Fresh dots flash, then settle into a dim memory; nearby dots are brighter and a sweep line circles the rocket. Cracked walls scan amber. Shafts are mapped in the same green as everything else: shafts are mapped gradually (v2.7.1): from a distance only the openings get their rectangle, and the tunnel's inside corners (and a closing rectangle at a dead end) are outlined a cell at a time as the scanner reaches within about 10 units and the floor and ceiling seams continue across its wall face. The view is always the nose camera (the third-person view is gone); the short orbit kill-cam after a target is destroyed stays.

- **Map memory.** Each sector remembers its dots. Retrying or replaying a sector starts with everything you scanned before; the last few sectors are also saved on the device and survive closing the app. A shattered cracked wall erases its old dots.
- **Thermal.** Sentries, targets, turrets, barrels, turbines, bulkheads, grates and laser emitters are drawn as heat (white-hot core to dark-red edge); laser beams are white-hot lines with a red-orange glow, and a disabled grid cools down. They only appear within thermal range and with a clear line of sight, and they fade in (dissolving into view) when detected and fade out when lost. Power-ups appear the same way.
- **Two scans.** The lidar maps walls (edges appear as breathing green lines where walls meet floors, ceilings and corners; surfaces as dots). The thermal scan finds enemies; the badge shows both ranges, and the radar draws the lidar range (green) and thermal range (red) around the rocket. You can only lock onto what thermal currently sees, and `[ ]` brackets mark visible sentries, CIWS turrets and laser control boxes (which can be locked too; flying into a laser box detonates the warhead and switches its grid off).
- **Radar.** The minimap shows only what you have scanned, plus target markers; enemies appear on it only while you can see them. The badge at the top right shows how much of the sector you have scanned.
- **Performance.** Up to 100,000 dots per sector. If frames get slow the scanner lowers its ray count automatically (AUTO-THROTTLED); low-spec mode halves it. The Blackout modifier now cuts lidar range by 40%, and ECM fields scramble the scanner.

### Thermal upgrades (THERMAL tab)

| Upgrade | Level 0 | Max | Cost per level |
| --- | --- | --- | --- |
| Thermal range | 18 units | 60 units (level 10) | 100 + 70 x level |
| Penetration (3 levels) | line of sight only | sees through 1 / 2 / 3 walls | 400 + 300 x level |
| Tracking | 15 degree seeker, 68-unit lock range | 25 degrees, 108 units (level 10) | 100 + 70 x level |
| Heat mark | off | contacts stay marked 5 s after leaving sight (level 10) | 100 + 70 x level |

**Delete saved data.** Title screen: DELETE SAVE (tap twice) erases credits, upgrades, preferences and every saved lidar map on this device.

**Scanner look.** A lidar wavefront pulses outward from the rocket every 1.6 s, lighting dots and edges as it passes, and a sweep line circles the rocket. Thermal objects carry camera scanlines and a scan band sweeping down the screen.

### Lidar upgrades (LIDAR tab of the upgrade screen)

| Upgrade | Level 0 | Level 10 | Cost per level |
| --- | --- | --- | --- |
| Range | 32 units | 80 units | 100 + 70 x level |
| Resolution | 600 rays per frame | 1,800 | 100 + 70 x level |
| Focus beam | 30% of rays in a 25 degree cone | 70% in a 45 degree cone | 100 + 70 x level |
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

**Shafts.** Slots with cyan rails cut through some walls. A shaft's opening is only a third of the wall height: the bottom, middle or top third (cyan squares on the radar). The rocket must be at the right height to fit; at the wrong height it hits the wall. A power-up floats inside every shaft. Most shafts go all the way through; some are dead ends: grab the power-up, then detonate at the end (there is no room to turn).

**Points.** Everything destroyable scores: primary targets 150, CIWS turrets 60, sentries 40, lasers 35, fuel barrels 10, vent grates 10, cracked walls 40, plus clear-all, direct-hit, combo, stealth, rank and medal bonuses. Kill points are multiplied by your speed at impact: x0.75 at minimum speed, about x1.2 at cruise, x2 at full speed. Every 250 points pays a package of 5 rockets (see Balance). Collecting a power-up is worth 30 points. The score carries from sector to sector and restarts with a new campaign; the HUD shows `score / next package`.

**Upgrades.** Every point you earn is also a credit. Spend credits on five rocket upgrades (saved on the device) from the title screen, the sector-clear screen, the mission-failed screen, or after EXIT TO MENU in the burger menu (it asks twice so a stray tap cannot throw away a sector).

| Upgrade | Effect | Levels |
| --- | --- | --- |
| Max speed | Starts at 20 m/s (x2 points at full speed) and rises by 0.5 per purchase to 30 m/s (x3 points); the speed lever's top end is your max speed | 20 |
| Fuel | Less fuel burned (-13% at level 1, over -50% at level 10) | 10 |
| Boost | Boost drains slower and recharges faster | 10 |
| Hull | Less damage from impacts, grates and laser relays | 10 |
| Explosion force | Bigger blast radius (+6% per level) | 10 |

**Laser grids.** The control box that shuts a laser grid down is on the left or the right end, chosen per grid.

**Flight.** There is no pitch limit: hold the stick up (or down) and the rocket keeps rotating, so loops are possible when there is room. The camera always stays upright and never banks; the rocket itself wobbles a little with speed and steering (more in the launch drop and with the engine out) and banks gently into turns (about 10 degrees at most), so the view shows both. After every rocket you press FIRE to launch the next one. While waiting on the pad, the stick (or keys, mouse or gyro) adjusts the launch angle, and the FIRE button shows the yaw and pitch. The rocket leaves the rail with cold thrusters, falls for about a third of a second, then the engine ignites.

The speed lever is locked at minimum while the rocket waits on the pad and works once it is launched.

**Title screen.** INITIATE LAUNCH sits in the middle; TARGETS & POINTS (what to attack, what each is worth, and why speed pays), CONTROLS and OPTIONS fold away (closed by default). The MENU button works at any time during a sector, including while the rocket waits on the pad. EXIT shuts the game down completely: it stops the game loop, silences audio, releases fullscreen and sensors, and closes the window. Browsers only let a page close itself in an installed app or a script-opened tab; elsewhere a "Game closed" screen replaces the game so you can close the tab.

## Mobile controls

| Control | Action |
| --- | --- |
| Left half (drag) | Floating flight stick (pitch and yaw) |
| Right half (drag) | Fine aim |
| LOCK | Lock the target highlighted in the 15 degree seeker cone. Laser switches (control boxes) lock within 3x the cone, up to 55 degrees off the nose, because they sit on the side walls. |
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

**Removed in v2.10:** the Flip & Burn button (key X).
