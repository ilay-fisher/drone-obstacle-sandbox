/**
 * The replan sequence as a pure function of time: where the flood front is, how far the new
 * route has drawn on, how far the old route has dissolved, and how visible the chip is. The
 * search layer reads these numbers each frame; nothing here touches the canvas.
 *
 *   0 ms     flood starts           (FLOOD_MS, ease out: a front slows as it spreads)
 *   100 ms   old route starts to dissolve   (DISSOLVE_MS, settling curve, no linear fade)
 *   150 ms   new route starts to draw on    (DRAW_MS)
 *   1000 ms  chip releases                   (it has been pinned since about 60 ms)
 *   1100 ms  sequence over; only the resting glow and the route remain
 *
 * Reduced motion: no flood, draw-on or dissolve; the finished picture shows at once. The
 * chip still appears for its second, held still, because it carries real numbers.
 */
import type { PlanMode } from '../engine/plannerBridge';

export const FLOOD_MS = 420;
export const DRAW_START_MS = 150;
export const DRAW_MS = 420;
export const DISSOLVE_START_MS = 100;
export const DISSOLVE_MS = 900;
/** The chip holds fully visible until here, then releases over `CHIP_FADE_MS`. */
export const CHIP_MS = 1000;
const CHIP_IN_START_MS = 60;
const CHIP_IN_MS = 140;
const CHIP_FADE_MS = 100;
export const TOTAL_MS = CHIP_MS + CHIP_FADE_MS;

/** Progress of every part of the sequence, each 0 to 1 and never going backwards. */
export interface Phases {
  /** Flood front position as a fraction of the flood's rank range. */
  flood: number;
  /** Fraction of the new route drawn on. */
  draw: number;
  /** Fraction of the old route dissolved (1 means gone). */
  dissolve: number;
  /** Chip opacity. */
  chip: number;
  /** True while anything is still moving or showing. */
  active: boolean;
}

/** The finished state: everything settled, the chip gone. Also what reduced motion jumps to. */
export const FINISHED: Phases = Object.freeze({ flood: 1, draw: 1, dissolve: 1, chip: 0, active: false });

const clamp01 = (x: number): number => (x > 0 ? (x < 1 ? x : 1) : 0);

/** Critically damped settle: quick start, long soft tail, exactly 0 at 0 and 1 at 1 (NaN gives 0). */
export function settle(p: number): number {
  if (!Number.isFinite(p) || p <= 0) return 0;
  if (p >= 1) return 1;
  const K = 5;
  const f = (x: number): number => 1 - (1 + K * x) * Math.exp(-K * x);
  return f(p) / f(1);
}

const easeOutQuad = (p: number): number => 1 - (1 - p) * (1 - p);
const easeOutCubic = (p: number): number => 1 - (1 - p) * (1 - p) * (1 - p);

/** The phases `elapsedMs` after a replan landed. With `reduced`, the finished picture at once. */
export function replanPhases(elapsedMs: number, reduced: boolean): Phases {
  if (reduced) return elapsedMs < CHIP_MS ? { flood: 1, draw: 1, dissolve: 1, chip: 1, active: true } : FINISHED;
  if (!(elapsedMs < TOTAL_MS)) return FINISHED;
  const e = elapsedMs < 0 ? 0 : elapsedMs;
  const chipIn = settle(clamp01((e - CHIP_IN_START_MS) / CHIP_IN_MS));
  const chipOut = 1 - clamp01((e - CHIP_MS) / CHIP_FADE_MS);
  return {
    flood: easeOutQuad(clamp01(e / FLOOD_MS)),
    draw: easeOutCubic(clamp01((e - DRAW_START_MS) / DRAW_MS)),
    dissolve: settle(clamp01((e - DISSOLVE_START_MS) / DISSOLVE_MS)),
    chip: Math.min(chipIn, chipOut),
    active: true,
  };
}

/**
 * The chip's words. Every number is real: `cells` is how many cells the planner expanded in
 * this call. "repaired" is used only for a D* Lite call that repaired an existing search; a
 * from-scratch call (the first, or after the goal moved or the map was cleared) says
 * "searched", because that is what it did.
 */
export function chipTextCompact(mode: PlanMode, incremental: boolean, found: boolean, cells: number): string {
  const text = `${cells} ${mode === 'dstar' && incremental ? 'repaired' : 'searched'}`;
  return found ? text : `${text}, no route`;
}

export function chipText(mode: PlanMode, incremental: boolean, found: boolean, cells: number): string {
  const verb = mode === 'dstar' && incremental ? 'repaired' : 'searched';
  const text = `${verb} ${cells} ${cells === 1 ? 'cell' : 'cells'}`;
  return found ? text : `${text}, no route`;
}
