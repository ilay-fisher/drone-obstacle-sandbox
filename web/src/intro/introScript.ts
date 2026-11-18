/**
 * The guided intro as data: four captions on a timeline, a short outro, and the cues the
 * scripted run fires (see `introRunner.ts`). Everything here is a pure function of time, so
 * the pill, the runner and the tests agree on one clock. Times are milliseconds from the
 * start of the intro.
 *
 *   0      1  "This is a city."          the city is painted in, quiet (no search events)
 *   2400   2  "It plans a route with A*" the A* wavefront plays, the route draws, the drone sets off
 *   5000   3  "Something blocks the way" a wall appears on the route; LiDAR catches it; A* replans
 *   7400   4  "It repairs only what ..." D* Lite takes over, then a second wall is repaired
 *   10400     outro: "Your turn" (the console lights up, the run stays paused mid-flight)
 *
 * Replans are spaced a full replan sequence apart (`replanTimeline.TOTAL_MS`), so the
 * intro never plays two search floods on top of each other: one loud motion at a time.
 */

export interface IntroStep {
  id: 1 | 2 | 3 | 4;
  caption: string;
  startMs: number;
  endMs: number;
}

export const INTRO_STEPS: readonly IntroStep[] = [
  { id: 1, caption: 'This is a city. The drone has to cross it.', startMs: 0, endMs: 2400 },
  { id: 2, caption: 'It plans a route with A*.', startMs: 2400, endMs: 5000 },
  { id: 3, caption: 'Something blocks the way.', startMs: 5000, endMs: 7400 },
  { id: 4, caption: 'It repairs only what changed with D* Lite.', startMs: 7400, endMs: 10400 },
];

export const OUTRO_CAPTION = 'Your turn: draw a wall in its path.';
/** End of the four guided steps. */
export const STEPS_MS = 10400;
/** How long the "Your turn" prompt stays after the console lights up. */
export const OUTRO_MS = 6000;
export const TOTAL_MS = STEPS_MS + OUTRO_MS;

/** When the scripted run does what. */
export const CUES = {
  /** The city starts to be painted in, building by building. */
  paintStart: 0,
  /** Painting spreads over this long (each wall then settles on its own spring). */
  paintMs: 1700,
  /** The finished city is loaded: this plans the first route, so the A* wavefront plays. */
  loadCity: 2400,
  /** The drone sets off once the route has drawn. */
  play: 3700,
  /** The first wall appears on the route ahead of the drone. */
  block1: 5200,
  /** The planner switches to D* Lite (a first D* call searches from scratch). */
  dstar: 7600,
  /** The second wall appears; D* Lite repairs only the cells that changed. */
  block2: 8800,
} as const;

export type IntroPhase = 'steps' | 'outro' | 'done';

const clampT = (t: number): number => (Number.isFinite(t) ? Math.max(0, t) : 0);

/** Index (0 to 3) of the step in force at `t`; a boundary belongs to the next step. -1 once the steps are over. */
export function stepIndexAt(t: number): number {
  const x = clampT(t);
  if (x >= STEPS_MS) return -1;
  for (let i = INTRO_STEPS.length - 1; i >= 0; i--) if (x >= INTRO_STEPS[i].startMs) return i;
  return 0;
}

/** The step in force at `t`, or null once the steps are over. */
export function stepAt(t: number): IntroStep | null {
  const i = stepIndexAt(t);
  return i < 0 ? null : INTRO_STEPS[i];
}

export function phaseAt(t: number): IntroPhase {
  const x = clampT(t);
  if (x < STEPS_MS) return 'steps';
  return x < TOTAL_MS ? 'outro' : 'done';
}

/** The words the caption pill shows at `t`; null when the intro is over. */
export function captionAt(t: number): string | null {
  const step = stepAt(t);
  if (step) return step.caption;
  return phaseAt(t) === 'outro' ? OUTRO_CAPTION : null;
}
