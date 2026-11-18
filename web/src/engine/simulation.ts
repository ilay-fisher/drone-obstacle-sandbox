import { log } from '../logger';
import type { CellValue, PlanMode, Planner } from './plannerBridge';

/** Cells per second the drone covers at 1.0x speed. */
export const DRONE_RATE = 6;
/** Cells per second moving patrol obstacles advance. */
export const PATROL_RATE = 6;
/** Upper bound of the preallocated patrol pool. */
export const MAX_PATROLS = 32;
const FLASH_SECONDS = 0.35;
const RETRY_SECONDS = 0.5;
const BLOCKED_GIVE_UP_SECONDS = 3;
const SLOW_REPLAN_MS = 5;

export type MissionStatus = 'Idle' | 'En Route' | 'Replanning' | 'Reached' | 'Blocked';

/** Live counters shown in the HUD. Mutated in place so ticking never allocates. */
export interface SimStats {
  status: MissionStatus;
  replans: number;
  lastLatencyMs: number;
  maxLatencyMs: number;
  totalLatencyMs: number;
  planCalls: number;
  lastExpanded: number;
  totalExpanded: number;
  pathCost: number;
  elapsedMs: number;
}

/** Payload handed to the owner when a mission ends. */
export interface MissionSummary {
  planMode: PlanMode;
  status: 'reached' | 'blocked';
  replans: number;
  avgReplanMs: number;
  maxReplanMs: number;
  nodesExpanded: number;
  pathCost: number;
  durationMs: number;
}

/** Portable map snapshot used by presets and the scenario API. */
export interface SimState {
  cells: Uint8Array;
  start: { x: number; y: number };
  goal: { x: number; y: number };
  patrols: { x: number; y: number; dx: number; dy: number }[];
}

/**
 * Per-tick simulation, deliberately independent of React and the canvas so it can be
 * unit-tested. Patrols are written into the planner grid (value 1) so that both the
 * planner and the LiDAR check see them; each patrol remembers the value underneath it
 * and restores it when it moves. All buffers are preallocated; `tick` does not allocate.
 */
export class Simulation {
  readonly width: number;
  readonly height: number;
  startX = 1;
  startY = 1;
  goalX = 1;
  goalY = 1;
  /** Drone position in continuous cell units (cell centre is x + 0.5). */
  droneX = 0.5;
  droneY = 0.5;
  heading = 0;
  path: Int32Array = new Int32Array(0);
  pathLen = 0;
  pathIdx = 0;
  mode: PlanMode = 'astar';
  speed = 1;
  lidarRadius = 6;
  playing = false;
  readonly stats: SimStats = {
    status: 'Idle', replans: 0, lastLatencyMs: 0, maxLatencyMs: 0, totalLatencyMs: 0,
    planCalls: 0, lastExpanded: 0, totalExpanded: 0, pathCost: 0, elapsedMs: 0,
  };
  // Patrol pool (structure of arrays).
  readonly patrolX = new Int32Array(MAX_PATROLS);
  readonly patrolY = new Int32Array(MAX_PATROLS);
  readonly patrolDX = new Int32Array(MAX_PATROLS);
  readonly patrolDY = new Int32Array(MAX_PATROLS);
  private readonly patrolUnder = new Uint8Array(MAX_PATROLS);
  patrolCount = 0;

  private frac = 0;
  private base: MissionStatus = 'Idle';
  private started = false;
  private ended = false;
  private needsReplan = false;
  private flash = 0;
  private blockedFor = 0;
  private retryIn = 0;
  private patrolAcc = 0;

  constructor(readonly planner: Planner, private readonly onMissionEnd?: (s: MissionSummary) => void) {
    this.width = planner.width;
    this.height = planner.height;
  }

  /** Sets start and goal cells. Call `reset` afterwards to apply them. */
  setEndpoints(sx: number, sy: number, gx: number, gy: number): void {
    this.startX = sx; this.startY = sy; this.goalX = gx; this.goalY = gy;
  }

  /** Starts or pauses the mission; the first start marks the mission as begun. */
  setPlaying(on: boolean): void {
    this.playing = on;
    if (on && !this.started && !this.ended) {
      this.started = true;
      this.base = this.pathLen > 0 ? 'En Route' : 'Blocked';
      this.refreshStatus();
    }
  }

  /** Switches algorithm; the next tick replans with it. */
  setMode(mode: PlanMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.needsReplan = true;
  }

  /** Returns the drone to the start, zeroes counters and previews the route. */
  reset(): void {
    const s = this.stats;
    s.replans = 0; s.lastLatencyMs = 0; s.maxLatencyMs = 0; s.totalLatencyMs = 0; s.planCalls = 0;
    s.lastExpanded = 0; s.totalExpanded = 0; s.pathCost = 0; s.elapsedMs = 0;
    this.playing = false;
    this.started = false;
    this.ended = false;
    this.needsReplan = false;
    this.blockedFor = 0;
    this.retryIn = 0;
    this.flash = 0;
    this.droneX = this.startX + 0.5;
    this.droneY = this.startY + 0.5;
    this.plan(false);
    this.refreshStatus();
  }

