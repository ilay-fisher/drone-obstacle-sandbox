import { describe, expect, it } from 'vitest';
import { formatLatency } from './format';

describe('formatLatency', () => {
  it('shows values under 0.1 ms as "< 0.1 ms", including zero', () => {
    expect(formatLatency(0)).toBe('< 0.1 ms');
    expect(formatLatency(0.0004)).toBe('< 0.1 ms');
    expect(formatLatency(0.0999)).toBe('< 0.1 ms');
  });
  it('shows 0.1 ms and above with three decimals as before', () => {
    expect(formatLatency(0.1)).toBe('0.100 ms');
    expect(formatLatency(2.3456)).toBe('2.346 ms');
  });
  it('does not claim a bound for invalid input', () => {
    expect(formatLatency(Number.NaN)).toBe('-');
    expect(formatLatency(-1)).toBe('-');
  });
});
