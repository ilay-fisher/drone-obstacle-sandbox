# PR 5: the console and telemetry as hardware

## What changed

- Console is three bevelled trays (Fly, Plan, Build), each labelled by an engraved mono pill.
  - Fly: large Play/Pause keycap (the one primary accent), Reset and Clear keycaps, Speed as a rotary dial with detents 0.5 to 4.
  - Plan: A*/D* Lite toggle switch (thumb throws and snaps on the snappy spring), LiDAR radius dial with detents 3 to 8, Heatmap and LiDAR rocker switches with an LED.
  - Build: five tool keycaps with engraved legends and shortcut letters, three preset cartridge chips, and a collapsible Scenarios tray (demo note and link, API offline badge and note kept).
- Keycaps squash to 0.955 and sink on the snappy spring (CSS `scale` and `translate` with `--spring-snappy`); release overshoots. The active tool sits down: inset, darker, lit legend.
- Dials: real `<input type=range>` underneath (hidden, focusable), circular drag on the rim, vertical drag on the cap, arrows, PageUp/PageDown, Home/End, detent ticks, engraved mono readout, rotor on the snappy spring. Maths in `controls/dialMath.ts`.
- Switches are `role=switch` with `aria-checked`, Space and Enter.
- Shortcuts: pure `input/keymap.ts` plus a `useShortcuts` hook; ignored while typing, with modifiers held, and Space stands down on a focused button so it does not double fire. Letters are printed on the keycaps.
- Telemetry strip under the map: status lamp and word (lamp colours from tokens; green and ember only for Reached and Blocked), a latency needle gauge (0 to 5 ms, linear to 1 ms then log) with the exact `formatLatency` text below (including "< 0.1 ms"), rolling mechanical counters for nodes expanded and total replans (WAAPI on the snappy spring), path cost in a well with a delta chip after a replan, Engine and API as engraved pills.
- Console corner fix: at 1440x900 the console no longer clips. It uses `overflow: visible` while everything fits, and only becomes a scroll area with a bottom fade mask (`data-scroll`, measured from the panel) when the trays do not fit. The trays share spare column height.
- Layout: at 1440x900 the console fits with no internal scroll. Below 1024 px it stacks under the telemetry with a segmented Fly / Plan / Build switch. No horizontal scroll at 390.
- Reduced motion: transitions and animations are off on all new parts and counters show the number directly.
- Not changed: DroneCanvas, `render/`, `cpp/`, `server/`, `wasm/`, the Planner interface, SimStats values. No new dependencies; no third spring.

Deviations: new instrument components live in `web/src/components/instruments/` (the brief named `controls/` and `input/` only). `vite.config.ts` test include widened to `src/**/*.test.{ts,tsx}` so the React markup tests run. Component files are `GaugeDial.tsx` and `CounterReadout.tsx` because `Gauge.tsx` vs `gauge.ts` collide on case-insensitive filesystems.

## Tests

`npm test`: 15 files, 144 tests passing (new: dialMath, keymap, gauge, counter, delta and control markup tests). `npm run build` and `VITE_BASE=/drone-obstacle-sandbox/ VITE_DEMO_MODE=true npm run build` both pass. Tests were committed before the implementation.

## Frame times

1440x900, Urban Canyon, playing, `?perf=1`, `__perfReset()` then about 12 s while turning the speed dial and flipping A*/D* four times. Headless Chromium, so frame intervals quantise to the 16.7 ms vsync.

| Engine | frames | p50 | p95 | max | over 16.7 ms | callback work p50 / p95 / max |
|---|---|---|---|---|---|---|
| C++ Wasm | 702 | 16.70 | 16.70 | 16.80 | 212 | 0.10 / 0.20 / 0.50 ms |
| TS fallback (wasm blocked) | 700 | 16.70 | 16.80 | 16.80 | 203 | 0.10 / 0.20 / 0.60 ms |

The "over 16.7" count is intervals of 16.8 ms against a 16.7 threshold, i.e. vsync jitter, not dropped frames; no frame exceeded 16.8 ms. Per-frame work stays under 1 ms.

## Evidence (docs/redesign/pr5/)

- `before-desktop-1440.png`, `before-mobile-390.png`, `after-desktop-1440.png`, `after-mobile-390.png` (Urban Canyon, playing, no `?perf=1`, HUD says C++ Wasm).
- `contact-sheet.png`: 8 frames about 100 ms apart: press Play (idle, down, released), turn speed dial, flip A* to D* Lite.
- `console-6s.webm`: about 6.7 s recording.
- `after-reduced-motion-1440.png`.

## Shortcuts

| Key | Action |
|---|---|
| Space | Play / pause |
| R | Reset drone |
| M | Switch algorithm (A* / D* Lite) |
| W | Wall tool |
| D | Wind tool |
| P | Patrol tool |
| G | Goal tool |
| E | Erase tool |
| [ / ] | Speed slower / faster |
| H | Toggle heatmap |
| L | Toggle LiDAR |

D stays Wind (printed on the keycap), so the algorithm switch is M. Dials also take arrows, PageUp/PageDown, Home and End when focused.

## Still weak

- No scenario save/load was exercised against a live API in the evidence runs (API offline state only).
- Dial feel (drag sensitivity, vertical cap drag) was checked by script and tests, not by hand on a touch device.
- The latency gauge now fills its well (dial about 150 px wide, labels 11 px) but its sweep is still small next to the counters.
- Counter roll is verified in the video only at normal speed; no per-frame check of the roll itself.
- Rocker on/off is now lamp, throw, engraved I/O and dimmed name; the throw is a small CSS perspective tilt, subtle at 42 px.
- The 1024 to 1200 px width range was not reviewed closely.
- Mobile tab switch hides trays with `display: none`, so there is no transition between tabs.
- The delta chip uses one decimal (the tested formatter), e.g. "-3.8", while path cost shows two; the stills use Dynamic Patrols at 4x to get a replan quickly.
- The mobile tablist works with Tab, Enter and Space only, not arrow keys.

## Review round 1 changes

- Telemetry strip rebalanced: the gauge fills its well height with a larger needle and 11 px tick labels, exact value under the hub. Counter drums are 28x44 px (32 px digits) centred in their wells, and the path cost value (34 px) sits on the same band. Columns: status, gauge 1.2fr, nodes, replans, cost. Strip height is unchanged at 130 px.
- Rockers: ON is thrown forward with a lit lamp, amber "I" and bright name; OFF is dark with a dead lamp, "O" and a dimmed name.
- New stills in docs/redesign/pr5/: `after-delta-chip-1440.png`, `after-rocker-off-1440.png` (LiDAR off), `after-mobile-390-plan.png`, `after-mobile-390-build.png`.
- Keyboard check at 390: Tab then Enter selects Plan, Tab then Space selects Build, and the trays swap correctly.
- Frame times (table above), contact sheet, video and reduced-motion still were re-captured after these changes.
