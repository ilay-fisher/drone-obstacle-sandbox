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

## Round 1 (manager review)

- Buildings: roofs are dark anodised graphite (about #2A323C to #343E4A, a little lighter than the
  stage), a lit top-left bevel, a darker lower-right side face and a contact shadow. Block height
  (hash) now spans 0.35 to 1.3, so side depth and shadow length differ visibly. Route and drone are
  the brightest things on the map.
- Wind: no amber. Cool steel-blue region tint with paper-white wisps at low alpha; drift kept.
  Wall wash while a wall is in flight is cool too (orange stays for live things only).
- Patrol pucks grew to about 1.4 cells across, ember colour and heading notch kept.
- Drag painting: one shade bake per frame at most, redrawing only the blocks that touched the
  changed cells (clip to their bbox plus shadow margin). Full bake only on first draw, resize,
  bulk change (more than 48 cells) or reset. Erase completion marks its cells dirty too.
- Evidence retaken after merging origin/main (new console, 1408b1c): tooltip hidden, contact sheet
  with 3 frames mid-drop cropped to the map, reduced-motion still, Wasm "before" run, WebM trimmed
  to start on Urban Canyon.

## Tests

Written first (`test:` commit): block labelling, cell hash stability, grid-change detection,
drop/lift timeline, flow-line phase, reduced-motion finished state, prune reports removed cells.
183 tests pass after merging main.

## Frame times (1440x900 headless Chromium, Urban Canyon playing, `?perf=1`)

`interval` is rAF spacing; `work` is our per-frame draw time. Headless rAF is vsync locked, so
the "over 16.7" count is rounding noise (16.8 ms stamps), not dropped frames.

| run | interval p50 / p95 / max | work p50 / p95 / max | over 16.7 (interval) |
|---|---|---|---|
| Wasm, idle 6 s | 16.7 / 16.7 / 16.8 | 0.1 / 0.2 / 0.3 | 70 of 360 |
| Wasm, drag painting and erasing | 16.7 / 16.8 / 16.8 | 0.2 / 4.5 / 10.0 | 118 of 309 |
| TS fallback, idle | 16.7 / 16.7 / 16.8 | 0.1 / 0.2 / 0.3 | 79 of 360 |
| TS fallback, drag | 16.7 / 16.7 / 16.8 | 0.2 / 5.1 / 6.9 | 124 of 303 |
| before (origin/main, Wasm), idle | 16.7 / 16.7 / 16.8 | 0.1 / 0.2 / 0.2 | 75 of 360 |
| before, drag | 16.7 / 16.8 / 16.8 | 0.1 / 0.1 / 0.3 | 133 of 348 |

Drag work p95 went from 8.5 ms (round 0, full rebake per edit) to 4.5 ms (Wasm) and 5.1 ms (TS).
That is still more than the flat before picture (0.1 ms), by design: buildings carry bevel, side
face and soft shadows. Still within the 16.7 ms budget; the worst single frame is 10 ms.

## Evidence (`docs/redesign/pr2/`)

- `before-` / `after-desktop-1440.png`, `-mobile-390.png`, `-patrols-desktop-1440.png`
  (no `?perf=1`; HUD shows C++ Wasm in all; both show the merged console)
- `contact-sheet-paint-replan.png`: map only, 8 frames at 12 fps, frames 1 to 3 mid-drop (cool
  wash on the falling wall), then landed and replan; mouse off the map, no tooltip
- `after-reduced-motion-1440.png`: reduced motion, wall already finished, no flow drift
- `map-6s.webm`: starts on Urban Canyon, then paint, erase, wind
- `frametimes-wasm.json`, `frametimes-ts-fallback.json`, `frametimes-before-wasm.json`

## Still weak

- Roofs are flat colour with a diagonal light and a thin bevel; very large blocks still read as
  slabs, not detailed buildings.
- Height variation is moderate; side depth differs but taller blocks do not look taller from above.
- The drop overshoot is subtle in single frames; it reads better in the video.
- The hover tooltip shows during a real drag (frames hidden only because the mouse left the map).
- Wind drift is judged in motion only on the video; stills show wisps, not drift.
- Drag cost is 4 to 5 ms p95 with single spikes to 10 ms; a per-block cached sprite would cut it.
- "Before" work time is not directly comparable: the old renderer was a handful of flat fills.
