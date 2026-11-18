import { describe, expect, it } from 'vitest';
import {
  SPRING_SNAPPY, SPRING_SOFT, dampingRatio, isAtRest, prefersReducedMotion, settleTime,
  springEase, springStep, springToLinear, stepResponse, tween,
} from './spring';

/** Largest value of the step response over twice its settle window, as a fraction above 1. */
function overshoot(cfg: typeof SPRING_SOFT): number {
  const total = settleTime(cfg);
  let peak = 0;
  for (let i = 0; i <= 2000; i++) peak = Math.max(peak, stepResponse(cfg, (i / 2000) * total * 2));
  return peak - 1;
}

describe('the two springs', () => {
  it('soft settles in about 880 ms', () => {
    expect(settleTime(SPRING_SOFT) * 1000).toBeGreaterThan(820);
    expect(settleTime(SPRING_SOFT) * 1000).toBeLessThan(940);
  });
  it('snappy settles in about 350 ms', () => {
    expect(settleTime(SPRING_SNAPPY) * 1000).toBeGreaterThan(320);
    expect(settleTime(SPRING_SNAPPY) * 1000).toBeLessThan(390);
  });
  it('soft overshoots by about 7 percent', () => {
    expect(overshoot(SPRING_SOFT)).toBeGreaterThan(0.06);
    expect(overshoot(SPRING_SOFT)).toBeLessThan(0.09);
  });
  it('snappy overshoots a little but less than a wobble', () => {
    expect(overshoot(SPRING_SNAPPY)).toBeGreaterThan(0.04);
    expect(overshoot(SPRING_SNAPPY)).toBeLessThan(0.09);
  });
  it('are both under-damped', () => {
    expect(dampingRatio(SPRING_SOFT)).toBeLessThan(1);
    expect(dampingRatio(SPRING_SNAPPY)).toBeLessThan(1);
  });
});

describe('stepResponse', () => {
  it('starts at 0 and rests at 1 after the settle time', () => {
    expect(stepResponse(SPRING_SOFT, 0)).toBe(0);
    expect(Math.abs(stepResponse(SPRING_SOFT, settleTime(SPRING_SOFT)) - 1)).toBeLessThan(0.006);
    expect(Math.abs(stepResponse(SPRING_SNAPPY, 5) - 1)).toBeLessThan(1e-6);
  });
});

describe('springStep', () => {
  it('converges on the target and comes to rest', () => {
    let s = { x: 0, v: 0 };
    for (let i = 0; i < 240; i++) s = springStep(s, 100, 1 / 60, SPRING_SOFT);
    expect(s.x).toBeCloseTo(100, 1);
    expect(isAtRest(s, 100, 0.05)).toBe(true);
  });
  it('returns the same object when already at rest on the target', () => {
    const s = { x: 5, v: 0 };
    expect(springStep(s, 5, 1 / 60, SPRING_SNAPPY)).toBe(s);
  });
  it('clamps a huge frame so a restored tab cannot explode the state', () => {
    const s = springStep({ x: 0, v: 0 }, 100, 5, SPRING_SNAPPY);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(Math.abs(s.x)).toBeLessThan(200);
  });
  it('overshoots the target on the way', () => {
    let s = { x: 0, v: 0 };
    let max = 0;
    for (let i = 0; i < 240; i++) { s = springStep(s, 100, 1 / 120, SPRING_SOFT); max = Math.max(max, s.x); }
    expect(max).toBeGreaterThan(105);
    expect(max).toBeLessThan(110);
  });
});

describe('springEase', () => {
  const ease = springEase(SPRING_SOFT);
  it('maps 0 to 0 and 1 to exactly 1, and tolerates junk', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(Number.NaN)).toBe(0);
    expect(ease(9)).toBe(1);
  });
});

describe('springToLinear', () => {
  it('samples a CSS linear() from 0 through an overshoot to exactly 1', () => {
    const css = springToLinear(SPRING_SNAPPY, 24);
    expect(css.startsWith('linear(0')).toBe(true);
    expect(css.endsWith(', 1)')).toBe(true);
    const nums = css.slice(7, -1).split(',').map((s) => Number(s.trim()));
    expect(nums).toHaveLength(24);
    expect(Math.max(...nums)).toBeGreaterThan(1.03);
  });
});

describe('tween', () => {
  /** Manual clock and frame queue so the tween can be driven without a browser. */
  function rig() {
    let t = 0;
    let pending: ((now: number) => void) | null = null;
    return {
      now: () => t,
      schedule: (cb: (now: number) => void) => { pending = cb; return 1; },
      cancel: () => { pending = null; },
      step: (ms: number) => { t += ms; const cb = pending; pending = null; cb?.(t); },
      hasPending: () => pending !== null,
    };
  }
  it('runs from start to end over the settle time and then stops', () => {
    const r = rig();
    const seen: number[] = [];
    tween(0, 10, SPRING_SNAPPY, (v) => seen.push(v), { ...r, reduced: false });
    for (let i = 0; i < 40; i++) r.step(16);
    expect(seen[seen.length - 1]).toBe(10);
    expect(r.hasPending()).toBe(false);
    expect(Math.max(...seen)).toBeGreaterThan(10);
  });
  it('jumps straight to the end under reduced motion', () => {
    const r = rig();
    const seen: number[] = [];
    tween(0, 10, SPRING_SOFT, (v) => seen.push(v), { ...r, reduced: true });
    expect(seen).toEqual([10]);
  });
  it('can be cancelled', () => {
    const r = rig();
    const seen: number[] = [];
    const stop = tween(0, 10, SPRING_SOFT, (v) => seen.push(v), { ...r, reduced: false });
    r.step(16);
    stop();
    const n = seen.length;
    r.step(16);
    expect(seen.length).toBe(n);
  });
});

describe('prefersReducedMotion', () => {
  it('is false when there is no matchMedia (node, old browsers)', () => {
    expect(prefersReducedMotion()).toBe(false);
  });
});
