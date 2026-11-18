/**
 * Spring physics for the whole UI. One module owns the maths so CSS easings, canvas tweens
 * and any future dial or keycap all feel like the same material: things have mass,
 * overshoot a little and settle. Pure TypeScript apart from `prefersReducedMotion` and the
 * default scheduler used by `tween`, both of which tolerate a missing DOM.
 *
 * The same two springs are baked into `styles/tokens.css` as `linear()` easings, and a test
 * regenerates them from here, so a change to a constant cannot drift away from the CSS.
 */

/** A spring: `stiffness` pulls toward the target, `damping` bleeds energy, mass is 1. */
export interface SpringConfig {
  stiffness: number;
  damping: number;
}

/** Position and velocity of one animated number. */
export interface SpringState {
  x: number;
  v: number;
}

/** Soft spring: entrances and anything large and slow. About 7% overshoot, settles in about 880 ms. */
export const SPRING_SOFT: SpringConfig = { stiffness: 90, damping: 12 };
/** Snappy spring: presses and anything the pointer drives. About 6% overshoot, settles in about 350 ms. */
export const SPRING_SNAPPY: SpringConfig = { stiffness: 520, damping: 30 };

/** Longest single step the integrator accepts; a restored tab must not explode the state. */
const MAX_DT = 1 / 30;
/** Integration sub-step. Small enough that semi-implicit Euler stays accurate for stiff springs. */
const SUBSTEP = 1 / 120;

/** Damping ratio: below 1 the spring overshoots, at 1 it is critically damped. */
export function dampingRatio(cfg: SpringConfig): number {
  return cfg.damping / (2 * Math.sqrt(cfg.stiffness));
}

/**
 * Advances a spring by `dtSec` (clamped to 1/30 s) in small sub-steps. Returns the very same
 * object when already at rest on the target, so callers can skip work with an identity check.
 */
export function springStep(s: SpringState, target: number, dtSec: number, cfg: SpringConfig): SpringState {
  if (s.x === target && s.v === 0) return s;
  let dt = Math.min(Math.max(dtSec, 0), MAX_DT);
  let { x, v } = s;
  while (dt > 0) {
    const h = Math.min(dt, SUBSTEP);
    v += (-cfg.stiffness * (x - target) - cfg.damping * v) * h;
    x += v * h;
    dt -= h;
  }
  return { x, v };
}

/** True when the spring is close enough to its target, and slow enough, to stop simulating it. */
export function isAtRest(s: SpringState, target: number, epsilon = 0.01): boolean {
  return Math.abs(s.x - target) < epsilon && Math.abs(s.v) < epsilon;
}

/** Seconds until the oscillation envelope drops under 0.5%: the duration a tween should run. */
export function settleTime(cfg: SpringConfig): number {
  const omega = Math.sqrt(cfg.stiffness);
  return Math.log(200) / (Math.min(dampingRatio(cfg), 1) * omega);
}

/** Closed-form unit step response at `t` seconds: 0 at t=0, above 1 while overshooting, 1 at rest. */
export function stepResponse(cfg: SpringConfig, t: number): number {
  const omega = Math.sqrt(cfg.stiffness);
  const zeta = dampingRatio(cfg);
  if (zeta >= 1) return 1 - Math.exp(-omega * t) * (1 + omega * t);
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-zeta * omega * t);
  return 1 - decay * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
}

/**
 * Easing function (progress in, progress out) that follows the spring's step response
 * stretched over `settleTime(cfg)`. Clamps to exactly 0 and 1 outside the range, and maps
 * NaN to 0, so it is safe to feed raw timer maths.
 */
export function springEase(cfg: SpringConfig): (p: number) => number {
  const total = settleTime(cfg);
  return (p) => {
    if (!Number.isFinite(p) || p <= 0) return 0;
    if (p >= 1) return 1;
    return stepResponse(cfg, p * total);
  };
}

/**
 * A CSS `linear()` easing sampled from the spring, so plain CSS transitions get real
 * overshoot. The `points` samples are evenly spaced in time; the first is 0, the last is 1.
 * This is the generator for `--spring-soft` and `--spring-snappy` in tokens.css.
 */
export function springToLinear(cfg: SpringConfig, points = 28): string {
  const ease = springEase(cfg);
  const values = Array.from({ length: points }, (_, i) => Number(ease(i / (points - 1)).toFixed(3)));
  return `linear(${values.join(', ')})`;
}

/** True when the user asked the OS to reduce motion. False without a DOM. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Injection points for `tween`, so tests can drive it with a manual clock. */
export interface TweenEnv {
  now: () => number;
  schedule: (cb: (now: number) => void) => number;
  cancel: (handle: number) => void;
  reduced: boolean;
}

function defaultEnv(): TweenEnv {
  return {
    now: () => performance.now(),
    schedule: (cb) => requestAnimationFrame(cb),
    cancel: (h) => cancelAnimationFrame(h),
    reduced: prefersReducedMotion(),
  };
}

/**
 * Animates a number from `from` to `to` along the spring's step response and calls
 * `onUpdate` each frame; the last call is always exactly `to`. Under reduced motion the
 * value jumps straight to `to` in one synchronous call. Returns a function that cancels it.
 */
export function tween(
  from: number,
  to: number,
  cfg: SpringConfig,
  onUpdate: (value: number) => void,
  env: Partial<TweenEnv> = {},
): () => void {
  const e = { ...defaultEnv(), ...env };
  if (e.reduced || from === to) {
    onUpdate(to);
    return () => {};
  }
  const durMs = settleTime(cfg) * 1000;
  const t0 = e.now();
  let handle = 0;
  let stopped = false;
  const frame = (now: number) => {
    if (stopped) return;
    const elapsed = now - t0;
    if (elapsed >= durMs) {
      onUpdate(to);
      return;
    }
    onUpdate(from + (to - from) * stepResponse(cfg, elapsed / 1000));
    handle = e.schedule(frame);
  };
  handle = e.schedule(frame);
  return () => { stopped = true; e.cancel(handle); };
}
