import { describe, expect, it } from 'vitest';
import { DSTAR_REST_MIX, GLOW_COMPOSITE, REST_GLOW_CAP } from './searchTone';

describe('search glow tone', () => {
  it('never composites the D* ember additively (it would run to yellow-white)', () => {
    expect(GLOW_COMPOSITE.dstar).toBe('source-over');
    expect(GLOW_COMPOSITE.astar).toBe('lighter');
  });
  it('caps the D* resting glow well below full opacity', () => {
    expect(REST_GLOW_CAP.dstar).toBeGreaterThan(0);
    expect(REST_GLOW_CAP.dstar).toBeLessThanOrEqual(0.6);
  });
  it('keeps the resting ember closer to the deep end than to signal orange', () => {
    expect(DSTAR_REST_MIX).toBeLessThan(0.5);
  });
});
