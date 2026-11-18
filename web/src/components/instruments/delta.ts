/**
 * Path cost delta shown as a chip after a replan. The cost itself is untouched `SimStats`
 * data; this only works out how it moved between two telemetry snapshots.
 */

/** A change worth showing. */
export interface CostDelta {
  value: number;
  /** Signed text with one decimal, e.g. "+3.2". */
  text: string;
  dir: 'up' | 'down';
}

/** Changes smaller than this round to "0.0" and are not worth a chip. */
const MIN_DELTA = 0.05;

/** Signed one-decimal text for a delta. */
export function formatDelta(value: number): string {
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(1)}`;
}

/** Delta from `prev` to `next`, or null when either side has no path or nothing moved. */
export function computeDelta(prev: number, next: number): CostDelta | null {
  if (!Number.isFinite(prev) || !Number.isFinite(next) || prev < 0 || next < 0) return null;
  const value = next - prev;
  if (Math.abs(value) < MIN_DELTA) return null;
  return { value, text: formatDelta(value), dir: value > 0 ? 'up' : 'down' };
}

/** What the telemetry remembers between snapshots. */
export interface DeltaState {
  replans: number;
  cost: number;
  delta: CostDelta | null;
}

/**
 * Reducer for one telemetry snapshot. A new replan sets the delta against the cost at the
 * previous snapshot and it stays until the next replan; a drop in the replan counter (reset
 * or a new map) clears it.
 */
export function nextDeltaState(s: DeltaState, replans: number, cost: number): DeltaState {
  if (replans < s.replans) return { replans, cost, delta: null };
  if (replans > s.replans) return { replans, cost, delta: computeDelta(s.cost, cost) };
  return { replans, cost, delta: s.delta };
}
