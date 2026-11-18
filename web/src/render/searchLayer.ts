/**
 * DRAW SLOT: search layer. The search is the show: the one loud motion on the map.
 *
 * Every planning call emits a `ReplanEvent` (see `engine/replanEvent.ts`). This layer plays it:
 *
 *   wavefront  visited cells light up in flood order as a soft front. Each cell is a cached
 *              radial sprite drawn additively, so neighbours merge into one soft region (no
 *              square cells). A bright rim marks the leading edge; cells it leaves behind
 *              settle to a dim resting glow. A* is warm paper white, D* Lite is ember orange.
 *   draw-on    the new route draws from the drone to the goal with an amber head. It is a
 *              smoothed display curve; the planner path and the drone's flight are unchanged.
 *   dissolve   the old route breaks into dots and fades out behind the new one.
 *   chip       "searched N cells" / "repaired N cells" pins to the flood for about a second.
 *
 * The route stays solid with a soft glow (not dashed): it must be the brightest line on the
 * map, and a solid line gives the dissolving old route (dashes, then dots) a clear grammar:
 * solid means current, dotted means leaving.
 *
 * Performance: sprites are pre-rendered when the size changes, and the resting glow is
 * accumulated into an offscreen canvas one flood step at a time, so a frame draws one image
 * for the glow plus a thin band of rim sprites. No gradients are created per frame. The
 * renderer calls the two exported functions at fixed points; their signatures are fixed.
 *
 * - `drawSearchUnder` runs after the ground and wind and BEFORE the buildings, so the glow
 *   spreads across open ground and buildings stand on top of it.
 * - `drawSearchOver` runs after the buildings, patrols and goal, BEFORE the drone layer.
 */
import type { ReplanEvent } from '../engine/replanEvent';
import type { Simulation } from '../engine/simulation';
import { FloodOrder, frontCount } from './floodOrder';
import { parseHex } from './mapPalette';
import type { DrawOpts, RenderView } from './renderTypes';
import { FINISHED, TOTAL_MS, chipText, replanPhases, type Phases } from './replanTimeline';
import { arcLengths, cellCentres, pointAt, smoothRoute, subCurveEnd, type Curve } from './routeCurve';

/** Radius (in cells) of the resting-glow sprite and of the brighter rim sprite. */
const REST_R = 1.7;
const RIM_R = 1.45;
/** Thickness of the bright rim, as a fraction of the flood's rank range. */
const RIM_BAND = 0.13;
/** Sprite alpha per cell: A* spreads over many cells so it is dim per cell; the D* repair is small, so hotter. */
const REST_PEAK = { astar: 0.2, dstar: 0.8 };
const RIM_PEAK = { astar: 0.3, dstar: 0.6 };

interface Sprite { canvas: HTMLCanvasElement; r: number }
interface ModeSprites { rest: Sprite; rim: Sprite }

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.ceil(w));
  c.height = Math.max(2, Math.ceil(h));
  return c;
}

/** A soft round sprite: `rgb` at the centre, easing to transparent at radius `r` CSS px. */
function glowSprite(rgb: [number, number, number], r: number, dpr: number, core = 0.55): Sprite {
  const px = Math.ceil(2 * r * dpr);
  const c = makeCanvas(px, px);
  const g = c.getContext('2d')!;
  const m = px / 2;
  const grad = g.createRadialGradient(m, m, 0, m, m, m);
  const col = (a: number): string => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  grad.addColorStop(0, col(1));
  grad.addColorStop(0.4, col(core));
  grad.addColorStop(0.75, col(core * 0.18));
  grad.addColorStop(1, col(0));
  g.fillStyle = grad;
  g.fillRect(0, 0, px, px);
  return { canvas: c, r };
}

