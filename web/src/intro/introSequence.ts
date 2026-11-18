/**
 * The intro's cue sequencer: a pure state machine, no clock and no simulation inside. The
 * runner calls `stepSeq(state, t, seq)` every frame with the intro clock `t` (ms) and the
 * simulation's `replanSeq` (how many planning calls have finished). It answers with the one
 * cue to fire now, if any.
 *
 * Event-driven, not timed: a cue that makes the planner run (a wall, the algorithm switch, the
 * map load) records the `replanSeq` it started from. The next cue waits until that call has
 * really finished (`replanSeq` moved on) plus the part of the replan sequence that must play
 * out first (`waitMs`, from `replanTimeline`): so a slow planner delays the script and two
 * floods can never overlap. Each cue also has a nominal time (`minAt`) that keeps the pace on
 * a normal machine at about ten seconds.
 *
 * It can never hang: if a planning call is not seen within `EVENT_TIMEOUT_MS` the wait is
 * dropped, and `HARD_CAP_MS` ends the run whatever happens.
 */
import { DRAW_MS, DRAW_START_MS, TOTAL_MS as REPLAN_TOTAL_MS } from '../render/replanTimeline';

export type CueName = 'loadCity' | 'play' | 'block1' | 'dstar' | 'block2';

export interface SeqCue {
  name: CueName;
  /** Earliest time on the intro clock (ms): the pace on a normal machine. */
  minAt: number;
  /** Wait this long after the previous planning call finished (null: no wait). */
  waitMs: number | null;
  /** True when firing this cue makes the planner run. */
  replan: boolean;
  /** The caption step (0 to 3) that begins when this cue fires. */
  step?: 1 | 2 | 3;
}

/** The new route has finished drawing on. */
const DRAWN_MS = DRAW_START_MS + DRAW_MS;

/** A beat to read the caption, then the second wall. */
const CAPTION_BEAT_MS = 600;

export const SEQUENCE: readonly SeqCue[] = [
  // The canonical city loads: its preview plan is the A* wavefront.
  { name: 'loadCity', minAt: 2400, waitMs: null, replan: true, step: 1 },
  // The drone sets off once the route has drawn and been read.
  { name: 'play', minAt: 3000, waitMs: DRAWN_MS + 250, replan: false },
  // The first wall: LiDAR sees it, A* replans.
  { name: 'block1', minAt: 5000, waitMs: DRAWN_MS, replan: true, step: 2 },
  // D* Lite's first call searches from scratch; it plays quietly, after the whole A* repair sequence.
  { name: 'dstar', minAt: 7400, waitMs: REPLAN_TOTAL_MS, replan: true, step: 3 },
  // The second wall: D* repairs only what changed (the one visible flood of step 4).
  { name: 'block2', minAt: 8600, waitMs: CAPTION_BEAT_MS, replan: true },
];

/** The guided steps end here at the earliest, once the last repair has played out. */
export const FINISH_AT_MS = 10400;
/** The steps end this long after the last repair finished: its flood, route and chip have all played. */
export const FINISH_WAIT_MS = REPLAN_TOTAL_MS;
/** A planning call not seen after this long counts as done so the script cannot hang. */
export const EVENT_TIMEOUT_MS = 2500;
/** The run ends here whatever the planner is doing. */
export const HARD_CAP_MS = 20000;

export interface SeqPending {
  /** `replanSeq` when the cue fired: the call is done once the counter passes it. */
  seq: number;
  firedAt: number;
  /** When the planning call was seen to finish; null while it has not. */
  eventAt: number | null;
}

export interface SeqState {
  /** Index of the next cue in `SEQUENCE`; `SEQUENCE.length` once all have fired. */
  next: number;
  /** The most recent cue that made the planner run. */
  pending: SeqPending | null;
  /** Caption step now in force (0 before the city loads). */
  step: 0 | 1 | 2 | 3;
  finished: boolean;
}

export type SeqFire = SeqCue | 'finish' | null;

export function initSeq(): SeqState {
  return { next: 0, pending: null, step: 0, finished: false };
}

/** When the wait behind the last planning call is over: its finish plus `waitMs`, or its timeout. */
function readyAt(p: SeqPending | null, waitMs: number | null): number {
  if (p === null || waitMs === null) return 0;
  return p.eventAt !== null ? p.eventAt + waitMs : p.firedAt + EVENT_TIMEOUT_MS;
}

/** One frame of the script. Never mutates `s`; fires at most one cue. */
export function stepSeq(s: SeqState, t: number, seq: number): { state: SeqState; fire: SeqFire } {
  const now = Number.isFinite(t) ? Math.max(0, t) : 0;
  if (s.finished) return { state: s, fire: null };
  let pending = s.pending;
  if (pending && pending.eventAt === null && seq > pending.seq) pending = { ...pending, eventAt: now };
  if (now >= HARD_CAP_MS) return { state: { ...s, pending, finished: true }, fire: 'finish' };
  if (s.next >= SEQUENCE.length) {
    if (now >= Math.max(FINISH_AT_MS, readyAt(pending, FINISH_WAIT_MS))) return { state: { ...s, pending, finished: true }, fire: 'finish' };
    return { state: { ...s, pending }, fire: null };
  }
  const cue = SEQUENCE[s.next];
  if (now < Math.max(cue.minAt, readyAt(pending, cue.waitMs))) return { state: { ...s, pending }, fire: null };
  return {
    state: {
      next: s.next + 1,
      pending: cue.replan ? { seq, firedAt: now, eventAt: null } : pending,
      step: cue.step ?? s.step,
      finished: false,
    },
    fire: cue,
  };
}
