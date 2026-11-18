/**
 * Pure maths for the rotary dials: value to needle angle, pointer to value, detent snapping
 * and keyboard steps. Kept free of React and the DOM so every rule is unit-tested; the Dial
 * component only feeds it pointer coordinates and renders the result.
 *
 * Angles are in degrees, 0 is straight up, positive is clockwise. The dial sweeps 270
 * degrees (-135 to +135) and leaves a dead gap at the bottom, like a hardware knob stop.
 */

/** Needle angle at the minimum detent. */
export const DIAL_MIN_ANGLE = -135;
/** Needle angle at the maximum detent. */
export const DIAL_MAX_ANGLE = 135;

/** The numeric range a dial covers; `step` is the spacing between detents. */
export interface DialRange {
  min: number;
  max: number;
  step: number;
}

/** Removes float noise such as 0.30000000000000004 so values compare and render cleanly. */
function clean(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/** Nearest detent to `v`, clamped to the range. NaN falls back to the minimum. */
export function snapToDetent(v: number, r: DialRange): number {
  if (!Number.isFinite(v)) return r.min;
  const steps = Math.round((v - r.min) / r.step);
  const last = Math.round((r.max - r.min) / r.step);
  return clean(r.min + Math.min(Math.max(steps, 0), last) * r.step);
}

/** Every detent from min to max inclusive, used to draw the rim ticks. */
export function detentValues(r: DialRange): number[] {
  const last = Math.round((r.max - r.min) / r.step);
  return Array.from({ length: last + 1 }, (_, i) => clean(r.min + i * r.step));
}

/** Needle angle for a value; out of range values clamp to the end stops. */
export function valueToAngle(v: number, r: DialRange): number {
  const t = (Math.min(Math.max(v, r.min), r.max) - r.min) / (r.max - r.min);
  return DIAL_MIN_ANGLE + t * (DIAL_MAX_ANGLE - DIAL_MIN_ANGLE);
}

/**
 * Snapped value for a pointer angle. Angles inside the dead gap clamp to the nearer end
 * stop (the gap is symmetric about straight down, so the sign of the angle decides).
 */
export function angleToValue(angle: number, r: DialRange): number {
  const a = Math.min(Math.max(angle, DIAL_MIN_ANGLE), DIAL_MAX_ANGLE);
  const t = (a - DIAL_MIN_ANGLE) / (DIAL_MAX_ANGLE - DIAL_MIN_ANGLE);
  return snapToDetent(r.min + t * (r.max - r.min), r);
}

/** Angle of the pointer around the dial centre, clockwise from straight up, in (-180, 180]. */
export function pointerAngle(cx: number, cy: number, x: number, y: number): number {
  return (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI;
}

/**
 * How a drag that started `dist` pixels from the centre is interpreted. On the rim the
 * pointer turns the knob; on the centre cap it behaves like a vertical fader, which is
 * easier on touch and for fine control. The cut is 45% of the radius.
 */
export function dragMode(dist: number, radius: number): 'circular' | 'vertical' {
  return dist > radius * 0.45 ? 'circular' : 'vertical';
}

/**
 * Value after a vertical drag of `dyPx` (positive is down) from `startValue`. Dragging up
 * raises it, and `pxPerRange` pixels of travel cover the whole range.
 */
export function verticalDragValue(startValue: number, dyPx: number, r: DialRange, pxPerRange = 140): number {
  return snapToDetent(startValue - (dyPx / pxPerRange) * (r.max - r.min), r);
}

/** One detent up or down, clamped; backs the `[` and `]` shortcuts. */
export function stepValue(v: number, r: DialRange, dir: 1 | -1): number {
  return snapToDetent(v + dir * r.step, r);
}

/**
 * Keyboard behaviour of a slider: arrows move one detent, Page keys two, Home and End jump
 * to the stops. Returns null for any other key so the caller can leave it alone.
 */
export function keyToValue(key: string, v: number, r: DialRange): number | null {
  switch (key) {
    case 'ArrowUp':
    case 'ArrowRight': return snapToDetent(v + r.step, r);
    case 'ArrowDown':
    case 'ArrowLeft': return snapToDetent(v - r.step, r);
    case 'PageUp': return snapToDetent(v + 2 * r.step, r);
    case 'PageDown': return snapToDetent(v - 2 * r.step, r);
    case 'Home': return r.min;
    case 'End': return r.max;
    default: return null;
  }
}
