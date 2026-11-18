/**
 * Pure helpers for the mechanical counters: which digits to show and which numbers a wheel
 * passes through when it rolls. A real odometer wheel only turns one way, so a digit going
 * from 8 to 1 rolls 8, 9, 0, 1 and never back through 7 to 2.
 */

/** One wheel: its digit and whether it is a significant digit (leading zeros are unlit). */
export interface WheelDigit {
  digit: number;
  lit: boolean;
}

/** Digits of a non-negative integer, left padded with unlit zeros to at least `minWidth`. */
export function digitsOf(value: number, minWidth: number): WheelDigit[] {
  const n = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  const text = String(n).padStart(Math.max(minWidth, 1), '0');
  const significant = String(n).length;
  return Array.from(text, (ch, i) => ({ digit: Number(ch), lit: i >= text.length - significant }));
}

/** How many detents a wheel turns forward from `from` to `to`, 0 to 9. */
export function rollSteps(from: number, to: number): number {
  return (((to - from) % 10) + 10) % 10;
}

/** The digits a wheel passes on its way, both ends included; a single entry when it stays. */
export function rollPath(from: number, to: number): number[] {
  const steps = rollSteps(from, to);
  return Array.from({ length: steps + 1 }, (_, i) => (from + i) % 10);
}
