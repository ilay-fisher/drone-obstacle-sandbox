# Web visualizer report (Agent B)

## What was built
Vite + React 18 + TypeScript (strict) app under `web/`, with Vitest.

- `engine/plannerBridge.ts`: `createPlanner()` per CONTRACTS section 3. Discovers the Wasm module with `import.meta.glob('../wasm/planner.js')` (and the `.wasm` URL with a `?url` glob), so the build passes with or without the artifacts. Uses zero-copy views, re-fetched only if detached. Falls back to the TS planner with a logged warning. `createPlannerFrom` exposes the same logic for tests.
- `engine/tsPlanner.ts`: A* and incremental D* Lite with identical semantics to C++ (8-dir, no corner cutting, octile, 4x wind, heat saturating at 255). Indexed binary heap, all typed arrays allocated once. Out-of-range `getCell` returns 1, `setCell` ignores values outside 0..2.
- `engine/simulation.ts`: React-free tick logic. Patrols are stamped into the grid and restore the value beneath them; LiDAR check through `hasPathObstruction`; replans on obstruction, on a wall in the next path cell, and on user edits; statuses Idle / En Route / Replanning / Reached / Blocked. Blocked retries every 0.5 s and ends the mission as `blocked` after 3 s. Mission end posts to `/api/runs`.
- `components/`: `DroneCanvas` (single rAF loop: tick + draw, wind hatch pattern built once, precomputed heat palette, LiDAR circle with sweep wedge, drag painting with interpolation, hover tooltip), `ControlPanel`, `TelemetryHud`.
- `api/client.ts`: typed client, 3 s timeout, `ApiError{offline}`; the sandbox works with no server.

## Render loop and simulation
`DroneCanvas` owns one `requestAnimationFrame` loop: `sim.tick(dt)` (dt clamped to 50 ms) then `draw()`. React only holds hover state and a 5 Hz telemetry snapshot, so the 60 FPS path never touches React state. `Simulation.tick` mutates preallocated pools and stats in place.

## Decisions
- Only `Planner` types cross the engine boundary, so Wasm and TS are interchangeable at runtime.
- `/health` is proxied in addition to `/api` (contract lists `/health` outside the prefix) for the API status dot.
- The first plan after reset is not counted as a replan; edits, obstructions and mode switches are.
- vitest 3 (not 2) so its bundled vite matches vite 6 types.

## Tests
39 Vitest tests: planner optimal costs, corner cutting, wind trade-off both ways, A* == D* Lite on 30 seeded maps, D* repair, unreachable goal, heat, LiDAR cases; simulation; API client (base64, offline); bridge fallbacks; and a Wasm vs TS cost parity test that loads the real `planner.wasm` in Node via `wasmBinary` (skipped automatically if the artifact is absent).

## Known limits
- Non-test TS/TSX is about 1,700 lines (including comments and blanks), above the 1,100-1,300 budget, mostly the planner (421) and simulation (359) with TSDoc.
- Patrols hop one cell at a time (6 cells/s) without interpolation.
- Scenarios whose grid size differs from 48x30 are rejected on load.
- Save/Load and run recording were verified only against mocked fetch; no live server was available.
- Screenshot `web-ui.png` was taken from the dev server with the Wasm engine active and the API offline.
