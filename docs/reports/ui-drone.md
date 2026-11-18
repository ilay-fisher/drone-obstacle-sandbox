# PR 4: the drone as a flight instrument (`feat/ui-drone`)

## What changed

- Body: a top-down quad about 1.8 cells across. Four rotor discs with a motion-blur ring (rotated cached sprite), dark anodised shell with a top-left bevel, arms, hubs, one blinking orange nav light. Sprites are pre-rendered per cell size, DPR and palette.
- Banking: heading and bank are spring-smoothed (heading on SPRING_SNAPPY, bank on SPRING_SOFT, driven by the heading velocity). The body skews and squashes into turns. The shadow drops lower right with speed and shrinks and softens over a building.
- LiDAR: a real ~50 degree fan rotating at 2.6 rad/s with a decaying phosphor trail (cached conic-gradient sprite, stepped fallback). Wall cells the beam edge has just crossed (with line of sight, inside the radius) get a short tick. The radius ring stays subtle.
- Blockage pulse: the one loud motion. When a counted `replan` is caused by a change inside the LiDAR radius, an expanding ring plus a body recoil away from the change plays for 400 ms.
- Goal pad: the pad glow and ring breathe slowly. On Reached the drone settles with a damped overshoot and the pad lamp turns green (status colour only).
- Reduced motion: no bank, sweep, blink or pulse. LiDAR is a static ring, heading is final, landing is instant.

## Architecture

Pure, unit-tested modules; the canvas layer only draws.

- `render/droneMotion.ts`: springs, bank target, speed, shadow look, cover, landing/lamp, `droneFinalState` (reduced-motion selector).
- `render/lidarScan.ts`: sweep angle, flash falloff, line of sight, hit collection into a preallocated buffer.
- `render/blockagePulse.ts`: `shouldPulse`, phases, nearest changed cell.
- `render/droneSprites.ts`: cached body, rotor, shadow (tight and soft), glow and fan sprites.
- `render/droneLayer.ts`: per-simulation `DroneShow` in a WeakMap, same pattern as `searchLayer`.
- `motion/spring.ts`: added allocation-free `springStepMut`.
- `mapEntities.ts` / `mapPalette.ts` / `palette.ts`: minimal edits (`drawGoal` takes a lamp amount; palette gets `pass`).

Coordination with PR 3: no edit to `searchLayer`. The pulse is 400 ms (inside the 420 ms flood), and `shouldPulse` skips it when the previous replan event is under 420 ms old (a flood is still playing) or the last pulse was under 700 ms ago. In the blockage sheet the ring leads and the flood follows.

## Tests

290 tests pass, `tsc` clean. New: `droneMotion.test.ts`, `lidarScan.test.ts`, `blockagePulse.test.ts`, plus `springStepMut` and palette `pass` tests. The `test:` commit is red on its own by design (TDD); the `feat:` commit turns it green and also carries two fixes to my own wrong test fixtures (a LiDAR "finds nothing" edge and a seam-wrap wall).

## Frame times (`?perf=1`, `window.__perf()`, 1440x900, headless Chromium, 14 wall edits while playing Urban Canyon)

| Engine (HUD) | Planner | frames | frame p50 | p95 | max | work p50 | work p95 | work max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C++ Wasm | A* | 353 | 16.7 | 16.8 | 16.8 | 0.20 | 0.90 | 10.1 |
| C++ Wasm | D* Lite | 351 | 16.7 | 16.8 | 16.8 | 0.20 | 0.90 | 6.4 |
| TS Fallback | A* | 353 | 16.7 | 16.7 | 16.8 | 0.20 | 1.00 | 6.1 |
| TS Fallback | D* Lite | 354 | 16.7 | 16.7 | 16.8 | 0.20 | 0.90 | 7.7 |

Times in ms; frame time is locked to the 60 Hz display. Per-frame JS work never exceeds ~10 ms (the max is the frame that builds sprites for a new replan). The HUD read "Engine C++ Wasm" in all screenshots and "TS Fallback" in the wasm-blocked runs. Raw: `docs/redesign/pr4/frametimes.json`.

## Evidence (`docs/redesign/pr4/`)

`before-1440`, `after-1440`, `before-390`, `after-390` (scrolled to top), `after-landed-1440` (green lamp), `after-reduced-motion-1440`, `closeup-3x-cruise`, `contact-sheet-blockage` (100 ms spacing), `contact-sheet-turn`, `drone-6s.webm`.

## Iteration log

1. Round 1. Exploration frames showed the body arms vanishing into the dark map (arms were 50% black on a dark ground). Arms are now a lit slate mix so the quad silhouette reads at ~38 px.
2. Round 2. First blockage capture showed no pulse. Cause was my test wall 7 cells ahead, outside the 6-cell LiDAR radius, so the pulse correctly did not fire. Moved the wall inside the radius; the ring now appears at the replan instant and finishes before the flood does.
3. Tooling: a time-guessed closeup crop missed the drone after the first turn, so the turn sheet is cut from the recorded video instead.

## Still weak

- The drone never occupies a wall cell, so "shadow over a building" uses the lower-right neighbour cell at 0.55 cover. It is an approximation.
- The pulse is only skipped, never merged, when a flood is playing, so a quick second wall can get no ring.
- LiDAR ticks are small and only visible at DPR 2 or in closeups.
- Rotor blur is a static conic sprite, not true per-frame blur.
- Perf measured in headless Chromium at DPR 1 on one machine; DPR 2 and low-end phones not measured.
- The 390 px drone is small (~25 px); readable but quiet.
