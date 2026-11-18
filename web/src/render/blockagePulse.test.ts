import { describe, expect, it } from 'vitest';
import { MIN_PULSE_GAP_MS, PULSE_MS, nearestChange, pulsePhases, shouldPulse, type PulseCheck } from './blockagePulse';
import { FLOOD_MS } from './replanTimeline';

const base: PulseCheck = {
  kind: 'replan',
  nearChange: true,
  reduced: false,
  ageMs: 10,
  msSincePrevEvent: Infinity,
  msSincePrevPulse: Infinity,
};

describe('shouldPulse', () => {
  it('fires for a counted replan with a change near the drone', () => {
    expect(shouldPulse(base)).toBe(true);
  });
  it('does not fire for previews and retries', () => {
    expect(shouldPulse({ ...base, kind: 'preview' })).toBe(false);
    expect(shouldPulse({ ...base, kind: 'retry' })).toBe(false);
  });
  it('does not fire when nothing changed near the drone (a far edit, an algorithm switch)', () => {
    expect(shouldPulse({ ...base, nearChange: false })).toBe(false);
  });
  it('does not fire under reduced motion', () => {
    expect(shouldPulse({ ...base, reduced: true })).toBe(false);
  });
  it('is skipped while the previous flood is still playing: one loud motion at a time', () => {
    expect(shouldPulse({ ...base, msSincePrevEvent: FLOOD_MS - 1 })).toBe(false);
    expect(shouldPulse({ ...base, msSincePrevEvent: FLOOD_MS + 1 })).toBe(true);
  });
  it('keeps a minimum gap between pulses', () => {
    expect(shouldPulse({ ...base, msSincePrevPulse: MIN_PULSE_GAP_MS - 1 })).toBe(false);
    expect(shouldPulse({ ...base, msSincePrevPulse: MIN_PULSE_GAP_MS + 1 })).toBe(true);
  });
  it('ignores an event that is already stale when first seen (page load, resumed tab)', () => {
    expect(shouldPulse({ ...base, ageMs: PULSE_MS + 50 })).toBe(false);
  });
});

describe('pulsePhases', () => {
  it('starts as a point and ends fully expanded and gone', () => {
    const a = pulsePhases(0);
    expect(a.radius).toBe(0);
    expect(a.active).toBe(true);
    const z = pulsePhases(PULSE_MS);
    expect(z.active).toBe(false);
    expect(z.alpha).toBe(0);
    expect(pulsePhases(PULSE_MS + 500).active).toBe(false);
  });
  it('expands monotonically and fast at first (ease out)', () => {
    let prev = -1;
    for (let t = 0; t <= PULSE_MS; t += 20) {
      const r = pulsePhases(t).radius;
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
    expect(pulsePhases(PULSE_MS * 0.3).radius).toBeGreaterThan(0.5);
  });
  it('fades out as it grows', () => {
    expect(pulsePhases(PULSE_MS * 0.9).alpha).toBeLessThan(pulsePhases(PULSE_MS * 0.2).alpha);
  });
  it('is quick: it finishes inside the flood window so it leads and does not trail it', () => {
    expect(PULSE_MS).toBeLessThanOrEqual(FLOOD_MS);
  });
  it('treats negative and NaN age as not started', () => {
    expect(pulsePhases(-5).radius).toBe(0);
    expect(pulsePhases(NaN).active).toBe(false);
  });
});

describe('nearestChange', () => {
  const w = 20;
  const idx = (x: number, y: number) => y * w + x;
  it('returns -1 when no changed cell is inside the radius', () => {
    expect(nearestChange(new Int32Array([idx(18, 18)]), w, 5.5, 5.5, 6)).toBe(-1);
    expect(nearestChange(new Int32Array(0), w, 5.5, 5.5, 6)).toBe(-1);
  });
  it('returns the closest changed cell inside the radius', () => {
    const ch = new Int32Array([idx(9, 5), idx(7, 5), idx(18, 18)]);
    expect(nearestChange(ch, w, 5.5, 5.5, 6)).toBe(idx(7, 5));
  });
});
