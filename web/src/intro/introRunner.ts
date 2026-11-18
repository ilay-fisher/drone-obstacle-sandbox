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
import { blockCellsAhead, cellsWithValue, dueCount, paintBatches } from './introCues';
import { CUES } from './introScript';

/** Drone speed multiplier during the intro: slow enough that the route is read before it is crossed. */
export const INTRO_SPEED = 0.8;
/** The scripted walls go this many cells ahead of the drone, a little beyond LiDAR range. */
export const BLOCK_AHEAD = 9;
/** Half-height of a scripted wall: it spans `2 * BLOCK_HALF + 1` cells across the avenue. */
export const BLOCK_HALF = 2;
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
  /** Puts the user's own speed back. */
  restore(): void;
}

type CueName = 'loadCity' | 'play' | 'block1' | 'dstar' | 'block2';
const ORDER: CueName[] = ['loadCity', 'play', 'block1', 'dstar', 'block2'];

export class IntroRunner {
  private readonly batches: Int32Array[];
  private readonly wind: Int32Array;
  private painted = 0;
  private windPainted = false;
  private next = 0;
  private active = false;

  constructor(
    private readonly sim: IntroSim,
    private readonly host: IntroHost,
    private readonly city: SimState,
    private readonly empty: SimState,
  ) {
    this.batches = paintBatches(cellsWithValue(city.cells, 1), sim.width, sim.height, MAX_BATCH);
    this.wind = cellsWithValue(city.cells, 2);
  }

  /** Clears the map, silences the search layer and begins. Call `update` from here on. */
  start(): void {
    this.active = true;
    this.painted = 0;
    this.windPainted = false;
    this.next = 0;
    this.sim.importState(this.empty);
    this.sim.setMode('astar');
    this.sim.speed = INTRO_SPEED;
    this.host.setQuiet(true);
    this.host.setMode('astar');
    this.host.setPlaying(false);
  }

  /** Advances the script to `tMs`. Cheap enough to call every frame. */
  update(tMs: number): void {
    if (!this.active) return;
    if (this.next === 0) this.paint(tMs);
    while (this.next < ORDER.length && tMs >= CUES[ORDER[this.next]]) this.fire(ORDER[this.next++]);
  }

  /** The steps are over: leave the run paused where it is and hand the console back. */
  finish(): void {
    if (!this.active) return;
    this.active = false;
    this.sim.setPlaying(false);
    this.host.setQuiet(false);
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
        for (const c of blockCellsAhead(sim.path, sim.pathIdx, sim.pathLen, sim.width, sim.height, BLOCK_AHEAD, BLOCK_HALF)) {
          sim.editCell(c.x, c.y, 1);
        }
        break;
      case 'dstar':
        sim.setMode('dstar');
        host.setMode('dstar');
        break;
    }
  }
}
