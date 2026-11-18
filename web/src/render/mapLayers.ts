/**
 * Static map layers, cached offscreen and rebuilt only when the grid (or the animating set)
 * changes, never per frame:
 *
 * - `base`: ground fill, one faint dot per cell centre, and the soft merged wind region.
 *   Rebuilt when wind cells change or the canvas is resized.
 * - `shade`: cast shadows and the lit buildings (transparent elsewhere), so the search layer
 *   can draw its glow between `base` and `shade`. Rebuilt when walls change, and whenever a
 *   drop/lift animation starts or ends (animating cells are drawn live, not cached).
 *
 * Buildings: 4-connected wall cells form one block with one height from `cellHash`, a lit
 * top face, a darker side face and a contact shadow to the lower right. One light, top left:
 * a diagonal light pass over the whole layer brightens the upper left and darkens the lower
 * right, so the map reads as lit from one corner.
 */
import type { EditFx } from './mapFx';
import { BLOCK_H_MAX, blockHeight, labelBlocks } from './blocks';
import {
  addEdges, addFootprint, cellGeom, newCellGeom, paintSide, paintTop, shadeIndex,
} from './buildings';
import { TOP_SHADES, type MapColors } from './mapPalette';
import type { Palette } from './palette';
import { paintWindRegion } from './windFlow';

/** How far off canvas the shadow caster is drawn, in CSS px, when a blurred shadow is wanted. */
const CASTER_OFFSET = 6000;

function makeCanvas(): HTMLCanvasElement {
  return document.createElement('canvas');
}

/** The cached ground, wind and building layers plus the scratch buffers used to bake them. */
export class MapLayers {
  readonly base = makeCanvas();
  readonly shade = makeCanvas();
  private readonly ground = makeCanvas();
  private readonly scratch = makeCanvas();
  /** Block id per cell (lowest cell index of its block) and the labelling stack. */
  readonly ids: Int32Array;
  private readonly stack: Int32Array;
  /** 1 where a cell counts as wall for joining: real walls plus walls that are lifting out. */
  readonly join: Uint8Array;
  private readonly windJoin: Uint8Array;
  /** Scratch marks for the dirty-block search. */
  private readonly mark: Uint8Array;
  private readonly geom = newCellGeom();
  cs = 16;
  dpr = 1;

  constructor(readonly w: number, readonly h: number) {
    const n = w * h;
    this.ids = new Int32Array(n);
    this.stack = new Int32Array(n);
    this.join = new Uint8Array(n);
    this.windJoin = new Uint8Array(n);
    this.mark = new Uint8Array(n);
  }

  /** Resizes every canvas for a new cell size or DPR and redraws the ground. Callers rebake base and shade after. */
  resize(cs: number, dpr: number, pal: Palette): void {
    this.cs = cs;
    this.dpr = dpr;
    const wpx = Math.round(this.w * cs * dpr);
    const hpx = Math.round(this.h * cs * dpr);
    for (const c of [this.base, this.shade, this.ground, this.scratch]) {
      c.width = wpx;
      c.height = hpx;
    }
    this.paintGround(pal);
  }

