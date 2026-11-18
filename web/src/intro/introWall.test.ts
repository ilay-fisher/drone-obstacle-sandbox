import { describe, expect, it } from 'vitest';
import { buildPreset } from '../scenarios/presets';
import { pickWall } from './introCues';

const W = 48;
const H = 30;
const city = buildPreset('Urban Canyon', W, H);
const route = (y: number, x0: number, x1: number) => Int32Array.from({ length: x1 - x0 + 1 }, (_, i) => y * W + x0 + i);
const args = (grid: Uint8Array, path: Int32Array, pathIdx = 2) => ({ grid, width: W, height: H, path, pathIdx, pathLen: path.length, lidarRadius: 6 });
const isWall = (g: Uint8Array, x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && g[y * W + x] === 1;

describe('pickWall', () => {
  it('builds a straight wall of 3 to 5 cells across a horizontal route, centred on a route cell', () => {
    const path = route(15, 2, 45);
    const w = pickWall(args(city.cells, path));
    expect(w.length).toBeGreaterThanOrEqual(3);
    expect(w.length).toBeLessThanOrEqual(5);
    expect(new Set(w.map((c) => c.x)).size).toBe(1);
    const x = w[0].x;
    const ys = w.map((c) => c.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBe(1);
    // centred: the middle cell of an odd wall is a route cell
    expect(w.length % 2).toBe(1);
    expect(path.includes(ys[(ys.length - 1) / 2] * W + x)).toBe(true);
  });

  it('puts the wall ahead of the drone, inside LiDAR range', () => {
    const path = route(15, 2, 45);
    const w = pickWall(args(city.cells, path, 4));
    const ahead = w[0].x - (path[4] % W);
    expect(ahead).toBeGreaterThanOrEqual(3);
    expect(ahead).toBeLessThanOrEqual(6);
  });

  it('keeps every wall cell on free ground at least one cell from any building', () => {
    for (const idx of [2, 6, 10, 14, 20, 26, 30]) {
      const w = pickWall(args(city.cells, route(15, 2, 45), idx));
      expect(w.length).toBeGreaterThan(0);
      for (const c of w) {
        expect(city.cells[c.y * W + c.x]).toBe(0);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(isWall(city.cells, c.x + dx, c.y + dy), `building near ${c.x},${c.y}`).toBe(false);
      }
    }
  });

  it('crosses a vertical route with a horizontal wall', () => {
    const grid = new Uint8Array(W * H);
    const path = Int32Array.from({ length: 24 }, (_, i) => (3 + i) * W + 20);
    const w = pickWall(args(grid, path, 2));
    expect(new Set(w.map((c) => c.y)).size).toBe(1);
    expect(w.length).toBeGreaterThanOrEqual(3);
    expect(w.some((c) => c.x === 20)).toBe(true);
  });

  it('never covers the last cells of the route (the goal)', () => {
    const path = route(15, 2, 12);
    const w = pickWall(args(new Uint8Array(W * H), path, 2));
    expect(w.length).toBeGreaterThan(0);
    for (const c of w) expect(c.x).toBeLessThanOrEqual(path[path.length - 3] % W);
  });

  it('falls back to a shorter wall when the street is narrow, and still lies on free ground', () => {
    const grid = new Uint8Array(W * H);
    for (let x = 0; x < W; x++) { grid[13 * W + x] = 1; grid[17 * W + x] = 1; } // a street 3 cells wide (y 14..16)
    const w = pickWall(args(grid, route(15, 2, 45), 4));
    expect(w.length).toBeGreaterThan(0);
    expect(w.length).toBeLessThanOrEqual(5);
    for (const c of w) expect(grid[c.y * W + c.x]).toBe(0);
  });

  it('with no usable route returns nothing', () => {
    expect(pickWall(args(new Uint8Array(W * H), new Int32Array(0), 0))).toEqual([]);
    expect(pickWall(args(new Uint8Array(W * H), route(15, 2, 4), 0))).toEqual([]);
  });

  it('is deterministic', () => {
    const path = route(15, 2, 45);
    expect(pickWall(args(city.cells, path))).toEqual(pickWall(args(city.cells, path)));
  });
});
