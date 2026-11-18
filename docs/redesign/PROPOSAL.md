# Redesign proposal: "flight instrument"

Status: **draft, waiting for owner approval** (Phase 1, no code yet).
Before screenshots: `docs/redesign/before/desktop-1440.png`, `docs/redesign/before/mobile-390.png`.

## 1. Audit of today (live demo, Urban Canyon, A*)

- **Map.** It shows a square grid with 1 px lines, flat grey blocks with a visible cell seam, and hatched wind. About 25% of the stage is dead space above and below the map.
- **Search.** The heat layer is a flat purple fill that appears all at once. No order, no front, nothing changes between replans. You cannot tell A* from D* Lite.
- **Route.** A dashed cyan line that snaps to the new route with no transition.
- **Drone.** A 1-cell white arrow with no shadow and no banking. The LiDAR is a translucent disc plus a wedge, and it looks the same before and during a blockage.
- **Controls.** Five brush buttons, three presets, a segmented switch, three actions, two sliders and two checkboxes, all equal weight. The play button, which matters most, is the same size as "Clear Map".
- **Telemetry.** A plain key-value list. "Replan Latency 0.000 ms" reads like a bug (see question 2).
- **390 px is broken.** The map is cut off on the right, telemetry values are pushed off screen, and the page scrolls sideways.
- **Look.** Generic cyan on navy, a sharp 1 px frame on every box, no single light source.

## 2. Art direction note

**One sentence:** a flight-instrument console on a dark stage, where the city is a machined relief map, the search is light spreading across it, and the drone is the only thing that moves fast.

It shares a material system with the portfolio (`ART_DIRECTION.md` v2), so the sandbox reads as the full-size version of the portfolio rig, not a different product.

- **Stage.** Blue-black graphite (`#0C1014` family), two soft drifting light pools, and fine grain. No grid.
- **Light.** One source, top-left, for buildings, keycaps, dials and shadows.
- **Material.** Anodised dark bodies, bevel highlights, contact shadows to the lower right, and radii of 10/16/24/36/pill. No sharp corner anywhere, and no 1 px frames as structure.
- **Colour.**
  - Accent: signal orange `#FF5A1F`, with amber `#FFB347` for speculars and ember `#A8300F` for shades.
  - Orange marks only what is live or pressable: the route, the drone's nav light, the active keycap, the D* repair glow.
  - A* search light is warm paper white. D* Lite repair light is ember orange, so the two algorithms differ at a glance.
  - Green is status-only (Reached); red-ember is status-only (Blocked).
- **Type.**
  - Display: Bricolage Grotesque 700.
  - UI: Instrument Sans.
  - Readouts: Martian Mono with tabular figures, engraved on wells.
  - All three self-hosted, about 90 KB woff2 in total.
- **Motion.**
  - Only the two portfolio springs: soft (880 ms, about 7% overshoot) and snappy (350 ms).
  - Everything settles; nothing fades linearly.
  - One loud motion at a time. The replan sequence is the loud motion, and while it plays the controls and readouts only tick.

## 3. Proposal by area

### A. Map as the hero (`render/` static layers)

- **Layout.** The map fills the stage edge to edge at the map's aspect ratio, and the stage hugs it, so there is no dead space. Desktop: the map takes about 70% of the width with a console column on the right. Mobile: the map is full width on top, with a docked console below it in tabs.
- **Ground.** A faint dot at each cell centre. No lines.
- **Buildings.**
  - Joined wall cells become one rounded block.
  - Each block gets a stable pseudo-random height from a cell hash.
  - The top face catches the light, there is a darker side, and a contact shadow falls lower-right.
  - Built once into a cached layer, and rebuilt only when cells change.
  - A painted wall drops in on the snappy spring; an erased wall lifts out.
- **Wind zones.** One merged soft region, with thin flow lines drifting along it at a slow, constant ambient speed. The lines are cached sprites translated per frame, so the fill uses no gradients.
- **Patrols.** Rounded ember pucks with a heading notch and a short motion smear.

### B. The search as the show (replan sequence, about 1.1 s)

1. **Wavefront.** Visited cells flood out in a soft front over about 420 ms, as merged blobs from cached glow sprites. A bright rim marks the leading edge, then the cells settle to a dim resting glow.
2. **Draw-on.** After about 150 ms, the new route draws itself from the drone to the goal over about 420 ms, with a bright amber head. The display uses a smoothed curve; the planner path is unchanged.
3. **Dissolve.** The old route breaks into dots and dissolves over about 900 ms, behind the new one.
4. **A* vs D* Lite.**
   - A* replans flood the whole searched region from the drone in paper white.
   - D* Lite replans flood only the cells its incremental repair touched, outward from the changed cells, in ember.
   - A "repaired N / searched M" chip pins next to the flood for one second.
   - This is honest: the C++ heat buffer already contains only this call's expansions, so D*'s smaller region is real data.
5. **Expansion order.** The engine exposes expansion counts per cell, not the order, and `cpp/` is off limits. So the front is reconstructed by a BFS through the visited cells from the search origin: the drone for A*, the goal and changed cells for D* Lite. The README will say so in one line (see question 1).

### C. A drone with character

- **Body.** A top-down quad: four rotor discs with a motion blur ring, an anodised body, and an orange nav light.
- **Banking.** It leans into turns: the body skews and its shadow offsets with speed and turn rate, settling on the soft spring. Its shadow on the ground shrinks as it climbs over buildings.
- **LiDAR.** A real rotating sweep: a 50° fan with a phosphor trail that decays behind it. Cells the beam touches flash faintly. Walls inside the radius that the beam hits get a tick mark.
- **Blockage.** A ring pulse expands from the drone (the one loud motion), with a short recoil. The status display flips to REPLANNING, and then the wavefront starts.
- **Goal.** A landing pad with a slow breathing ring. On Reached, the drone settles onto the pad with a damped overshoot, and the pad lamp turns green.

