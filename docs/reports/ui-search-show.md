# PR 3: the search is the show

The replan is now the one loud motion on screen (about 1.1 s). Everything else stays quiet.

## What it does

| Beat | Start | Length | What you see |
| --- | --- | --- | --- |
| Wavefront | 0 ms | ~420 ms | A flood expands from the origin (drone cell for A*, goal plus changed cells for D* Lite) with a bright leading rim, then settles to a dim resting glow. A* is warm paper white. D* Lite is ember (`#A8300F` to `#FF5A1F`). |
| Draw-on | ~150 ms | ~420 ms | The new route draws on with an amber (`#FFB347`) head. The route stays the brightest line. |
| Dissolve | ~150 ms | ~900 ms | The old route breaks into dots and fades behind the new one (ease/spring). |
| Chip | 0 ms | ~1 s | A pill pinned just above the flood. |

Reduced motion: no flood, draw-on or dissolve. The final state (new route, resting glow, chip) shows at once. This is a pure selector (`replanPhases` returns `FINISHED`), with tests.

## Architecture

- `engine/replanEvent.ts` + `Simulation.lastReplan`: pure additive `ReplanEvent` (mode, changed cells, origin, heat snapshot as a `Uint8Array` copy, old path, new path, timestamp). No change to `cpp/`, `server/`, the `Planner` interface or `SimStats`.
- `render/floodOrder.ts`: pure flood order. The engine exposes heat counts, not expansion order, so the order is reconstructed in JS (chamfer 5/7 Dijkstra over visited heat > 0 cells from the origin, rank 0..1 per cell). Unreachable visited cells are appended by distance. The README says so.
- `render/routeCurve.ts`: Chaikin smoothing (2 iterations) plus arc-length bookkeeping. This is display only: the planner path and the drone's flight path are unchanged.
- `render/replanTimeline.ts`: the whole timeline is a pure function of elapsed ms.
- `render/searchLayer.ts`: cached pre-rendered radial sprites drawn with `lighter`, an offscreen accumulation canvas for the resting glow, a thin live rim band. No per-frame gradients. The flat stair-stepped heat fill is gone.

## Honest chip

Every number is real. A*: "searched M cells" (M is the heat > 0 count). D* Lite: "repaired N cells", only when the call was an incremental repair toward the same goal as the previous D* call; a first D* call (full search) says "searched". Singular "cell" for 1. ", no route" is appended when nothing was found. In the capture scene the D* repair is genuinely 2 cells, against 354 cells for the A* search of the same map.

## Dashed vs solid-with-glow (decision)

Solid with glow. The dashes of the old route carry the meaning "this is the route that is going away" (the dissolve), so the new one must not share that vocabulary. A solid, glowing, amber-headed line reads as "live and current" at a glance, keeps the route the brightest thing on screen, and a smoothed curve looks cleaner solid than dashed (dashes on a curve beat against the cell grid). The dashed line is reserved for the dissolving old route.

## A* vs D* contrast

`after-dstar-repair-1440.png` and `contact-sheet-dstar.png` against `contact-sheet-astar.png`, same Urban Canyon map, same kind of wall edit near the route: A* floods a whole region in white (354 cells), D* Lite shows one small ember spot (2 cells).

## Evidence (docs/redesign/pr3/)

- `before-1440.png`, `before-390.png` (origin/main 0dcde3a), `after-1440.png`, `after-390.png`
- `after-dstar-repair-1440.png` (ember repair mid-flood), `after-reduced-motion-1440.png`
- `contact-sheet-astar.png`, `contact-sheet-dstar.png` (8 frames, ~100 ms apart, cropped to the map)
- `search-show.webm` (6 s: A* replans, then D* Lite repairs)
- The HUD reads "Engine C++ Wasm" in every screenshot.

## Frame times (`?perf=1`, `window.__perf()`, 1440x900, Chromium, 14 repeated wall edits while playing)

| Engine | Planner | frames | frame p50 | p95 | max | work p50 | work p95 | work max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C++ Wasm | A* | 422 | 16.7 | 16.7 | 16.8 | 0.2 | 1.3 | 9.3 |
| C++ Wasm | D* Lite | 422 | 16.7 | 16.7 | 16.8 | 0.1 | 1.2 | 6.5 |
| TS fallback (wasm request blocked; HUD says "TS Fallback") | A* | 422 | 16.7 | 16.7 | 16.8 | 0.3 | 1.6 | 6.8 |
| TS fallback | D* Lite | 423 | 16.7 | 16.8 | 16.8 | 0.2 | 1.2 | 9.2 |

Times in ms. Frame time is locked to the 60 Hz display (16.7 ms); per-frame JS work never exceeds 10 ms. The 9 ms work spike is the frame that builds the sprites and flood order for a new replan.

## Iteration log

1. Round 1. Flood resting glow was almost invisible against the map (A* alpha 0.12). Raised A* rest/rim alpha to 0.2/0.3. The A* flood now reads as soft white light.
2. Round 2. The D* repair was invisible (2 cells at low alpha, and the chip sat on top of it). Ember sprite 1.6x larger, hotter mix toward orange (0.8), alpha 0.8, and the chip now pins just outside the flood's bounding box instead of at its centroid. The repair is now a clear ember spot.
3. Tooling caught two of my own mistakes: a contact sheet was stale because `ffmpeg` was cut by `| head`, and the image viewer cached by filename. Re-rendered under new names and verified timestamps.

## Still weak

- The D* ember spot is honest but small. For a 2-cell repair it is a subtle moment; it relies on the contrast with A*.
- Chip placement is "above the flood bbox"; on a large flood near the top edge it falls below and can overlap a building face.
- The wavefront's sprite stamping shows faint dither/pixel texture at its leading edge for the first ~100 ms of a big A* flood.
- Reduced-motion still shows the chip (it is information, not motion); some may prefer it hidden.
- `incremental` is a JS-side best effort (same goal as previous D* call since last clear/import); the engine does not expose it.
- Measured on one machine in headless Chromium at DPR 1; DPR 2 and low-end phones not measured.
- Draw-on maps display progress by raw/smoothed length ratio, so the head is within a fraction of a cell of the drone's true route, not exact.
