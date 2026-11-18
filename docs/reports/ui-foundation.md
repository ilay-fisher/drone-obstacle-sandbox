# UI foundation (redesign PR 1)

Branch `feat/ui-foundation`. Scope: tokens, fonts, springs, stage layout, the 390 px fix, loop hygiene, frame-time probe, latency display, minimal canvas recolour. No changes to `cpp/`, `server/`, `web/src/wasm/`, the `Planner` interface or `SimStats`.

## What changed

- `web/src/styles/tokens.css`: palette (stage `#0C1014` family, surfaces, warm paper text, paint `#FF5A1F` / hi `#FFB347` / deep `#A8300F`, status green and ember), radius ladder 10/16/24/36/pill, bevel / well / contact-shadow / rim tokens lit from the top left, and the two springs as CSS `linear()` easings. `styles/tokens.test.ts` regenerates the springs from `spring.ts` and fails if the CSS drifts.
- `web/src/styles/fonts.css` + `web/src/assets/fonts/`: Bricolage Grotesque 700, Instrument Sans 400/600, Martian Mono 400/500, latin subset woff2 from Fontsource 5.3.0 (77 KB total), all OFL-1.1, licence texts in `assets/fonts/LICENSE`. URLs go through Vite so they respect `VITE_BASE`.
- `web/src/motion/spring.ts`: soft (90/12, about 880 ms, about 7.7% overshoot) and snappy (520/30, about 350 ms), `springStep`, `stepResponse`, `springEase`, `springToLinear`, `tween` (cancellable, injectable clock) and `prefersReducedMotion`.
- Layout (`styles.css`, `DroneCanvas.tsx`): the canvas box keeps the grid's aspect ratio and the stage hugs it. Desktop is a 7fr / 3fr grid (map about 70%) with the console on the right and the stage width capped so the map fits the viewport height. At 760 px and below the map is full width on top and the console stacks below. The 390 px bug is fixed: the old fixed-height stage and integer cell sizing clipped the map. Verified at 390x844: `scrollWidth == clientWidth`, whole map visible.
- Stage backdrop: three static light pools plus SVG grain; the grain drift animation is off under `prefers-reduced-motion`.
- Panels and controls restyled to rounded bevelled surfaces: telemetry readouts as wells, pill status lamp, bevelled buttons, orange primary, pill segmented control, custom range sliders and toggle switches (still real `input` elements). Focus rings use the amber token.
- Loop hygiene (`render/loopControl.ts`, pure and tested): DPR capped at 2, rAF loop stopped when the canvas is off screen (IntersectionObserver) or the tab is hidden, clock rebased on resume with dt clamped to 50 ms.
- Probe (`perf/frameStats.ts`, `perf/perfProbe.ts`): with `?perf=1`, ring buffer of 1200 frame intervals and callback work times, `window.__perf()` returning `{frames, p50, p95, max, over16_7, work}`, `window.__perfReset()`, and a small overlay. Without the flag nothing is installed (no timers, DOM or listeners).
- `format.ts`: `formatLatency` shows values under 0.1 ms as "< 0.1 ms"; `SimStats` is untouched.
- Canvas (`render/palette.ts`): colours come from the CSS tokens at mount. 1 px grid lines are gone: the ground is a cached layer with one faint dot per cell centre. Cell edges snap to device pixels so there are no seams between walls. Heat is now warm paper, the route is orange, wind is amber hatch. Drawing is otherwise unchanged (map, drone, LiDAR work is PR 2-4).
- `index.html`: empty data-URI favicon, which removes the 404 console error.

## Tests

`cd web && npm test`: 11 files, 86 tests passed (was 5 files / 61 tests before; 25 new: spring, loop control, frame stats, latency format, palette, token drift). `npm run build` (tsc plus vite) passes. `VITE_BASE=/drone-obstacle-sandbox/ VITE_DEMO_MODE=true npm run build` passes and the emitted CSS references `/drone-obstacle-sandbox/assets/*.woff2`. The code only accepts the literal `true` for `VITE_DEMO_MODE` (`1` does not enable demo mode).

Test commits come first in history (`test:` before `feat:`).

## Frame times

Headless Chromium, 1440x900, Urban Canyon, A*, playing, 10 s window (1200 frames). This machine's headless rAF runs at about 120 Hz (p50 8.3 ms), so the 16.7 ms budget has about 2x headroom here.

| Engine | p50 | p95 | max | over 16.7 ms | callback work p50 / p95 / max |
|---|---|---|---|---|---|
| C++ Wasm | 8.3 | 9.2 | 9.5 | 0 | 0.10 / 0.20 / 1.9 ms |
| TS Fallback (wasm request blocked via Playwright route) | 8.3 | 9.2 | 11.0 | 0 | 0.10 / 0.20 / 0.5 ms |

Off-screen check: with the page scrolled so the canvas is not visible, 0 frames were recorded in 1 s, and 120 frames in the next second after scrolling back.

## Evidence

`docs/redesign/pr1/after-desktop-1440.png`, `after-mobile-390.png`, `after-mobile-390-full.png`.

## Still weak

- Map art is barely changed: flat wall squares, hatched wind, a plain arrow drone and a flat LiDAR disc. That is PR 2 to 4.
- Controls are restyled but are still ordinary buttons and sliders, not hardware (PR 5). The console is tall: at 1440x900 the Scenarios block is below the fold.
- The heat layer is very faint now and is not distinguishable between A* and D* Lite (PR 3).
- No before/after contact sheet, WebM, or reduced-motion screenshot in this PR; the reduced-motion path was not exercised in a browser.
- The probe measures rAF intervals on a 120 Hz headless display, so it is not a 60 Hz verdict; a run on a real 60 Hz display would be more convincing.
- Grain drift is a full-screen fixed layer animated with `steps()`; its cost was not isolated (frame work stays at 0.1 ms p50, but compositor cost is not measured).
- Mobile console is a long single column with no tabs.