### D. Controls as hardware, grouped by task

The console is in three groups.

1. **Fly.**
   - A large play/pause keycap.
   - Reset and Clear keycaps.
   - Speed as a rotary dial with detents at 0.5–4x.
2. **Plan.**
   - An A* / D* Lite toggle switch with a throw and a snap.
   - LiDAR radius as a dial with detents at 3–8.
   - Heatmap and LiDAR overlays as two small rocker switches.
3. **Build.**
   - Tool keycaps with engraved legends: Wall W, Wind D, Patrol P, Goal G, Erase E. Each is press-squashed on the snappy spring.
   - Presets as three cartridge-style chips.
   - Scenarios, in a collapsed tray. In demo mode the tray shows the "run locally" note.

Every control is a real `<button>`, `<input type=range>` or `role=switch` underneath, with visible focus rings and keyboard shortcuts: Space play, A/D algorithm, W/D/P/G/E tools, [ and ] speed, R reset. Dials take arrows and Page Up/Down. The cursor gets no custom ring (the portfolio cursor is out of scope).

### E. Telemetry as instruments

- **Status display.** A single large status lamp plus a word: EN ROUTE / REPLANNING / REACHED / BLOCKED.
- **Latency.** A needle gauge (0–5 ms, with a log scale after 1 ms) that springs to each new value. The exact number appears below it in mono.
- **Counters.** Nodes expanded and total replans as mechanical counters: the digits roll on the snappy spring.
- **Path cost.** A numeric well with a delta chip (+3.2) after a replan.
- **Engine and API.** Engine (C++ Wasm / TS Fallback) and API state as small engraved pills.
- **Values.** Every number shown is exactly what `SimStats` holds today. Only the presentation changes.

### F. Guided intro (first visit only, about 10 s, skippable)

The intro is a scripted run on Urban Canyon, with the console dimmed and a 4-step caption pill:

1. "This is a city. The drone has to cross it." The camera rests on the map; buildings drop in, staggered.
2. "It plans a route with A*." The wavefront plays, then the route draws.
3. "Something blocks the way." A patrol slides in, the LiDAR catches it, and the scan pulse plays.
4. "It repairs only what changed with D* Lite." The ember repair flood plays, then the new route.

Then the console lights up with "Your turn: draw a wall in its path." Skip with Esc or any click. The intro is stored in `localStorage` so it doesn't repeat, and a "?" keycap replays it. Under reduced motion it becomes a static 4-panel caption card.

## 4. Engineering constraints (how 60 FPS and the rules are kept)

- No changes to `cpp/`, `server/`, the `Planner` interface or `SimStats`. The renderer reads the existing views plus a new pure `ReplanEvent` emitted by `Simulation`: changed cells, mode, and heat snapshot. That event is additive, and it has unit tests.
- **Rendering.**
  - Cached layers: ground, buildings and wind base are rebuilt only on change.
  - Flood and glow sprites are pre-rendered, and no gradients are built per frame.
  - DPR is capped at 2.
  - The rAF loop pauses when the canvas is off screen (IntersectionObserver) or the tab is hidden (visibilitychange).
- **Pure modules with tests.** Springs, flood-order reconstruction, polyline smoothing and draw-on arc length, dial detent mapping, keyboard map, intro script timeline, and the reduced-motion "finished state" selector.
- **Reduced motion.** No flood, draw-on, sweep or bank. The final states show immediately and LiDAR is a static ring.
- **No new runtime dependencies.** Springs are about 40 lines of local code, as in the portfolio. Fonts are self-hosted.

## 4b. Owner decisions (2026-11-18)

1. Flood order: rebuild it in JS (BFS over the visited cells from the origin), with a one-line README note.
2. Latency below the timer's resolution is shown as "< 0.1 ms"; the measured value is unchanged.
3. Sonnet agents build on branches; the manager reviews visuals, iterates and merges.
4. The intro plays on first visit only, and the "?" keycap replays it.

## 5. PR plan (one per area, each from `main`)

| # | Branch | Scope |
|---|---|---|
| 1 | `feat/ui-foundation` | tokens, fonts, springs, stage layout, the 390 px fix, the loop pause/visibility, and the frame-time probe (`?perf=1`) |
| 2 | `feat/ui-map` | relief buildings, wind flow, patrol pucks, goal pad, edit drop/lift |
| 3 | `feat/ui-search-show` | `ReplanEvent`, flood order, wavefront, draw-on, dissolve, A*/D* contrast |
| 4 | `feat/ui-drone` | quad body, bank and shadow, LiDAR sweep, scan pulse, landing |
| 5 | `feat/ui-console` | keycaps, dials, switches, shortcuts, and the instrument telemetry |
| 6 | `feat/ui-intro` | guided intro, replay keycap, and the README screenshot |

PRs 2, 4 and 5 can run in parallel after 1. PR 3 lands after 2 because it shares the renderer layers.

Each PR carries:

- before and after screenshots at 1440x900 and 390x844
- an 8-frame contact sheet (about 100 ms apart, through a replan)
- a short WebM
- frame-time p50/p95/max from a 10 s scripted run, for both Wasm and TS fallback
- a "still weak" list

I review my own frames and iterate at least twice before opening the PR.
