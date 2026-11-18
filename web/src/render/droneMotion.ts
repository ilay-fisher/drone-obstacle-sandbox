/**
 * The drone's motion as pure maths: smoothed heading, bank, altitude (landing), recoil, ground
 * speed, rotor phase and the shadow's look. Nothing here touches the canvas, so it is all unit
 * tested. `droneLayer.ts` feeds it the simulation each frame and draws the result.
 *
 *   heading   follows the planner's segment direction on SPRING_SNAPPY, so a 45 degree corner
 *             is a quick swing, not a snap. The turn rate is the spring's own velocity.
 *   bank      leans into the turn: its target is proportional to the turn rate (clamped), and
 *             it settles on SPRING_SOFT, so the lean builds and relaxes slowly.
 *   altitude  1 while flying, 0 on the pad. On Reached it springs to 0 on SPRING_SOFT, dips a
 *             little below 0 (the squash of touching down) and rests.
 *   recoil    a short displacement kick away from a blockage, back to rest on SPRING_SNAPPY.
 *
 * Reduced motion: everything lands on its final value in one step (no bank, no recoil, the
 * final heading, instant landing, rotors still).
 */
import { SPRING_SNAPPY, SPRING_SOFT, springStepMut, type SpringState } from '../motion/spring';
import type { MissionStatus } from '../engine/simulation';

/** Largest lean, in radians (about 26 degrees). */
export const MAX_BANK = 0.46;
/** Lean per rad/s of turn rate. A 45 degree corner on the snappy spring peaks near 5 rad/s. */
const BANK_PER_TURN_RATE = 0.12;
/** Ground speed (cells/s) that counts as "full speed" for the shadow offset. */
export const SPEED_REF = 14;
/** Rotor spin at full altitude, rad/s. Slow enough not to alias at 60 Hz. */
const ROTOR_RATE = 17;
/** A jump bigger than this many cells in one frame is a reset or map load, not flight. */
const TELEPORT_CELLS = 2.5;
const MAX_DT = 0.05;

const TAU = Math.PI * 2;

/** Shortest signed rotation from `from` to `to`, in (-pi, pi]. */
export function angleDiff(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

/** Lean target for a turn rate in rad/s: proportional, clamped to +-MAX_BANK. */
export function bankTarget(turnRate: number): number {
  const b = turnRate * BANK_PER_TURN_RATE;
  return b > MAX_BANK ? MAX_BANK : b < -MAX_BANK ? -MAX_BANK : b;
}

/** Ground speed in cells/s mapped to 0..1. */
export function speedNorm(cellsPerSec: number): number {
  const n = cellsPerSec / SPEED_REF;
  return n > 0 ? (n < 1 ? n : 1) : 0;
}

/** Most cover the shadow alone can cause (the drone itself over a wall is always 1). */
const SHADOW_COVER_MAX = 0.8;

/**
 * How much a building covers the shadow: 1 when the drone is over a wall, otherwise the share
 * of the shadow footprint that lies on buildings (`footprintCover`), scaled down a little.
 */
export function coverFor(underWall: boolean, shadowCover: number): number {
  if (underWall) return 1;
  const c = shadowCover > 0 ? (shadowCover < 1 ? shadowCover : 1) : 0;
  return c * SHADOW_COVER_MAX;
}

/**
 * Share (0..1) of the square footprint centred on (`cx`, `cy`) with half-side `r` (cell units)
 * that lies on wall cells: the exact overlap area with every cell under it, so it grows
 * smoothly as the shadow slides onto a building instead of popping cell by cell. Allocation-free.
 */
export function footprintCover(isWall: (x: number, y: number) => boolean, cx: number, cy: number, r: number): number {
  if (!(r > 0)) return isWall(Math.floor(cx), Math.floor(cy)) ? 1 : 0;
  const x0 = cx - r;
  const x1 = cx + r;
  const y0 = cy - r;
  const y1 = cy + r;
  let area = 0;
  for (let y = Math.floor(y0); y <= Math.floor(y1); y++) {
    const oy = Math.min(y1, y + 1) - Math.max(y0, y);
    if (!(oy > 0)) continue;
    for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
      const ox = Math.min(x1, x + 1) - Math.max(x0, x);
      if (ox > 0 && isWall(x, y)) area += ox * oy;
    }
  }
  const c = area / (4 * r * r);
  return c < 0 ? 0 : c > 1 ? 1 : c;
}

