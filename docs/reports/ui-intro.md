# PR 6: the guided first-visit intro

A ten-second scripted run teaches the app before the user touches it, then hands over the console.

## What it does

| Step | Time | Caption | What happens (all through the public `Simulation` API) |
| --- | --- | --- | --- |
| 1 | 0 to 2.4 s | This is a city. The drone has to cross it. | Urban Canyon is painted in cell by cell, left to right with scatter. Each building drops in on the renderer's own edit spring. The search layer is muted, so painting plays no replan. |
| 2 | 2.4 to 5.0 s | It plans a route with A*. | The canonical map loads; its first plan is the A* wavefront and the route draws. The drone sets off at 0.8x. |
| 3 | 5.0 to 7.4 s | Something blocks the way. | A 5-cell wall is placed on the route 9 cells ahead of the drone (`editCell`). LiDAR sees it, the scan pulse plays, A* replans. |
| 4 | 7.4 to 10.4 s | It repairs only what changed with D* Lite. | The planner switches to D* Lite (first D* call searches from scratch, honestly labelled "searched"), then a second wall is placed and D* repairs only the changed cells (the ember "repaired N cells" flood). |
| Outro | 10.4 s on | Your turn: draw a wall in its path. | The console lights up (spring), the run stays paused mid-flight in D* Lite so the user's first wall gets an instant repair. The pill leaves after 6 s. |

One loud motion at a time: the cues are at least 1.1 s apart (the replan timeline is 1.1 s), and a caption change is a 3 px opacity tick, never a second big motion.

Every readout is real. Nothing in `cpp/`, `server/`, the `Planner` interface or `SimStats` changed. Painting calls `sim.reset()` after each batch so no replan is counted while the city is built; counts during the run are whatever the planner really did.

## How

- `intro/introScript.ts`: captions and step times as data, pure `stepAt/phaseAt/captionAt`, the cue table.
- `intro/introCues.ts`: pure helpers (paint order, how many cells are due, where the wall goes).
- `intro/introRunner.ts`: `IntroRunner` fires the cues against an `IntroSim` and an `IntroHost` (UI mirror). No timers; the caller drives `update(t)`.
- `intro/introStorage.ts`: `?intro=` override, first-visit logic, guarded `localStorage` (get and set both in try/catch; unreadable storage means "do not auto-show", the `?` key still replays).
- `components/intro/useIntro.ts`: one rAF loop (cancelled on skip, finish and unmount; a long frame advances the script by at most 100 ms). React state changes only on caption change.
- `IntroPill` (aria-live polite, no pointer events), `IntroShield` (transparent click-to-skip sheet, not focusable), `IntroCard` (reduced motion).
- Render: `DrawOpts.quiet` makes the search layer swallow events while the city paints.
- Input: `?` is in the keymap (`replayIntro`) with tests, and a real `Intro ?` keycap sits in the console footer (focus ring, aria-label "Show the intro again" (not "Replay...", which a loose name match for the Play button would hit)).

## Skip and states

- Esc or any click during the run: Urban Canyon loaded, A*, paused, user's own speed restored, console fully lit.
- Natural finish: paused mid-flight in D* Lite, console lit.
- Reduced motion: no animation, a modal dialog card (four finished-state panels, "Got it"), focus moves to the button and returns on close, Esc closes, Tab stays inside.
- First visit only: `drone-sandbox.intro-seen.v1` is written when the intro starts. If storage throws, the app works and the intro does not nag.

## URL switches

- `?intro=0`: never show the intro (used for tests and the README screenshot).
- `?intro=1`: force it (ignores the seen flag).

## Tests

New: `introScript`, `introCues`, `introStorage`, `introRunner` (fake sim and host, including storage that throws) and the `?` shortcut in `keymap.test.ts`. Committed in a `test:` commit before the implementation. Full suite: 341 tests green (round 2 adds `paintBatches`, one-building-per-frame runner tests and `searchTone`); `typecheck` and `build` (also with `VITE_BASE=/drone-obstacle-sandbox/ VITE_DEMO_MODE=true`) green.

## Frame times

Measured with `?perf=1&intro=1` over the full 16.4 s (intro plus outro), headless Chromium, 1440x900, 60 Hz.

| Engine | frames | interval p50 | p95 | max | work p50 | work p95 | work max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C++ Wasm | 996 | 16.7 ms | 16.8 ms | 16.8 ms | 0.2 ms | 0.8 ms | 3.3 ms |
| TS fallback (`**/*.wasm*` blocked) | 996 | 16.7 ms | 16.7 ms | 16.8 ms | 0.2 ms | 0.7 ms | 2.8 ms |

(The probe's `over16_7` counter reads about a third of frames because the headless clock ticks exactly 16.7; max is 16.8.)

## Evidence

`docs/redesign/pr6/`: before and after stills at 1440 and 390, a contact sheet through the D* repair (8 frames about 100 ms apart), a contact sheet across all four steps, a WebM of the full intro, and the reduced-motion card at 1440 and 390.

## Review iterations

1. Mobile pill wrapped to two lines and covered the drone and the repair flood. Fixed: 12 px single-line pill, smaller pips, `Esc` hint hidden below 760 px.
2. The pill covered nothing important at 1440 (bottom centre sits on the lower building row, clear of the route); verified at all four steps.
3. Review round 1, buildings read as checkerboard noise in step 1. Cause: the intro painted wall cells one by one in a jittered order, so many half-built buildings animated cell by cell, and any frame that changed more than 48 cells snapped without the drop. Fix: `paintBatches` groups walls into whole buildings (4-connected, over-large ones chunked at 40 cells, left to right) and the runner paints one building per frame, so each drops in as a whole rounded block on the snappy spring.
4. Review round 1, D* repair flood was a saturated yellow-white blob. Cause: the D* resting sprites were added with the `lighter` composite, and overlapping sprites sum to white. Fix: the D* ember now composites with ordinary alpha (`source-over`), the resting sprite is mostly deep ember (`DSTAR_REST_MIX` 0.3), the accumulated glow is capped at 50% opacity, and the rim peak is lowered. A* keeps `lighter` (dim paper-white, cannot reach white). Sprites stay cached, no per-frame gradients. The same code serves a normal D* replan on a user wall (checked: deep orange, modest rim).
5. Review round 1, reduced-motion card: LiDAR arc is now paper-white, the goal is an orange pad ring, buildings are rounded with a soft drop shadow, and the ember cells are orange. Green is no longer used.
6. Review round 1, the Intro key is now a full Keycap in the same key-stack style as Reset and Clear, with an engraved "?" glyph and the "Intro" legend.

## Still weak

- The intro is timed, not event-driven: on a very slow machine the long-frame clamp stretches it, but a planner call that takes long could overlap two floods.
- The scripted wall position is chosen from the live route, so on odd plans a wall may fall right in front of a building edge and look less deliberate.
- The step 1 drops are caught mid-fall in some still frames (a building partly settled looks like a stripe); in motion they are 350 ms each.
- The initial D* flood in step 4 still covers a wide area (deep orange now, but big); it is the true search extent.
- The Intro key no longer shows its `?` shortcut as a second glyph (the `?` is the icon); the shortcut still works and is in the aria label.
- HUD numbers during step 1 show the previous plan's values (all real, but briefly confusing) until step 2.
- Esc/click skip on mobile has no visible "tap to skip" hint (the `Esc` hint is hidden under 760 px).
- Reduced-motion card art is schematic, not a screenshot.
