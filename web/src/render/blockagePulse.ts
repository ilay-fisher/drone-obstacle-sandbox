/**
 * The blockage pulse: the one loud motion of the drone. When a counted replan was caused by a
 * change near the drone (a wall painted or a patrol stepping inside the LiDAR radius), a ring
 * expands from the drone and the body recoils. Pure timing and decisions here; the drone layer
 * draws it.
 *
 * It must not fight the search show (PR 3). The replan flood starts at the same instant, so
 * the pulse is built to lead it: it is faster than the flood (it finishes inside `FLOOD_MS`).
 * While a previous flood is still playing the pulse is not skipped but reduced (see `pulseMode`),
 * so the cause of the replan is still shown. Both modes keep a minimum gap. One loud motion at a time.
 */
import type { ReplanKind } from '../engine/replanEvent';
import { FLOOD_MS } from './replanTimeline';

/** Length of the pulse. Inside the 420 ms flood, so the ring is gone before the flood finishes. */
export const PULSE_MS = 400;
/** Least time between two pulses. */
export const MIN_PULSE_GAP_MS = 700;
/** The reduced pulse: shorter, thinner and fainter, so it can play over a flood without competing. */
export const REDUCED_PULSE_MS = 260;
export const REDUCED_MIN_GAP_MS = 300;
const REDUCED_ALPHA = 0.5;
const REDUCED_WEIGHT = 0.45;

/** What the decision needs to know about the newest replan event. */
export interface PulseCheck {
  kind: ReplanKind;
  /** A changed cell lies within the LiDAR radius of the drone. */
  nearChange: boolean;
  reduced: boolean;
  /** How long ago the event landed, when first seen (large for events that predate the page). */
  ageMs: number;
  /** Time between this event and the previous one (Infinity when there was none). */
  msSincePrevEvent: number;
  /** Time since the last pulse started (Infinity when none). */
  msSincePrevPulse: number;
}

/** How a pulse plays: the full ring, or the thin quiet one used while a flood is already playing. */
export type PulseMode = 'full' | 'reduced';

/**
 * Whether and how to pulse. A change near the drone always deserves its cause shown, but never
 * as a second loud motion: when the previous replan's flood is still playing the ring is the
 * reduced one (thin, faint, short), so the flood stays the one loud thing. Both modes are rate
 * limited (the reduced one with a shorter gap, so a quick second wall still gets its ring).
 */
export function pulseMode(c: PulseCheck): PulseMode | 'none' {
  if (c.reduced || c.kind !== 'replan' || !c.nearChange) return 'none';
  if (c.ageMs > PULSE_MS) return 'none';
  if (c.msSincePrevEvent < FLOOD_MS) return c.msSincePrevPulse < REDUCED_MIN_GAP_MS ? 'none' : 'reduced';
  return c.msSincePrevPulse < MIN_PULSE_GAP_MS ? 'none' : 'full';
}

export function shouldPulse(c: PulseCheck): boolean {
  return pulseMode(c) !== 'none';
}

/** How long a pulse of this mode plays. */
export function pulseDuration(mode: PulseMode): number {
  return mode === 'reduced' ? REDUCED_PULSE_MS : PULSE_MS;
}

/** Ring state: radius as a fraction of its maximum, opacity, and stroke weight, all 0..1. */
export interface PulsePhases {
  radius: number;
  alpha: number;
  weight: number;
  active: boolean;
  /** True for the full pulse: it also draws the soft halo and the inner ring. */
  full: boolean;
}

const OFF: PulsePhases = Object.freeze({ radius: 1, alpha: 0, weight: 0, active: false, full: false });
const START: PulsePhases = Object.freeze({ radius: 0, alpha: 1, weight: 1, active: true, full: true });
const START_REDUCED: PulsePhases = Object.freeze({
  radius: 0, alpha: REDUCED_ALPHA, weight: REDUCED_WEIGHT, active: true, full: false,
});

/** The pulse `ageMs` after it started. Ease-out expansion, quick fade. */
export function pulsePhases(ageMs: number, mode: PulseMode = 'full'): PulsePhases {
  if (!Number.isFinite(ageMs)) return OFF;
  const reduced = mode === 'reduced';
  if (ageMs <= 0) return reduced ? START_REDUCED : START;
  const dur = pulseDuration(mode);
  if (ageMs >= dur) return OFF;
  const p = ageMs / dur;
  const out = 1 - (1 - p) * (1 - p) * (1 - p);
  const fade = 1 - p;
  const alpha = Math.min(1, p / 0.06) * fade * fade;
  const weight = 1 - p;
  return reduced
    ? { radius: out, alpha: alpha * REDUCED_ALPHA, weight: weight * REDUCED_WEIGHT, active: true, full: false }
    : { radius: out, alpha, weight, active: true, full: true };
}

/**
 * Index (a cell) of the changed cell closest to the drone among those inside `radius` cells,
 * or -1 when none is. `droneX/Y` are in cell units, `w` is the grid width.
 */
export function nearestChange(changed: Int32Array, w: number, droneX: number, droneY: number, radius: number): number {
  let best = -1;
  let bestD = radius * radius;
  for (let k = 0; k < changed.length; k++) {
    const c = changed[k];
    const dx = (c % w) + 0.5 - droneX;
    const dy = ((c / w) | 0) + 0.5 - droneY;
    const d = dx * dx + dy * dy;
    if (d <= bestD) { bestD = d; best = c; }
  }
  return best;
}
