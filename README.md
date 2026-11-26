# NIKITA // SHADOW OPS

A 3D tactical guided-missile simulation for phones (and desktop). Fly a wire-guided Nikita warhead through 100 procedurally generated facility sectors, destroy the primary targets, avoid sentries, lasers, turbines, CIWS turrets, ECM fields and sliding bulkheads.

Single-file game (`index.html`) built on [Three.js](https://threejs.org/) r187, bundled in `vendor/three-0.187.0/` so the game has no external dependencies and works offline.

## Play

GitHub Pages: https://jagerwayne.github.io/nikita/

Use landscape. Gyro tilt flight needs HTTPS, which the Pages link provides.

## Install (v1.0)

The game is a PWA. Open the Pages link, then:

- **Android / Chrome, Edge:** tap INSTALL APP on the briefing screen (or the browser menu, Install app).
- **iPhone / iPad (Safari):** Share, Add to Home Screen.

It then launches full-screen from the home screen and works offline after the first load. Every launch checks for a new version and updates itself automatically.

**Title menu (v2.18):** the first screen shows the icon, the game name, the version and NEW / CONTINUE / OPTIONS / EXIT. NEW deletes everything saved (after a confirm): level reached, credits, upgrades, best scores, scan maps and the autopilot's explored map, and always starts at sector 1 (settings are kept; v2.22); CONTINUE resumes the saved sector with your credits and upgrades (greyed out when nothing is saved); OPTIONS holds gyro, seed, start sector, upgrades, install, CHECK FOR UPDATES and DELETE SAVE; EXIT autosaves, stops the game and closes the app (browsers only allow closing an installed app window, otherwise a THANKS FOR PLAYING screen appears). The phone's back button pauses the game instead of leaving it. Forced landscape: the manifest says landscape, the game locks the orientation when it can, and a ROTATE DEVICE overlay covers portrait.

**Intro call and sharing (v2.18).** Starting a NEW game opens a short radio call from Meryl (your handler): eliminate every primary target and destroy as much as you can. Tap or press Enter to advance, SKIP / Escape to cut it short; OPTIONS has REPLAY INTRO CALL. SHARE GAME on the title screen shows the game's link (COPY LINK, or SHARE... to open the phone's share sheet) and a QR code that opens the game; it works offline. The QR code library is vendored in `vendor/qrcode-generator-2.0.4/`.

**Updates (v2.17):** OPTIONS has a CHECK FOR UPDATES button (it reports whether you are on the latest version and turns into UPDATE TO vX when a newer one exists), and a green NEW VERSION banner appears on the title screen when a phone shows an older copy. Updating shows a byte-based progress bar (percentage and MB downloaded) while every file is cached, then reloads into the new version. A half-downloaded update is never installed: the old version keeps running and you can retry. The first visit shows a small "Downloading for offline play" strip.

**Releasing an update:**
1. Change the files.
2. Add any new static file to `js/boot/files.js`, then run `node tools/make-sizes.mjs` (writes `js/boot/sizes.js`, the file sizes behind the progress bar) and `node tools/check-deps.mjs` (is a vendored library behind? upgrade it into a new `vendor/<name>-<version>/` folder and update `files.js`, the import map and `vendor/README.md`).
3. Bump `APP_VERSION` in `js/boot/version.js` (the only version number; it names the offline cache and the `sw.js?v=` URL).
4. Push to `main`.

Installed phones pick up the new version on the next launch. If an install ever gets stuck, open the page with `?reset` appended to wipe its cache.

## Landing from hover and new physics (v2.19)

- **No LAND button.** Land from a hover: hover, then hold the stick down (S) onto a flat floor and the rocket touches down (dust puff, a thud, the nose bobs). On the ground the HOVER button (H) lifts off straight into a hover (dust blows out during the spool-up); raising the lever still lifts off into forward flight. The G key is gone. Ramps and the lift shaft still cannot be landed on.
- **Braking dip.** Slowing down tips the nose forward on a springy pitch: a lever pull-back dips it a little, and engaging HOVER at speed brakes hard (retro-jet puffs ahead of the nose, an air-brake whoosh, a shudder, the field of view pulls in) and dips it up to about 15 degrees before it bobs back and settles.
- **Wall bumps.** A gentle bump in hover (and every glancing deflection) rebounds a little, knocks the nose and roll away from the surface, spins the hull off the wall and throws sparks, shake and a thud.
- **Also new.** Hard turns at speed rumble the view; below 14% fuel the engine coughs now and then (speed dip, nose drop, shudder).
- **Lidar resolution upgrade.** Besides more rays (600 to 1,800) and scan rows (8 to 24), it now makes the lidar dots bigger (up to 1.6 times).

