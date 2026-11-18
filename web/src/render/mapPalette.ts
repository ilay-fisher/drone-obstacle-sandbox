/**
 * Map-specific colours derived from the shared canvas palette (which in turn is read from the
 * CSS tokens). Nothing here is a new colour: each value is a token mixed with another token
 * or with black or white at a fixed ratio, so a token change flows through to the map.
 */
import type { Palette } from './palette';

/** Number of top-face shades; taller blocks use lighter ones, so skyline height reads at a glance. */
export const TOP_SHADES = 5;

/** Colours the map layers draw with. All plain strings, built once per palette. */
export interface MapColors {
  /** Lit top faces, dark to light. */
  top: string[];
  /** Shaded side face (south). */
  side: string;
  /** Specular edge on the top face, on its lit (north) side. */
  edgeHi: string;
  /** Fainter specular on the lit west side. */
  edgeWest: string;
  /** Dark edge on the shaded east and south sides of the top face. */
  edgeLo: string;
  /** Soft cast shadow and tight contact shadow, lower right. */
  shadowSoft: string;
  shadowTight: string;
  /** Soft wind region fill and the flow streak colour (amber). */
  windRegion: string;
  /** Landing pad: plate, rim and breathing ring. */
  padPlate: string;
  padRim: string;
  padRing: string;
  padGlow: string;
  /** Patrol puck body, rim light and heading notch. */
  puck: string;
  puckHi: string;
  puckDeep: string;
  notch: string;
}

/** Parses `#rgb` or `#rrggbb`; returns null for anything else (rgb(), named colours). */
export function parseHex(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((d) => d + d).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Mixes two colours by `t` (0 gives `a`, 1 gives `b`). Unparseable input returns `a` unchanged. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return a;
  const ch = (i: number) => Math.round(pa[i] + (pb[i] - pa[i]) * t);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}

/** `rgba()` from a hex colour and an alpha; unparseable input returns the colour as given. */
export function withAlpha(c: string, alpha: number): string {
  const p = parseHex(c);
  return p ? `rgba(${p[0]},${p[1]},${p[2]},${alpha})` : c;
}

/** Builds the map colours from the canvas palette. */
export function buildMapColors(pal: Palette): MapColors {
  const top: string[] = [];
  for (let i = 0; i < TOP_SHADES; i++) top.push(mix(pal.wall, pal.drone, 0.0 + (0.26 * i) / (TOP_SHADES - 1)));
  return {
    top,
    side: mix(pal.wall, '#000000', 0.55),
    edgeHi: withAlpha(pal.drone, 0.6),
    edgeWest: withAlpha(pal.drone, 0.2),
    edgeLo: 'rgba(0,0,0,0.34)',
    shadowSoft: 'rgba(0,0,0,0.5)',
    shadowTight: 'rgba(0,0,0,0.42)',
    windRegion: withAlpha(pal.goal, 0.11),
    padPlate: mix(pal.ground, pal.drone, 0.1),
    padRim: withAlpha(pal.goal, 0.85),
    padRing: pal.goal,
    padGlow: withAlpha(pal.goal, 0.5),
    puck: mix(pal.route, pal.stage, 0.18),
    puckHi: mix(pal.goal, pal.drone, 0.1),
    puckDeep: mix(pal.route, '#000000', 0.62),
    notch: pal.stage,
  };
}
