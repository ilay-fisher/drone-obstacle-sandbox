import { describe, expect, it } from 'vitest';
import { createTsPlanner } from './tsPlanner';
import type { PlanMode, Planner } from './plannerBridge';

const SQ2 = Math.SQRT2;

/** Seeded PRNG (mulberry32) so random-map tests are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function open(w: number, h: number): Planner {
  return createTsPlanner(w, h);
}

const modes: PlanMode[] = ['astar', 'dstar'];

describe('tsPlanner optimal costs', () => {
  for (const mode of modes) {
    it(`straight line cost (${mode})`, () => {
      const p = open(10, 10);
      const r = p.computePath(0, 0, 5, 0, mode);
      expect(r.found).toBe(true);
      expect(r.cost).toBeCloseTo(5, 9);
      expect(r.path.length).toBe(6);
      expect(r.path[0]).toBe(0);
      expect(r.path[5]).toBe(5);
    });

    it(`pure diagonal cost (${mode})`, () => {
      const p = open(10, 10);
      const r = p.computePath(0, 0, 4, 4, mode);
      expect(r.cost).toBeCloseTo(4 * SQ2, 9);
    });

    it(`mixed move cost (${mode})`, () => {
      const p = open(10, 10);
      const r = p.computePath(0, 0, 5, 2, mode);
      expect(r.cost).toBeCloseTo(3 + 2 * SQ2, 9);
    });

    it(`forbids corner cutting (${mode})`, () => {
      const p = open(3, 3);
      p.setCell(1, 0, 1);
      const r = p.computePath(0, 0, 1, 1, mode);
      expect(r.found).toBe(true);
      expect(r.cost).toBeCloseTo(2, 9);
      const both = open(3, 3);
      both.setCell(1, 0, 1);
      both.setCell(0, 1, 1);
      expect(both.computePath(0, 0, 1, 1, mode).found).toBe(false);
    });

    it(`prefers a cheap detour around wind (${mode})`, () => {
      const p = open(11, 3);
      for (let x = 3; x <= 7; x++) p.setCell(x, 1, 2);
      const r = p.computePath(0, 1, 10, 1, mode);
      expect(r.cost).toBeCloseTo(8 + 2 * SQ2, 9);
      for (let i = 0; i < r.path.length; i++) expect(p.grid()[r.path[i]]).not.toBe(2);
    });

    it(`crosses wind when the detour is longer (${mode})`, () => {
      const p = open(9, 9);
      for (let y = 0; y <= 7; y++) p.setCell(4, y, 1);
      p.setCell(4, 4, 2);
      const r = p.computePath(0, 4, 8, 4, mode);
      expect(r.cost).toBeCloseTo(11, 9);
      expect(Array.from(r.path)).toContain(4 * 9 + 4);
    });

    it(`unreachable goal returns found=false cost=-1 (${mode})`, () => {
      const p = open(8, 5);
      for (let y = 0; y < 5; y++) p.setCell(4, y, 1);
      const r = p.computePath(0, 2, 7, 2, mode);
      expect(r.found).toBe(false);
      expect(r.cost).toBe(-1);
      expect(r.path.length).toBe(0);
    });
  }
});

describe('tsPlanner A* vs D* Lite', () => {
  it('agree on 30 seeded random maps', () => {
    const rnd = mulberry32(12345);
    for (let m = 0; m < 30; m++) {
      const a = open(20, 15);
      const d = open(20, 15);
      for (let y = 0; y < 15; y++) {
        for (let x = 0; x < 20; x++) {
          const r = rnd();
          const v = r < 0.25 ? 1 : r < 0.35 ? 2 : 0;
          a.setCell(x, y, v);
          d.setCell(x, y, v);
        }
      }
      a.setCell(0, 0, 0); d.setCell(0, 0, 0);
      a.setCell(19, 14, 0); d.setCell(19, 14, 0);
      const ra = a.computePath(0, 0, 19, 14, 'astar');
      const rd = d.computePath(0, 0, 19, 14, 'dstar');
      expect(rd.found).toBe(ra.found);
      if (ra.found) expect(rd.cost).toBeCloseTo(ra.cost, 6);
    }
  });

  it('D* Lite repairs the route after a wall blocks it and matches A*', () => {
    const d = open(20, 9);
    const a = open(20, 9);
    const first = d.computePath(0, 4, 19, 4, 'dstar');
    expect(first.cost).toBeCloseTo(19, 9);
    const blocked = first.path[10];
    const bx = blocked % 20;
    const by = Math.floor(blocked / 20);
    d.setCell(bx, by, 1);
    a.setCell(bx, by, 1);
    const second = d.computePath(0, 4, 19, 4, 'dstar');
    const ref = a.computePath(0, 4, 19, 4, 'astar');
    expect(second.found).toBe(true);
    expect(second.cost).toBeCloseTo(ref.cost, 6);
    expect(Array.from(second.path)).not.toContain(blocked);
    // Moving the start (as the drone does) must keep D* consistent.
    const third = d.computePath(3, 4, 19, 4, 'dstar');
    expect(third.cost).toBeCloseTo(a.computePath(3, 4, 19, 4, 'astar').cost, 6);
    expect(d.replanCount()).toBe(3);
  });
});

describe('tsPlanner heat and misc', () => {
  it('heat is nonzero only on expanded cells and sums to the expansion count (A*)', () => {
    const p = open(20, 20);
    for (let y = 0; y < 15; y++) p.setCell(10, y, 1);
    const r = p.computePath(2, 2, 18, 2, 'astar');
    const heat = p.heat();
    let sum = 0;
    let nonzero = 0;
    for (let i = 0; i < heat.length; i++) {
      sum += heat[i];
      if (heat[i] > 0) nonzero++;
      if (p.grid()[i] === 1) expect(heat[i]).toBe(0);
    }
    expect(sum).toBe(r.expanded);
    expect(nonzero).toBeGreaterThan(0);
    expect(nonzero).toBeLessThan(400);
  });

  it('heat buffer is cleared between searches', () => {
    const p = open(10, 10);
    p.computePath(0, 0, 9, 9, 'astar');
    p.computePath(0, 0, 1, 0, 'astar');
    let nz = 0;
    for (const v of p.heat()) if (v > 0) nz++;
    expect(nz).toBeLessThan(10);
  });

  it('ignores out-of-range edits and reports cell values', () => {
    const p = open(5, 5);
    p.setCell(-1, 0, 1);
    p.setCell(5, 5, 1);
    p.setCell(2, 2, 2);
    expect(p.getCell(2, 2)).toBe(2);
    expect(p.getCell(9, 9)).toBe(1);
    p.clearGrid();
    expect(p.getCell(2, 2)).toBe(0);
    expect(p.replanCount()).toBe(0);
  });
});

describe('tsPlanner hasPathObstruction', () => {
  function line(): Planner {
    const p = open(20, 5);
    p.computePath(0, 2, 19, 2, 'astar');
    return p;
  }

  it('is false when the path is clear', () => {
    expect(line().hasPathObstruction(0, 2, 8, 1)).toBe(false);
  });

  it('respects the sensor radius', () => {
    const p = line();
    p.setCell(10, 2, 1);
    expect(p.hasPathObstruction(0, 2, 5, 1)).toBe(false);
    expect(p.hasPathObstruction(0, 2, 12, 1)).toBe(true);
    expect(p.hasPathObstruction(8, 2, 5, 1)).toBe(true);
  });

  it('ignores path indices before fromIndex', () => {
    const p = line();
    p.setCell(10, 2, 1);
    expect(p.hasPathObstruction(12, 2, 8, 11)).toBe(false);
  });

  it('requires line of sight', () => {
    const p = line();
    p.setCell(10, 2, 1);
    p.setCell(10, 1, 1);
    expect(p.hasPathObstruction(10, 0, 5, 1)).toBe(false);
    p.setCell(10, 1, 0);
    expect(p.hasPathObstruction(10, 0, 5, 1)).toBe(true);
  });
});
