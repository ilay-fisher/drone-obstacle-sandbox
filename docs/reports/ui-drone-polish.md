# PR 7: drone polish (`feat/ui-drone-polish`)

Fixes the "still weak" list from PR 4 (`docs/reports/ui-drone.md`). No change to `cpp/`, the planner API, `server/` or any number shown.

## What changed

1. **Minimum on-screen size.** `droneDrawScale(cell)` (pure, in `droneMotion.ts`) lifts the drone to a 34 CSS px span when the cell-based size is smaller, capped at 2.6x. At 1440 (cell 21.3) the scale is exactly 1, so the desktop drone is unchanged. At 390 (cell 7.46) it is 2.53, up from about 13 CSS px (the old "~25 px" was device px). Sprites are built for the scaled size, so there is no per-frame scaling cost. The LiDAR, pulse and goal stay in map cells.
2. **Rotor contrast.** Discs stay graphite. Each rotor now has a thin dark outer line, a faint light ring all round (so the disc silhouette reads on dark ground) and a lighter bevel on the top-left arc (one light source), fading to the sides.
3. **LiDAR ticks.** Longer (0.46 cell half-length, was 0.3), thicker (at least 2.2 px, was 1.4), neutral paper colour (`pal.drone`, no accent) with a dark under-stroke so they hold on light and dark cells. Still the same short flash (about 0.2 s). Visible at DPR 1 (`before/after-lidar-ticks-dpr1.png`).
4. **Blockage pulse is reduced, not skipped, during a flood.** `pulseMode()` returns `full`, `reduced` or `none`. While the previous replan's flood still plays the ring is the reduced one: single thin ring, 55% alpha, 50% weight, 260 ms (full: 400 ms), no halo or inner ring. Rate limits: 700 ms between full pulses, 300 ms between reduced ones.
5. **Shadow over buildings samples the shadow footprint.** `footprintCover()` (pure) returns the exact overlap area of the shadow's 1.2 x 1.2 cell footprint with the wall cells under it, centred on the real shadow offset (speed and altitude aware). `coverFor(under, shadowCover)` maps it to 0..0.8, or 1 when the drone is over a wall. It feeds the existing exponential cover smoothing, so it slides in without a pop. The closure that tests a cell is created once per simulation, so frames allocate nothing.
6. **Perf at DPR 2 and 4x CPU** measured (below). Nothing exceeded 8 ms p95 work, so no extra caching was needed.

## Tests

360 pass (was 341), `tsc` clean. The `test:` commit is red by design (TDD). New: reduced pulse modes, durations, gaps and phases; `footprintCover` (area, partial cover, no pop, degenerate radius); `coverFor`; `droneDrawScale` (1440 unchanged, 390 reaches 34 px, cap, monotone, NaN). The `feat:` commit also fixes two of my own test fixtures (float tolerance in the slide test, slide range).

## Frame times (`?perf=1`, `window.__perf()`, Urban Canyon, 14 wall edits while flying, about 8 s each)

All times in ms. Frame time is locked to the 60 Hz display; the column that matters is work (simulation tick plus draw).

| Scenario | Engine (HUD) | Planner | frames | frame p50 | frame p95 | work p50 | work p95 | work max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Desktop 1440x900, DPR 1 | C++ Wasm | A* | 484 | 16.7 | 16.8 | 0.20 | 0.50 | 1.5 |
| | C++ Wasm | D* Lite | 482 | 16.7 | 16.7 | 0.20 | 0.40 | 1.1 |
| | TS Fallback | A* | 485 | 16.7 | 16.7 | 0.20 | 0.50 | 1.5 |
| | TS Fallback | D* Lite | 480 | 16.7 | 16.7 | 0.20 | 0.40 | 1.7 |
| Desktop 1440x900, DPR 2 | C++ Wasm | A* | 477 | 16.7 | 16.8 | 0.20 | 1.00 | 2.6 |
| | C++ Wasm | D* Lite | 486 | 16.7 | 16.8 | 0.20 | 0.70 | 3.3 |
| | TS Fallback | A* | 482 | 16.7 | 16.7 | 0.20 | 0.80 | 2.1 |
| | TS Fallback | D* Lite | 476 | 16.7 | 16.8 | 0.10 | 0.60 | 2.3 |
| 390x844 mobile, DPR 2, 4x CPU throttle | C++ Wasm | A* | 477 | 16.7 | 16.8 | 0.60 | 1.50 | 5.1 |
| | C++ Wasm | D* Lite | 479 | 16.7 | 16.7 | 0.50 | 1.10 | 4.0 |
| | TS Fallback | A* | 493 | 16.7 | 16.7 | 0.70 | 1.40 | 15.2 |
| | TS Fallback | D* Lite | 481 | 16.7 | 16.7 | 0.50 | 1.30 | 5.1 |

Worst p95 work is 1.5 ms, far under the 8 ms budget. One TS-fallback A* frame in the throttled run reached 15.2 ms (the frame that builds sprites for a new replan, under 4x throttle); it did not show up in the p95 and did not move the frame interval. The HUD read "Engine C++ Wasm" in the Wasm runs and "TS Fallback" with `**/*.wasm*` blocked. Raw: `docs/redesign/pr7/frametimes.json`. Headless Chromium on one Mac, so the 4x throttle is an emulation, not a real phone.

## Evidence (`docs/redesign/pr7/`)

`before-1440`, `after-1440`, `before-390`, `after-390`, `before/after-closeup-3x-1440`, `before/after-closeup-3x-390` (start pose, 2x capture upscaled 3x), `before/after-lidar-ticks-dpr1`, `before/after-contact-sheet-blockage` (8 frames, about 100 ms apart, starting just before the first wall; a second wall 110 ms later lands during the flood: the after sheet shows the full ring, then the thin reduced ring over the flood; the before sheet shows no second ring), `drone-polish-8s.webm`, `frametimes.json`.

## Iteration log

1. Round 1 frames: the rotor bevel (0.85 alpha) read as silver coins at 3x. Reduced to 0.58 with a 0.30 shoulder and a 0.14 ring, discs stay graphite.
2. The first min-size cap (1.7x) only gave about 23 px at 390. Raised the cap to 2.6x so the 34 px target is met on the real phone map; the 390 frame then reads as a quad with the shell and nav light still dominant.
3. The reduced ring was barely visible in the first sheet; alpha 0.5 to 0.55 and weight 0.45 to 0.5 (still under 60% of the full ring, which a test pins).
4. Tooling: the capture scripts reach the simulation through the React fiber (evidence only, no app change) to place walls relative to the drone.

## Still weak

- At 390 the drone at 34 px is about 15% of the map height and bigger than the patrol pucks. It reads, but it is a deliberate over-scale; 30 px would be calmer.
- Closeups are taken at the start pose; a banking closeup mid-flight is only in the WebM.
- The reduced pulse is faint on purpose; on a bright projector it may be hard to see.
- LiDAR ticks appear only when the beam crosses a wall inside the radius, so a single frame often has none.
- Rotor blur is still a static conic sprite.
- The shadow footprint is a square approximation of the silhouette (and ignores patrol pucks as shadow receivers).
- Perf is headless Chromium with emulated throttle, not a real low-end phone.
