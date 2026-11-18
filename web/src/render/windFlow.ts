/**
 * Wind zones: one merged soft region (baked into the cached base layer) with thin flow
 * lines drifting across it in one direction at a slow, constant ambient speed.
 *
 * The streak is a pre-rendered sprite. Each frame only translates it with `drawImage`, so
 * no gradient, path or string is built in the hot loop. Streak positions come from the pure
 * `streakPhase`, which keeps the motion unit testable. Under reduced motion the clock is
 * frozen: the lines are drawn, still, in their resting positions.
 */
import { cellHash } from './blocks';
import { addFootprint, cellGeom, newCellGeom } from './buildings';
import type { MapColors } from './mapPalette';

/** Distance between streaks on one lane, in cells. */
export const FLOW_PERIOD_CELLS = 4.6;
/** Drift speed in cells per second; the same in every wind zone, always to the right. */
export const FLOW_SPEED_CELLS_PER_S = 0.3;
/** Streak length in cells. */
const STREAK_LEN = 3.2;
/** Lanes per wind row. */
const LANES = 3;

/**
 * Seconds on the flow clock for a frame at `nowMs`. Constant 0 under reduced motion, which
 * freezes every streak where it rests.
 */
export function flowTime(nowMs: number, reduced: boolean): number {
  return reduced ? 0 : nowMs / 1000;
}

/**
 * Position, in cells and within [0, FLOW_PERIOD_CELLS), of the first streak on a lane at
 * flow time `tSec`. Streaks repeat every period, so the others sit at `phase + k * period`.
 * `seed` (0 to 1) staggers lanes; `speedMul` lets lanes drift at slightly different rates.
 */
export function streakPhase(tSec: number, seed: number, speedMul = 1): number {
  const P = FLOW_PERIOD_CELLS;
  const p = (seed * P + FLOW_SPEED_CELLS_PER_S * speedMul * tSec) % P;
  return p < 0 ? p + P : p;
}

/**
 * Fills `out` with a soft 0..1 wind density per cell (a 3x3 box average of the wind mask).
 * Inside a zone it is 1, it falls off across the zone's edge and is 0 beyond one cell, which
 * is what fades streaks in and out as they enter and leave the zone.
 */
export function windDensity(cells: Uint8Array, w: number, h: number, out: Float32Array): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && cells[yy * w + xx] === 2) n++;
        }
      }
      out[y * w + x] = n / 9;
    }
  }
}

let blurOk: boolean | null = null;
/** True when `ctx.filter` works (Chromium and Firefox; not older Safari). Probed once. */
function canBlur(ctx: CanvasRenderingContext2D): boolean {
  if (blurOk === null) {
    ctx.save();
    ctx.filter = 'blur(2px)';
    blurOk = ctx.filter === 'blur(2px)';
    ctx.restore();
  }
  return blurOk;
}

/**
 * Bakes the soft wind region onto `dst` (CSS px coordinates, transform already set to the
 * DPR scale): wind cells merge into one rounded shape, drawn through `scratch` so it can be
 * blurred. `windJoin` is a 0/1 mask of wind cells. Runs only when wind cells change.
 */
export function paintWindRegion(
  dst: CanvasRenderingContext2D, scratch: HTMLCanvasElement, windJoin: Uint8Array,
  w: number, h: number, cs: number, dpr: number, colors: MapColors,
): void {
  const sctx = scratch.getContext('2d');
  if (!sctx) return;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, scratch.width, scratch.height);
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sctx.fillStyle = colors.windRegion;
  const g = newCellGeom();
  sctx.beginPath();
  let any = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (windJoin[y * w + x] !== 1) continue;
      cellGeom(g, x, y, windJoin, w, h, cs);
      // Wind spreads further than a wall: widen the free edges so zones feel like air, not blocks.
      addFootprint(sctx, g, 0, 0);
      any = true;
    }
  }
  if (!any) return;
  sctx.fill();
  dst.save();
  dst.setTransform(1, 0, 0, 1, 0, 0);
  if (canBlur(dst)) {
    dst.filter = `blur(${Math.max(1.5, cs * 0.5 * dpr).toFixed(1)}px)`;
    dst.drawImage(scratch, 0, 0);
    dst.filter = 'none';
    dst.globalAlpha = 0.65;
    dst.drawImage(scratch, 0, 0);
  } else {
    dst.drawImage(scratch, 0, 0);
  }
  dst.restore();
}

