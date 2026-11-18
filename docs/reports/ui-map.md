# PR 2: the map

## What changed

- Canvas drawing moved out of `DroneCanvas.tsx` into a layered renderer in `web/src/render/`:
  `renderer.ts` (composition), `mapLayers.ts` (cached ground dots, buildings, shadows),
  `windFlow.ts` (soft wind region and drifting flow streaks), `mapFx.ts` (wall drop and lift),
  `mapEntities.ts` (patrol pucks, landing pad), `buildings.ts`, `blocks.ts`, `mapPalette.ts`.
- Draw slots for later PRs: `searchLayer.ts` (PR 3) and `droneLayer.ts` (PR 4) hold the previous
  simple heat, route, LiDAR and drone drawing, moved as is with palette colours.
- Buildings: 4-connected wall cells form one rounded block with a stable height from a cell hash,
  lit top, darker side, contact and soft shadow to the lower right, no seam inside a block.
- Wind: one merged blurred region, thin flow streaks drifting in one direction, cached sprites
  translated per frame (no per-frame gradients).
- Patrols are ember pucks with a heading notch; the goal is a pad with a slowly breathing ring.
- Editing: painted walls drop in on the snappy spring, erased walls lift out. The planner gets
  the cell immediately; only the picture animates.
- Reduced motion: no flow drift, drop/lift or breathing; finished states only.
- Engine: additive `Simulation.gridVersion` (bumped in edit paths) and `copyVisualGrid`.
  The cached layers rebuild only when it moves. No change to `cpp/`, `server/`, `wasm/`, the
  Planner interface or SimStats.

## Tests

Written first (`test:` commit): block labelling, cell hash stability, grid-change detection,
drop/lift timeline, flow-line phase, reduced-motion finished state. 124 tests pass.

## Frame times (1440x900 headless Chromium, Urban Canyon playing, `?perf=1`)

`interval` is rAF spacing; `work` is our per-frame draw time. Headless rAF is vsync locked, so
the "over 16.7" count is rounding noise (16.8 ms stamps), not dropped frames.

| run | interval p50 / p95 / max | work p50 / p95 / max | over 16.7 (interval) |
|---|---|---|---|
| Wasm, idle 6 s | 16.7 / 16.7 / 16.8 | 0.2 / 0.3 / 0.4 | 83 of 360 |
| Wasm, drag painting and erasing | 16.7 / 16.7 / 16.8 | 4.5 / 8.5 / 9.8 | 91 of 222 |
| TS fallback, idle | 16.7 / 16.8 / 16.8 | 0.1 / 0.2 / 2.0 | 75 of 360 |
| TS fallback, drag | 16.7 / 16.7 / 16.8 | 4.4 / 8.4 / 9.9 | 84 of 225 |
| before (origin/main, TS), idle | 16.7 / 16.7 / 16.8 | 0.1 / 0.2 / 0.4 | 64 of 360 |
| before, drag | 16.7 / 16.7 / 16.8 | 0.1 / 0.3 / 0.5 | 92 of 223 |

Cost: while dragging, each edit rebakes the building layer (about 4 to 9 ms of work per frame),
still under budget but visibly more than before. Idle cost is unchanged.

## Evidence (`docs/redesign/pr2/`)

- `before-` / `after-desktop-1440.png`, `-mobile-390.png`, `-patrols-desktop-1440.png`
  (no `?perf=1`; HUD shows C++ Wasm in all)
- `contact-sheet-paint-replan.png`: 8 frames, 100 ms apart, wall dropping onto the route, replan
- `map-6s.webm`: includes the first 2 s of the default scenario, then Urban Canyon, paint, erase, wind
- `frametimes-*.json`

## Still weak

- Roofs are flat colour with a diagonal light and a 1 px specular edge; large blocks still look
  like slabs rather than detailed buildings.
- Wind flow is judged in motion only on the video; stills show wisps, not drift.
- Drag painting rebakes the whole building layer per change (up to 9 ms); incremental bake would be better.
- Patrol pucks are small at 1440 px; no reduced-motion screenshot captured.
- Hover tooltip overlaps the map in the contact sheet (pre-existing).
- No Wasm "before" frame-time run; before numbers are TS fallback only.
