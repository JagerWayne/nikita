# NIKITA // SHADOW OPS

A 3D tactical guided-missile simulation for phones (and desktop). Fly a wire-guided Nikita warhead through 100 procedurally generated facility sectors, destroy the primary targets, avoid sentries, lasers, turbines, CIWS turrets, ECM fields and sliding bulkheads.

Single-file game (`index.html`) built on [Three.js](https://threejs.org/) r187, loaded from unpkg at runtime.

## Play

GitHub Pages: https://jagerwayne.github.io/nikita/

Use landscape. On iPhone, tap Share, then Add to Home Screen for a full-screen experience (Safari has no fullscreen button). Gyro tilt flight needs HTTPS, which the Pages link provides.

## Mobile controls

| Control | Action |
| --- | --- |
| Left half (drag) | Floating flight stick (pitch and yaw) |
| Right half (drag) | Fine aim |
| LOCK | Lock the target highlighted in the 15 degree seeker cone |
| BOOST (hold) | Overdrive; recharges to 100% after emptying |
| AIR BRAKE (hold) | Stealth crawl |
| HOLD DET (hold 0.3 s) | Manual warhead detonation |
| CAM | Nose-cam or chase-cam |
| 1 / 2 / 3 strip | Crawl, cruise, overdrive |
| MENU | Pause sheet: gyro, invert pitch, haptics, low-spec mode, left-handed layout, button size and opacity, radar, sound |
| Radar (tap) | Enlarge or shrink the minimap |

Desktop: click to capture the mouse, `WASD` or arrows steer, `L` lock, `Shift`/`Space` boost, `Ctrl` brake, `E` camera, `R` detonate, `1-3` speed, `Tab` radar, `~` developer overrides.

## Notes

- Preferences (left-handed layout, button size/opacity, low-spec mode) are stored in `localStorage`.
- Low-spec mode drops the CRT, blend-mode and blur overlays and renders at 1x resolution. The game suggests it if the frame rate stays low.
- Requires a browser with import-map support (iOS/Safari 16.4+, Chrome/Edge 89+, Firefox 108+).
