# Interface Contracts

These contracts are the single source of truth shared by all workstreams. They let the
C++ engine, the web visualizer, and the backend API be built in parallel. Any change to a
contract must be proposed in a PR that edits this file first and is approved by the
project manager.

## 1. Grid model (shared by every component)

| Item | Value |
|---|---|
| Default grid size | `48 x 30` cells (width x height) |
| Cell index | `idx = y * width + x` (row-major flat 1D) |
| Cell values (`uint8`) | `0` free, `1` wall/obstacle, `2` wind/jamming zone |
| Traversal cost | straight step `1.0`, diagonal step `sqrt(2)`; multiplied by `4.0` when the destination cell is `2` |
| Movement | 8-directional. Diagonal moves are forbidden if either orthogonal neighbor is a wall (no corner cutting) |
| Heuristic | Octile distance: `dx + dy + (sqrt(2) - 2) * min(dx, dy)`, using the minimum step cost (`1.0`), so it stays admissible |

## 2. C++ engine: `DronePlanner` (cpp/planner.hpp)

```cpp
class DronePlanner {
public:
  DronePlanner(int width, int height);           // allocates every buffer once

  // Grid editing. Out-of-range coordinates are ignored.
  void setCell(int x, int y, int value);         // records the change for D* Lite
  int  getCell(int x, int y) const;
  void clearGrid();                              // all cells 0, resets search state

  // Planning. mode 0 = A* (full search), mode 1 = D* Lite (incremental).
  // D* Lite reuses its search state while the goal is unchanged and repairs only
  // the cells changed through setCell since the last call; a new goal re-initializes it.
  // Returns true if a path was found. Clears and refills visited_heat_.
  bool computePath(int sx, int sy, int gx, int gy, int mode);

  // LiDAR: true if any wall cell (value 1) lies on the stored path from
  // path index `fromIndex` onward, within `sensorRadius` cells (Euclidean) of the drone,
  // AND is in line of sight of the drone (Bresenham ray does not cross another wall first).
  bool hasPathObstruction(int droneX, int droneY, int sensorRadius, int fromIndex) const;

  // Telemetry for the last computePath call.
  int    getLastExpandedCount() const;
  double getLastReplanMs() const;                // measured with std::chrono::steady_clock
  double getPathCost() const;                    // INFINITY-safe: returns -1 when no path
  int    getPathLength() const;                  // number of cells, start..goal inclusive
  int    getReplanCount() const;                 // number of computePath calls since clearGrid

  int width() const;
  int height() const;
};
```

Zero-copy views exposed by `cpp/bindings.cpp` (embind, `emscripten::typed_memory_view`):

| JS method | Type | Content |
|---|---|---|
| `getGridView()` | `Uint8Array(width*height)` | occupancy/cost grid |
| `getHeatView()` | `Uint8Array(width*height)` | expansions per cell for the last search, saturating at 255 |
| `getPathView()` | `Int32Array(width*height)` | first `getPathLength()` entries are flat cell indices from start to goal |

Views must be re-fetched after any call that might grow Wasm memory. The engine never
reallocates its own buffers after construction, so in practice they stay valid.

### Wasm artifacts
`cpp/build.sh` compiles with:
`em++ -std=c++17 -O3 --bind -sEXPORT_ES6=1 -sENVIRONMENT=web -sALLOW_MEMORY_GROWTH=1 -sMODULARIZE=1 -sEXPORT_NAME=createPlannerModule`
into `web/src/wasm/planner.js` + `web/src/wasm/planner.wasm` (+ `planner.d.ts`).
It runs inside the `emscripten/emsdk:4.0.10` Docker image, so no local install is required.
The C++ workstream owns everything in `web/src/wasm/` and commits the built artifacts.

## 3. Web bridge: `web/src/engine/plannerBridge.ts`

```ts
export type EngineMode = 'C++ Wasm' | 'TS Fallback';
export type CellValue = 0 | 1 | 2;
export type PlanMode = 'astar' | 'dstar';

export interface PlanResult {
  found: boolean;
  path: Int32Array;       // flat indices start..goal (a view or copy, length = path length)
  cost: number;           // -1 when not found
  expanded: number;
  latencyMs: number;
}

export interface Planner {
  readonly mode: EngineMode;
  readonly width: number;
  readonly height: number;
  setCell(x: number, y: number, v: CellValue): void;
  getCell(x: number, y: number): CellValue;
  clearGrid(): void;
  computePath(sx: number, sy: number, gx: number, gy: number, mode: PlanMode): PlanResult;
  hasPathObstruction(droneX: number, droneY: number, radius: number, fromIndex: number): boolean;
  grid(): Uint8Array;     // zero-copy view in Wasm mode
  heat(): Uint8Array;     // zero-copy view in Wasm mode
  replanCount(): number;
}

export async function createPlanner(width: number, height: number): Promise<Planner>;
```

Loading rule: discover the module with `import.meta.glob('../wasm/planner.js')`, so the
build succeeds whether or not the artifact exists. If it is missing or fails to
instantiate, log a warning and return the TypeScript fallback, which implements the same
algorithms (A* and D* Lite) over the same flat buffers.

## 4. Backend REST API (server/, default port 3001, prefix `/api`)

All bodies are JSON, validated with zod. Errors use `{ "error": { "code": string, "message": string } }`.

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/health` | none | `{ status: "ok", db: "ok" \| "down" }` |
| GET | `/api/scenarios` | none | `ScenarioSummary[]` (id, name, width, height, createdAt) |
| GET | `/api/scenarios/:id` | none | `Scenario` or 404 |
| POST | `/api/scenarios` | `ScenarioInput` | 201 `Scenario` |
| DELETE | `/api/scenarios/:id` | none | 204 or 404 |
| POST | `/api/runs` | `RunInput` | 201 `Run` |
| GET | `/api/runs` | `?scenarioId=&limit=` (limit 1-100, default 20) | `Run[]` newest first |
| GET | `/api/stats` | none | `{ totalRuns, avgReplanMs, p95ReplanMs, byEngine: { mode, runs, avgReplanMs }[] }` |

```ts
type ScenarioInput = {
  name: string;                       // 1..80 chars
  width: number; height: number;      // 8..128
  cells: string;                      // base64 of the Uint8Array grid, length must equal width*height
  start: { x: number; y: number };
  goal:  { x: number; y: number };
  patrols: { x: number; y: number; dx: number; dy: number }[];  // up to 32
};
type Scenario = ScenarioInput & { id: string; createdAt: string };   // id = uuid

type RunInput = {
  scenarioId: string | null;
  engineMode: 'C++ Wasm' | 'TS Fallback';
  planMode: 'astar' | 'dstar';
  status: 'reached' | 'blocked' | 'aborted';
  replans: number; avgReplanMs: number; maxReplanMs: number;
  nodesExpanded: number; pathCost: number; durationMs: number;
};
type Run = RunInput & { id: string; createdAt: string };
```

The web app calls the API through the Vite dev proxy (`/api` -> `http://localhost:3001`).
The visualizer must stay fully usable when the API is down: Save/Load buttons show an
"API offline" state and the simulation is unaffected.