/** Drone span in cells (shell plus rotors), and the smallest span it may have on screen, in CSS px. */
const DRONE_SPAN_CELLS = 1.8;
export const MIN_DRONE_PX = 29;
export const MAX_DRONE_SCALE = 2.6;

/**
 * Draw scale of the drone for a map cell size: 1 when its cell-based size is already at least
 * `MIN_DRONE_PX`, larger on phones so it still reads. Never below 1, capped on tiny maps.
 */
export function droneDrawScale(cell: number): number {
  if (!(cell > 0)) return 1;
  const s = MIN_DRONE_PX / (cell * DRONE_SPAN_CELLS);
  return s <= 1 ? 1 : s < MAX_DRONE_SCALE ? s : MAX_DRONE_SCALE;
}

/** Where and how the ground shadow is drawn. Offsets are in cells, lower right (light is top left). */
export interface ShadowLook {
  dx: number;
  dy: number;
  /** Size multiplier of the shadow sprite. */
  scale: number;
  alpha: number;
  /** 0 crisp .. 1 soft: the weight of the blurred sprite against the tight one. */
  soft: number;
}

/**
 * The shadow of a drone at altitude `alt` (1 flying, 0 on the pad), moving at `speedN` (0..1),
 * with `cover` (0..1) of a building under it. Higher and faster pushes it further away; over a
 * building it shrinks, fades and softens (the roof is closer to the drone than the street).
 */
export function shadowLook(speedN: number, alt: number, cover: number): ShadowLook {
  const a = alt < 0 ? 0 : alt > 1.2 ? 1.2 : alt;
  const off = (0.16 + 0.2 * a + 0.28 * speedN * a) * (1 - 0.55 * cover);
  return {
    dx: off,
    dy: off * 1.25,
    scale: (0.86 + 0.14 * a) * (1 - 0.3 * cover),
    alpha: (0.34 + 0.16 * a) * (1 - 0.5 * cover),
    soft: Math.min(1, 0.25 + 0.3 * a + 0.45 * cover),
  };
}

/** Everything the drone layer reads each frame. Mutated in place. */
export interface DroneMotion {
  /** Unwrapped heading in radians, and its angular velocity (the turn rate). */
  heading: SpringState;
  bank: SpringState;
  alt: SpringState;
  /** Recoil displacement in cells, per axis. */
  rx: SpringState;
  ry: SpringState;
  /** Smoothed ground speed, cells/s. */
  speed: number;
  /** Smoothed building cover, 0..1. */
  cover: number;
  /** Rotor phase in radians. */
  rotor: number;
  lastX: number;
  lastY: number;
  init: boolean;
}

export function createDroneMotion(): DroneMotion {
  return {
    heading: { x: 0, v: 0 },
    bank: { x: 0, v: 0 },
    alt: { x: 1, v: 0 },
    rx: { x: 0, v: 0 },
    ry: { x: 0, v: 0 },
    speed: 0,
    cover: 0,
    rotor: 0,
    lastX: 0,
    lastY: 0,
    init: false,
  };
}

/** What one frame knows about the simulation. */
export interface MotionInput {
  /** Drone position in cell units. */
  x: number;
  y: number;
  /** The planner's heading (radians), the direction of the current segment. */
  heading: number;
  reached: boolean;
  /** Target building cover, 0..1 (see `coverFor`). */
  cover: number;
  reduced: boolean;
}