/** Animated flow lines over the wind region. Owns the streak sprite and the per-cell density. */
export class WindFlow {
  private sprite: HTMLCanvasElement | null = null;
  private dens: Float32Array;
  private rowHasWind: Uint8Array;
  private seeds: Float32Array;
  private cs = 0;
  private spriteKey = '';
  private any = false;

  constructor(private readonly w: number, private readonly h: number) {
    this.dens = new Float32Array(w * h);
    this.rowHasWind = new Uint8Array(h);
    this.seeds = new Float32Array(h * LANES);
    for (let i = 0; i < this.seeds.length; i++) this.seeds[i] = cellHash(i + 7919);
  }

  /** Recomputes density for the current wind cells. Call when the grid's wind changed or on resize. */
  rebuild(vis: Uint8Array, cs: number, dpr: number, colorKey: string, streakColor: string): void {
    this.cs = cs;
    windDensity(vis, this.w, this.h, this.dens);
    this.any = false;
    for (let y = 0; y < this.h; y++) {
      let has = 0;
      for (let x = 0; x < this.w; x++) if (vis[y * this.w + x] === 2) { has = 1; break; }
      this.rowHasWind[y] = has;
      if (has) this.any = true;
    }
    const key = `${cs.toFixed(2)}:${dpr}:${colorKey}`;
    if (key !== this.spriteKey) {
      this.spriteKey = key;
      this.sprite = makeStreak(cs, dpr, streakColor);
    }
  }

  /** Bilinear density at a point in cell units (cell centres sit at +0.5). */
  private sample(u: number, v: number): number {
    const x = u - 0.5;
    const y = v - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const w = this.w;
    const h = this.h;
    const at = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : this.dens[yy * w + xx]);
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  }

  /** Draws the streaks for flow time `tSec`. Allocation-free. */
  draw(ctx: CanvasRenderingContext2D, tSec: number): void {
    if (!this.any || !this.sprite) return;
    const cs = this.cs;
    const P = FLOW_PERIOD_CELLS;
    const sh = this.sprite.height / (this.sprite.width / (STREAK_LEN * cs));
    for (let y = 0; y < this.h; y++) {
      if (this.rowHasWind[y] === 0) continue;
      for (let k = 0; k < LANES; k++) {
        const seed = this.seeds[y * LANES + k];
        const phase = streakPhase(tSec, seed, 0.8 + 0.25 * k);
        for (let x0 = phase - P; x0 < this.w; x0 += P) {
          const cx = x0 + STREAK_LEN * 0.5;
          const ly = y + 0.18 + 0.32 * k + (seed - 0.5) * 0.14 + Math.sin(tSec * 0.8 + x0 * 0.55 + seed * 6.283) * 0.1;
          const d = this.sample(cx, ly);
          const a = (d - 0.15) * 0.9;
          if (a <= 0.02) continue;
          ctx.globalAlpha = a > 1 ? 1 : a;
          ctx.drawImage(this.sprite, x0 * cs, ly * cs - sh * 0.5, STREAK_LEN * cs, sh);
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}

/** Pre-renders one streak: a thin horizontal line that fades in, peaks late and tapers out. */
function makeStreak(cs: number, dpr: number, color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const wpx = Math.max(4, Math.round(STREAK_LEN * cs * dpr));
  const lw = Math.max(1.1, cs * 0.04) * dpr;
  const hpx = Math.ceil(lw + 2);
  c.width = wpx;
  c.height = hpx;
  const g = c.getContext('2d');
  if (!g) return c;
  const grad = g.createLinearGradient(0, 0, wpx, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  grad.addColorStop(0.72, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.strokeStyle = grad;
  g.lineWidth = lw;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(lw * 0.5, hpx / 2);
  g.lineTo(wpx - lw * 0.5, hpx / 2);
  g.stroke();
  // Tint: keep the alpha shape of the line, take the colour from the palette.
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, wpx, hpx);
  return c;
}