  /** Ground fill plus one faint dot per cell centre. Only on resize. */
  private paintGround(pal: Palette): void {
    const g = this.ground.getContext('2d');
    if (!g) return;
    const { w, h, cs, dpr } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = pal.ground;
    g.fillRect(0, 0, w * cs, h * cs);
    g.fillStyle = pal.dot;
    const r = Math.max(0.9, cs * 0.05);
    g.beginPath();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cx = (x + 0.5) * cs;
        const cy = (y + 0.5) * cs;
        g.moveTo(cx + r, cy);
        g.arc(cx, cy, r, 0, Math.PI * 2);
      }
    }
    g.fill();
  }

  /** Rebuilds `base`: the ground and the soft wind region for the wind cells in `vis`. */
  bakeBase(vis: Uint8Array, colors: MapColors): void {
    const ctx = this.base.getContext('2d');
    if (!ctx) return;
    const { w, h, cs, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.ground, 0, 0);
    for (let i = 0; i < vis.length; i++) this.windJoin[i] = vis[i] === 2 ? 1 : 0;
    paintWindRegion(ctx, this.scratch, this.windJoin, w, h, cs, dpr, colors);
  }

  /**
   * Rebuilds `shade` from the visual grid. Cells with a running drop or lift animation are
   * left out (the live pass draws them) but still count as joined neighbours, so a block does
   * not change shape the moment an animation starts or ends.
   *
   * `dirty` lists cell indices whose state changed since the last bake (`dirtyCount` of them);
   * only the blocks touching those cells, plus a margin for height and shadow, are redrawn
   * inside a clip. Pass `null` for a full rebuild (first bake, resize, bulk change).
   */
  bakeShade(vis: Uint8Array, fx: EditFx, colors: MapColors, dirty: Int32Array | null = null, dirtyCount = 0): void {
    const ctx = this.shade.getContext('2d');
    const sctx = this.scratch.getContext('2d');
    if (!ctx || !sctx) return;
    const { w, h, cs, dpr, join, ids } = this;
    const n = w * h;
    for (let i = 0; i < n; i++) join[i] = vis[i] === 1 ? 1 : 0;
    for (let k = 0; k < fx.count; k++) {
      if (fx.kindAt(k) === 'lift') join[fx.cellAt(k)] = 1;
    }
    labelBlocks(join, w, h, ids, this.stack);

    // Dirty rectangle in CSS px (whole layer when `dirty` is null).
    let rx0 = 0, ry0 = 0, rx1 = w * cs, ry1 = h * cs;
    let partial = false;
    if (dirty !== null && dirtyCount > 0) {
      const mark = this.mark;
      mark.fill(0);
      let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
      const grow = (c: number) => {
        const x = c % w, y = (c / w) | 0;
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      };
      for (let k = 0; k < dirtyCount; k++) {
        const c = dirty[k];
        grow(c);
        const x = c % w, y = (c / w) | 0;
        if (ids[c] >= 0) mark[ids[c]] = 1;
        if (x > 0 && ids[c - 1] >= 0) mark[ids[c - 1]] = 1;
        if (x < w - 1 && ids[c + 1] >= 0) mark[ids[c + 1]] = 1;
        if (y > 0 && ids[c - w] >= 0) mark[ids[c - w]] = 1;
        if (y < h - 1 && ids[c + w] >= 0) mark[ids[c + w]] = 1;
      }
      for (let i = 0; i < n; i++) if (ids[i] >= 0 && mark[ids[i]] === 1) grow(i);
      const m = cs * (BLOCK_H_MAX + 1.3);
      rx0 = Math.max(0, bx0 * cs - m * 0.6);
      ry0 = Math.max(0, by0 * cs - m);
      rx1 = Math.min(w * cs, (bx1 + 1) * cs + m);
      ry1 = Math.min(h * cs, (by1 + 1) * cs + m * 0.6);
      partial = true;
    }
    // Device px, rounded outward.
    const dx0 = Math.floor(rx0 * dpr), dy0 = Math.floor(ry0 * dpr);
    const dx1 = Math.min(this.shade.width, Math.ceil(rx1 * dpr)), dy1 = Math.min(this.shade.height, Math.ceil(ry1 * dpr));
    const cx0 = dx0 / dpr, cy0 = dy0 / dpr, cx1 = dx1 / dpr, cy1 = dy1 / dpr;
    // A cell matters when its footprint, height or shadow can reach the rectangle.
    const reach = cs * (BLOCK_H_MAX + 1.3);
    const touches = (x: number, y: number): boolean =>
      !partial || ((x + 1) * cs + reach > cx0 && x * cs - reach < cx1 && (y + 1) * cs + reach > cy0 && y * cs - reach < cy1);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(dx0, dy0, dx1 - dx0, dy1 - dy0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx0, dy0, dx1 - dx0, dy1 - dy0);
    ctx.clip();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = this.geom;

    // Cast shadows: a soft one (blurred, the caster drawn off canvas so only its shadow lands)
    // and a tight dark one right at the base. Both fall to the lower right, away from the light,
    // and grow with the block's height, so a tall block throws a longer shadow.
    ctx.fillStyle = '#000';
    ctx.shadowColor = colors.shadowSoft;
    ctx.shadowBlur = cs * 0.32 * dpr;
    ctx.shadowOffsetX = CASTER_OFFSET * dpr;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (join[i] !== 1 || fx.has(i)) continue;
      const x = i % w, y = (i / w) | 0;
      if (!touches(x, y)) continue;
      const hpx = this.heightPx(i);
      cellGeom(g, x, y, join, w, h, cs);
      addFootprint(ctx, g, -CASTER_OFFSET + cs * 0.16 + hpx * 0.9, cs * 0.14 + hpx * 0.7);
    }
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.fillStyle = colors.shadowTight;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (join[i] !== 1 || fx.has(i)) continue;
      const x = i % w, y = (i / w) | 0;
      if (!touches(x, y)) continue;
      const hpx = this.heightPx(i);
      cellGeom(g, x, y, join, w, h, cs);
      addFootprint(ctx, g, cs * 0.04 + hpx * 0.34, cs * 0.05 + hpx * 0.28);
    }
    ctx.fill();
    ctx.restore();

    // Buildings on a scratch layer so the light pass touches only them. Painter's order, row by
    // row: all sides of a row, then all its tops, so a southern block's top covers a northern
    // block's side and a joined neighbour's side never overlaps this cell's top.
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalCompositeOperation = 'source-over';
    sctx.globalAlpha = 1;
    sctx.clearRect(dx0, dy0, dx1 - dx0, dy1 - dy0);
    sctx.save();
    sctx.beginPath();
    sctx.rect(dx0, dy0, dx1 - dx0, dy1 - dy0);
    sctx.clip();
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const hi = new Path2D();
    const west = new Path2D();
    const lo = new Path2D();
    const lw = Math.max(1.2, cs * 0.055);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (join[i] !== 1 || fx.has(i) || !touches(x, y)) continue;
        cellGeom(g, x, y, join, w, h, cs);
        paintSide(sctx, g, colors, 0, 1);
      }
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (join[i] !== 1 || fx.has(i) || !touches(x, y)) continue;
        const hc = blockHeight(ids[i]);
        const hpx = Math.max(2, hc * cs);
        cellGeom(g, x, y, join, w, h, cs);
        paintTop(sctx, g, colors, shadeIndex(hc, TOP_SHADES), hpx, 0, 1);
        addEdges(hi, west, lo, g, hpx, 0, lw);
      }
    }
    sctx.globalAlpha = 1;
    sctx.lineWidth = lw;
    sctx.lineCap = 'round';
    sctx.strokeStyle = colors.edgeLo;
    sctx.stroke(lo);
    sctx.strokeStyle = colors.edgeWest;
    sctx.stroke(west);
    sctx.strokeStyle = colors.edgeHi;
    sctx.stroke(hi);

    // One light, top left: a diagonal falloff over everything drawn so far on this layer.
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalCompositeOperation = 'source-atop';
    const lg = sctx.createLinearGradient(0, 0, this.scratch.width, this.scratch.height);
    lg.addColorStop(0, 'rgba(210,225,240,0.10)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0)');
    lg.addColorStop(1, 'rgba(0,0,0,0.3)');
    sctx.fillStyle = lg;
    sctx.fillRect(dx0, dy0, dx1 - dx0, dy1 - dy0);
    sctx.globalCompositeOperation = 'source-over';
    sctx.restore();

    ctx.drawImage(this.scratch, dx0, dy0, dx1 - dx0, dy1 - dy0, dx0, dy0, dx1 - dx0, dy1 - dy0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Height in px of the block cell `i` belongs to (uses the labelling from the last bake). */
  heightPx(i: number): number {
    const root = this.ids[i];
    return root < 0 ? 0 : Math.max(2, blockHeight(root) * this.cs);
  }

  /** Shade index of cell `i`'s block. */
  shadeOf(i: number): number {
    const root = this.ids[i];
    return root < 0 ? 0 : shadeIndex(blockHeight(root), TOP_SHADES);
  }
}
