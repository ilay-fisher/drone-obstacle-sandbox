/**
 * Geometry and painting of one building cell, shared by the cached static layer (`mapLayers`)
 * and the live drop/lift animation (`mapFx`) so a cell looks identical in both.
 *
 * One light, top left. A building is its footprint on the ground, a top face lifted by the
 * block's height (drawn a little higher on screen), and the strip of side face that shows
 * between the two. Neighbouring wall cells join: no padding and no rounded corners on a shared
 * edge, so a block of cells is one rounded solid with no seam. Shadows fall to the lower right.
 */
import { BLOCK_H_MAX, BLOCK_H_MIN } from './blocks';
import type { MapColors } from './mapPalette';

/** Reused geometry record. `rad` is the four corner radii (tl, tr, br, bl) for `roundRect`. */
export interface CellGeom {
  l: number; t: number; r: number; b: number;
  rad: number[];
  /** Cell radius used for outer corners, and for insetting the specular edges. */
  corner: number;
  wu: boolean; wl: boolean; wr: boolean; wd: boolean;
}

/** Allocates a geometry record to be refilled by `cellGeom`. */
export function newCellGeom(): CellGeom {
  return { l: 0, t: 0, r: 0, b: 0, rad: [0, 0, 0, 0], corner: 0, wu: false, wl: false, wr: false, wd: false };
}

/** Space between a free cell edge and the building, as a fraction of the cell. */
const PAD = 0.07;
/** Corner radius as a fraction of the cell. */
const RADIUS = 0.3;
/** Joined edges overlap by this many px so adjacent cells leave no seam. */
const OVERLAP = 0.5;

/**
 * Fills `g` with the footprint of cell (`x`, `y`) in CSS px. `join[i] === 1` marks cells that
 * count as wall for joining purposes. Rounds only the corners that face open ground.
 */
export function cellGeom(g: CellGeom, x: number, y: number, join: Uint8Array, w: number, h: number, cs: number): void {
  const i = y * w + x;
  const wl = x > 0 && join[i - 1] === 1;
  const wr = x < w - 1 && join[i + 1] === 1;
  const wu = y > 0 && join[i - w] === 1;
  const wd = y < h - 1 && join[i + w] === 1;
  const pad = cs * PAD;
  const r = cs * RADIUS;
  g.wl = wl; g.wr = wr; g.wu = wu; g.wd = wd;
  g.l = x * cs + (wl ? -OVERLAP : pad);
  g.r = (x + 1) * cs - (wr ? -OVERLAP : pad);
  g.t = y * cs + (wu ? -OVERLAP : pad);
  g.b = (y + 1) * cs - (wd ? -OVERLAP : pad);
  g.corner = r;
  g.rad[0] = !wu && !wl ? r : 0;
  g.rad[1] = !wu && !wr ? r : 0;
  g.rad[2] = !wd && !wr ? r : 0;
  g.rad[3] = !wd && !wl ? r : 0;
}

/** Adds the footprint, shifted by (`dx`, `dy`), as a rounded rectangle subpath. */
export function addFootprint(ctx: CanvasPath, g: CellGeom, dx: number, dy: number): void {
  ctx.roundRect(g.l + dx, g.t + dy, g.r - g.l, g.b - g.t, g.rad);
}

/** Index of the top-face shade for a block height in cell units (see `BLOCK_H_*`). */
export function shadeIndex(heightCells: number, shades: number): number {
  const u = (heightCells - BLOCK_H_MIN) / (BLOCK_H_MAX - BLOCK_H_MIN);
  return Math.max(0, Math.min(shades - 1, Math.floor(u * shades)));
}

/** Paints the shaded side face of one cell: its footprint, lifted by `rise` px, at `alpha`. */
export function paintSide(ctx: CanvasRenderingContext2D, g: CellGeom, colors: MapColors, rise: number, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colors.side;
  ctx.beginPath();
  addFootprint(ctx, g, 0, -rise);
  ctx.fill();
}

/** Paints the lit top face of one cell, `hpx` px above its footprint and `rise` px above the ground. */
export function paintTop(
  ctx: CanvasRenderingContext2D, g: CellGeom, colors: MapColors, shade: number,
  hpx: number, rise: number, alpha: number,
): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colors.top[shade];
  ctx.beginPath();
  addFootprint(ctx, g, 0, -rise - hpx);
  ctx.fill();
}

/**
 * Paints a whole cell, side then top. `squash` scales the height (the landing squash) and
 * `alpha` fades it. Used by the live animation; the cached layer paints sides and tops in
 * separate passes per row so a neighbour's side never overlaps this cell's top.
 */
export function paintBody(
  ctx: CanvasRenderingContext2D, g: CellGeom, colors: MapColors, shade: number,
  hpx: number, rise: number, squash: number, alpha: number,
): void {
  paintSide(ctx, g, colors, rise, alpha);
  paintTop(ctx, g, colors, shade, hpx * squash, rise, alpha);
}

/**
 * Adds the specular edges of the top face to three paths: `hi` along the lit north edge,
 * `west` down the west edge, `lo` along the shaded east and south edges. Edges that touch a
 * joined neighbour are skipped, so the specular follows the outline of the whole block.
 */
export function addEdges(
  hi: CanvasPath, west: CanvasPath, lo: CanvasPath,
  g: CellGeom, hpx: number, rise: number, lw: number,
): void {
  const k = g.corner * 0.7;
  const top = g.t - rise - hpx + lw * 0.5;
  const bottom = g.b - rise - hpx - lw * 0.5;
  const left = g.l + lw * 0.5;
  const right = g.r - lw * 0.5;
  if (!g.wu) { hi.moveTo(g.l + (g.wl ? 0 : k), top); hi.lineTo(g.r - (g.wr ? 0 : k), top); }
  if (!g.wl) { west.moveTo(left, g.t - rise - hpx + (g.wu ? 0 : k)); west.lineTo(left, g.b - rise - hpx - (g.wd ? 0 : k)); }
  if (!g.wd) { lo.moveTo(g.l + (g.wl ? 0 : k), bottom); lo.lineTo(g.r - (g.wr ? 0 : k), bottom); }
  if (!g.wr) { lo.moveTo(right, g.t - rise - hpx + (g.wu ? 0 : k)); lo.lineTo(right, g.b - rise - hpx - (g.wd ? 0 : k)); }
}
