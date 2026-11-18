# UI intro polish (PR 8)

Fixes the "still weak" list left by PR 6 (`docs/reports/ui-intro.md`). Branch `feat/ui-intro-polish`.

## What changed

1. **Event-driven intro.** `web/src/intro/introSequence.ts` is a pure state machine: `stepSeq(state, t, replanSeq)` fires at most one cue per call. A cue that makes the planner run records `sim.replanSeq`; the next loud cue waits for that call to finish plus the matching part of the `replanTimeline` (draw-on 570 ms, or the whole 1100 ms sequence before the quiet D* call and before the end). Each cue also has a nominal time, so a normal machine takes about 10.5 s. A call not seen within 2500 ms stops being waited for; a hard cap of 20 s ends the run. `introScript.ts` now only holds captions and constants.
2. **Honest step 4.** The `dstar` cue switches to D* Lite with the new renderer `calm` flag on: its first call is a from-scratch search and the renderer adopts the plan silently (route follows, no flood, glow or chip). The second wall then triggers the only visible flood, a real incremental repair. The chip reads "repaired 25 cells" and the HUD shows the real numbers of each call.
3. **Deliberate walls.** `pickWall` in `introCues.ts` (pure): 3 or 5 cells, straight, perpendicular to the route, centred on a route cell, all cells free and at least 1 cell from any building, ahead of the drone within LiDAR range. Tiers relax the range, the clearance and then the length (and keep one end open); the last fallback is the old straight-across wall.
4. **Clean step 1 readout.** While step 1 runs the HUD gets a constant idle state (zeros, "Idle"). No previous values, no fake numbers; real values return with the first intro replan.
5. **Mobile skip hint.** Under 760 px the pill shows "Tap to skip" (10 px, a hairline divider); desktop keeps "Esc skip". It fits on one line with the caption at 390 (checked in step 1 and 3 stills).
6. **Reduced-motion card art.** Four static 240x150 inline SVG panels built from shared gradients and blur filters: rounded relief buildings (top-left light, lower-right contact shadow), orange route with soft glow, paper-white A* region, deep-orange D* repair region, drone glyph, orange goal ring. No motion, no canvas.

Untouched: `cpp/`, the planner API, `server/`, `droneLayer.ts` and the drone modules. Renderer change is additive (`calm` option, `adopt` and `setRoute` in `searchLayer.ts`).

## Tests

361 tests green (was 341). New: `introSequence.test.ts` (order, 10 to 12 s pace, slow-planner delay, event-before-next-cue at several latencies, timeout when the planner never answers, hard cap, one cue per call, purity), `introWall.test.ts` (wall geometry, clearance, range, fallbacks), rewritten `introRunner.test.ts` (event-aware fake sim) and `introScript.test.ts`. The failing tests are in the `test:` commit that precedes the `feat:` commits. `npm run typecheck`, `npm run build` and the demo build (`VITE_BASE=/drone-obstacle-sandbox/ VITE_DEMO_MODE=true`) are green.

## Frame times

`?perf=1&intro=1`, 16.8 s, headless Chromium 1440x900, 60 Hz.

| Engine | frames | interval p50 | p95 | max | work p50 | work p95 | work max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C++ Wasm | 1007 | 16.7 ms | 16.7 ms | 16.8 ms | 0.2 ms | 0.6 ms | 6.6 ms |
| TS fallback | 1006 | 16.7 ms | 16.8 ms | 16.8 ms | 0.1 ms | 0.6 ms | 6.7 ms |

The 6 ms work maximum is the one frame that paints the city or plays the first flood; no frame work exceeds 16.7 ms. (The probe's `over16_7` counter reads a third of frames because the headless clock ticks 16.7.)

Timing on a normal machine (Playwright timeline): captions at about 0, 2.4, 5.0 and 7.5 s, "Your turn" at 10.5 s. With the CPU throttled 6x, "Your turn" arrives at 10.7 s and the planner call that took 1.6 ms (0.3 ms normally) delays nothing visible; the sequencer waits for each event, so floods follow one after another.

## Review rounds

1. First recording: timing and idle HUD correct; the step-4 repair was a small deep-orange region with "repaired 25 cells" (nodes expanded 26 versus 272 and 322 for the full searches).
2. Reduced-motion card: the D* region and A* halo were too faint to read next to the glow; raised their fill opacity (0.3 and 0.85). Step 1 stills were catching buildings mid-drop; they are now taken after 2 s.

## Still weak

- The second wall is partly hidden under the building edge it sits beside at 1440; it reads as deliberate in motion but is small in a still.
- Step 1 buildings are still mid-drop for the first 1.5 s by design; only the later still is clean.
- The slow-planner proof is a 6x CPU throttle, not a planner that really takes seconds; the sequencer tests cover the long latencies.
- Reduced-motion card is schematic geometry, not a render of the live canvas, so it will not follow future map style changes by itself.
- "Tap to skip" is 10 px text; the whole pill is the tap target but it is a small one.

## Evidence (`docs/redesign/pr8/`)

- Stills at 1440 and 390: `step1` to `step4` and `outro` (`-1440.png`, `-390.png`)
- `step4-repair-sheet.png` (8 frames, 100 ms apart), `all-steps-sheet.png`
- `slow-planner-6x-sheet.png` and `slow-planner-6x.webm`
- `full-intro.webm`
- `reduced-motion-card-1440.png`, `reduced-motion-card-390.png`
- `perf_wasm.json`, `perf_ts.json`
