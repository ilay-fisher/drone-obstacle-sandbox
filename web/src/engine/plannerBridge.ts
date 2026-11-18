import { log } from '../logger';
import { createTsPlanner } from './tsPlanner';

export type EngineMode = 'C++ Wasm' | 'TS Fallback';
export type CellValue = 0 | 1 | 2;
export type PlanMode = 'astar' | 'dstar';

/** Result of one planning call. `path` may be a view into planner memory; copy it to keep it. */
export interface PlanResult {
  found: boolean;
  path: Int32Array;
  cost: number;
  expanded: number;
  latencyMs: number;
}

/** Engine-agnostic planner surface (CONTRACTS section 3). */
export interface Planner {
  readonly mode: EngineMode;
  readonly width: number;
  readonly height: number;
  setCell(x: number, y: number, v: CellValue): void;
  getCell(x: number, y: number): CellValue;
  clearGrid(): void;
  computePath(sx: number, sy: number, gx: number, gy: number, mode: PlanMode): PlanResult;
  hasPathObstruction(droneX: number, droneY: number, radius: number, fromIndex: number): boolean;
  grid(): Uint8Array;
  heat(): Uint8Array;
  replanCount(): number;
}

/** Subset of the embind `DronePlanner` class used by the bridge. */
interface WasmPlanner {
  setCell(x: number, y: number, v: number): void;
  getCell(x: number, y: number): number;
  clearGrid(): void;
  computePath(sx: number, sy: number, gx: number, gy: number, mode: number): boolean;
  hasPathObstruction(x: number, y: number, r: number, from: number): boolean;
  getLastExpandedCount(): number;
  getLastReplanMs(): number;
  getPathCost(): number;
  getPathLength(): number;
  getReplanCount(): number;
  getGridView(): Uint8Array;
  getHeatView(): Uint8Array;
  getPathView(): Int32Array;
}

interface WasmModule {
  DronePlanner: new (w: number, h: number) => WasmPlanner;
}
type WasmFactory = (opts: { locateFile: (file: string) => string; wasmBinary?: ArrayBuffer }) => Promise<WasmModule>;

/** A buffer view is detached when Wasm memory grows; re-fetch it in that case. */
function live<T extends Uint8Array | Int32Array>(view: T | null, fetch: () => T): T {
  return view !== null && view.buffer.byteLength > 0 ? view : fetch();
}

/** Adapter exposing the embind class through the shared `Planner` surface using zero-copy views. */
class WasmBackedPlanner implements Planner {
  readonly mode = 'C++ Wasm' as const;
  private gridView: Uint8Array | null = null;
  private heatView: Uint8Array | null = null;
  private pathView: Int32Array | null = null;

  constructor(private readonly inst: WasmPlanner, readonly width: number, readonly height: number) {}

  setCell(x: number, y: number, v: CellValue): void { this.inst.setCell(x, y, v); }
  getCell(x: number, y: number): CellValue { return this.inst.getCell(x, y) as CellValue; }
  clearGrid(): void { this.inst.clearGrid(); }
  replanCount(): number { return this.inst.getReplanCount(); }
  hasPathObstruction(x: number, y: number, r: number, from: number): boolean {
    return this.inst.hasPathObstruction(x, y, r, from);
  }
  grid(): Uint8Array { return (this.gridView = live(this.gridView, () => this.inst.getGridView())); }
  heat(): Uint8Array { return (this.heatView = live(this.heatView, () => this.inst.getHeatView())); }

  computePath(sx: number, sy: number, gx: number, gy: number, mode: PlanMode): PlanResult {
    const found = this.inst.computePath(sx, sy, gx, gy, mode === 'astar' ? 0 : 1);
    this.pathView = live(this.pathView, () => this.inst.getPathView());
    return {
      found,
      path: this.pathView.subarray(0, found ? this.inst.getPathLength() : 0),
      cost: found ? this.inst.getPathCost() : -1,
      expanded: this.inst.getLastExpandedCount(),
      latencyMs: this.inst.getLastReplanMs(),
    };
  }
}

type Loader = () => Promise<unknown>;

/**
 * Builds a planner from explicit module and asset maps (the shape `import.meta.glob`
 * produces). Split from `createPlanner` so tests can exercise the fallback paths without
 * depending on whether the Wasm artifacts are present in the working tree. `wasmBinary`
 * lets Node-based tests supply the module bytes instead of fetching them.
 */
export async function createPlannerFrom(
  modules: Record<string, Loader>,
  wasmUrls: Record<string, Loader>,
  width: number,
  height: number,
  wasmBinary?: ArrayBuffer,
): Promise<Planner> {
  const loader = Object.values(modules)[0];
  if (!loader) {
    log.info('engine: no Wasm artifact found, using TS fallback');
    return createTsPlanner(width, height);
  }
  try {
    const factory = ((await loader()) as { default: WasmFactory }).default;
    const urlLoader = Object.values(wasmUrls)[0];
    const wasmUrl = urlLoader ? ((await urlLoader()) as string) : null;
    const mod = await factory({
      wasmBinary,
      locateFile: (file) => (wasmUrl && file.endsWith('.wasm') ? wasmUrl : file),
    });
    log.info('engine: C++ Wasm planner loaded');
    return new WasmBackedPlanner(new mod.DronePlanner(width, height), width, height);
  } catch (err) {
    log.warn('engine: Wasm load failed, using TS fallback', err);
    return createTsPlanner(width, height);
  }
}

// The globs resolve to empty maps when the C++ workstream has not committed artifacts yet.
const wasmModules = import.meta.glob('../wasm/planner.js') as Record<string, Loader>;
const wasmUrls = import.meta.glob('../wasm/planner.wasm', { query: '?url', import: 'default' }) as Record<string, Loader>;

/**
 * Creates the best available planner: C++ Wasm if its artifacts exist and instantiate,
 * otherwise the TypeScript implementation with identical semantics.
 */
export function createPlanner(width: number, height: number): Promise<Planner> {
  return createPlannerFrom(wasmModules, wasmUrls, width, height);
}
