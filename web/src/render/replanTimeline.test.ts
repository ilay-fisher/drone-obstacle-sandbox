import { describe, expect, it } from 'vitest';
import {
  CHIP_MS, DISSOLVE_MS, DISSOLVE_START_MS, DRAW_MS, DRAW_START_MS, FINISHED, FLOOD_MS, TOTAL_MS,
  chipText, chipTextCompact, replanPhases, settle,
} from './replanTimeline';

describe('replan timeline', () => {
  it('keeps the spec timings: flood 420, draw-on from 150 for 420, dissolve 900, about 1.1 s total', () => {
    expect(FLOOD_MS).toBe(420);
    expect(DRAW_START_MS).toBe(150);
    expect(DRAW_MS).toBe(420);
    expect(DISSOLVE_MS).toBe(900);
    expect(CHIP_MS).toBeGreaterThanOrEqual(1000);
    expect(TOTAL_MS).toBeGreaterThanOrEqual(1000);
    expect(TOTAL_MS).toBeLessThanOrEqual(1200);
  });

  it('starts everything at rest and ends in the finished state', () => {
    const p0 = replanPhases(0, false);
    expect(p0.flood).toBe(0);
    expect(p0.draw).toBe(0);
    expect(p0.dissolve).toBe(0);
    expect(p0.active).toBe(true);
    const end = replanPhases(TOTAL_MS + 1, false);
    expect(end).toEqual(FINISHED);
    expect(end.active).toBe(false);
  });

  it('delays the draw-on to 150 ms and finishes each phase on schedule', () => {
    expect(replanPhases(DRAW_START_MS - 1, false).draw).toBe(0);
    expect(replanPhases(DRAW_START_MS + 60, false).draw).toBeGreaterThan(0);
    expect(replanPhases(FLOOD_MS, false).flood).toBe(1);
    expect(replanPhases(DRAW_START_MS + DRAW_MS, false).draw).toBe(1);
    expect(replanPhases(DISSOLVE_START_MS + DISSOLVE_MS, false).dissolve).toBe(1);
  });

  it('is monotonic and never leaves 0..1', () => {
    let prev = replanPhases(0, false);
    for (let t = 0; t <= TOTAL_MS + 50; t += 10) {
      const p = replanPhases(t, false);
      for (const k of ['flood', 'draw', 'dissolve'] as const) {
        expect(p[k]).toBeGreaterThanOrEqual(prev[k] - 1e-9);
        expect(p[k]).toBeGreaterThanOrEqual(0);
        expect(p[k]).toBeLessThanOrEqual(1);
      }
      expect(p.chip).toBeGreaterThanOrEqual(0);
      expect(p.chip).toBeLessThanOrEqual(1);
      prev = p;
    }
  });

  it('settles on a spring-like curve, not linearly: fast start, long soft tail', () => {
    expect(settle(0.5)).toBeGreaterThan(0.5);
    expect(settle(0)).toBe(0);
    expect(settle(1)).toBe(1);
    expect(settle(0.9)).toBeLessThan(1);
    expect(settle(NaN)).toBe(0);
  });

  it('shows the chip from early on until the end of its second, then hides it', () => {
    expect(replanPhases(300, false).chip).toBe(1);
    expect(replanPhases(900, false).chip).toBe(1);
    expect(replanPhases(TOTAL_MS + 5, false).chip).toBe(0);
  });

  it('under reduced motion shows the finished picture at once, with the chip held static', () => {
    const p = replanPhases(0, true);
    expect(p.flood).toBe(1);
    expect(p.draw).toBe(1);
    expect(p.dissolve).toBe(1);
    expect(p.chip).toBe(1);
    expect(replanPhases(CHIP_MS + 1, true)).toEqual(FINISHED);
  });

  it('words the chip with real numbers only', () => {
    expect(chipText('astar', false, true, 812)).toBe('searched 812 cells');
    expect(chipText('dstar', true, true, 37)).toBe('repaired 37 cells');
    expect(chipText('dstar', false, true, 640)).toBe('searched 640 cells');
    expect(chipText('astar', false, true, 1)).toBe('searched 1 cell');
    expect(chipText('astar', false, false, 90)).toBe('searched 90 cells, no route');
  });

  it('has a compact chip form with the same honest verb and count', () => {
    expect(chipTextCompact('astar', false, true, 354)).toBe('354 searched');
    expect(chipTextCompact('dstar', true, true, 2)).toBe('2 repaired');
    expect(chipTextCompact('dstar', false, true, 640)).toBe('640 searched');
    expect(chipTextCompact('astar', false, false, 90)).toBe('90 searched, no route');
  });
});
