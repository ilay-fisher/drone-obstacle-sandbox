import { describe, expect, it } from 'vitest';
import {
  FLOW_PERIOD_CELLS, FLOW_SPEED_CELLS_PER_S, flowTime, streakPhase, windDensity,
} from './windFlow';
import { breathPhase } from './mapEntities';

describe('streakPhase', () => {
  it('stays inside one period', () => {
    for (let t = 0; t < 120; t += 0.37) {
      for (const seed of [0, 0.31, 0.99]) {
        const p = streakPhase(t, seed);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(FLOW_PERIOD_CELLS);
      }
    }
  });

  it('drifts in one direction at the ambient speed', () => {
    const dt = 0.5;
    const a = streakPhase(10, 0.4);
    const b = streakPhase(10 + dt, 0.4);
    const moved = (b - a + FLOW_PERIOD_CELLS) % FLOW_PERIOD_CELLS;
    expect(moved).toBeCloseTo(FLOW_SPEED_CELLS_PER_S * dt, 6);
  });

  it('is periodic: one full period of travel returns to the same phase', () => {
    const T = FLOW_PERIOD_CELLS / FLOW_SPEED_CELLS_PER_S;
    expect(streakPhase(3 + T, 0.7)).toBeCloseTo(streakPhase(3, 0.7), 6);
  });

  it('offsets lanes by their seed so streaks do not march in a line', () => {
    expect(streakPhase(5, 0.1)).not.toBeCloseTo(streakPhase(5, 0.6), 3);
  });

  it('is slow: under half a cell per second', () => {
    expect(FLOW_SPEED_CELLS_PER_S).toBeLessThan(0.5);
    expect(FLOW_SPEED_CELLS_PER_S).toBeGreaterThan(0.05);
  });
});

describe('reduced motion finished state', () => {
  it('freezes the flow clock', () => {
    expect(flowTime(0, true)).toBe(flowTime(987654, true));
    expect(flowTime(2500, false)).toBeCloseTo(2.5, 6);
    expect(streakPhase(flowTime(1, true), 0.3)).toBe(streakPhase(flowTime(99999, true), 0.3));
  });

  it('freezes the landing pad ring at its rest state', () => {
    expect(breathPhase(0, true)).toBe(breathPhase(31415, true));
    const moving = new Set<number>();
    for (let t = 0; t < 8000; t += 500) moving.add(Number(breathPhase(t, false).toFixed(3)));
    expect(moving.size).toBeGreaterThan(3);
  });

  it('breath stays in [0, 1]', () => {
    for (let t = 0; t < 20000; t += 137) {
      const b = breathPhase(t, false);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });
});

describe('windDensity', () => {
  it('is 1 deep inside a wind zone, softer at its edge and 0 far away', () => {
    const w = 9, h = 7;
    const cells = new Uint8Array(w * h);
    for (let y = 1; y <= 5; y++) for (let x = 1; x <= 5; x++) cells[y * w + x] = 2;
    const out = new Float32Array(w * h);
    windDensity(cells, w, h, out);
    expect(out[3 * w + 3]).toBeCloseTo(1, 6);
    expect(out[1 * w + 1]).toBeLessThan(1);
    expect(out[1 * w + 1]).toBeGreaterThan(0);
    expect(out[0]).toBeGreaterThan(0);
    expect(out[0]).toBeLessThan(out[1 * w + 1]);
    expect(out[3 * w + 8]).toBe(0);
  });

  it('is all zero without wind', () => {
    const out = new Float32Array(9).fill(5);
    windDensity(new Uint8Array(9), 3, 3, out);
    expect(Math.max(...out)).toBe(0);
  });
});