## Landing (v2.9–2.11)

- **LAND button (v2.11, VTOL since v2.14).** Press LAND (G on a keyboard) and the rocket brakes to a hover, levels its nose and settles straight down onto the floor like a VTOL, then lands by itself. Press the button again to cancel; a landing also lapses after 24 s. Ramps and the lift shaft cannot be landed on (the landing cancels). A slow, gentle touch without a landing request just skims the floor without damage.
- **No landing banner.** The LAND button itself shows the state: LAND, CANCEL while a landing is in progress, LIFT OFF once down and ABORT during lift-off. The feed still reports touchdown and cancellations.
- **Shafts (v2.11).** A shaft's slab and lintel now count as floor and roof once the rocket is inside the opening, so you can land in a shaft the same way. Take-off inside a shaft rises only as far as the roof allows and keeps the nose level.
- **On the ground.** The engine idles and keeps burning fuel (half the cruise burn; the EFF meter reads IDLE). You can turn on the spot and tilt the nose up to aim, and the gun still fires, so a landed rocket works as a quiet sniper post. An empty tank still self-destructs.
- **Touchdown (v2.10).** The rocket hops once or twice, dips its nose and then leans over onto one fin (the view tilts about 7 degrees). A harder touchdown shakes the view more.
- **Take-off.** Press LIFT OFF (the LAND button turns into it), or bring the lever to minimum once and then raise it past the bottom notch: the engine spools up for half a second (the view shakes, the fin levels), the rocket rises about 1.7 m off the floor while pitching its nose up, then pulls away and is airborne after about 1.4 s. Press the button again (or drop the lever when lifting off by lever) during the spool-up to abort.
- **Crashing.** Dropping onto the floor (sinking faster than 4 m/s), diving steeply into it, or hitting it with the engine out detonates the warhead. A fast, shallow skim still scrapes the hull (-22%) and bounces off as before.

## Hover (v2.15)

- **HOVER button (H on a keyboard).** Toggles hover mode in flight (lift off first). The lever drops to 0 so the rocket stops and holds its place; there is no gravity sag. The stick (or W/S) now climbs and descends at up to 2.6 m/s while the nose stays level, left/right (A/D) rotate on the spot, and the lever runs from 0 to 4 m/s (the readout shows tenths) along the heading. Press again to return to forward flight at your previous lever setting.
- **Gentle contact.** While hovering below about 5.5 m/s, touching a wall, floor or roof just stops you against it with no damage. Hover is quiet to sentries, uses no boost, and burns 30% more fuel than idle flight. The LAND button still works from hover (it settles straight down). The engine sound holds a steady lift note.

## Autopilot rewrite (v2.24+)

The autopilot is being rewritten from scratch in layers, one release per step: 1) flight telemetry, 2) waypoint planning (A* over explored tiles, smoothed legs) and guidance (look-ahead pursuit, measured braking), 3) target acquisition and fire control (bracketed contacts, tracking, lead, lock-on warhead runs), 4) mission planner, 5) tuning and removal of the old code. Until step 2 lands the previous autopilot keeps flying.

- **Step 1 (v2.24): telemetry.** Every frame the new `Autopilot` class takes one snapshot of the flight: position, tile and floor, velocity (horizontal / vertical), acceleration, heading, pitch, yaw rate, height above the floor and room to the ceiling, side / up / down probes and a forward clearance fan (-60 to +60 degrees, up to 30 m), the measured braking and turning limits (strongest deceleration and fastest yaw rate actually seen) with the stopping distance at the current speed, fuel, burn rate and range left (now and at cruise speed), hull, ammo, rockets, and the bracketed contacts with distance, bearing and threat flag. DEV OVERRIDE (~) has "Autopilot Debug (telemetry)" to show it as a live panel.

