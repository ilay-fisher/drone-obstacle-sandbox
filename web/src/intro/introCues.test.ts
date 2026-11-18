import { describe, expect, it } from 'vitest';
import { buildPreset } from '../scenarios/presets';
import { blockCellsAhead, cellsWithValue, dueCount, staggerOrder } from './introCues';

describe('cellsWithValue', () => {
  it('lists the flat indices holding a value, ascending', () => {
    const cells = Uint8Array.from([0, 1, 2, 1, 0, 2]);
    expect(Array.from(cellsWithValue(cells, 1))).toEqual([1, 3]);
    expect(Array.from(cellsWithValue(cells, 2))).toEqual([2, 5]);
  });
});

describe('staggerOrder', () => {
  const w = 48;
  const h = 30;
  const walls = cellsWithValue(buildPreset('Urban Canyon', w, h).cells, 1);

  it('is a deterministic permutation of its input', () => {
    const a = staggerOrder(walls, w);
    const b = staggerOrder(walls, w);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.length).toBe(walls.length);
    expect(Array.from(a).sort((x, y) => x - y)).toEqual(Array.from(walls));
  });

  it('sweeps roughly left to right so the city assembles as a wave', () => {
    const o = staggerOrder(walls, w);
    const q = Math.floor(o.length / 4);
    const meanX = (from: number, to: number) => {
      let s = 0;
      for (let i = from; i < to; i++) s += o[i] % w;
      return s / (to - from);
    };
    expect(meanX(0, q)).toBeLessThan(meanX(o.length - q, o.length) - 10);
  });
});

describe('dueCount', () => {
  it('is 0 at or before the start, all at the end, monotone in between', () => {
    expect(dueCount(100, -5, 1000)).toBe(0);
    expect(dueCount(100, 0, 1000)).toBe(0);
    expect(dueCount(100, 1000, 1000)).toBe(100);
    expect(dueCount(100, 5000, 1000)).toBe(100);
    let prev = 0;
    for (let t = 0; t <= 1000; t += 25) {
      const c = dueCount(100, t, 1000);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
    expect(dueCount(100, 500, 1000)).toBe(50);
  });
  it('handles empty lists and bad input', () => {
    expect(dueCount(0, 500, 1000)).toBe(0);
    expect(dueCount(10, Number.NaN, 1000)).toBe(0);
    expect(dueCount(10, 500, 0)).toBe(10);
  });
});

describe('blockCellsAhead', () => {
  const w = 20;
  const h = 10;
  // a straight route along row 5 from x=1 to x=18
  const path = Int32Array.from({ length: 18 }, (_, i) => 5 * w + 1 + i);

  it('puts a vertical wall across the route a fixed number of cells ahead of the drone', () => {
    const cells = blockCellsAhead(path, 3, path.length, w, h, 9, 2);
    const xs = new Set(cells.map((c) => c.x));
    expect(Array.from(xs)).toEqual([1 + 3 + 9]);
    expect(cells.map((c) => c.y).sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7]);
  });

  it('stays inside the map', () => {
    const cells = blockCellsAhead(path, 3, path.length, w, 4, 9, 2);
    for (const c of cells) {
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThan(4);
    }
  });

  it('never targets the last cells of the route (the goal) even when little is left', () => {
    const cells = blockCellsAhead(path, 14, path.length, w, h, 9, 2);
    const lastX = path[path.length - 1] % w;
    for (const c of cells) expect(c.x).toBeLessThan(lastX);
    expect(cells.length).toBeGreaterThan(0);
  });

  it('returns nothing when there is no route', () => {
    expect(blockCellsAhead(new Int32Array(0), 0, 0, w, h, 9, 2)).toEqual([]);
    expect(blockCellsAhead(path, 0, 2, w, h, 9, 2)).toEqual([]);
  });
});