/** Deterministic 0..1 per dot index, so each dot of the old route fades at its own moment. */
function dotHash(i: number): number {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** State of the show for one simulation. Created lazily, rebuilt when the size changes. */
class SearchShow {
  readonly flood: FloodOrder;
  private key = '';
  private astar!: ModeSprites;
  private dstar!: ModeSprites;
  private head!: Sprite;
  private acc: HTMLCanvasElement | null = null;
  private accCtx: CanvasRenderingContext2D | null = null;
  private accCount = 0;
  private seq = -1;
  private lastNow = -1;
  ev: ReplanEvent | null = null;
  /** Time scale base: the event's timestamp, or "long ago" for an event that was already stale. */
  private t0 = 0;
  private animated = false;
  cur: Curve | null = null;
  private rawCum = new Float32Array(0);
  private old: Curve | null = null;
  private chip: HTMLCanvasElement | null = null;
  private chipW = 0;
  private chipH = 0;
  private chipX = 0;
  private chipY = 0;
  phases: Phases = FINISHED;
  readonly pt = { x: 0, y: 0 };
  readonly dash = [0, 0];

  constructor(w: number, h: number) {
    this.flood = new FloodOrder(w, h);
  }

  /** (Re)builds sprites and the accumulation canvas when the cell size, DPR or map size changed. */
  prepare(v: RenderView): void {
    const key = `${v.cell}|${v.dpr}|${v.w}|${v.h}`;
    if (key === this.key) return;
    this.key = key;
    const { pal, cell, dpr } = v;
    const white = parseHex(pal.drone) ?? [236, 232, 223];
    const ember = parseHex(pal.ember) ?? [168, 48, 15];
    const orange = parseHex(pal.route) ?? [255, 90, 31];
    const amber = parseHex(pal.goal) ?? [255, 179, 71];
    // D* Lite: ember at rest, orange on the rim, so a repair reads as a small hot spot.
    const emberRest = ember.map((c, i) => Math.round(c + (orange[i] - c) * 0.8)) as [number, number, number];
    this.astar = { rest: glowSprite(white, REST_R * cell, dpr), rim: glowSprite([255, 250, 240], RIM_R * cell, dpr) };
    this.dstar = { rest: glowSprite(emberRest, REST_R * 1.6 * cell, dpr), rim: glowSprite(orange, RIM_R * 1.6 * cell, dpr) };
    this.head = glowSprite(amber, 2.2 * cell, dpr, 0.5);
    this.acc = makeCanvas(v.w * cell * dpr, v.h * cell * dpr);
    this.accCtx = this.acc.getContext('2d');
    this.accCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.accCount = 0;
    if (this.ev) this.placeChip(v);
  }

  /** Starts playing a new event when the simulation has produced one since the last frame. */
  sync(sim: Simulation, v: RenderView, now: number): void {
    if (now === this.lastNow && sim.replanSeq === this.seq) return;
    this.lastNow = now;
    this.prepare(v);
    const ev = sim.lastReplan;
    if (ev && ev.seq !== this.seq) this.begin(ev, v, now);
    if (!this.ev) { this.phases = FINISHED; return; }
    const elapsed = this.animated ? now - this.t0 : TOTAL_MS + 1;
    this.phases = replanPhases(elapsed, v.reduced);
    this.advanceGlow(v);
  }

  private begin(ev: ReplanEvent, v: RenderView, now: number): void {
    this.seq = ev.seq;
    this.ev = ev;
    const stale = now - ev.timestamp > TOTAL_MS;
    this.animated = ev.kind !== 'retry' && !stale;
    this.t0 = ev.timestamp;
    this.flood.compute(ev.heat, ev.origin, ev.origin.length);
    this.accCtx?.clearRect(0, 0, v.w * v.cell, v.h * v.cell);
    this.accCount = 0;
    this.cur = smoothRoute(ev.newPath, v.w);
    const n = ev.newPath.length;
    this.rawCum = new Float32Array(n);
    if (n > 0) {
      const raw = new Float32Array(2 * n);
      cellCentres(ev.newPath, v.w, raw);
      arcLengths(raw, n, this.rawCum);
    }
    this.old = this.animated && ev.oldPath.length > 1 ? smoothRoute(ev.oldPath, v.w) : null;
    this.placeChip(v);
  }

  /** Draws the resting glow of every cell the front has passed that is not in the accumulation canvas yet. */
  private advanceGlow(v: RenderView): void {
    const ev = this.ev;
    const g = this.accCtx;
    if (!ev || !g) return;
    const upTo = frontCount(this.flood, this.phases.flood);
    if (upTo <= this.accCount) return;
    const spr = (ev.mode === 'dstar' ? this.dstar : this.astar).rest;
    const peak = REST_PEAK[ev.mode];
    const { cell, w } = v;
    const f = this.flood;
    g.globalCompositeOperation = 'lighter';
    for (let k = this.accCount; k < upTo; k++) {
      const c = f.order[k];
      const hv = ev.heat[c];
      g.globalAlpha = peak * (0.45 + 0.55 * Math.min(1, (hv - 1) / 3));
      g.drawImage(spr.canvas, ((c % w) + 0.5) * cell - spr.r, (((c / w) | 0) + 0.5) * cell - spr.r, 2 * spr.r, 2 * spr.r);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    this.accCount = upTo;
  }

  /** Resting glow plus, while the flood runs, the bright rim at its leading edge. */
  drawGlow(ctx: CanvasRenderingContext2D, v: RenderView): void {
    const ev = this.ev;
    if (!ev || this.flood.count === 0 || !this.acc) return;
    const W = v.w * v.cell;
    const H = v.h * v.cell;
    ctx.drawImage(this.acc, 0, 0, W, H);
    const front = this.phases.flood;
    if (front >= 1) return;
    const f = this.flood;
    const hi = frontCount(f, front);
    const lo = frontCount(f, front - RIM_BAND);
    if (hi <= lo) return;
    const spr = (ev.mode === 'dstar' ? this.dstar : this.astar).rim;
    const peak = RIM_PEAK[ev.mode] * (front < 0.8 ? 1 : (1 - front) / 0.2);
    const { cell, w } = v;
    ctx.globalCompositeOperation = 'lighter';
    for (let k = lo; k < hi; k++) {
      const c = f.order[k];
      const t = (f.rank[c] - (front - RIM_BAND)) / RIM_BAND;
      ctx.globalAlpha = peak * (t < 0 ? 0 : t);
      ctx.drawImage(spr.canvas, ((c % w) + 0.5) * cell - spr.r, (((c / w) | 0) + 0.5) * cell - spr.r, 2 * spr.r, 2 * spr.r);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Arc length of the drone along the display curve (0 until the mission moves). */
  droneArc(sim: Simulation): number {
    const c = this.cur;
    const n = this.rawCum.length;
    if (!c || c.n < 2 || n < 2) return 0;
    const idx = Math.min(sim.pathIdx, n - 1);
    const total = this.rawCum[n - 1];
    if (total <= 0) return 0;
    let arc = this.rawCum[idx];
    if (idx < n - 1) {
      const seg = this.rawCum[idx + 1] - this.rawCum[idx];
      const a = sim.path[idx];
      const w = sim.width;
      const d = Math.hypot(sim.droneX - ((a % w) + 0.5), sim.droneY - (((a / w) | 0) + 0.5));
      arc += Math.min(seg, d);
    }
    return Math.min(c.length, (arc / total) * c.length);
  }

  /** Strokes the part of `c` between arc lengths `s0` and `s1` as the current path (no stroke call). */
  tracePath(ctx: CanvasRenderingContext2D, c: Curve, s0: number, s1: number, cell: number): void {
    const p = this.pt;
    pointAt(c, s0, p);
    ctx.beginPath();
    ctx.moveTo(p.x * cell, p.y * cell);
    const k0 = subCurveEnd(c, s0) + 1;
    const k1 = subCurveEnd(c, s1);
    for (let k = k0; k <= k1; k++) ctx.lineTo(c.pts[2 * k] * cell, c.pts[2 * k + 1] * cell);
    pointAt(c, s1, p);
    ctx.lineTo(p.x * cell, p.y * cell);
  }

  /** The old route: a line that breaks into dashes, then dots, and the dots fade one by one. */
  drawDissolve(ctx: CanvasRenderingContext2D, v: RenderView): void {
    const old = this.old;
    const q = this.phases.dissolve;
    if (!old || old.n < 2 || q >= 1) return;
    const { cell, pal } = v;
    const P = cell * 0.6;
    const lw = Math.max(2, cell * 0.14);
    const breakUp = Math.min(1, q / 0.3);
    const lineA = 0.5 * (1 - Math.min(1, Math.max(0, (q - 0.12) / 0.16)));
    ctx.strokeStyle = pal.route;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (lineA > 0.01) {
      this.dash[0] = P * (1 - breakUp) + 0.01;
      this.dash[1] = P * breakUp + 0.01;
      ctx.setLineDash(this.dash);
      ctx.lineWidth = lw * (1 - 0.25 * breakUp);
      ctx.globalAlpha = lineA;
      this.tracePath(ctx, old, 0, old.length, cell);
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
    }
    if (q > 0.1) {
      ctx.fillStyle = pal.route;
      const dots = Math.floor((old.length * cell) / P) + 1;
      const p = this.pt;
      for (let k = 0; k < dots; k++) {
        const fade = Math.min(1, Math.max(0, (q - 0.12 - dotHash(k) * 0.55) / 0.3));
        const a = 0.5 * (1 - fade);
        if (a < 0.01) continue;
        pointAt(old, (k * P) / cell, p);
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(p.x * cell, p.y * cell, lw * 0.5 * (1 - 0.5 * fade), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
  }

  /** The new route: soft glow, solid orange core, amber highlight; the amber head leads while it draws on. */
  drawRoute(ctx: CanvasRenderingContext2D, sim: Simulation, v: RenderView): void {
    const c = this.cur;
    if (!c || c.n < 2) return;
    const s0 = this.droneArc(sim);
    const draw = this.phases.draw;
    const s1 = s0 + (c.length - s0) * draw;
    if (s1 - s0 < 0.01) return;
    const { cell, pal } = v;
    this.tracePath(ctx, c, s0, s1, cell);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = pal.route;
    ctx.globalAlpha = 0.1;
    ctx.lineWidth = cell * 0.95;
    ctx.stroke();
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = cell * 0.45;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(2.4, cell * 0.18);
    ctx.stroke();
    ctx.strokeStyle = pal.goal;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = Math.max(1, cell * 0.06);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
    if (draw < 1) {
      const headA = draw < 0.85 ? 1 : (1 - draw) / 0.15;
      const p = this.pt;
      pointAt(c, s1, p);
      const hx = p.x * cell;
      const hy = p.y * cell;
      const spr = this.head;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = headA * 0.9;
      ctx.drawImage(spr.canvas, hx - spr.r, hy - spr.r, 2 * spr.r, 2 * spr.r);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = headA;
      ctx.fillStyle = pal.goal;
      ctx.beginPath();
      ctx.arc(hx, hy, Math.max(2.4, cell * 0.2), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /** Renders the chip text once per event and picks where it pins: centred on the flood, kept inside the map. */
  private placeChip(v: RenderView): void {
    const ev = this.ev;
    this.chip = null;
    if (!ev || !this.animated || this.flood.count === 0) return;
    const { cell, dpr, pal, w } = v;
    const text = chipText(ev.mode, ev.incremental, ev.found, this.flood.count);
    const font = '500 11px "Martian Mono", ui-monospace, Menlo, monospace';
    const probe = makeCanvas(2, 2).getContext('2d')!;
    probe.font = font;
    const tw = Math.ceil(probe.measureText(text).width);
    const padX = 12;
    const dotR = 3.5;
    const h = 24;
    const wCss = tw + padX * 2 + dotR * 2 + 7;
    const pad = 10;
    const c = makeCanvas((wCss + pad * 2) * dpr, (h + pad * 2) * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = 8;
    g.shadowOffsetX = 2;
    g.shadowOffsetY = 3;
    g.fillStyle = 'rgba(12,16,20,0.94)';
    g.beginPath();
    g.roundRect(pad, pad, wCss, h, h / 2);
    g.fill();
    g.shadowColor = 'transparent';
    g.fillStyle = ev.mode === 'dstar' ? pal.route : pal.drone;
    g.beginPath();
    g.arc(pad + padX, pad + h / 2, dotR, 0, Math.PI * 2);
    g.fill();
    g.font = font;
    g.textBaseline = 'middle';
    g.fillStyle = pal.drone;
    g.fillText(text, pad + padX + dotR * 2 + 7, pad + h / 2 + 0.5);
    this.chip = c;
    this.chipW = wCss + pad * 2;
    this.chipH = h + pad * 2;
    // Pin the chip just outside the flood's bounding box (above it, or below when the top is cramped),
    // horizontally centred on the flood centroid, so it never covers the repair itself.
    const f = this.flood;
    let sx = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < f.count; k++) {
      const cc = f.order[k];
      const y = (cc / w) | 0;
      sx += (cc % w) + 0.5;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const mapW = v.w * cell;
    const mapH = v.h * cell;
    const gap = 8;
    let y = minY * cell - h - gap;
    if (y < 4) y = (maxY + 1) * cell + gap;
    y = Math.min(y, mapH - h - 4);
    this.chipX = Math.min(Math.max(4 - pad, (sx / f.count) * cell - this.chipW / 2), mapW - this.chipW + pad - 4);
    this.chipY = Math.max(4, y) - pad;
  }

  drawChip(ctx: CanvasRenderingContext2D, v: RenderView): void {
    const a = this.phases.chip;
    if (!this.chip || a <= 0.01) return;
    const slide = v.reduced ? 0 : (1 - a) * 6;
    ctx.globalAlpha = a;
    ctx.drawImage(this.chip, this.chipX, this.chipY + slide, this.chipW, this.chipH);
    ctx.globalAlpha = 1;
  }
}

const NO_DASH: number[] = [];
const shows = new WeakMap<Simulation, SearchShow>();

function showFor(sim: Simulation): SearchShow {
  let s = shows.get(sim);
  if (!s) { s = new SearchShow(sim.width, sim.height); shows.set(sim, s); }
  return s;
}

/** The flood: resting glow and the bright front. Honours the heat toggle. */
export function drawSearchUnder(ctx: CanvasRenderingContext2D, sim: Simulation, v: RenderView, o: DrawOpts, now: number): void {
  const show = showFor(sim);
  show.sync(sim, v, now);
  if (!o.showHeat) return;
  show.drawGlow(ctx, v);
}

/** The route (dissolving old one, then the new one drawing on) and the chip. */
export function drawSearchOver(ctx: CanvasRenderingContext2D, sim: Simulation, v: RenderView, o: DrawOpts, now: number): void {
  const show = showFor(sim);
  show.sync(sim, v, now);
  show.drawDissolve(ctx, v);
  show.drawRoute(ctx, sim, v);
  if (o.showHeat) show.drawChip(ctx, v);
}