- **Step 2 (v2.25): waypoints and guidance (beta).** DEV OVERRIDE has "New Autopilot (beta)". It plans with A* over explored tiles only (diagonal moves without cutting corners; extra cost next to walls and hazards; ramp links between floors; live lasers, turbines, bulkheads and primary targets are no-go, fuel barrels and grates only cost extra), heads for the nearest frontier tile (explored, touching unexplored) preferring what lies ahead of the nose, and string-pulls the tile route into a few straight legs; each waypoint carries a target altitude and a speed limit from the turn it makes (tunnel mouths and ramps are always kept). Guidance chases a look-ahead point on the legs (further ahead the faster it flies) with heading and altitude PD control, flies at cruise speed and brakes early enough for every coming waypoint using the braking it has actually measured, also limited by the free distance ahead, and pushes off side walls. It replans when the goal gets explored on the way, a hazard appears on the route, or it is stuck. A 360 scan happens only where several unexplored tiles are still around. With the explore-map overlay on, the smoothed legs (white) and the look-ahead point (cyan) are drawn too. In the beta the previous gunner still fires, and once nothing reachable is left to explore the previous autopilot takes over to hunt. Tested: abc 86% and seed 7 72% scanned after 2.5 minutes (previous autopilot: 61%, about 65%).

- **Step 3 (v2.26): target acquisition and fire control (beta).** The new autopilot engages every enemy and laser switch box that wears the [ ] brackets. Each bracketed contact becomes a track (position, smoothed velocity, frames in view); a lock is confirmed after 6 frames. Targets are ranked: CIWS turrets, alerted sentries, sentries, laser switch boxes (a box whose grid blocks the way first), then by distance and how far it has to turn, sticking with the current target. It leads moving sentries (bullet time of flight at 120 m/s plus its own speed), matches the target's height (the gun fires level from the nose), slows right down while engaging, and fires only when the predicted miss is inside the target's hit area, with a clear line and no fuel barrel near the line of fire close enough for its blast to reach the rocket. Bursts are sized to the hits the target needs; a few rounds are kept for threats; a target not killed in 6 s is left alone for 20 s. When only live laser grids block the rest of the map it flies to a spot from where thermal sees the grid's switch box, faces it and shoots it, then carries on exploring. Fixes in the planner: costs are now exact (a rounding error dropped parts of the map from the search), turbines only block the tiles their blades sweep, a brief failure to find a goal (right after launch, between floors) no longer ends exploring, and after a hand-over it keeps re-checking for new frontier every 5 s. Tested on sectors 8, 12 and 16: 57%, 56% and 41% scanned after 2.5 minutes with 4, 10 and 6 kills at about 3 rounds a kill, laser grids switched off by shooting their boxes.

- **Step 4 (v2.27): mission planner, lock-on hunting, laser gates. The new autopilot is now the default** (DEV OVERRIDE "New Autopilot" off = the previous one). Once a second it decides the mission: EXPLORE until nothing reachable is left (or the scan reads 100%, or rockets / hull run low), PICKUP for a seen, useful pickup close by (rockets, overcharge, ammo when low, repair when hurt or short of fuel), then HUNT: a route to a tile next to the nearest primary target, a turn until the target sits inside the seeker cone, the game's lock-on, and homing flies the warhead into the proximity fuze (the button shows EXPLORE / PICKUP / HUNT). Laser grids are no longer walls but timed gates: the pilot predicts every beam from the game clock (pulse gates' off phase, sweeping beams' positions, the twin sweep's gap), holds about 3 m before the beam line at a safe crossing height, and dashes across at 7 m/s only when the whole crossing window is clear; it still shoots a grid's switch box when thermal sees it. Tested on sectors 8, 12 and 14: 78%, 88% and 91% scanned after 4 minutes with 6, 12 and 13 kills, 2-4 grid crossings each and no laser hits; sector 1 (seed 7) went from exploring to a pickup to a lock-on warhead run and cleared the sector by itself.

