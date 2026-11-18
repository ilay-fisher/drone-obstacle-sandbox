import { describe, expect, it } from 'vitest';
import { createPlannerFrom } from './plannerBridge';

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
