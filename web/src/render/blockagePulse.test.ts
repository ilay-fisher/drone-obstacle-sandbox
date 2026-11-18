import { describe, expect, it } from 'vitest';
import {
  MIN_PULSE_GAP_MS, PULSE_MS, REDUCED_MIN_GAP_MS, REDUCED_PULSE_MS, nearestChange, pulseDuration, pulseMode, pulsePhases, shouldPulse,
  type PulseCheck,
} from './blockagePulse';
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
  it('plays a reduced pulse, not nothing, while the previous flood is still playing', () => {
    expect(shouldPulse({ ...base, msSincePrevEvent: FLOOD_MS - 1 })).toBe(true);
    expect(pulseMode({ ...base, msSincePrevEvent: FLOOD_MS - 1 })).toBe('reduced');
    expect(pulseMode({ ...base, msSincePrevEvent: FLOOD_MS + 1 })).toBe('full');
  });
  it('keeps a minimum gap between full pulses', () => {
    expect(pulseMode({ ...base, msSincePrevPulse: MIN_PULSE_GAP_MS - 1 })).toBe('none');
    expect(pulseMode({ ...base, msSincePrevPulse: MIN_PULSE_GAP_MS + 1 })).toBe('full');
  });
  it('keeps a shorter gap between reduced pulses, so a quick second wall still gets a ring', () => {
    const c = { ...base, msSincePrevEvent: 200 };
    expect(REDUCED_MIN_GAP_MS).toBeLessThan(MIN_PULSE_GAP_MS);
    expect(pulseMode({ ...c, msSincePrevPulse: REDUCED_MIN_GAP_MS - 1 })).toBe('none');
    expect(pulseMode({ ...c, msSincePrevPulse: REDUCED_MIN_GAP_MS + 1 })).toBe('reduced');
  });
  it('says none for every reason shouldPulse says no', () => {
    expect(pulseMode({ ...base, kind: 'retry' })).toBe('none');
    expect(pulseMode({ ...base, nearChange: false })).toBe('none');
    expect(pulseMode({ ...base, reduced: true })).toBe('none');
    expect(pulseMode({ ...base, ageMs: PULSE_MS + 50 })).toBe('none');
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

describe('reduced pulse', () => {
  const peak = (mode: 'full' | 'reduced', key: 'alpha' | 'weight'): number => {
    let m = 0;
    for (let t = 0; t <= PULSE_MS; t += 5) m = Math.max(m, pulsePhases(t, mode)[key]);
    return m;
  };
  it('is shorter than the full pulse and ends inside it', () => {
    expect(pulseDuration('reduced')).toBe(REDUCED_PULSE_MS);
    expect(pulseDuration('full')).toBe(PULSE_MS);
    expect(REDUCED_PULSE_MS).toBeLessThan(PULSE_MS);
    expect(pulsePhases(REDUCED_PULSE_MS, 'reduced').active).toBe(false);
    expect(pulsePhases(REDUCED_PULSE_MS - 1, 'reduced').active).toBe(true);
  });
  it('is a thin, faint ring: clearly lower alpha and weight than the full one', () => {
    expect(peak('reduced', 'alpha')).toBeLessThan(peak('full', 'alpha') * 0.6);
    expect(peak('reduced', 'weight')).toBeLessThan(peak('full', 'weight') * 0.6);
    expect(peak('reduced', 'alpha')).toBeGreaterThan(0.15);
  });
  it('still expands and fades like a ring, and has no halo or second ring', () => {
    expect(pulsePhases(REDUCED_PULSE_MS * 0.3, 'reduced').radius).toBeGreaterThan(0.5);
    expect(pulsePhases(REDUCED_PULSE_MS * 0.9, 'reduced').alpha).toBeLessThan(pulsePhases(REDUCED_PULSE_MS * 0.2, 'reduced').alpha);
    expect(pulsePhases(50, 'reduced').full).toBe(false);
    expect(pulsePhases(50, 'full').full).toBe(true);
  });
  it('defaults to the full pulse', () => {
    expect(pulsePhases(100)).toEqual(pulsePhases(100, 'full'));
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
