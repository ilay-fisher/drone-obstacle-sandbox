import { describe, expect, it } from 'vitest';
import { SPRING_SNAPPY, settleTime } from '../motion/spring';
import { DROP_RISE_CELLS, EditFx, FX_DURATION_MS, editFxState, newFxState } from './mapFx';

describe('editFxState timeline', () => {
  it('lasts as long as the snappy spring takes to settle', () => {
    expect(FX_DURATION_MS).toBeCloseTo(settleTime(SPRING_SNAPPY) * 1000, 5);
  });

  it('drop starts high and transparent, then lands solid', () => {
    const s0 = editFxState('drop', 0, false, newFxState());
    expect(s0.rise).toBeCloseTo(DROP_RISE_CELLS, 5);
    expect(s0.alpha).toBe(0);
    expect(s0.done).toBe(false);
    const end = editFxState('drop', FX_DURATION_MS + 1, false, newFxState());
    expect(end).toEqual({ rise: 0, alpha: 1, squash: 1, dust: 1, done: true });
  });

  it('drop never goes below the ground, descends monotonically and squashes on impact', () => {
    let prev = Infinity;
    let minSquash = 1;
    let sawDust = false;
    const s = newFxState();
    for (let t = 0; t <= FX_DURATION_MS; t += 4) {
      editFxState('drop', t, false, s);
      expect(s.rise).toBeGreaterThanOrEqual(0);
      expect(s.rise).toBeLessThanOrEqual(prev + 1e-9);
      prev = s.rise;
      expect(s.alpha).toBeGreaterThanOrEqual(0);
      expect(s.alpha).toBeLessThanOrEqual(1);
      minSquash = Math.min(minSquash, s.squash);
      if (s.dust > 0 && s.dust < 1) sawDust = true;
    }
    expect(minSquash).toBeLessThan(0.95);
    expect(minSquash).toBeGreaterThan(0.6);
    expect(sawDust).toBe(true);
  });

  it('lift starts solid on the ground and ends gone and risen', () => {
    const s0 = editFxState('lift', 0, false, newFxState());
    expect(s0.rise).toBe(0);
    expect(s0.alpha).toBe(1);
    const end = editFxState('lift', FX_DURATION_MS + 1, false, newFxState());
    expect(end.done).toBe(true);
    expect(end.alpha).toBe(0);
    expect(end.rise).toBeGreaterThan(0.5);
  });

  it('lift fades out and rises without ever reversing', () => {
    const s = newFxState();
    let prevAlpha = 1;
    let prevRise = 0;
    for (let t = 0; t <= FX_DURATION_MS; t += 4) {
      editFxState('lift', t, false, s);
      expect(s.alpha).toBeLessThanOrEqual(prevAlpha + 1e-9);
      expect(s.rise).toBeGreaterThanOrEqual(prevRise - 1e-9);
      prevAlpha = s.alpha;
      prevRise = s.rise;
    }
  });

  it('clamps negative and non-finite ages to the start state', () => {
    expect(editFxState('drop', -50, false, newFxState()).rise).toBeCloseTo(DROP_RISE_CELLS, 5);
    expect(editFxState('drop', NaN, false, newFxState()).rise).toBeCloseTo(DROP_RISE_CELLS, 5);
  });

  it('reduced motion returns the finished state immediately', () => {
    expect(editFxState('drop', 0, true, newFxState())).toEqual({ rise: 0, alpha: 1, squash: 1, dust: 1, done: true });
    const lift = editFxState('lift', 0, true, newFxState());
    expect(lift.done).toBe(true);
    expect(lift.alpha).toBe(0);
  });

  it('writes into the object it is given and returns it', () => {
    const o = newFxState();
    expect(editFxState('drop', 10, false, o)).toBe(o);
  });
});

describe('EditFx pool', () => {
  it('tracks active cells and prunes the ones whose timeline finished', () => {
    const fx = new EditFx(100, 8, false);
    fx.begin(5, 'drop', 1000);
    fx.begin(7, 'lift', 1100);
    expect(fx.count).toBe(2);
    expect(fx.has(5)).toBe(true);
    expect(fx.has(6)).toBe(false);
    expect(fx.kindOf(7)).toBe('lift');
    expect(fx.prune(1000 + FX_DURATION_MS - 1)).toBe(false);
    expect(fx.prune(1000 + FX_DURATION_MS + 1)).toBe(true);
    expect(fx.has(5)).toBe(false);
    expect(fx.has(7)).toBe(true);
    expect(fx.count).toBe(1);
    fx.prune(1100 + FX_DURATION_MS + 1);
    expect(fx.count).toBe(0);
  });

  it('restarts a cell that is edited again mid-animation, in place', () => {
    const fx = new EditFx(100, 8, false);
    fx.begin(5, 'drop', 0);
    fx.begin(5, 'lift', 100);
    expect(fx.count).toBe(1);
    expect(fx.kindOf(5)).toBe('lift');
    expect(fx.startOf(5)).toBe(100);
  });

  it('drops the oldest animation instead of allocating when the pool is full', () => {
    const fx = new EditFx(100, 3, false);
    for (let i = 0; i < 5; i++) fx.begin(i, 'drop', i);
    expect(fx.count).toBe(3);
    expect(fx.has(0)).toBe(false);
    expect(fx.has(4)).toBe(true);
  });

  it('bumps its epoch whenever the active set changes, and not otherwise', () => {
    const fx = new EditFx(100, 8, false);
    const e0 = fx.epoch;
    fx.begin(1, 'drop', 0);
    expect(fx.epoch).toBeGreaterThan(e0);
    const e1 = fx.epoch;
    fx.prune(1);
    expect(fx.epoch).toBe(e1);
    fx.prune(FX_DURATION_MS + 10);
    expect(fx.epoch).toBeGreaterThan(e1);
  });

  it('under reduced motion nothing is ever animated', () => {
    const fx = new EditFx(100, 8, true);
    fx.begin(3, 'drop', 0);
    expect(fx.count).toBe(0);
    expect(fx.has(3)).toBe(false);
  });
});
