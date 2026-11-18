/**
 * The route as drawn: a smoothed curve through the planner's cell-centre path, plus the
 * arc-length bookkeeping the draw-on and the route trim need. Display only: the planner's
 * path is never changed, and the drone still flies the original cell path.
 *
 * Points are interleaved `[x0, y0, x1, y1, ...]` in cell units (a cell centre is x + 0.5).
 * Everything here is pure; curves are built once per replan, never per frame.
 */

/** A smoothed polyline and its cumulative arc length at every vertex. */
export interface Curve {
  pts: Float32Array;
  /** Arc length from the first vertex to vertex i (cum[0] is 0). */
  cum: Float32Array;
  /** Vertex count. */
  n: number;
  /** Total arc length. */
  length: number;
}

/** Writes the centres of `cells` (row-major indices on a grid `w` wide) into `out`; returns the point count. */
export function cellCentres(cells: ArrayLike<number>, w: number, out: Float32Array): number {
  const n = cells.length;
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    out[2 * i] = (c % w) + 0.5;
    out[2 * i + 1] = ((c / w) | 0) + 0.5;
  }
  return n;
}

/**
 * Chaikin corner cutting, `iterations` times, keeping the first and last point. Each pass
 * doubles the point count, so `out` needs room for `n * 2^iterations` points. Returns the count.
 */
export function chaikin(src: Float32Array, n: number, iterations: number, out: Float32Array): number {
  let cur = src.slice(0, 2 * n);
  let m = n;
  for (let it = 0; it < iterations && m >= 3; it++) {
    const next = new Float32Array(4 * m);
    let k = 0;
    next[k++] = cur[0];
    next[k++] = cur[1];
    for (let i = 0; i < m - 1; i++) {
      const ax = cur[2 * i], ay = cur[2 * i + 1], bx = cur[2 * i + 2], by = cur[2 * i + 3];
      next[k++] = 0.75 * ax + 0.25 * bx;
      next[k++] = 0.75 * ay + 0.25 * by;
      next[k++] = 0.25 * ax + 0.75 * bx;
      next[k++] = 0.25 * ay + 0.75 * by;
    }
    next[k++] = cur[2 * m - 2];
    next[k++] = cur[2 * m - 1];
    m = k / 2;
    cur = next;
  }
  out.set(cur.subarray(0, 2 * m));
  return m;
}

/** Fills `cum` with the arc length at each of the `n` points and returns the total. */
export function arcLengths(pts: Float32Array, n: number, cum: Float32Array): number {
  let s = 0;
  if (n > 0) cum[0] = 0;
  for (let i = 1; i < n; i++) {
    s += Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
    cum[i] = s;
  }
  return s;
}

/** Smooths a cell path (grid `w` wide) into a display curve. Allocates; call once per replan. */
export function smoothRoute(cells: ArrayLike<number>, w: number, iterations = 2): Curve {
  const n = cells.length;
  if (n === 0) return { pts: new Float32Array(0), cum: new Float32Array(0), n: 0, length: 0 };
  const raw = new Float32Array(2 * n);
  cellCentres(cells, w, raw);
  const cap = n << iterations;
  const pts = new Float32Array(2 * cap);
  const m = chaikin(raw, n, iterations, pts);
  const cum = new Float32Array(m);
  const length = arcLengths(pts, m, cum);
  return { pts: pts.subarray(0, 2 * m), cum, n: m, length };
}

/** Index of the last vertex whose arc length is at most `s` (0 when `s` is before the second vertex). */
export function subCurveEnd(c: Curve, s: number): number {
  if (c.n === 0) return 0;
  let lo = 0;
  let hi = c.n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c.cum[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Writes the point at arc length `s` (clamped to the curve) into `out`. */
export function pointAt(c: Curve, s: number, out: { x: number; y: number }): void {
  if (c.n === 0) return;
  if (s <= 0 || c.n === 1) { out.x = c.pts[0]; out.y = c.pts[1]; return; }
  if (s >= c.length) { out.x = c.pts[2 * c.n - 2]; out.y = c.pts[2 * c.n - 1]; return; }
  const k = subCurveEnd(c, s);
  const seg = c.cum[k + 1] - c.cum[k];
  const t = seg > 0 ? (s - c.cum[k]) / seg : 0;
  out.x = c.pts[2 * k] + (c.pts[2 * k + 2] - c.pts[2 * k]) * t;
  out.y = c.pts[2 * k + 1] + (c.pts[2 * k + 3] - c.pts[2 * k + 1]) * t;
}
