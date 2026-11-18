import { describe, expect, it } from 'vitest';
import { GAUGE_MAX_ANGLE, GAUGE_MIN_ANGLE, GAUGE_TICKS, gaugeAngle, gaugeFraction } from './gauge';
import { digitsOf, rollPath, rollSteps } from './counter';
import { computeDelta, formatDelta, nextDeltaState, type DeltaState } from './delta';

describe('gauge mapping', () => {
  it('spans 0 to 5 ms across the sweep', () => {
    expect(gaugeAngle(0)).toBe(GAUGE_MIN_ANGLE);
    expect(gaugeAngle(5)).toBe(GAUGE_MAX_ANGLE);
    expect(gaugeFraction(0)).toBe(0);
    expect(gaugeFraction(5)).toBe(1);
  });
  it('is linear up to 1 ms and logarithmic after', () => {
    expect(gaugeFraction(0.5)).toBeCloseTo(gaugeFraction(1) / 2, 9);
    // the log segment: sqrt(5) is the geometric midpoint of 1..5
    const mid = (gaugeFraction(1) + 1) / 2;
    expect(gaugeFraction(Math.sqrt(5))).toBeCloseTo(mid, 9);
  });
  it('is continuous and strictly increasing across the 1 ms knee', () => {
    expect(gaugeFraction(1.0001) - gaugeFraction(1)).toBeLessThan(0.001);
    let prev = -1;
    for (let ms = 0; ms <= 5; ms += 0.05) {
      const f = gaugeFraction(ms);
      expect(f).toBeGreaterThan(prev);
      prev = f;
    }
  });
  it('clamps beyond the scale and maps bad input to zero', () => {
    expect(gaugeAngle(40)).toBe(GAUGE_MAX_ANGLE);
    expect(gaugeAngle(-3)).toBe(GAUGE_MIN_ANGLE);
    expect(gaugeAngle(Number.NaN)).toBe(GAUGE_MIN_ANGLE);
    expect(gaugeAngle(Number.POSITIVE_INFINITY)).toBe(GAUGE_MAX_ANGLE);
  });
  it('ticks sit on the same scale, ascending, from 0 to 5', () => {
    expect(GAUGE_TICKS[0].ms).toBe(0);
    expect(GAUGE_TICKS[GAUGE_TICKS.length - 1].ms).toBe(5);
    const ms = GAUGE_TICKS.map((t) => t.ms);
    expect([...ms].sort((a, b) => a - b)).toEqual(ms);
  });
});

describe('counter digits', () => {
  it('pads to the minimum width and marks leading zeros as unlit', () => {
    expect(digitsOf(42, 4)).toEqual([
      { digit: 0, lit: false }, { digit: 0, lit: false }, { digit: 4, lit: true }, { digit: 2, lit: true },
    ]);
  });
  it('grows past the minimum width instead of truncating', () => {
    expect(digitsOf(123456, 4).map((d) => d.digit)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('zero keeps its last digit lit, and bad input reads as zero', () => {
    expect(digitsOf(0, 3)[2]).toEqual({ digit: 0, lit: true });
    expect(digitsOf(Number.NaN, 2).map((d) => d.digit)).toEqual([0, 0]);
    expect(digitsOf(-7, 2).map((d) => d.digit)).toEqual([0, 0]);
    expect(digitsOf(12.9, 2).map((d) => d.digit)).toEqual([1, 2]);
  });
});

describe('counter roll targets', () => {
  it('rolls forward through the digits between two values', () => {
    expect(rollPath(3, 6)).toEqual([3, 4, 5, 6]);
    expect(rollSteps(3, 6)).toBe(3);
  });
  it('wraps 9 to 0 forward like an odometer, never backwards', () => {
    expect(rollPath(8, 1)).toEqual([8, 9, 0, 1]);
    expect(rollSteps(8, 1)).toBe(3);
  });
  it('does not move when the digit is unchanged', () => {
    expect(rollPath(5, 5)).toEqual([5]);
    expect(rollSteps(5, 5)).toBe(0);
  });
});

describe('path cost delta', () => {
  it('is the signed change with one decimal', () => {
    expect(computeDelta(56.66, 59.9)).toEqual({ value: expect.closeTo(3.24, 5), text: '+3.2', dir: 'up' });
    expect(computeDelta(59.9, 56.66)).toEqual({ value: expect.closeTo(-3.24, 5), text: '-3.2', dir: 'down' });
  });
  it('is absent without a real change or without a path on either side', () => {
    expect(computeDelta(10, 10)).toBeNull();
    expect(computeDelta(10, 10.01)).toBeNull();
    expect(computeDelta(-1, 10)).toBeNull();
    expect(computeDelta(10, -1)).toBeNull();
    expect(computeDelta(Number.NaN, 10)).toBeNull();
  });
  it('formats with an explicit sign', () => {
    expect(formatDelta(3.24)).toBe('+3.2');
    expect(formatDelta(-0.5)).toBe('-0.5');
  });
  const start: DeltaState = { replans: 0, cost: 50, delta: null };
  it('shows a delta once a replan lands with a different cost', () => {
    const s = nextDeltaState(start, 1, 53.4);
    expect(s.delta?.text).toBe('+3.4');
    expect(s.replans).toBe(1);
    expect(s.cost).toBe(53.4);
  });
  it('keeps the delta until the next replan, even while cost is unchanged', () => {
    const s1 = nextDeltaState(start, 1, 53.4);
    expect(nextDeltaState(s1, 1, 53.4).delta?.text).toBe('+3.4');
    expect(nextDeltaState(s1, 2, 53.4).delta).toBeNull();
  });
  it('clears on reset, when the replan counter drops', () => {
    const s1 = nextDeltaState(start, 3, 60);
    const s2 = nextDeltaState(s1, 0, 50);
    expect(s2.delta).toBeNull();
    expect(s2.replans).toBe(0);
    expect(s2.cost).toBe(50);
  });
  it('tracks cost without a delta before any replan happens', () => {
    expect(nextDeltaState(start, 0, 52).cost).toBe(52);
    expect(nextDeltaState(start, 0, 52).delta).toBeNull();
  });
});
