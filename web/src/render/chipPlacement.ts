/**
 * Where the replan chip goes. Pure geometry in CSS px, so the choice can be unit tested.
 *
 * The chip pins next to the flood but must never cover the new route, the drone or the goal
 * pad. Candidates are tried in a fixed order (above, below, right, left of the flood's bounding
 * box, then the map corners nearest the flood first) and the first one that clears wins.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Anchor = 'above' | 'below' | 'right' | 'left' | 'corner' | 'fallback';

export interface PlaceInput {
  /** Size of the chip's visible pill. */
  box: { w: number; h: number };
  map: { w: number; h: number };
  /** Minimum distance from the map edge. */
  margin: number;
  /** Distance kept from the flood's bounding box. */
  gap: number;
  /** Bounding box of the flooded cells. */
  flood: Rect;
  /** Route polyline `[x0, y0, x1, y1, ...]` and its point count. */
  route: Float32Array;
  routeN: number;
  /** Clearance kept around the route line. */
  routePad: number;
  /** Rects to stay clear of: the drone and the goal pad. */
  avoid: Rect[];
}

export interface Placement {
  x: number;
  y: number;
  anchor: Anchor;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** True when any segment of the polyline passes within `pad` of the rect. */
export function rectHitsPolyline(r: Rect, pts: Float32Array, n: number, pad: number): boolean {
  const x0 = r.x - pad;
  const y0 = r.y - pad;
  const x1 = r.x + r.w + pad;
  const y1 = r.y + r.h + pad;
  if (n === 1) return pts[0] >= x0 && pts[0] <= x1 && pts[1] >= y0 && pts[1] <= y1;
  for (let i = 0; i + 1 < n; i++) {
    if (segmentHitsBox(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], x0, y0, x1, y1)) return true;
  }
  return false;
}

/** Liang-Barsky clip: does the segment touch the box? */
function segmentHitsBox(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}

function violations(r: Rect, i: PlaceInput): number {
  let n = rectHitsPolyline(r, i.route, i.routeN, i.routePad) ? 1 : 0;
  for (const a of i.avoid) if (rectsOverlap(r, a)) n++;
  return n;
}

export function placeChip(i: PlaceInput): Placement {
  const { box, map, margin, gap, flood } = i;
  const clampX = (x: number) => Math.min(Math.max(margin, x), Math.max(margin, map.w - margin - box.w));
  const clampY = (y: number) => Math.min(Math.max(margin, y), Math.max(margin, map.h - margin - box.h));
  const cx = flood.x + flood.w / 2;
  const cy = flood.y + flood.h / 2;
  const cands: { x: number; y: number; anchor: Anchor }[] = [
    { x: cx - box.w / 2, y: flood.y - gap - box.h, anchor: 'above' },
    { x: cx - box.w / 2, y: flood.y + flood.h + gap, anchor: 'below' },
    { x: flood.x + flood.w + gap, y: cy - box.h / 2, anchor: 'right' },
    { x: flood.x - gap - box.w, y: cy - box.h / 2, anchor: 'left' },
  ];
  const corners = [
    { x: margin, y: margin },
    { x: map.w - margin - box.w, y: margin },
    { x: margin, y: map.h - margin - box.h },
    { x: map.w - margin - box.w, y: map.h - margin - box.h },
  ].sort((a, b) => Math.hypot(a.x + box.w / 2 - cx, a.y + box.h / 2 - cy) - Math.hypot(b.x + box.w / 2 - cx, b.y + box.h / 2 - cy));
  for (const c of corners) cands.push({ ...c, anchor: 'corner' });

  let best: Placement | null = null;
  let bestScore = Infinity;
  for (const c of cands) {
    const x = clampX(c.x);
    const y = clampY(c.y);
    const score = violations({ x, y, w: box.w, h: box.h }, i);
    if (score === 0) return { x, y, anchor: c.anchor };
    if (score < bestScore) { bestScore = score; best = { x, y, anchor: 'fallback' }; }
  }
  return best ?? { x: clampX(margin), y: clampY(margin), anchor: 'fallback' };
}

/** Chip size for a map `mapW` CSS px wide: full on a roomy map, compact and smaller on a phone. */
export function chipLayout(mapW: number): { compact: boolean; font: number; padX: number; h: number; dotR: number } {
  if (mapW >= 500) return { compact: false, font: 11, padX: 12, h: 24, dotR: 3.5 };
  const font = 9 + Math.min(1, Math.max(0, (mapW - 250) / 250)) * 1.5;
  return { compact: true, font, padX: 7, h: 18, dotR: 2.5 };
}
