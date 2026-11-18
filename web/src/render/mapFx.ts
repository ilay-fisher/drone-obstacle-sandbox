/**
 * Drop and lift of edited walls. The planner gets an edit the instant the pointer moves; this
 * module only drives the picture: a painted wall falls in on the snappy spring and an erased
 * wall lifts out. The timeline is a pure function of age so it is unit tested, and the pool of
 * running animations is preallocated so painting never allocates.
 *
 * Under reduced motion nothing animates: `editFxState` returns the finished state and
 * `EditFx.begin` is a no-op, so edits simply appear.
 */
import { SPRING_SNAPPY, settleTime, stepResponse } from '../motion/spring';
import { addEdges, addFootprint, cellGeom, newCellGeom, paintBody } from './buildings';
import type { MapColors } from './mapPalette';
import type { MapLayers } from './mapLayers';

/** What a drop or lift looks like at one instant. */
export interface FxState {
  /** Height above the ground, in cell units (the building is drawn that much higher). */
  rise: number;
  /** Opacity of the building, 0 to 1. */
  alpha: number;
  /** Vertical scale of the building body: below 1 for the brief squash on impact. */
  squash: number;
  /** Progress 0 to 1 of the dust ring after a landing; 0 before impact, 1 when finished. */
  dust: number;
  /** True once the animation has finished and the cell belongs to the cached layer. */
  done: boolean;
}

export type FxKind = 'drop' | 'lift';

/** A fresh state object, to be reused across frames. */
export function newFxState(): FxState {
  return { rise: 0, alpha: 1, squash: 1, dust: 1, done: true };
}

/** Cells a dropping wall starts above the ground. */
export const DROP_RISE_CELLS = 2.2;
/** Cells an erased wall rises while it fades. */
export const LIFT_RISE_CELLS = 1.1;
/** Both animations take as long as the snappy spring needs to settle. */
export const FX_DURATION_MS = settleTime(SPRING_SNAPPY) * 1000;
/** The wall fades in over its first moments of falling. */
const FADE_IN_MS = 90;
/** Largest squash: the spring's overshoot is scaled so the peak lands near this. */
const SQUASH_PER_OVERSHOOT = 3;

/** Age in ms when the snappy spring first reaches its target: the moment of impact. */
const LAND_MS = (() => {
  for (let t = 1; t < 1000; t++) if (stepResponse(SPRING_SNAPPY, t / 1000) >= 1) return t;
  return FX_DURATION_MS;
})();

/**
 * Fills `out` with the state of a drop or lift `ageMs` after it began, and returns `out`.
 * A drop falls from `DROP_RISE_CELLS` on the snappy spring, squashes by up to about 19% where
 * the spring overshoots, and throws a dust ring on impact. A lift rises and fades along the
 * same spring. Negative or non-finite ages count as 0.
 */
export function editFxState(kind: FxKind, ageMs: number, reduced: boolean, out: FxState): FxState {
  if (reduced) {
    out.rise = 0;
    out.alpha = kind === 'drop' ? 1 : 0;
    out.squash = 1;
    out.dust = 1;
    out.done = true;
    return out;
  }
  const age = Number.isFinite(ageMs) && ageMs > 0 ? ageMs : 0;
  if (age >= FX_DURATION_MS) {
    out.rise = kind === 'drop' ? 0 : LIFT_RISE_CELLS;
    out.alpha = kind === 'drop' ? 1 : 0;
    out.squash = 1;
    out.dust = 1;
    out.done = true;
    return out;
  }
  const s = stepResponse(SPRING_SNAPPY, age / 1000);
  // The spring dips a hair under 1 on its way home; after impact the wall simply stays down.
  const landed = age >= LAND_MS;
  out.done = false;
  if (kind === 'drop') {
    out.rise = landed ? 0 : DROP_RISE_CELLS * Math.max(0, 1 - s);
    out.alpha = Math.min(1, age / FADE_IN_MS);
    out.squash = 1 - SQUASH_PER_OVERSHOOT * Math.min(0.1, Math.max(0, s - 1));
    out.dust = !landed ? 0 : Math.min(1, (age - LAND_MS) / (FX_DURATION_MS - LAND_MS));
  } else {
    const u = landed ? 1 : Math.min(1, Math.max(0, s));
    out.rise = LIFT_RISE_CELLS * u;
    out.alpha = 1 - u;
    out.squash = 1;
    out.dust = 1;
  }
  return out;
}

/**
 * A fixed-capacity set of running drop/lift animations, one per cell at most. Nothing is
 * allocated after construction. `epoch` increases whenever the set of animating cells
 * changes (one starts or one finishes), which is the renderer's cue to rebuild its cached
 * building layer: animating cells are drawn live and left out of the cache.
 */
export class EditFx {
  private readonly cells: Int32Array;
  private readonly start: Float64Array;
  private readonly kinds: Uint8Array;
  private readonly slotOf: Int16Array;
  /** Number of animations running. */
  count = 0;
  /** Bumps when the animating set changes. */
  epoch = 0;

  constructor(cellCount: number, capacity = 256, public reduced = false) {
    this.cells = new Int32Array(capacity);
    this.start = new Float64Array(capacity);
    this.kinds = new Uint8Array(capacity);
    this.slotOf = new Int16Array(cellCount).fill(-1);
  }

