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

/** What `pickWall` needs to know: the live grid (1 = wall), the route and the drone's place on it. */
export interface WallQuery {
  grid: Uint8Array;
  width: number;
  height: number;
  path: Int32Array;
  pathIdx: number;
  pathLen: number;
  /** The drone's LiDAR range in cells. A wall inside it is seen (and replanned around) at once. */
  lidarRadius: number;
}

/** Wall lengths tried, longest first: odd lengths are centred on a route cell. */
const WALL_LENS = [5, 3] as const;
/** The ahead distance (cells along the route) we like best; candidates are tried nearest to it first. */
const PREFERRED_AHEAD = 5;

interface Tier { a0: number; a1: number; clear: boolean; lens: readonly number[] }

/**
 * A deliberate scripted obstacle: a short straight wall perpendicular to the route, centred on
 * a route cell on open street, ahead of the drone inside LiDAR range. Every wall cell is free
 * ground. In the first tiers each cell is also at least one cell from any building (so the
 * wall reads as a barrier placed in the street, never as an extension of a building edge) and
 * the street stays passable around its ends. The later tiers relax range, clearance and length
 * for narrow streets, and the last one falls back to the old straight-across wall. Pure and
 * deterministic; empty only when there is no usable route.
 */
export function pickWall(q: WallQuery): { x: number; y: number }[] {
  const { grid, width: w, height: h, path } = q;
  const len = Math.min(q.pathLen, path.length);
  if (len < 4) return [];
  const last = len - 3;
  const goal = path[len - 1];
  const reach = Math.max(4, Math.floor(q.lidarRadius));
  const tiers: Tier[] = [
    { a0: 4, a1: reach, clear: true, lens: WALL_LENS },
    { a0: 3, a1: reach + 5, clear: true, lens: WALL_LENS },
    { a0: 3, a1: reach + 5, clear: false, lens: [5, 3, 2] },
  ];
  const free = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && grid[y * w + x] === 0;
  const building = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && grid[y * w + x] === 1;
  for (const t of tiers) {
    const aheads: number[] = [];
    for (let a = t.a0; a <= t.a1; a++) aheads.push(a);
    aheads.sort((p, r) => Math.abs(p - PREFERRED_AHEAD) - Math.abs(r - PREFERRED_AHEAD) || p - r);
    for (const a of aheads) {
      const i = q.pathIdx + a;
      if (i > last || i < 1) continue;
      const c = path[i];
      const cx = c % w;
      const cy = (c / w) | 0;
      const p = path[i - 1];
      const n = path[Math.min(i + 1, len - 1)];
      const dx = (n % w) - (p % w);
      const dy = ((n / w) | 0) - ((p / w) | 0);
      const vertical = Math.abs(dx) >= Math.abs(dy); // a horizontal-ish route is crossed by a vertical wall
      for (const L of t.lens) {
        const lo = -Math.floor((L - 1) / 2);
        const hi = Math.floor(L / 2);
        const cells: { x: number; y: number }[] = [];
        let ok = true;
        for (let k = lo; k <= hi && ok; k++) {
          const x = vertical ? cx : cx + k;
          const y = vertical ? cy + k : cy;
          if (!free(x, y) || y * w + x === goal) { ok = false; break; }
          if (t.clear) {
            for (let oy = -1; oy <= 1 && ok; oy++) for (let ox = -1; ox <= 1; ox++) if (building(x + ox, y + oy)) { ok = false; break; }
          }
          cells.push({ x, y });
        }
        if (!ok) continue;
        if (!t.clear) {
          // leave a way round: at least one end must open onto free ground
          const e1 = vertical ? free(cx, cy + lo - 1) : free(cx + lo - 1, cy);
          const e2 = vertical ? free(cx, cy + hi + 1) : free(cx + hi + 1, cy);
          if (!e1 && !e2) continue;
        }
        return cells;
      }
    }
  }
  return blockCellsAhead(path, q.pathIdx, len, w, h, PREFERRED_AHEAD, 1);
}
