/** Pure helpers for the scripted run: what to paint when, and where the walls go. */

/** Flat indices of every cell holding `value`, ascending. */
export function cellsWithValue(cells: Uint8Array, value: number): Int32Array {
  let n = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] === value) n++;
  const out = new Int32Array(n);
  let k = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] === value) out[k++] = i;
  return out;
}

/** Deterministic 0..1 noise for a cell index, so the same city always settles the same way. */
function jitter(i: number): number {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Orders cells so the city assembles as a left-to-right wave with a little scatter:
 * the rank of a cell is its column plus up to ~5 columns of jitter. Returns a new array.
 */
export function staggerOrder(idx: Int32Array, width: number): Int32Array {
  const keyed = Array.from(idx, (c) => ({ c, k: (c % width) + jitter(c) * 5 }));
  keyed.sort((a, b) => a.k - b.k || a.c - b.c);
  return Int32Array.from(keyed, (e) => e.c);
}

/** How many of `n` cells are due `tMs` into a painting window of `spanMs` (0 before the start, all at the end). */
export function dueCount(n: number, tMs: number, spanMs: number): number {
  if (n <= 0 || !Number.isFinite(tMs) || tMs <= 0) return 0;
  if (!(spanMs > 0) || tMs >= spanMs) return n;
  return Math.min(n, Math.floor((n * tMs) / spanMs));
}

/**
 * A short vertical wall across the route, `ahead` cells in front of the drone's place on
 * the path and `half` cells to each side. The wall is clamped so it never sits on the last
 * two cells (the goal) and stays on the map. Empty when there is no usable route.
 */
export function blockCellsAhead(
  path: Int32Array, pathIdx: number, pathLen: number, width: number, height: number, ahead: number, half: number,
): { x: number; y: number }[] {
  const len = Math.min(pathLen, path.length);
  if (len < 4) return [];
  const last = len - 3;
  const at = Math.min(Math.max(pathIdx + ahead, pathIdx + 1), last);
  if (at < 1) return [];
  const c = path[at];
  const x = c % width;
  const cy = (c / width) | 0;
  const out: { x: number; y: number }[] = [];
  for (let y = cy - half; y <= cy + half; y++) if (y >= 0 && y < height) out.push({ x, y });
  return out;
}