/** The finished picture a reduced-motion viewer gets, as plain data. */
export interface DroneFinal {
  animate: boolean;
  heading: number;
  bank: number;
  altitude: number;
  sweep: boolean;
  pulse: boolean;
}

/**
 * The reduced-motion selector. With `reduced`, no bank, sweep or pulse, the drone sits at its
 * final heading and altitude (landing is instant). Otherwise everything animates.
 */
export function droneFinalState(reduced: boolean, status: MissionStatus, heading: number): DroneFinal {
  const altitude = status === 'Reached' ? 0 : 1;
  if (reduced) return { animate: false, heading, bank: 0, altitude, sweep: false, pulse: false };
  return { animate: true, heading, bank: 0, altitude, sweep: true, pulse: true };
}

/** How green the pad lamp is, 0..1: it lights as the landing drone comes down, instantly under reduced motion. */
export function lampMix(alt: number, reached: boolean, reduced: boolean): number {
  if (!reached) return 0;
  if (reduced) return 1;
  const m = (0.6 - alt) / 0.45;
  return m > 0 ? (m < 1 ? m : 1) : 0;
}

/** Puts every channel on its final value (first frame, teleport, reduced motion). */
function snap(m: DroneMotion, inp: MotionInput): void {
  m.heading.x = inp.heading;
  m.heading.v = 0;
  m.bank.x = 0;
  m.bank.v = 0;
  m.alt.x = inp.reached ? 0 : 1;
  m.alt.v = 0;
  m.rx.x = 0; m.rx.v = 0;
  m.ry.x = 0; m.ry.v = 0;
  m.speed = 0;
  m.cover = inp.cover;
}

/** Advances the drone's motion by `dtSec`. Allocation-free. */
export function stepDroneMotion(m: DroneMotion, inp: MotionInput, dtSec: number): void {
  const dt = dtSec > 0 ? (dtSec < MAX_DT ? dtSec : MAX_DT) : 0;
  const jumped = m.init && Math.hypot(inp.x - m.lastX, inp.y - m.lastY) > TELEPORT_CELLS;
  const first = !m.init;
  const fin = droneFinalState(inp.reduced, inp.reached ? 'Reached' : 'En Route', inp.heading);
  if (first || jumped || !fin.animate) {
    snap(m, inp);
    if (!fin.animate) m.alt.x = fin.altitude;
    m.init = true;
    m.lastX = inp.x;
    m.lastY = inp.y;
    return;
  }
  springStepMut(m.heading, m.heading.x + angleDiff(m.heading.x, inp.heading), dt, SPRING_SNAPPY);
  springStepMut(m.bank, bankTarget(m.heading.v), dt, SPRING_SOFT);
  springStepMut(m.alt, inp.reached ? 0 : 1, dt, SPRING_SOFT);
  springStepMut(m.rx, 0, dt, SPRING_SNAPPY);
  springStepMut(m.ry, 0, dt, SPRING_SNAPPY);
  if (dt > 0) {
    const inst = Math.hypot(inp.x - m.lastX, inp.y - m.lastY) / dt;
    m.speed += (inst - m.speed) * (1 - Math.exp(-dt * 9));
  }
  m.cover += (inp.cover - m.cover) * (1 - Math.exp(-dt * 10));
  const spin = 0.3 + 0.7 * (m.alt.x < 0 ? 0 : m.alt.x > 1 ? 1 : m.alt.x);
  m.rotor = (m.rotor + ROTOR_RATE * spin * dt) % TAU;
  m.lastX = inp.x;
  m.lastY = inp.y;
}

/** Kicks the body away from a blockage: `(dirX, dirY)` is the unit direction, `strength` 0..1. */
export function kickRecoil(m: DroneMotion, dirX: number, dirY: number, strength: number): void {
  const v = 11 * strength;
  m.rx.v += dirX * v;
  m.ry.v += dirY * v;
}