  /** Removes walls, wind and patrols; endpoints stay. */
  clearMap(): void {
    this.patrolCount = 0;
    this.planner.clearGrid();
    this.reset();
  }

  /** Applies a brush value to a cell. Walls may not cover the endpoints or a patrol. */
  editCell(x: number, y: number, v: CellValue): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const pi = this.patrolAt(x, y);
    if (pi >= 0) {
      if (v !== 1 && this.patrolUnder[pi] !== v) { this.patrolUnder[pi] = v; this.needsReplan = true; }
      return;
    }
    if (v === 1 && this.isEndpoint(x, y)) return;
    if (this.planner.getCell(x, y) !== v) { this.planner.setCell(x, y, v); this.needsReplan = true; }
  }

  /** Clears a cell and removes any patrol standing on it. */
  erase(x: number, y: number): void {
    const pi = this.patrolAt(x, y);
    if (pi >= 0) {
      this.planner.setCell(x, y, this.patrolUnder[pi] as CellValue);
      const last = --this.patrolCount;
      this.patrolX[pi] = this.patrolX[last]; this.patrolY[pi] = this.patrolY[last];
      this.patrolDX[pi] = this.patrolDX[last]; this.patrolDY[pi] = this.patrolDY[last];
      this.patrolUnder[pi] = this.patrolUnder[last];
      this.needsReplan = true;
    }
    this.editCell(x, y, 0);
  }

  /** Moves the target to a passable cell. */
  setGoal(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    if (this.planner.getCell(x, y) === 1 || (x === this.goalX && y === this.goalY)) return;
    this.goalX = x; this.goalY = y;
    this.needsReplan = true;
  }

  /** Spawns a patrol obstacle on a free or wind cell. Returns false if it cannot be placed. */
  addPatrol(x: number, y: number, dx: number, dy: number): boolean {
    if (this.patrolCount >= MAX_PATROLS || this.planner.getCell(x, y) === 1 || this.isEndpoint(x, y)) return false;
    const i = this.patrolCount++;
    this.patrolX[i] = x; this.patrolY[i] = y; this.patrolDX[i] = dx; this.patrolDY[i] = dy;
    this.patrolUnder[i] = this.planner.getCell(x, y);
    this.planner.setCell(x, y, 1);
    this.needsReplan = true;
    return true;
  }

  /** Snapshot with patrol cells restored, suitable for saving. */
  exportState(): SimState {
    const cells = this.planner.grid().slice();
    const patrols: SimState['patrols'] = [];
    for (let i = 0; i < this.patrolCount; i++) {
      cells[this.patrolY[i] * this.width + this.patrolX[i]] = this.patrolUnder[i];
      patrols.push({ x: this.patrolX[i], y: this.patrolY[i], dx: this.patrolDX[i], dy: this.patrolDY[i] });
    }
    return { cells, start: { x: this.startX, y: this.startY }, goal: { x: this.goalX, y: this.goalY }, patrols };
  }

  /** Replaces the whole map. Returns false when the snapshot does not match the grid size. */
  importState(s: SimState): boolean {
    if (s.cells.length !== this.width * this.height) return false;
    this.patrolCount = 0;
    this.planner.clearGrid();
    for (let i = 0; i < s.cells.length; i++) {
      if (s.cells[i] !== 0) this.planner.setCell(i % this.width, (i / this.width) | 0, s.cells[i] as CellValue);
    }
    this.setEndpoints(s.start.x, s.start.y, s.goal.x, s.goal.y);
    for (const p of s.patrols) this.addPatrol(p.x, p.y, p.dx, p.dy);
    this.reset();
    return true;
  }

  /** Advances the world by `dt` seconds. Allocation-free. */
  tick(dt: number): void {
    if (this.flash > 0) this.flash -= dt;
    if (this.needsReplan) { this.needsReplan = false; this.plan(true); }
    if (!this.playing || this.ended || !this.started) { this.refreshStatus(); return; }
    this.stats.elapsedMs += dt * 1000;
    this.stepPatrols(dt);
    if (this.base === 'Blocked') {
      this.blockedFor += dt;
      this.retryIn -= dt;
      if (this.retryIn <= 0) { this.retryIn = RETRY_SECONDS; this.plan(false); }
      if (this.base === 'Blocked' && this.blockedFor >= BLOCKED_GIVE_UP_SECONDS) this.finish('blocked');
    } else if (this.base === 'En Route') {
      const cx = Math.floor(this.droneX);
      const cy = Math.floor(this.droneY);
      const next = this.pathIdx + 1 < this.pathLen ? this.path[this.pathIdx + 1] : -1;
      const nextIsWall = next >= 0 && this.planner.grid()[next] === 1;
      if (nextIsWall || this.planner.hasPathObstruction(cx, cy, this.lidarRadius, this.pathIdx + 1)) this.plan(true);
      if (this.base === 'En Route') this.advance(dt);
    }
    this.refreshStatus();
  }

  private isEndpoint(x: number, y: number): boolean {
    return (x === this.startX && y === this.startY) || (x === this.goalX && y === this.goalY);
  }

  private patrolAt(x: number, y: number): number {
    for (let i = 0; i < this.patrolCount; i++) if (this.patrolX[i] === x && this.patrolY[i] === y) return i;
    return -1;
  }

  private refreshStatus(): void {
    this.stats.status = this.base === 'En Route' && this.flash > 0 ? 'Replanning' : this.base;
  }

  /** Plans from the cell the drone occupies; `count` says whether it is a replan for the stats. */
  private plan(count: boolean): void {
    const cx = Math.floor(this.droneX);
    const cy = Math.floor(this.droneY);
    this.droneX = cx + 0.5;
    this.droneY = cy + 0.5;
    const r = this.planner.computePath(cx, cy, this.goalX, this.goalY, this.mode);
    const s = this.stats;
    if (count) s.replans++;
    s.planCalls++;
    s.lastLatencyMs = r.latencyMs;
    s.totalLatencyMs += r.latencyMs;
    if (r.latencyMs > s.maxLatencyMs) s.maxLatencyMs = r.latencyMs;
    s.lastExpanded = r.expanded;
    s.totalExpanded += r.expanded;
    s.pathCost = r.cost;
    if (r.latencyMs > SLOW_REPLAN_MS) log.warn(`slow replan ${r.latencyMs.toFixed(1)} ms (${this.mode})`);
    this.path = r.path;
    this.pathLen = r.found ? r.path.length : 0;
    this.pathIdx = 0;
    this.frac = 0;
    if (!r.found) this.base = 'Blocked';
    else if (this.started) {
      this.base = 'En Route';
      this.blockedFor = 0;
      if (count) this.flash = FLASH_SECONDS;
    } else this.base = 'Idle';
    if (this.started && this.pathLen === 1) this.finish('reached');
  }

  private advance(dt: number): void {
    const w = this.width;
    let rem = DRONE_RATE * this.speed * dt;
    while (rem > 0 && this.pathIdx < this.pathLen - 1) {
      const a = this.path[this.pathIdx];
      const b = this.path[this.pathIdx + 1];
      const dx = (b % w) - (a % w);
      const dy = ((b / w) | 0) - ((a / w) | 0);
      const seg = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
      this.heading = Math.atan2(dy, dx);
      const left = seg * (1 - this.frac);
      if (rem >= left) { rem -= left; this.pathIdx++; this.frac = 0; } else { this.frac += rem / seg; rem = 0; }
    }
    const a = this.path[this.pathIdx];
    const ax = (a % w) + 0.5;
    const ay = ((a / w) | 0) + 0.5;
    if (this.pathIdx < this.pathLen - 1) {
      const b = this.path[this.pathIdx + 1];
      this.droneX = ax + ((b % w) + 0.5 - ax) * this.frac;
      this.droneY = ay + (((b / w) | 0) + 0.5 - ay) * this.frac;
    } else {
      this.droneX = ax; this.droneY = ay;
      this.finish('reached');
    }
  }

  private stepPatrols(dt: number): void {
    this.patrolAcc += dt * PATROL_RATE;
    while (this.patrolAcc >= 1) {
      this.patrolAcc -= 1;
      for (let i = 0; i < this.patrolCount; i++) this.movePatrol(i);
    }
  }

  /** Restore the cell underneath, step (bouncing off walls, edges and the endpoints), re-stamp. */
  private movePatrol(i: number): void {
    const p = this.planner;
    p.setCell(this.patrolX[i], this.patrolY[i], this.patrolUnder[i] as CellValue);
    for (let attempt = 0; attempt < 2; attempt++) {
      const nx = this.patrolX[i] + this.patrolDX[i];
      const ny = this.patrolY[i] + this.patrolDY[i];
      const droneHere = nx === Math.floor(this.droneX) && ny === Math.floor(this.droneY);
      if (p.getCell(nx, ny) !== 1 && !droneHere && !(nx === this.goalX && ny === this.goalY)) {
        this.patrolX[i] = nx; this.patrolY[i] = ny;
        break;
      }
      this.patrolDX[i] = -this.patrolDX[i];
      this.patrolDY[i] = -this.patrolDY[i];
    }
    this.patrolUnder[i] = p.getCell(this.patrolX[i], this.patrolY[i]);
    p.setCell(this.patrolX[i], this.patrolY[i], 1);
  }

  private finish(status: 'reached' | 'blocked'): void {
    if (this.ended) return;
    this.ended = true;
    this.base = status === 'reached' ? 'Reached' : 'Blocked';
    const s = this.stats;
    this.onMissionEnd?.({
      planMode: this.mode,
      status,
      replans: s.replans,
      avgReplanMs: s.planCalls ? s.totalLatencyMs / s.planCalls : 0,
      maxReplanMs: s.maxLatencyMs,
      nodesExpanded: s.totalExpanded,
      pathCost: s.pathCost,
      durationMs: s.elapsedMs,
    });
  }
}
