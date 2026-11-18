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

/**
 * Splits wall cells into buildings (4-connected pieces), ordered left to right, each at most
 * `maxBatch` cells (a larger block is cut in row order). The renderer animates an edit only
 * when fewer than 48 cells change in one frame, so painting one batch per frame makes every
 * building drop in whole, on its own spring, instead of dissolving into scattered cells.
 */
export function paintBatches(cells: Int32Array, width: number, height: number, maxBatch: number): Int32Array[] {
  const present = new Set<number>(cells);
  const seen = new Set<number>();
  const blocks: number[][] = [];
  for (const start of Array.from(cells).sort((a, b) => a - b)) {
    if (seen.has(start)) continue;
    const block: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const c = stack.pop()!;
      block.push(c);
      const x = c % width;
      const y = (c / width) | 0;
      const next: number[] = [];
      if (x > 0) next.push(c - 1);
      if (x < width - 1) next.push(c + 1);
      if (y > 0) next.push(c - width);
      if (y < height - 1) next.push(c + width);
      for (const n of next) if (present.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
    }
    block.sort((a, b) => a - b);
    blocks.push(block);
  }
  const minX = (b: number[]) => b.reduce((m, c) => Math.min(m, c % width), width);
  blocks.sort((a, b) => minX(a) - minX(b) || a[0] - b[0]);
  const out: Int32Array[] = [];
  for (const b of blocks) {
    for (let i = 0; i < b.length; i += maxBatch) out.push(Int32Array.from(b.slice(i, i + maxBatch)));
  }
  return out;
}
