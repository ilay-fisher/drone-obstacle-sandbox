import { describe, expect, it } from 'vitest';
import { createTsPlanner } from './tsPlanner';
import { PATROL_RATE, Simulation } from './simulation';

function make() {
  const sim = new Simulation(createTsPlanner(20, 9));
  sim.setEndpoints(0, 4, 19, 4);
  sim.reset();
  return sim;
}

describe('Simulation.gridVersion', () => {
  it('bumps when a visible cell changes and only then', () => {
    const sim = make();
    const v0 = sim.gridVersion;
    sim.editCell(5, 2, 1);
    expect(sim.gridVersion).toBeGreaterThan(v0);
    const v1 = sim.gridVersion;
    sim.editCell(5, 2, 1); // same value again
    sim.editCell(-1, 2, 1); // out of range
    sim.editCell(0, 4, 1); // the start endpoint refuses walls
    sim.erase(8, 8); // already empty
    expect(sim.gridVersion).toBe(v1);
    sim.erase(5, 2);
    expect(sim.gridVersion).toBeGreaterThan(v1);
  });

  it('does not bump for patrol spawn, patrol movement or removal over empty ground', () => {
    const sim = make();
    sim.addPatrol(5, 7, 1, 0);
    const v = sim.gridVersion;
    sim.setPlaying(true);
    sim.tick(3 / PATROL_RATE + 1e-6);
    expect(sim.patrolX[0]).toBeGreaterThan(5);
    expect(sim.gridVersion).toBe(v);
    sim.erase(sim.patrolX[0], sim.patrolY[0]);
    expect(sim.patrolCount).toBe(0);
    expect(sim.gridVersion).toBe(v);
  });

  it('bumps when wind is painted under a patrol, because the visible cell changed', () => {
    const sim = make();
    sim.addPatrol(5, 7, 0, 0);
    const v = sim.gridVersion;
    sim.editCell(5, 7, 2);
    expect(sim.gridVersion).toBeGreaterThan(v);
  });

  it('bumps on clearMap and importState', () => {
    const sim = make();
    let v = sim.gridVersion;
    sim.clearMap();
    expect(sim.gridVersion).toBeGreaterThan(v);
    v = sim.gridVersion;
    expect(sim.importState(sim.exportState())).toBe(true);
    expect(sim.gridVersion).toBeGreaterThan(v);
  });
});

describe('Simulation.copyVisualGrid', () => {
  it('shows what is under a patrol instead of the stamped wall', () => {
    const sim = make();
    sim.editCell(5, 7, 2);
    sim.addPatrol(5, 7, 1, 0);
    expect(sim.planner.getCell(5, 7)).toBe(1);
    const out = new Uint8Array(sim.width * sim.height);
    sim.copyVisualGrid(out);
    expect(out[7 * sim.width + 5]).toBe(2);
    sim.editCell(9, 1, 1);
    sim.copyVisualGrid(out);
    expect(out[1 * sim.width + 9]).toBe(1);
  });
});
