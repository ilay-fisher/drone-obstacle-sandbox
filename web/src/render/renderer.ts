/**
 * The layered map renderer. One `frame()` call draws, back to front:
 *
 *   1. base layer      cached: ground dots and the soft wind region
 *   2. wind flow       animated streaks, cached sprites translated per frame
 *   3. SEARCH UNDER    slot, `searchLayer.drawSearchUnder` (heat today, PR 3 flood later)
 *   4. shade layer     cached: cast shadows and lit buildings
 *   5. edit fx         walls being painted (dropping) or erased (lifting), drawn live
 *   6. goal and patrol pucks
 *   7. SEARCH OVER     slot, `searchLayer.drawSearchOver` (route today, PR 3 draw-on later)
 *   8. DRONE           slot, `droneLayer.drawDroneLayer` (LiDAR and drone today, PR 4 later)
 *
 * The slots are separate modules so other workstreams replace them without touching this
 * file. Layers 1 and 4 are rebuilt only when the grid changes: the renderer compares
 * `Simulation.gridVersion` once per frame and, on a change, diffs the visual grid to find the
 * edited cells. The planner already has the edit by then (painting latency is untouched);
 * only the picture animates.
 */
import type { Simulation } from '../engine/simulation';
import { diffGrid } from './blocks';
import { drawDroneLayer, landingLamp } from './droneLayer';
import { EditFx, drawEditFx } from './mapFx';
import { MapEntities } from './mapEntities';
import { MapLayers } from './mapLayers';
import { buildMapColors, type MapColors } from './mapPalette';
import type { Palette } from './palette';
import type { DrawOpts, RenderView } from './renderTypes';
import { drawSearchOver, drawSearchUnder } from './searchLayer';
import { WindFlow, flowTime } from './windFlow';

/** More changed cells than this in one step is a bulk load (preset, import, clear): snap, do not animate. */
const MAX_ANIMATED_EDITS = 48;

/** Composes the cached layers, the animated map layers and the two draw slots. */
export class Renderer {
  private readonly layers: MapLayers;
  private readonly fx: EditFx;
  private readonly flow: WindFlow;
  private readonly entities = new MapEntities();
  private readonly vis: Uint8Array;
  private readonly prev: Uint8Array;
  private readonly changed = new Int32Array(MAX_ANIMATED_EDITS);
  private readonly colors: MapColors;
  private readonly view: RenderView;
  private seenVersion = -1;
  private windDirty = true;
  private shadeDirty = true;
  private fxEpoch = -1;
  /** Cells that changed since the last shade bake; `dirtyAll` forces a full rebuild. */
  private readonly dirty: Int32Array;
  private dirtyCount = 0;
  private dirtyAll = true;
  private ready = false;

  constructor(private readonly ctx: CanvasRenderingContext2D, private readonly sim: Simulation, pal: Palette, reduced: boolean) {
    const n = sim.width * sim.height;
    this.layers = new MapLayers(sim.width, sim.height);
    this.fx = new EditFx(n, 256, reduced);
    this.flow = new WindFlow(sim.width, sim.height);
    this.vis = new Uint8Array(n);
    this.dirty = new Int32Array(n + 512);
    this.prev = new Uint8Array(n);
    this.colors = buildMapColors(pal);
    this.view = { w: sim.width, h: sim.height, cell: 16, dpr: 1, pal, reduced };
  }

  /** Sets the CSS px per cell and the DPR (call on mount and whenever the canvas resizes). */
  resize(cell: number, dpr: number): void {
    const v = this.view;
    v.cell = cell;
    v.dpr = dpr;
    this.layers.resize(cell, dpr, v.pal);
    this.entities.resize(cell, dpr, this.colors);
    this.windDirty = true;
    this.shadeDirty = true;
    this.dirtyAll = true;
    this.ready = true;
  }

