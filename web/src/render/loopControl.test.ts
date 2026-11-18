import { describe, expect, it } from 'vitest';
import { MAX_FRAME_DT, clampDt, effectiveDpr, shouldRun } from './loopControl';

describe('shouldRun', () => {
  it('runs only when the canvas is on screen and the tab is visible', () => {
    expect(shouldRun({ onScreen: true, tabVisible: true })).toBe(true);
    expect(shouldRun({ onScreen: false, tabVisible: true })).toBe(false);
    expect(shouldRun({ onScreen: true, tabVisible: false })).toBe(false);
    expect(shouldRun({ onScreen: false, tabVisible: false })).toBe(false);
  });
});

describe('clampDt', () => {
  it('passes normal frame times through in seconds', () => {
    expect(clampDt(1000, 1016)).toBeCloseTo(0.016, 6);
  });
  it('caps a long gap so a resume after a pause does not jump the simulation', () => {
    expect(clampDt(0, 60_000)).toBe(MAX_FRAME_DT);
  });
  it('never returns a negative or non-finite step', () => {
    expect(clampDt(500, 400)).toBe(0);
    expect(clampDt(Number.NaN, 10)).toBe(0);
  });
});

describe('effectiveDpr', () => {
  it('caps the device pixel ratio at 2', () => {
    expect(effectiveDpr(3)).toBe(2);
    expect(effectiveDpr(2)).toBe(2);
    expect(effectiveDpr(1.5)).toBe(1.5);
  });
  it('falls back to 1 for missing or invalid values', () => {
    expect(effectiveDpr(0)).toBe(1);
    expect(effectiveDpr(Number.NaN)).toBe(1);
    expect(effectiveDpr(undefined)).toBe(1);
  });
});
