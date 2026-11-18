/**
 * Canvas colours, read from the CSS design tokens so the stylesheet stays the single source
 * of truth. The canvas cannot use `var()`, so the values are resolved once at mount through
 * `getComputedStyle` and kept as plain strings; the render loop never builds style strings.
 */

/** Resolved colours for one frame of drawing. */
export interface Palette {
  ground: string;
  wall: string;
  /** Faint dot drawn at the centre of every cell, in place of grid lines. */
  dot: string;
  /** Heat cell fill by visit count (index 0 is unused). */
  heat: string[];
  route: string;
  goal: string;
  drone: string;
  nav: string;
  patrol: string;
  patrolRim: string;
  lidarFill: string;
  lidarEdge: string;
  lidarSweep: string;
  windFill: string;
  windStroke: string;
  stage: string;
  /** Status-only green (`--pass`): the landed pad lamp. */
  pass: string;
  /** Ember shade of the accent (`--paint-deep`): the D* Lite repair light at rest. */
  ember: string;
}

/** Builds an `rgba()` string from a space or comma separated `r g b` triplet. */
export function rgba(triplet: string, alpha: number): string {
  const [r, g, b] = triplet.trim().split(/[\s,]+/);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Built-in values mirroring tokens.css, used only if a token is missing. */
const FALLBACK: Record<string, string> = {
  '--stage': '#0c1014',
  '--ground': '#10161c',
  '--wall': '#2d3844',
  '--text': '#ece8df',
  '--text-rgb': '236 232 223',
  '--paint': '#ff5a1f',
  '--paint-rgb': '255 90 31',
  '--paint-hi': '#ffb347',
  '--paint-deep': '#a8300f',
  '--paint-hi-rgb': '255 179 71',
  '--blocked': '#ff6b57',
  '--pass': '#7be0b0',
};

/**
 * Builds the palette from a token getter (normally `getComputedStyle(root).getPropertyValue`).
 * Missing or empty tokens fall back to the built-in values, so a broken stylesheet cannot
 * paint the map black.
 */
export function buildPalette(get: (name: string) => string): Palette {
  const t = (name: string): string => get(name).trim() || FALLBACK[name];
  const text = t('--text-rgb');
  const paint = t('--paint-rgb');
  const paintHi = t('--paint-hi-rgb');
  return {
    ground: t('--ground'),
    wall: t('--wall'),
    stage: t('--stage'),
    ember: t('--paint-deep'),
    pass: t('--pass'),
    dot: rgba(text, 0.1),
    heat: Array.from({ length: 256 }, (_, i) => rgba(text, Number((0.05 + 0.13 * Math.min(1, i / 6)).toFixed(3)))),
    route: t('--paint'),
    goal: t('--paint-hi'),
    drone: t('--text'),
    nav: t('--paint'),
    patrol: t('--blocked'),
    patrolRim: rgba(paint, 0.9),
    lidarFill: rgba(text, 0.04),
    lidarEdge: rgba(text, 0.22),
    lidarSweep: rgba(paintHi, 0.2),
    windFill: rgba(paintHi, 0.1),
    windStroke: rgba(paintHi, 0.55),
  };
}

/** Reads the palette from the document's root element. Browser only. */
export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  return buildPalette((name) => cs.getPropertyValue(name));
}
