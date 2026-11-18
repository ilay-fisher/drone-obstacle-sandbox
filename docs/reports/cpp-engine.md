# C++ engine report (Agent A)

## What was built
- `cpp/planner.hpp`, `cpp/planner.cpp`: `DronePlanner` per CONTRACTS.md section 2, with A* (mode 0) and incremental D* Lite (mode 1) over flat `uint8` grids, plus LiDAR `hasPathObstruction`.
- `cpp/bindings.cpp`: embind class with every contract method and zero-copy `getGridView`, `getHeatView`, `getPathView` (`typed_memory_view`).
- `cpp/build.sh`: builds in Docker `emscripten/emsdk:4.0.10` (`--platform linux/amd64`), or with a local `em++` when `USE_LOCAL_EMCC=1`. Output in `web/src/wasm/` (`planner.js`, `planner.wasm`, `planner.d.ts`, committed).
- `cpp/test_planner.cpp`: 17 standalone tests, no framework.
- `.github/workflows/ci-cpp.yml`: job `test` (g++, `-Werror`) and job `wasm` (emsdk container).

## Decisions
- **Heap**: own `IndexedMinHeap` (binary heap + node-to-position map). Supports decrease-key and remove-by-id in O(log n), so no duplicate entries and capacity is exactly the node count. Key is a lexicographic pair, which serves A* (f, h) and D* Lite (k1, k2).
- **Two separate search states**: A* and D* Lite each own a heap and node arrays, so running A* never corrupts the persistent D* Lite queue.
- **No allocation in the hot path**: all vectors (grid, heat, path, node arrays, heaps, pending list) are sized in the constructor; `computePath` only fills and indexes them.
- **D* Lite**: backward search from the goal, `g`/`rhs`, km key modifier when the start moves. `setCell` records changed cells in a deduplicated pending list; the next D* call runs UpdateVertex on each changed cell and its 8 neighbours (this covers cost changes and the diagonal corner rule). A new goal re-initializes the state.
- **Floating point ties (fixed in fix/dstar-false-blocked)**: keys that are mathematically equal can differ by a few ulps (sum of sqrt(2) terms vs closed-form octile). The heap stays exactly ordered, and the D* Lite stop test expands while the queue minimum is below the start key plus 1e-9. An earlier version used a tolerant comparison inside the heap order, which broke the heap invariant and made D* Lite report "no path" after a start jump plus a wall drag.
- **Path cost** is reported as the sum of step costs along the extracted path in both modes, and tests recheck it against the path.
- **Heat**: `uint8` reset every call, saturating at 255. For D* Lite it shows only cells re-expanded in that call.
- **Obstruction**: scans stored path cells from `fromIndex`, filters by Euclidean radius, then Bresenham line of sight (intermediate walls occlude).

## Verification
- Tests include an independent O(N^2) Dijkstra and compare A*, D* Lite and Dijkstra on 50 seeded random maps, plus 30 random edit/move sequences for D* Lite against a fresh A*.
- Also run clean under `-fsanitize=address,undefined`.
- Wasm smoke test with Node (loading `planner.wasm` through `wasmBinary`): path, views and replan work.

## Line counts
See PR description (`wc -l`). planner.hpp + planner.cpp + bindings.cpp = 618 lines.

## Deviations and known limits
- Additive public accessors `gridData()`, `heatData()`, `pathData()` (used by bindings and tests); contract methods unchanged.
- `getCell` outside the map returns 1 (wall), since the contract is silent.
- `setCell` also ignores values outside 0..2.
- `getGridView`/`getHeatView`/`getPathView` are typed `any` in the generated `planner.d.ts` (emscripten does not type `val`); the web bridge should cast to `Uint8Array`/`Int32Array`.
- D* Lite expansions in the first (initialization) call can exceed A*; the benefit is on later replans.
- `hasPathObstruction` needs a prior `computePath` (it reads the stored path).
