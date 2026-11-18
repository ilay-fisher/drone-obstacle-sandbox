import { describe, expect, it } from 'vitest';
import { arcLengths, cellCentres, chaikin, pointAt, smoothRoute, subCurveEnd } from './routeCurve';

const W = 10;
const cells = (pts: [number, number][]) => Int32Array.from(pts.map(([x, y]) => y * W + x));

function polyLength(p: Float32Array, n: number): number {
  let s = 0;
  for (let i = 1; i < n; i++) s += Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]);
  return s;
}

describe('routeCurve', () => {
  it('turns cells into cell-centre points', () => {
    const out = new Float32Array(4);
    expect(cellCentres(cells([[1, 2], [3, 4]]), W, out)).toBe(2);
    expect(Array.from(out)).toEqual([1.5, 2.5, 3.5, 4.5]);
  });

  it('chaikin keeps both end points and cuts the corner inside the polyline', () => {
    const src = Float32Array.from([0, 0, 2, 0, 2, 2]);
    const out = new Float32Array(64);
    const n = chaikin(src, 3, 2, out);
    expect([out[0], out[1]]).toEqual([0, 0]);
    expect([out[2 * n - 2], out[2 * n - 1]]).toEqual([2, 2]);
    expect(polyLength(out, n)).toBeLessThan(polyLength(src, 3));
    for (let i = 0; i < n; i++) expect(out[2 * i + 1]).toBeLessThanOrEqual(out[2 * i] + 1e-6);
  });

  it('never strays more than half a cell from the planner path', () => {
    const path = cells([[0, 0], [1, 0], [2, 1], [3, 1], [4, 2], [4, 3], [5, 4], [6, 4], [7, 3]]);
    const raw = new Float32Array(path.length * 2);
    cellCentres(path, W, raw);
    const c = smoothRoute(path, W);
    for (let i = 0; i < c.n; i++) {
      let best = Infinity;
      for (let j = 0; j + 1 < path.length; j++) {
        const ax = raw[2 * j], ay = raw[2 * j + 1], bx = raw[2 * j + 2], by = raw[2 * j + 3];
        const t = Math.max(0, Math.min(1, ((c.pts[2 * i] - ax) * (bx - ax) + (c.pts[2 * i + 1] - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
        best = Math.min(best, Math.hypot(c.pts[2 * i] - (ax + t * (bx - ax)), c.pts[2 * i + 1] - (ay + t * (by - ay))));
      }
      expect(best).toBeLessThan(0.5);
    }
    expect(c.length).toBeLessThan(polyLength(raw, path.length));
    expect([c.pts[0], c.pts[1]]).toEqual([raw[0], raw[1]]);
  });

  it('arc lengths start at 0, never decrease and end at the total length', () => {
    const c = smoothRoute(cells([[0, 0], [3, 0], [3, 3]]), W);
    expect(c.cum[0]).toBe(0);
    for (let i = 1; i < c.n; i++) expect(c.cum[i]).toBeGreaterThanOrEqual(c.cum[i - 1]);
    expect(c.cum[c.n - 1]).toBeCloseTo(c.length, 4);
    const tmp = new Float32Array(c.n);
    expect(arcLengths(c.pts, c.n, tmp)).toBeCloseTo(c.length, 4);
  });

  it('samples a point at an arc length, clamped to the ends', () => {
    const c = smoothRoute(cells([[0, 0], [4, 0]]), W);
    const p = { x: 0, y: 0 };
    pointAt(c, 0, p);
    expect([p.x, p.y]).toEqual([0.5, 0.5]);
    pointAt(c, c.length / 2, p);
    expect(p.x).toBeCloseTo(2.5, 4);
    pointAt(c, c.length * 5, p);
    expect(p.x).toBeCloseTo(4.5, 4);
    pointAt(c, -3, p);
    expect(p.x).toBeCloseTo(0.5, 4);
  });

  it('subCurveEnd returns the index of the last vertex fully inside a length', () => {
    const c = smoothRoute(cells([[0, 0], [4, 0]]), W);
    expect(subCurveEnd(c, 0)).toBe(0);
    expect(subCurveEnd(c, c.length)).toBe(c.n - 1);
    const k = subCurveEnd(c, c.length / 2);
    expect(c.cum[k]).toBeLessThanOrEqual(c.length / 2);
    expect(c.cum[k + 1]).toBeGreaterThan(c.length / 2);
  });

  it('handles empty and single-cell paths', () => {
    expect(smoothRoute(new Int32Array(0), W).n).toBe(0);
    const one = smoothRoute(cells([[2, 2]]), W);
    expect(one.n).toBe(1);
    expect(one.length).toBe(0);
  });
});
