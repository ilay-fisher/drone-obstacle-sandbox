import type { PlanMode } from './plannerBridge';

/**
 * What a planning call looked like, handed to the renderer so the search can be shown.
 * Purely additive: it is built from data the planner already exposes, and it never feeds
 * back into planning.
 *
 * - `replan`: a counted replan (a wall appeared, the goal moved, the algorithm changed).
 * - `preview`: the plan made by `reset` or a map load, before the drone moves.
 * - `retry`: the periodic re-attempt while a mission is blocked (the picture stays still).
 */
export type ReplanKind = 'replan' | 'preview' | 'retry';

export interface ReplanEvent {
  /** Increases by one per planning call. */
  seq: number;
  kind: ReplanKind;
  mode: PlanMode;
  found: boolean;
  /** Cells this call expanded, as the planner counted them (the sum of the heat buffer). */
  expanded: number;
  /**
   * True for a D* Lite call that repaired an existing search toward the same goal. A first
   * D* call, one after a goal change, or one after the map was cleared searches from scratch.
   */
  incremental: boolean;
  /** Cells edited since the previous planning call (walls, wind, patrol steps), once each. */
  changed: Int32Array;
  /** Where the search started: the drone cell for A*; the goal then the changed cells for D* Lite. */
  origin: Int32Array;
  /** Copy of the planner's heat buffer for this call (visit counts per cell, not a view). */
  heat: Uint8Array;
  /** The route that was still ahead of the drone before this call (empty when there was none). */
  oldPath: Int32Array;
  /** The route this call produced (empty when none was found). */
  newPath: Int32Array;
  /** `performance.now()` when the call finished. */
  timestamp: number;
}
