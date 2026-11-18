import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createPlannerFrom } from './plannerBridge';
import { createTsPlanner } from './tsPlanner';

describe('plannerBridge', () => {
  it('falls back to the TS planner when no wasm module is found', async () => {
    const p = await createPlannerFrom({}, {}, 48, 30);
    expect(p.mode).toBe('TS Fallback');
    expect(p.width).toBe(48);
    expect(p.height).toBe(30);
    expect(p.computePath(0, 0, 10, 0, 'astar').found).toBe(true);
  });

  it('falls back when the wasm module fails to load', async () => {
    const p = await createPlannerFrom({ '../wasm/planner.js': () => Promise.reject(new Error('boom')) }, {}, 8, 8);
    expect(p.mode).toBe('TS Fallback');
  });

  it('falls back when the module factory does not instantiate', async () => {
    const bad = () => Promise.resolve({ default: () => Promise.reject(new Error('no wasm')) });
    const p = await createPlannerFrom({ '../wasm/planner.js': bad }, {}, 8, 8);
    expect(p.mode).toBe('TS Fallback');
  });
});

describe('plannerBridge Wasm parity', () => {
  const jsPath = new URL('../wasm/planner.js', import.meta.url);
  const wasmPath = new URL('../wasm/planner.wasm', import.meta.url);
  const present = existsSync(jsPath) && existsSync(wasmPath);

  it.skipIf(!present)('loads the real Wasm module and matches TS costs', async () => {
    const bytes = readFileSync(wasmPath);
    const wasmBinary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const wasm = await createPlannerFrom({ x: () => import(/* @vite-ignore */ jsPath.href) }, {}, 20, 15, wasmBinary);
    expect(wasm.mode).toBe('C++ Wasm');
    const ts = createTsPlanner(20, 15);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let m = 0; m < 10; m++) {
      wasm.clearGrid();
      ts.clearGrid();
      for (let y = 0; y < 15; y++) {
        for (let x = 0; x < 20; x++) {
          const r = rnd();
          const v = r < 0.25 ? 1 : r < 0.35 ? 2 : 0;
          wasm.setCell(x, y, v);
          ts.setCell(x, y, v);
        }
      }
      wasm.setCell(0, 0, 0); ts.setCell(0, 0, 0);
      wasm.setCell(19, 14, 0); ts.setCell(19, 14, 0);
      const a = wasm.computePath(0, 0, 19, 14, 'astar');
      const b = ts.computePath(0, 0, 19, 14, 'astar');
      expect(a.found).toBe(b.found);
      expect(a.cost).toBeCloseTo(b.cost, 6);
      expect(wasm.computePath(0, 0, 19, 14, 'dstar').cost).toBeCloseTo(b.cost, 6);
    }
  });
});
