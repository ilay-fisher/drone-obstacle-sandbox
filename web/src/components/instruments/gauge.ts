/**
 * Needle gauge maths for replan latency: 0 to 5 ms, linear up to 1 ms, logarithmic after.
 * Replans are mostly well under a millisecond, so the first 55% of the sweep is linear and
 * readable; the slow tail from 1 to 5 ms is compressed on a log scale so it still fits.
 */

/** Scale end, in milliseconds. */
export const GAUGE_MAX_MS = 5;
/** Where the scale turns from linear to logarithmic, in milliseconds. */
export const GAUGE_KNEE_MS = 1;
/** Share of the sweep used by the linear part (0 to the knee). */
export const GAUGE_LINEAR_SHARE = 0.55;
/** Needle angle at 0 ms; 0 degrees is straight up, positive is clockwise. */
export const GAUGE_MIN_ANGLE = -75;
/** Needle angle at 5 ms. */
export const GAUGE_MAX_ANGLE = 75;

/** Position on the scale, 0 to 1. NaN and negatives read 0; anything past 5 ms pins at 1. */
export function gaugeFraction(ms: number): number {
  if (Number.isNaN(ms) || ms <= 0) return 0;
  if (ms >= GAUGE_MAX_MS) return 1;
  if (ms <= GAUGE_KNEE_MS) return (ms / GAUGE_KNEE_MS) * GAUGE_LINEAR_SHARE;
  const logPart = Math.log(ms / GAUGE_KNEE_MS) / Math.log(GAUGE_MAX_MS / GAUGE_KNEE_MS);
  return GAUGE_LINEAR_SHARE + logPart * (1 - GAUGE_LINEAR_SHARE);
}

/** Needle angle in degrees for a latency. */
export function gaugeAngle(ms: number): number {
  return GAUGE_MIN_ANGLE + gaugeFraction(ms) * (GAUGE_MAX_ANGLE - GAUGE_MIN_ANGLE);
}

/** Printed marks on the dial face; `label` is set where there is room to print a number. */
export const GAUGE_TICKS: { ms: number; major: boolean; label?: string }[] = [
  { ms: 0, major: true, label: '0' },
  { ms: 0.25, major: false },
  { ms: 0.5, major: false },
  { ms: 0.75, major: false },
  { ms: 1, major: true, label: '1' },
  { ms: 2, major: true, label: '2' },
  { ms: 3, major: false },
  { ms: 4, major: false },
  { ms: 5, major: true, label: '5' },
];
