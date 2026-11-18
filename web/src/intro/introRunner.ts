/**
 * The scripted run behind the guided intro. It drives the simulation ONLY through its public
 * API (load a map, set the planner, edit cells, play), so every readout stays real: the
 * replan counter, latency and expanded-node counts are whatever the planner really did.
 *
 * `update(t)` is called every frame with the time since the intro began; each cue fires once,
 * in order, even if a frame is late. The runner holds no timers, so there is nothing to clean
 * up beyond cancelling whoever calls `update`.
 */
import type { CellValue, PlanMode } from '../engine/plannerBridge';
import type { SimState } from '../engine/simulation';
import { cellsWithValue, dueCount, paintBatches, pickWall } from './introCues';
import { CUES } from './introScript';
import { initSeq, stepSeq, type CueName, type SeqState } from './introSequence';

/** Drone speed multiplier during the intro: slow enough that the route is read before it is crossed. */
export const INTRO_SPEED = 0.8;
/** Most cells painted in one frame: under the renderer's 48-cell limit for animated edits. */
export const MAX_BATCH = 40;

/** The part of `Simulation` the script uses. */
export interface IntroSim {
  readonly width: number;
  readonly height: number;
  speed: number;
  readonly path: Int32Array;
  readonly pathIdx: number;
  readonly pathLen: number;
  readonly lidarRadius: number;
  /** Planning calls finished so far; the script waits on it, so a slow planner delays the next cue. */
  readonly replanSeq: number;
  copyVisualGrid(out: Uint8Array): void;
  importState(s: SimState): boolean;
  editCell(x: number, y: number, v: CellValue): void;
  reset(): void;
  setMode(m: PlanMode): void;
  setPlaying(on: boolean): void;
}

/** What the UI must mirror: React state for the console, the render loop's quiet flag, restoring the user's settings. */
export interface IntroHost {
  setMode(m: PlanMode): void;
  setPlaying(on: boolean): void;
  /** While true the renderer plays no search events (the city is still being painted). */
  setQuiet(q: boolean): void;
  /** While true the renderer adopts new plans silently: the route follows, no flood and no chip. */
  setCalm(c: boolean): void;
  /** Puts the user's own speed back. */
  restore(): void;
}

export class IntroRunner {
  private readonly batches: Int32Array[];
  private readonly wind: Int32Array;
  private painted = 0;
  private windPainted = false;
  private seqState: SeqState = initSeq();
  private active = false;
  private finished = false;
  /** `replanSeq` the quiet D* plan started from; -1 when no quiet plan is waiting. */
  private calmSeq = -1;
  private readonly scratch: Uint8Array;

  constructor(
    private readonly sim: IntroSim,
    private readonly host: IntroHost,
    private readonly city: SimState,
    private readonly empty: SimState,
  ) {
    this.batches = paintBatches(cellsWithValue(city.cells, 1), sim.width, sim.height, MAX_BATCH);
    this.wind = cellsWithValue(city.cells, 2);
    this.scratch = new Uint8Array(sim.width * sim.height);
  }

  /** Caption step in force: 0 to 3 (the step cues move it on). */
  get step(): 0 | 1 | 2 | 3 {
    return this.seqState.step;
  }

  /** The four guided steps are over (the caller then calls `finish`). */
  get done(): boolean {
    return this.finished;
  }

  /** Clears the map, silences the search layer and begins. Call `update` from here on. */
  start(): void {
    this.active = true;
    this.painted = 0;
    this.windPainted = false;
    this.seqState = initSeq();
    this.finished = false;
    this.calmSeq = -1;
    this.sim.importState(this.empty);
    this.sim.setMode('astar');
    this.sim.speed = INTRO_SPEED;
    this.host.setQuiet(true);
    this.host.setMode('astar');
    this.host.setPlaying(false);
  }

  /**
   * Advances the script to `tMs`. Cheap enough to call every frame. At most one cue fires per
   * call, and a cue that makes the planner run holds the next one back until that planning call
   * has finished (see `introSequence.ts`).
   */
  update(tMs: number): void {
    if (!this.active || this.finished) return;
    if (this.seqState.next === 0) this.paint(tMs);
    const seq = this.sim.replanSeq;
    if (this.calmSeq >= 0 && seq > this.calmSeq) {
      // The quiet plan has landed (and was adopted silently in that same frame): back to normal.
      this.calmSeq = -1;
      this.host.setCalm(false);
    }
    const r = stepSeq(this.seqState, tMs, seq);
    this.seqState = r.state;
    if (r.fire === 'finish') this.finished = true;
    else if (r.fire) this.fire(r.fire.name);
  }

  /** The steps are over: leave the run paused where it is and hand the console back. */
  finish(): void {
    if (!this.active) return;
    this.active = false;
    this.sim.setPlaying(false);
    this.host.setQuiet(false);
    this.host.setCalm(false);
    this.host.setPlaying(false);
    this.host.restore();
  }

  /** Skip: a normal state. Urban Canyon loaded fresh, A*, paused, the user's own speed back. */
  skip(): void {
    this.active = false;
    this.settle();
    this.host.restore();
  }

  /** Reduced motion: no animation at all, just the finished city, paused. */
  showFinished(): void {
    this.active = false;
    this.settle();
    this.host.restore();
  }

  private settle(): void {
    this.sim.setPlaying(false);
    this.sim.importState(this.city);
    this.sim.setMode('astar');
    this.host.setQuiet(false);
    this.host.setCalm(false);
    this.host.setMode('astar');
    this.host.setPlaying(false);
  }

  /**
   * Paints the city in. Wind first (it is a soft region, not a building), then one whole
   * building per frame in a left to right wave; each drops in on the snappy spring (the renderer's edit effect).
   * `reset` after every batch: edits queue a counted replan, and nothing should be counted
   * while the city is still being built.
   */
  private paint(tMs: number): void {
    const { sim } = this;
    let did = false;
    if (!this.windPainted) {
      this.windPainted = true;
      for (let k = 0; k < this.wind.length; k++) sim.editCell(this.wind[k] % sim.width, (this.wind[k] / sim.width) | 0, 2);
      did = this.wind.length > 0;
    }
    // One building per frame, so the renderer animates it as a single clean drop.
    const due = dueCount(this.batches.length, tMs - CUES.paintStart, CUES.paintMs);
    if (this.painted < due) {
      for (const c of this.batches[this.painted++]) sim.editCell(c % sim.width, (c / sim.width) | 0, 1);
      did = true;
    }
    if (did) sim.reset();
  }

  private fire(cue: CueName): void {
    const { sim, host } = this;
    switch (cue) {
      case 'loadCity':
        // The canonical map: identical walls, so nothing visibly changes, and its first plan is the A* wavefront.
        host.setQuiet(false);
        sim.importState(this.city);
        sim.setMode('astar');
        host.setMode('astar');
        break;
      case 'play':
        sim.setPlaying(true);
        host.setPlaying(true);
        break;
      case 'block1':
      case 'block2':
        sim.copyVisualGrid(this.scratch);
        for (const c of pickWall({
          grid: this.scratch, width: sim.width, height: sim.height,
          path: sim.path, pathIdx: sim.pathIdx, pathLen: sim.pathLen, lidarRadius: sim.lidarRadius,
        })) sim.editCell(c.x, c.y, 1);
        break;
      case 'dstar':
        // D* Lite's first call searches the whole map. Let it happen quietly, before the second
        // wall, so the one flood step 4 shows is the real incremental repair.
        this.calmSeq = sim.replanSeq;
        host.setCalm(true);
        sim.setMode('dstar');
        host.setMode('dstar');
        break;
    }
  }
}