- **Step 5 (v2.28): tuning, the old code removed, the explore map is the map.** The previous autopilot is gone (only the new one remains, no Dev Override switch). Obstacle avoidance: fuel barrels (they blow up on contact within about 1.5 m), sentries and primary targets ahead make it climb over them where the room allows, slow down until it is high enough, and steer aside (a barrel blast next to a primary target used to end a sector early). Multi-floor: drop holes and atriums link a tile with the one below, the route stops over the hole and climbs or descends before moving on (the lift is avoided: it takes over the rocket's height), so upper floors get explored. **The radar's old base map is replaced by the explore map**: the map in the corner is now always the explore map (floors stacked, the current one at 100% and the others at 5%; walls, floor, ramps, shafts, holes and lifts, hazards, cracked walls, the route and the autopilot's legs), with the radar's live overlays on top (primary targets, visible enemies, decoys, ECM fields, the noise ring, lidar and thermal ranges, the rocket and its heading). Benchmark after 4 minutes: sector 1 cleared by itself at about 2 minutes (87-91% scanned, lock-on warhead run), sector 8 87%, sector 12 82%, sector 16 (2 floors) 78% with the upper floor explored, no laser hits.

## Full autopilot (v2.20)

The AUTO button (V on a keyboard) is now a full autopilot that plays the sector for you. Press it in the READY state and it launches the rocket itself; press it in flight and it takes over. It re-engages after every launch and relaunches after a lost rocket, an engine-out or a kill, until the sector is cleared, you run out of rockets, or you press AUTO again. Moving the stick takes over at once.

- **Exploring, room by room (v2.21).** It moves to the middle of the room it is in, turns a full 360 degrees so the lidar sweeps every wall, then heads for the nearest opening the scan could not see past (a doorway or the continuation of a corridor) and scans again there. In narrow corridors it skips the spin (the all-around lidar rays already cover both walls). Rooms already scanned are remembered for the whole sector, so every new rocket continues where the last one stopped instead of starting over, and spots it had to give up are retried once before it decides the map is done. It plans routes over every floor (ramps included) and avoids turbines, bulkheads, live lasers, barrels and grates. The button shows EXPLORE, PICKUP or HUNT.
- **Explore map (v2.23).** Exploring is driven by a plotted map: one cell per map tile (64 x 64), one layer per floor, filled only from what the lidar has actually reached. Values: 0 unexplored, 1 solid, 2 / 3 / 4 shaft top / mid / bottom, 5 explored open floor, 6 ramp, 7 hole or lift, 8 hazard (turbine, bulkhead, live laser, barrel, grate), 9 the planned route (the fastest vector to the chosen part of the map), 10 cracked wall. The autopilot routes only over explored tiles, heads for the nearest explored tile that touches unexplored ones (preferring what lies ahead of the nose, so it does not turn around for nothing), flies at cruise speed in transit (the most economical thrust: the most distance per fuel) and stays on the middle line of corridors. It only stops for a 360 scan where several unexplored tiles are still around. The map is saved per sector on the device and cleared by NEW.
- **Explore map display (v2.23, the main map since v2.28).** The map in the corner shows the explore map: walls grey, open floor dark green, ramps green, shafts cyan, holes and lifts violet, hazards red, cracked walls amber, the route yellow, Nikita white with a heading line. Floors are stacked: the current floor at 100%, the others at 5%. In the console, `__nikitaOps.xmapDump()` prints the current floor as digits (10 as X).
- **Explored map remembered, straight to the next unexplored part (v2.22).** After every respawn the autopilot keeps the map it explored and flies directly (fast) to the nearest unexplored area instead of scanning the launch bay again; everything it passes in plain view counts as explored too. The explored map is saved on the device (with the lidar map, which is now saved at every respawn and when the app goes to the background), so it also survives closing the app and Continue. Relaunch and take-over are quicker.
- **Exploration over killing (v2.22).** Only real threats (CIWS turrets, alerted sentries) make it turn, stop and fight; anything else bracketed is shot only when it happens to be lined up, without slowing down. After a room scan it waits only for threats still in sight (up to 5 s). No primary target is hunted until the reachable map is explored.
- **Speed.** It sets its own speed from the straight stretch of its route and the free distance ahead: up to 16 m/s in transit to a far room or while hunting, 7 m/s close to the next scan spot, slowing for turns, tunnel mouths and walls. A flight burns about 2% fuel a second at any speed, so faster means farther.
- **Targets.** The primary targets wait until the whole reachable map is explored (or the scan reads 100%, rockets are nearly gone, the hull is badly hurt), because destroying the last one ends the sector. It runs straight at a target once it sees it and lets the proximity fuze go off; on autopilot the fuze ignores everything except the primary target it is hunting.
- **Gunner: brackets only.** It only shoots what wears the [ ] brackets: sentries and CIWS turrets that thermal currently sees, and laser control boxes. It turns toward the target, matches its height and holds the trigger while aligned; it gives up on one it cannot hit after 7 s and keeps a few rounds in reserve. Barrels, grates and primary targets are never shot.
- **Laser box brackets (fix).** A laser control box used to get its [ ] brackets from up to 95 m away with any clear line of sight. It is now bracketed (and can be locked or shot) only when thermal itself sees the box, inside thermal range, like sentries and turrets.
- **Pickups.** It detours for rocket caches, overcharge, ammo (when low) and repair kits (when hurt) if it has fuel to spare.
- **Scan 100%.** The scan counts every edge in the sector, including secret chambers behind cracked walls (they must be breached, or seen with Deep scan) and the inside of tunnels. Each rocket also starts from the launch bay with about 45 s of fuel, so far corners take several rockets. The autopilot keeps going until nothing reachable is left; sealed chambers may keep it below 100%.
- **Landing.** The autopilot never lands. The old AUTO-DISCOVERY is part of it (it explores whenever it is not hunting or picking something up).

## Auto discovery and hover physics (v2.16)

- **AUTO button (V on a keyboard).** From flight, the rocket switches to hover and flies itself around the facility, floor by floor and up and down the ramps, visiting the places next to every edge the scanner has not outlined yet. It stops at each spot and turns slowly so the scanner sweeps all around, then picks the nearest remaining spot. It stops with "AUTO-DISCOVERY COMPLETE" at 100% scan, or reports what is left when nothing else is reachable. Move the stick (or press AUTO again) to take over at any time.
- **What it avoids.** Turbines, bulkheads, live laser grids, fuel barrels and vent grates are kept at a distance. The proximity fuze is off while it flies. It does not fight: sentries and turrets can still shoot it, and anything behind a live laser grid stays unscanned until you switch the grid off.
- **Sealed areas.** The autopilot cannot open cracked walls itself. When everything reachable is outlined it flies to the nearest cracked wall and hovers there ("AT THE SEALED WALL"). Blast the wall open (this costs the rocket), launch the next rocket and press AUTO again: the map memory is kept, so it carries on into the new space. Repeat for each cracked wall (secret chambers and shortcut tunnels) until the scan reads 100%.
- **More hover physics.** A slow breeze drifts a hovering rocket and its thrusters pulse; close to the floor the exhaust builds an air cushion that slows a descent; close to walls and the roof the prop wash pushes it away and shakes the view; it leans into a move like a helicopter; the spin builds up and coasts when you release the stick; and the gun recoils harder when hovering.

## Flight physics and sound (v2.14)

- **Scan completion.** The SCAN badge now counts every real edge in the sector: wall seams, corners, shaft outlines, ramp outlines, opening rims and lift beams, secret chambers included. It reads 100% only when every one has been outlined (it shows at most 99% before that), so secret chambers must be breached or deep-scanned.
- **Extra physics.** Gusts buffet the rocket (more at speed and in narrow passages); a fast rocket is pushed gently away from walls, floor and roof it skims past (an air cushion); below crawl speed the nose droops and the rocket sinks a little; speeding up lifts the nose and braking dips it; the gun recoils (a small push back and a nose kick); a blast just outside its lethal radius shoves the rocket away (SHOCKWAVE); and a glancing scrape knocks the hull into a roll.
- **Sound.** Effects are now soft sine tones with a gentle attack and are quieter overall. The engine is a layered rocket-motor model: a deep brown-noise rumble with a combustion chuff, a band-passed exhaust roar that brightens with thrust, a high hiss at speed and low chamber tones. It spools up and down with throttle and idles when landed.

## Collision markers and blast danger (v2.11)

- **Fuze / detonate button (v2.13).** The DET button toggles with a tap between PROX FUZE (default: the proximity fuze below is armed) and HOLD DETONATE (fuze off; hold the button for 0.4 s to fire the warhead). The mode shows on the button and persists between rockets. R on a keyboard always detonates.
- **Proximity fuze (v2.12, v2.14).** When armed, the warhead bursts by itself when it comes within 5 units of a primary target, a sentry or a CIWS turret with a clear line to it, so near misses count. A fuze burst on a primary target pays the normal kill points but not the DIRECT HIT bonus (a true impact still does). Barrels, laser boxes and grates are not fuzed.
- **Button layout (v2.12).** The action buttons sit in a tidy two-column block beside the throttle lever (GUN and LOCK on the bottom row, DECOY and DETONATE above, LAND on top) and no longer reach into the middle of the screen.
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
| Resolution | 600 rays per frame, 8 scan rows, normal dots | 1,800 rays, 24 rows, dots 1.6 times bigger | 100 + 70 x level |
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
