import { describe, expect, it } from 'vitest';
import { createTsPlanner } from './tsPlanner';
import { PATROL_RATE, Simulation, type MissionSummary } from './simulation';

function make(w = 20, h = 9, sx = 0, sy = 4, gx = 19, gy = 4) {
  const ends: MissionSummary[] = [];
  const sim = new Simulation(createTsPlanner(w, h), (s) => ends.push(s));
  sim.setEndpoints(sx, sy, gx, gy);
  sim.reset();
  return { sim, ends };
}

describe('Simulation', () => {
  it('plans while idle and advances the drone once playing', () => {
    const { sim } = make();
    expect(sim.stats.status).toBe('Idle');
    expect(sim.pathLen).toBeGreaterThan(0);
    const x0 = sim.droneX;
    sim.setPlaying(true);
    for (let i = 0; i < 10; i++) sim.tick(0.1);
    expect(sim.droneX).toBeGreaterThan(x0 + 1);
    expect(['En Route', 'Replanning']).toContain(sim.stats.status);
  });

  it('moves patrols and restores the cells they leave', () => {
    const { sim } = make();
    sim.planner.setCell(5, 7, 2);
    sim.addPatrol(5, 7, 1, 0);
    expect(sim.planner.getCell(5, 7)).toBe(1);
    sim.setPlaying(true);
    sim.tick(1 / PATROL_RATE + 1e-6);
    expect(sim.planner.getCell(5, 7)).toBe(2);
    expect(sim.planner.getCell(6, 7)).toBe(1);
  });

  it('replans when LiDAR sees a new wall on the path', () => {
    const { sim } = make();
    sim.lidarRadius = 8;
    sim.setPlaying(true);
    sim.tick(0.05);
    const before = sim.stats.replans;
    sim.planner.setCell(6, 4, 1);
    sim.tick(0.05);
    expect(sim.stats.replans).toBe(before + 1);
    for (let i = 0; i < sim.pathLen; i++) expect(sim.path[i]).not.toBe(4 * 20 + 6);
  });

  it('replans when the user edits the map', () => {
    const { sim } = make();
    const before = sim.stats.replans;
    sim.editCell(10, 4, 1);
    sim.tick(0.01);
    expect(sim.stats.replans).toBe(before + 1);
  });

  it('reaches the target and reports the mission once', () => {
    const { sim, ends } = make();
    sim.setPlaying(true);
    for (let i = 0; i < 600 && sim.stats.status !== 'Reached'; i++) sim.tick(0.05);
    expect(sim.stats.status).toBe('Reached');
    for (let i = 0; i < 20; i++) sim.tick(0.05);
    expect(ends.length).toBe(1);
    expect(ends[0].status).toBe('reached');
  });

  it('reports Blocked when the goal is walled off', () => {
    const { sim } = make();
    for (let y = 0; y < 9; y++) sim.editCell(10, y, 1);
    sim.setPlaying(true);
    sim.tick(0.05);
    expect(sim.stats.status).toBe('Blocked');
  });
});
