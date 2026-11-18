import { describe, expect, it } from 'vitest';
import {
  DIAL_MAX_ANGLE, DIAL_MIN_ANGLE, angleToValue, detentValues, dragMode, keyToValue, pointerAngle,
  snapToDetent, stepValue, valueToAngle, verticalDragValue, type DialRange,
} from './dialMath';

const SPEED: DialRange = { min: 0.5, max: 4, step: 0.5 };
const RADIUS: DialRange = { min: 3, max: 8, step: 1 };

describe('detents', () => {
  it('lists every detent from min to max', () => {
    expect(detentValues(SPEED)).toEqual([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
    expect(detentValues(RADIUS)).toEqual([3, 4, 5, 6, 7, 8]);
  });
  it('snaps to the nearest detent and clamps', () => {
    expect(snapToDetent(1.2, SPEED)).toBe(1);
    expect(snapToDetent(1.3, SPEED)).toBe(1.5);
    expect(snapToDetent(-5, SPEED)).toBe(0.5);
    expect(snapToDetent(99, RADIUS)).toBe(8);
    expect(snapToDetent(Number.NaN, RADIUS)).toBe(3);
  });
  it('never leaks float noise into the value', () => {
    expect(snapToDetent(0.1 + 0.2 + 0.2, { min: 0, max: 1, step: 0.1 })).toBe(0.5);
  });
});

describe('angle mapping', () => {
  it('maps min and max to the ends of the 270 degree sweep, 0 degrees is straight up', () => {
    expect(valueToAngle(0.5, SPEED)).toBe(DIAL_MIN_ANGLE);
    expect(valueToAngle(4, SPEED)).toBe(DIAL_MAX_ANGLE);
    expect(valueToAngle(3, RADIUS)).toBe(DIAL_MIN_ANGLE);
    expect(valueToAngle(8, RADIUS)).toBe(DIAL_MAX_ANGLE);
    expect(valueToAngle(2.25, SPEED)).toBeCloseTo(0, 6);
  });
  it('is linear in between and clamps out of range input', () => {
    expect(valueToAngle(5.5, RADIUS)).toBeCloseTo(0, 6);
    expect(valueToAngle(100, RADIUS)).toBe(DIAL_MAX_ANGLE);
    expect(valueToAngle(-100, RADIUS)).toBe(DIAL_MIN_ANGLE);
  });
  it('inverts: angle to snapped value', () => {
    for (const v of detentValues(SPEED)) expect(angleToValue(valueToAngle(v, SPEED), SPEED)).toBe(v);
    for (const v of detentValues(RADIUS)) expect(angleToValue(valueToAngle(v, RADIUS), RADIUS)).toBe(v);
  });
  it('snaps an angle between two detents to the nearer one', () => {
    const a = valueToAngle(5, RADIUS);
    const b = valueToAngle(6, RADIUS);
    expect(angleToValue(a + (b - a) * 0.4, RADIUS)).toBe(5);
    expect(angleToValue(a + (b - a) * 0.6, RADIUS)).toBe(6);
  });
  it('clamps angles inside the dead gap at the bottom to the nearer end stop', () => {
    expect(angleToValue(170, RADIUS)).toBe(8);
    expect(angleToValue(-170, RADIUS)).toBe(3);
    expect(angleToValue(180, SPEED)).toBe(4);
  });
});

describe('pointer geometry', () => {
  it('measures clockwise from straight up', () => {
    expect(pointerAngle(0, 0, 0, -10)).toBeCloseTo(0, 6);
    expect(pointerAngle(0, 0, 10, 0)).toBeCloseTo(90, 6);
    expect(pointerAngle(0, 0, -10, 0)).toBeCloseTo(-90, 6);
    expect(Math.abs(pointerAngle(0, 0, 0, 10))).toBeCloseTo(180, 6);
  });
  it('turns on the rim and drags vertically from the centre cap', () => {
    expect(dragMode(30, 40)).toBe('circular');
    expect(dragMode(5, 40)).toBe('vertical');
  });
  it('vertical drag: up raises, down lowers, the full range spans the drag length', () => {
    expect(verticalDragValue(2, -40, SPEED, 140)).toBe(3);
    expect(verticalDragValue(2, 40, SPEED, 140)).toBe(1);
    expect(verticalDragValue(2, -9999, SPEED, 140)).toBe(4);
    expect(verticalDragValue(2, 9999, SPEED, 140)).toBe(0.5);
    expect(verticalDragValue(2, 0, SPEED, 140)).toBe(2);
  });
});

describe('keyboard', () => {
  it('arrows move one detent', () => {
    expect(keyToValue('ArrowUp', 2, SPEED)).toBe(2.5);
    expect(keyToValue('ArrowRight', 2, SPEED)).toBe(2.5);
    expect(keyToValue('ArrowDown', 2, SPEED)).toBe(1.5);
    expect(keyToValue('ArrowLeft', 2, SPEED)).toBe(1.5);
  });
  it('page keys move two detents, home and end jump to the stops', () => {
    expect(keyToValue('PageUp', 4, RADIUS)).toBe(6);
    expect(keyToValue('PageDown', 4, RADIUS)).toBe(3);
    expect(keyToValue('Home', 6, RADIUS)).toBe(3);
    expect(keyToValue('End', 6, RADIUS)).toBe(8);
  });
  it('clamps at the stops and ignores other keys', () => {
    expect(keyToValue('ArrowUp', 8, RADIUS)).toBe(8);
    expect(keyToValue('ArrowDown', 3, RADIUS)).toBe(3);
    expect(keyToValue('a', 3, RADIUS)).toBeNull();
  });
  it('stepValue backs the [ and ] shortcuts', () => {
    expect(stepValue(1, SPEED, 1)).toBe(1.5);
    expect(stepValue(1, SPEED, -1)).toBe(0.5);
    expect(stepValue(4, SPEED, 1)).toBe(4);
    expect(stepValue(0.5, SPEED, -1)).toBe(0.5);
  });
});
