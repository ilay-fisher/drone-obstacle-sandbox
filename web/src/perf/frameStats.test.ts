import { describe, expect, it } from 'vitest';
import { FrameRing, computeFrameStats, perfEnabled } from './frameStats';

describe('computeFrameStats', () => {
  it('returns zeros for no frames', () => {
    expect(computeFrameStats([])).toEqual({ frames: 0, p50: 0, p95: 0, max: 0, over16_7: 0 });
  });
  it('computes nearest-rank percentiles, max and the count over 16.7 ms', () => {
    const times = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100 ms
    const s = computeFrameStats(times);
    expect(s.frames).toBe(100);
    expect(s.p50).toBe(50);
    expect(s.p95).toBe(95);
    expect(s.max).toBe(100);
    expect(s.over16_7).toBe(84);
  });
  it('does not mutate its input', () => {
    const t = [3, 1, 2];
    computeFrameStats(t);
    expect(t).toEqual([3, 1, 2]);
  });
  it('treats exactly 16.7 ms as on budget', () => {
    expect(computeFrameStats([16.7, 16.71]).over16_7).toBe(1);
  });
});

describe('FrameRing', () => {
  it('keeps only the most recent entries once full', () => {
    const r = new FrameRing(3);
    [1, 2, 3, 4, 5].forEach((t) => r.push(t));
    expect(r.values().sort()).toEqual([3, 4, 5]);
    expect(r.size).toBe(3);
  });
  it('reports fewer values before it fills', () => {
    const r = new FrameRing(8);
    r.push(5); r.push(6);
    expect(r.values()).toEqual([5, 6]);
  });
  it('clears', () => {
    const r = new FrameRing(4);
    r.push(1);
    r.clear();
    expect(r.size).toBe(0);
  });
});

describe('perfEnabled', () => {
  it('is on only for perf=1', () => {
    expect(perfEnabled('?perf=1')).toBe(true);
    expect(perfEnabled('?a=b&perf=1')).toBe(true);
    expect(perfEnabled('?perf=0')).toBe(false);
    expect(perfEnabled('')).toBe(false);
  });
});
