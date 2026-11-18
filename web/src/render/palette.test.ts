import { describe, expect, it } from 'vitest';
import { buildPalette, rgba } from './palette';

const tokens: Record<string, string> = {
  '--ground': ' #10161c ',
  '--wall': '#2d3844',
  '--text-rgb': '236 232 223',
  '--paint-rgb': '255 90 31',
  '--paint-hi-rgb': '255 179 71',
  '--paint': '#ff5a1f',
  '--paint-hi': '#ffb347',
  '--pass': '#7be0b0',
  '--blocked': '#ff6b57',
  '--stage': '#0c1014',
};
const get = (name: string) => tokens[name] ?? '';

describe('rgba', () => {
  it('builds an rgba string from a space-separated rgb triplet', () => {
    expect(rgba('255 90 31', 0.5)).toBe('rgba(255,90,31,0.5)');
  });
  it('accepts comma-separated triplets too', () => {
    expect(rgba('1, 2, 3', 1)).toBe('rgba(1,2,3,1)');
  });
});

describe('buildPalette', () => {
  it('reads colours from the token getter and trims whitespace', () => {
    const p = buildPalette(get);
    expect(p.ground).toBe('#10161c');
    expect(p.wall).toBe('#2d3844');
    expect(p.route).toBe('#ff5a1f');
    expect(p.goal).toBe('#ffb347');
  });
  it('exposes the status-only green for the landed pad lamp', () => {
    expect(buildPalette(get).pass).toBe('#7be0b0');
    expect(buildPalette(() => '').pass).toBe('#7be0b0');
  });
  it('derives translucent colours from the rgb tokens', () => {
    const p = buildPalette(get);
    expect(p.dot).toBe('rgba(236,232,223,0.1)');
    expect(p.lidarFill).toMatch(/^rgba\(236,232,223,/);
    expect(p.lidarSweep).toMatch(/^rgba\(255,179,71,/);
  });
  it('falls back to built-in values when a token is missing, so a bad stylesheet never paints black', () => {
    const p = buildPalette(() => '');
    expect(p.route).toBe('#ff5a1f');
    expect(p.ground).toBe('#10161c');
  });
  it('precomputes 256 heat styles from the paper tint', () => {
    const p = buildPalette(get);
    expect(p.heat).toHaveLength(256);
    expect(p.heat[1]).toMatch(/^rgba\(236,232,223,/);
    expect(p.heat[255]).toBe(p.heat[6]);
  });
});