  /** Switches reduced motion at runtime: running animations end and the finished states show. */
  setReduced(reduced: boolean): void {
    this.view.reduced = reduced;
    this.fx.reduced = reduced;
    if (reduced) this.fx.clear();
    this.entities.snap();
  }

  /**
   * Draws one frame. `now` is the rAF timestamp in ms, `dtSec` the clamped frame time.
   * Allocation-free once the layers are baked; a rebake happens only after an edit.
   */
  frame(now: number, dtSec: number, o: DrawOpts): void {
    if (!this.ready) return;
    const { ctx, sim, layers, view, colors } = this;
    if (sim.gridVersion !== this.seenVersion) this.syncGrid(now);
    if (this.fx.count > 0 && this.fx.prune(now)) {
      for (let k = 0; k < this.fx.removedCount; k++) this.markDirty(this.fx.removed[k]);
    }
    if (this.windDirty) {
      layers.bakeBase(this.vis, colors);
      this.flow.rebuild(this.vis, view.cell, view.dpr, colors.windRegion, colors.windStreak);
      this.windDirty = false;
    }
    if (this.shadeDirty || this.fx.epoch !== this.fxEpoch) {
      // At most one bake per frame, redrawing only the blocks that changed.
      if (this.dirtyAll) layers.bakeShade(this.vis, this.fx, colors);
      else layers.bakeShade(this.vis, this.fx, colors, this.dirty, this.dirtyCount);
      this.fxEpoch = this.fx.epoch;
      this.shadeDirty = false;
      this.dirtyAll = false;
      this.dirtyCount = 0;
    }

    const W = view.w * view.cell;
    const H = view.h * view.cell;
    ctx.globalAlpha = 1;
    ctx.drawImage(layers.base, 0, 0, W, H);
    this.flow.draw(ctx, flowTime(now, view.reduced));
    drawSearchUnder(ctx, sim, view, o, now);
    ctx.drawImage(layers.shade, 0, 0, W, H);
    if (this.fx.count > 0) drawEditFx(ctx, this.fx, layers, colors, now);
    this.entities.drawGoal(ctx, sim, now, view.reduced, landingLamp(sim, view.reduced));
    this.entities.drawPatrols(ctx, sim, dtSec, view.reduced);
    drawSearchOver(ctx, sim, view, o, now);
    drawDroneLayer(ctx, sim, view, o, now);
  }

  /**
   * Called when `gridVersion` moved. Rebuilds the visual grid, finds which cells changed and
   * starts a drop or lift for each wall added or removed (a handful at most: a bulk change
   * snaps instead). Also decides which cached layers are stale.
   */
  private syncGrid(now: number): void {
    const { sim, vis, prev, changed } = this;
    sim.copyVisualGrid(vis);
    const first = this.seenVersion === -1;
    this.seenVersion = sim.gridVersion;
    if (first) {
      prev.set(vis);
      this.windDirty = true;
      this.shadeDirty = true;
      this.dirtyAll = true;
      return;
    }
    const n = diffGrid(prev, vis, changed);
    if (n === 0) return;
    if (n > changed.length) {
      this.fx.clear();
      this.entities.snap();
      this.windDirty = true;
      this.shadeDirty = true;
      this.dirtyAll = true;
    } else {
      for (let k = 0; k < n; k++) {
        const c = changed[k];
        const was = prev[c];
        const is = vis[c];
        if (was === 2 || is === 2) this.windDirty = true;
        if (was === 1 || is === 1) {
          this.shadeDirty = true;
          this.markDirty(c);
        }
        if (is === 1 && was !== 1) this.fx.begin(c, 'drop', now);
        else if (was === 1 && is !== 1) this.fx.begin(c, 'lift', now);
      }
    }
    prev.set(vis);
  }

  /** Records a cell whose cached picture is stale (no-op once a full rebuild is pending). */
  private markDirty(cell: number): void {
    if (this.dirtyAll) return;
    if (this.dirtyCount >= this.dirty.length) { this.dirtyAll = true; return; }
    this.dirty[this.dirtyCount++] = cell;
  }
}