  /** Starts (or restarts, in place) the animation for `cell`. When full, the oldest slot is reused. */
  begin(cell: number, kind: FxKind, nowMs: number): void {
    if (this.reduced || cell < 0 || cell >= this.slotOf.length) return;
    let k = this.slotOf[cell];
    if (k < 0) {
      if (this.count === this.cells.length) {
        let oldest = 0;
        for (let i = 1; i < this.count; i++) if (this.start[i] < this.start[oldest]) oldest = i;
        this.remove(oldest);
      }
      k = this.count++;
      this.cells[k] = cell;
      this.slotOf[cell] = k;
    }
    this.start[k] = nowMs;
    this.kinds[k] = kind === 'drop' ? 0 : 1;
    this.epoch++;
  }

  /** Removes animations that finished by `nowMs`. Returns true when any were removed. */
  prune(nowMs: number): boolean {
    let removed = false;
    for (let k = this.count - 1; k >= 0; k--) {
      if (nowMs - this.start[k] >= FX_DURATION_MS) { this.remove(k); removed = true; }
    }
    if (removed) this.epoch++;
    return removed;
  }

  /** Drops every animation (used when the map is replaced wholesale or motion is reduced). */
  clear(): void {
    if (this.count === 0) return;
    for (let k = 0; k < this.count; k++) this.slotOf[this.cells[k]] = -1;
    this.count = 0;
    this.epoch++;
  }

  has(cell: number): boolean { return this.slotOf[cell] >= 0; }
  kindOf(cell: number): FxKind { return this.kinds[this.slotOf[cell]] === 0 ? 'drop' : 'lift'; }
  startOf(cell: number): number { return this.start[this.slotOf[cell]]; }
  /** Cell index held by slot `k` (0 to count - 1), for iterating without allocating. */
  cellAt(k: number): number { return this.cells[k]; }
  kindAt(k: number): FxKind { return this.kinds[k] === 0 ? 'drop' : 'lift'; }
  startAt(k: number): number { return this.start[k]; }

  /** Swap-removes slot `k`; the epoch is bumped by the caller where it matters. */
  private remove(k: number): void {
    const last = --this.count;
    this.slotOf[this.cells[k]] = -1;
    if (k !== last) {
      this.cells[k] = this.cells[last];
      this.start[k] = this.start[last];
      this.kinds[k] = this.kinds[last];
      this.slotOf[this.cells[k]] = k;
    }
  }
}

/** A path sink that ignores everything, so one `addEdges` call can feed a single style. */
const NOOP: CanvasPath = { moveTo() {}, lineTo() {} } as unknown as CanvasPath;
const geom = newCellGeom();
const fxState = newFxState();

/**
 * Draws every running drop and lift live, on top of the cached layers (which leave those
 * cells out). A dropping wall falls with a shadow that tightens as it lands, squashes on
 * impact and throws a dust ring; an erased wall lifts and fades, shadow with it.
 * Allocation-free. Call after `layers` has been rebaked for the current epoch.
 */
export function drawEditFx(
  ctx: CanvasRenderingContext2D, fx: EditFx, layers: MapLayers, colors: MapColors, nowMs: number,
): void {
  const { w, h, cs, join } = layers;
  const lw = Math.max(1, cs * 0.045);
  for (let k = 0; k < fx.count; k++) {
    const cell = fx.cellAt(k);
    const kind = fx.kindAt(k);
    editFxState(kind, nowMs - fx.startAt(k), false, fxState);
    if (fxState.alpha <= 0.01) continue;
    const x = cell % w;
    const y = (cell / w) | 0;
    const hpx = layers.heightPx(cell);
    const rise = fxState.rise * cs;
    const shade = layers.shadeOf(cell);
    cellGeom(geom, x, y, join, w, h, cs);
    // Shadow: stays on the ground, drifting further right and down the higher the wall is.
    ctx.globalAlpha = fxState.alpha * 0.55;
    ctx.fillStyle = colors.shadowTight;
    ctx.beginPath();
    addFootprint(ctx, geom, cs * 0.06 + (hpx + rise) * 0.55, cs * 0.06 + (hpx + rise) * 0.45);
    ctx.fill();
    paintBody(ctx, geom, colors, shade, hpx, rise, fxState.squash, fxState.alpha);
    const top = hpx * fxState.squash;
    ctx.globalAlpha = fxState.alpha;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.strokeStyle = colors.edgeLo;
    ctx.beginPath();
    addEdges(NOOP, NOOP, ctx, geom, top, rise, lw);
    ctx.stroke();
    ctx.strokeStyle = colors.edgeWest;
    ctx.beginPath();
    addEdges(NOOP, ctx, NOOP, geom, top, rise, lw);
    ctx.stroke();
    ctx.strokeStyle = colors.edgeHi;
    ctx.beginPath();
    addEdges(ctx, NOOP, NOOP, geom, top, rise, lw);
    ctx.stroke();
    if (kind === 'drop' && fxState.dust > 0 && fxState.dust < 1) {
      ctx.globalAlpha = (1 - fxState.dust) * 0.45;
      ctx.strokeStyle = colors.edgeHi;
      ctx.lineWidth = Math.max(1, cs * 0.05);
      ctx.beginPath();
      ctx.arc((x + 0.5) * cs, (y + 0.58) * cs, cs * (0.5 + 0.6 * fxState.dust), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
