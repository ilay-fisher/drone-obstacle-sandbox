import { describe, expect, it } from 'vitest';
import { createTsPlanner } from './tsPlanner';
import { Simulation } from './simulation';

function make(w = 24, h = 11, sx = 0, sy = 5, gx = 23, gy = 5) {
  const sim = new Simulation(createTsPlanner(w, h));
  sim.setEndpoints(sx, sy, gx, gy);
  let t = 1000;
  sim.clock = () => (t += 7);
  sim.reset();
  return sim;
}

describe('ReplanEvent', () => {
  it('is emitted by the first (preview) plan with the drone cell as the A* origin', () => {
    const sim = make();
    const e = sim.lastReplan!;
    expect(e).not.toBeNull();
    expect(e.kind).toBe('preview');
    expect(e.mode).toBe('astar');
    expect(e.found).toBe(true);
    expect(Array.from(e.origin)).toEqual([5 * 24 + 0]);
    expect(e.changed.length).toBe(0);
    expect(Array.from(e.newPath)).toEqual(Array.from(sim.path.subarray(0, sim.pathLen)));
    expect(e.oldPath.length).toBe(0);
    expect(e.timestamp).toBeGreaterThan(1000);
    expect(e.expanded).toBe(sim.stats.lastExpanded);
  });

  it('carries a heat snapshot that is a copy, not a view of planner memory', () => {
    const sim = make();
    const e = sim.lastReplan!;
    expect(e.heat).toBeInstanceOf(Uint8Array);
    expect(e.heat.buffer).not.toBe(sim.planner.heat().buffer);
    expect(Array.from(e.heat)).toEqual(Array.from(sim.planner.heat()));
    const before = e.heat.slice();
    sim.planner.computePath(0, 0, 3, 3, 'astar');
    expect(Array.from(e.heat)).toEqual(Array.from(before));
  });

  it('lists the cells edited since the previous plan, once each, and marks the replan', () => {
    const sim = make();
    const seq = sim.replanSeq;
    sim.editCell(10, 5, 1);
    sim.editCell(10, 5, 1);
    sim.editCell(11, 5, 1);
    sim.tick(0.016);
    const e = sim.lastReplan!;
    expect(sim.replanSeq).toBe(seq + 1);
    expect(e.kind).toBe('replan');
    expect(Array.from(e.changed).sort((a, b) => a - b)).toEqual([5 * 24 + 10, 5 * 24 + 11]);
    expect(sim.stats.replans).toBe(1);
  });

  it('keeps the old route as the part still ahead of the drone, and a separate new route', () => {
    const sim = make();
    const oldPath = Array.from(sim.path.subarray(0, sim.pathLen));
    sim.editCell(10, 5, 1);
    sim.tick(0.016);
    const e = sim.lastReplan!;
    expect(Array.from(e.oldPath)).toEqual(oldPath);
    expect(e.newPath.length).toBeGreaterThan(0);
    expect(e.newPath).not.toBe(e.oldPath);
    expect(Array.from(e.newPath)).toEqual(Array.from(sim.path.subarray(0, sim.pathLen)));
    expect(Array.from(e.newPath)).not.toContain(5 * 24 + 10);
  });

  it('uses the goal plus the changed cells as the D* Lite origin and flags incremental repairs', () => {
    const sim = make();
    sim.setMode('dstar');
    sim.tick(0.016);
    const first = sim.lastReplan!;
    expect(first.mode).toBe('dstar');
    expect(first.incremental).toBe(false);
    expect(first.origin[0]).toBe(5 * 24 + 23);
    sim.editCell(12, 5, 1);
    sim.tick(0.016);
    const e = sim.lastReplan!;
    expect(e.mode).toBe('dstar');
    expect(e.incremental).toBe(true);
    expect(Array.from(e.origin)).toEqual([5 * 24 + 23, 5 * 24 + 12]);
    expect(Array.from(e.changed)).toEqual([5 * 24 + 12]);
  });

  it('a D* repair touches far fewer cells than the A* search it replaces', () => {
    const sim = make(40, 21, 0, 10, 39, 10);
    sim.setMode('dstar');
    sim.tick(0.016);
    sim.editCell(20, 10, 1);
    sim.tick(0.016);
    const repaired = sim.lastReplan!.heat.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
    sim.setMode('astar');
    sim.tick(0.016);
    const searched = sim.lastReplan!.heat.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
    expect(repaired).toBeGreaterThan(0);
    expect(repaired).toBeLessThan(searched);
  });

  it('forgets incremental state when the map is cleared', () => {
    const sim = make();
    sim.setMode('dstar');
    sim.tick(0.016);
    sim.setMode('dstar');
    sim.clearMap();
    sim.setMode('astar');
    sim.setMode('dstar');
    sim.tick(0.016);
    expect(sim.lastReplan!.incremental).toBe(false);
  });

  it('does not change the stats shape', () => {
    const sim = make();
    expect(Object.keys(sim.stats).sort()).toEqual([
      'elapsedMs', 'lastExpanded', 'lastLatencyMs', 'maxLatencyMs', 'pathCost', 'planCalls',
      'replans', 'status', 'totalExpanded', 'totalLatencyMs',
    ]);
  });

  it('marks retries of a blocked mission so the picture can stay still', () => {
    const sim = make(9, 5, 0, 2, 8, 2);
    for (let y = 0; y < 5; y++) sim.planner.setCell(4, y, 1);
    sim.reset();
    sim.setPlaying(true);
    sim.tick(0.016);
    expect(sim.lastReplan!.found).toBe(false);
    sim.tick(0.6);
    expect(sim.lastReplan!.kind).toBe('retry');
  });
});
