/** Smallest latency the display claims to resolve, in milliseconds. */
export const LATENCY_FLOOR_MS = 0.1;

/**
 * Formats a replan latency for the telemetry readout. Below 0.1 ms the timer is at the
 * edge of its resolution and "0.000 ms" reads like a bug, so the display says "< 0.1 ms".
 * Only the text changes: the measured value in `SimStats` is untouched. Invalid input
 * (NaN, negative) shows a dash rather than a made-up bound.
 */
export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '-';
  if (ms < LATENCY_FLOOR_MS) return '< 0.1 ms';
  return `${ms.toFixed(3)} ms`;
}
