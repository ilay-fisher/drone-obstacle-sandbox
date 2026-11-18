import { describe, expect, it } from 'vitest';
import { FloodOrder, frontCount } from './floodOrder';

/** '#' is a visited cell (heat above 0), '.' is not. */
function heatOf(rows: string[]): { heat: Uint8Array; w: number; h: number } {
  const h = rows.length;
  const w = rows[0].length;
  const heat = new Uint8Array(w * h);
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === '#') heat[y * w + x] = 1 + ((x + y) % 3); }));
  return { heat, w, h };
}

describe('FloodOrder', () => {
  it('ranks a corridor from the origin end, 0 at the origin and 1 at the far end', () => {
    const { heat, w, h } = heatOf(['#####']);
    const f = new FloodOrder(w, h);
    f.compute(heat, [0], 1);
    expect(f.count).toBe(5);
    expect(Array.from(f.rank)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(Array.from(f.order.subarray(0, 5))).toEqual([0, 1, 2, 3, 4]);
  });

  it('gives unvisited cells rank -1 and keeps every visited rank in 0..1', () => {
    const { heat, w, h } = heatOf(['..#..', '.###.', '..#..']);
    const f = new FloodOrder(w, h);
    f.compute(heat, [7], 1);
    for (let i = 0; i < heat.length; i++) {
      if (heat[i] === 0) expect(f.rank[i]).toBe(-1);
      else {
        expect(f.rank[i]).toBeGreaterThanOrEqual(0);
        expect(f.rank[i]).toBeLessThanOrEqual(1);
      }
    }
    expect(f.rank[7]).toBe(0);
  });

  it('is nondecreasing along the order and the order lists every visited cell once', () => {
    const { heat, w, h } = heatOf(['#######', '#.###.#', '#######']);
    const f = new FloodOrder(w, h);
    f.compute(heat, [0], 1);
    const seen = new Set<number>();
    for (let k = 0; k < f.count; k++) {
      seen.add(f.order[k]);
      if (k > 0) expect(f.rank[f.order[k]]).toBeGreaterThanOrEqual(f.rank[f.order[k - 1]]);
    }
    expect(seen.size).toBe(heat.reduce((n, v) => n + (v ? 1 : 0), 0));
    expect(f.count).toBe(seen.size);
  });

  it('floods through visited cells only, so a gap delays the far side', () => {
    // Two rows joined only at the right end: the cell below the origin is near in space but far by flood.
    const { heat, w, h } = heatOf(['#####', '....#', '#####']);
    const f = new FloodOrder(w, h);
    f.compute(heat, [0], 1);
    expect(f.rank[2 * w + 0]).toBeGreaterThan(f.rank[0 * w + 4]);
  });

  it('appends visited cells the origin cannot reach through visited cells, ordered by distance', () => {
    const { heat, w, h } = heatOf(['###...###..#']);
    const f = new FloodOrder(w, h);
    f.compute(heat, [0], 1);
    expect(f.count).toBe(8);
    const a = f.rank[6];
    const b = f.rank[8];
    const far = f.rank[11];
    expect(a).toBeGreaterThan(f.rank[2]);
    expect(b).toBeGreaterThan(a);
    expect(far).toBeGreaterThan(b);
    expect(far).toBe(1);
  });

  it('starts at the nearest visited cell when the origin itself was not visited (a new wall)', () => {
    const { heat, w, h } = heatOf(['.....', '.###.', '.....']);
    const f = new FloodOrder(w, h);
    f.compute(heat, [0 * w + 1], 1);
    expect(f.rank[1 * w + 1]).toBe(0);
    expect(f.rank[1 * w + 3]).toBe(1);
  });

  it('floods from several origins at once', () => {
    const { heat, w, h } = heatOf(['#######']);
    const f = new FloodOrder(w, h);
    f.compute(heat, [0, 6], 2);
    expect(f.rank[0]).toBe(0);
    expect(f.rank[6]).toBe(0);
    expect(f.rank[3]).toBe(1);
  });

  it('spreads roughly round: a diagonal cell at 3,3 is nearer than a straight one at 5,0', () => {
    const rows = Array.from({ length: 9 }, () => '#########');
    const { heat, w, h } = heatOf(rows);
    const f = new FloodOrder(w, h);
    f.compute(heat, [0], 1);
    expect(f.rank[3 * w + 3]).toBeLessThan(f.rank[0 * w + 5]);
    expect(f.rank[3 * w + 3]).toBeGreaterThan(f.rank[0 * w + 2]);
  });

  it('handles an empty heat map and reuses its buffers between calls', () => {
    const { heat, w, h } = heatOf(['#####']);
    const f = new FloodOrder(w, h);
    f.compute(new Uint8Array(5), [0], 1);
    expect(f.count).toBe(0);
    const rankRef = f.rank;
    f.compute(heat, [0], 1);
    expect(f.count).toBe(5);
    expect(f.rank).toBe(rankRef);
  });

  it('frontCount finds how many cells the front has passed', () => {
    const { heat, w, h } = heatOf(['#####']);
    const f = new FloodOrder(w, h);
    f.compute(heat, [0], 1);
    expect(frontCount(f, -0.0001)).toBe(0);
    expect(frontCount(f, 0)).toBe(1);
    expect(frontCount(f, 0.5)).toBe(3);
    expect(frontCount(f, 0.74)).toBe(3);
    expect(frontCount(f, 1)).toBe(5);
  });
});
