/**
 * The blockage pulse: the one loud motion of the drone. When a counted replan was caused by a
 * change near the drone (a wall painted or a patrol stepping inside the LiDAR radius), a ring
 * expands from the drone and the body recoils. Pure timing and decisions here; the drone layer
 * draws it.
 *
 * It must not fight the search show (PR 3). The replan flood starts at the same instant, so
 * the pulse is built to lead it: it is faster than the flood (it finishes inside `FLOOD_MS`)
 * and it is skipped altogether while a previous flood is still playing, and for a short gap
 * after another pulse. One loud motion at a time.
 */
import type { ReplanKind } from '../engine/replanEvent';
import { FLOOD_MS } from './replanTimeline';

/** Length of the pulse. Inside the 420 ms flood, so the ring is gone before the flood finishes. */
export const PULSE_MS = 400;
/** Least time between two pulses. */
export const MIN_PULSE_GAP_MS = 700;

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

export function shouldPulse(c: PulseCheck): boolean {
  if (c.reduced || c.kind !== 'replan' || !c.nearChange) return false;
  if (c.ageMs > PULSE_MS) return false;
  if (c.msSincePrevEvent < FLOOD_MS) return false;
  if (c.msSincePrevPulse < MIN_PULSE_GAP_MS) return false;
  return true;
}

/** Ring state: radius as a fraction of its maximum, opacity, and stroke weight, all 0..1. */
export interface PulsePhases {
  radius: number;
  alpha: number;
  weight: number;
  active: boolean;
}

const OFF: PulsePhases = Object.freeze({ radius: 1, alpha: 0, weight: 0, active: false });
const START: PulsePhases = Object.freeze({ radius: 0, alpha: 1, weight: 1, active: true });

/** The pulse `ageMs` after it started. Ease-out expansion, quick fade. */
export function pulsePhases(ageMs: number): PulsePhases {
  if (!Number.isFinite(ageMs)) return OFF;
  if (ageMs <= 0) return START;
  if (ageMs >= PULSE_MS) return OFF;
  const p = ageMs / PULSE_MS;
  const out = 1 - (1 - p) * (1 - p) * (1 - p);
  const fade = 1 - p;
  return { radius: out, alpha: Math.min(1, p / 0.06) * fade * fade, weight: 1 - p, active: true };
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
