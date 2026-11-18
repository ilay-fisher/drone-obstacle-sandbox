/**
 * The LiDAR sweep as pure maths: where the beam is at a time, which wall cells it has just
 * passed over (and can actually see), and how bright each one flashes. The drone layer draws
 * the fan from a cached sprite and puts a tick mark on every hit returned here.
 *
 * A hit needs line of sight: a wall behind another wall is not flashed, as a real scan would
 * not reach it. Walls are `1` in the planner grid (patrols are stamped there too, so a patrol
 * flashes as well, which is right: the sensor sees it).
 */

const TAU = Math.PI * 2;

/** Width of the fan, 50 degrees. */
export const FAN_RAD = (50 * Math.PI) / 180;
/** Sweep speed in rad/s (about one turn every 2.4 s). */
export const SWEEP_RATE = 2.6;
/** A wall stays lit for this many radians of beam travel behind the leading edge (about 0.2 s). */
export const FLASH_ARC = 0.55;

/** Wraps an angle into [0, 2pi). */
export function wrapTau(a: number): number {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

/** Angle of the beam's leading edge at `nowMs`. Fixed under reduced motion (the ring is static). */
export function sweepAngle(nowMs: number, reduced: boolean): number {
  return reduced ? 0 : wrapTau((nowMs / 1000) * SWEEP_RATE);
}

/**
 * Brightness (0..1) of a wall cell `lag` radians behind the beam's leading edge: full right
 * behind it, easing to nothing by `FLASH_ARC`. Cells the edge has not reached (negative lag)
 * are dark.
 */
export function flashAmount(lag: number): number {
  if (!(lag >= 0) || lag >= FLASH_ARC) return 0;
  const k = 1 - lag / FLASH_ARC;
  return k * k;
}

/**
 * True when no wall lies strictly between (x0,y0) and (x1,y1) (cell units). Steps along the
 * ray in 0.3 cell increments and succeeds as soon as it enters the target's own cell.
 */
export function lineOfSight(grid: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number): boolean {
  const tx = Math.floor(x1);
  const ty = Math.floor(y1);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / 0.3));
  for (let s = 1; s <= steps; s++) {
    const cx = Math.floor(x0 + (dx * s) / steps);
    const cy = Math.floor(y0 + (dy * s) / steps);
    if (cx === tx && cy === ty) return true;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
    if (grid[cy * w + cx] === 1) return false;
  }
  return true;
}

/** Preallocated hit list: `count` valid entries of `cells` (cell index) and `amount` (0..1). */
export interface ScanHits {
  cells: Int32Array;
  amount: Float32Array;
  count: number;
}

export function createScanHits(capacity: number): ScanHits {
  return { cells: new Int32Array(capacity), amount: new Float32Array(capacity), count: 0 };
}

/**
 * Fills `out` with the wall cells inside `radius` (cells) of the drone that the beam edge at
 * `edge` radians has passed within the last `FLASH_ARC`, and that the drone can see. Returns
 * how many. Never writes past the buffer. Allocation-free.
 */
export function collectHits(
  grid: Uint8Array, w: number, h: number, droneX: number, droneY: number, radius: number, edge: number, out: ScanHits,
): number {
  let n = 0;
  const cap = out.cells.length;
  const x0 = Math.max(0, Math.floor(droneX - radius));
  const x1 = Math.min(w - 1, Math.ceil(droneX + radius));
  const y0 = Math.max(0, Math.floor(droneY - radius));
  const y1 = Math.min(h - 1, Math.ceil(droneY + radius));
  const r2 = radius * radius;
  for (let y = y0; y <= y1 && n < cap; y++) {
    for (let x = x0; x <= x1 && n < cap; x++) {
      if (grid[y * w + x] !== 1) continue;
      const dx = x + 0.5 - droneX;
      const dy = y + 0.5 - droneY;
      if (dx * dx + dy * dy > r2) continue;
      const amount = flashAmount(wrapTau(edge - Math.atan2(dy, dx)));
      if (amount <= 0) continue;
      if (!lineOfSight(grid, w, h, droneX, droneY, x + 0.5, y + 0.5)) continue;
      out.cells[n] = y * w + x;
      out.amount[n] = amount;
      n++;
    }
  }
  out.count = n;
  return n;
}
