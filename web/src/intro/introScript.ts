/**
 * The guided intro as data: four captions, a short outro, and the painting window. WHEN each
 * thing happens is not decided here by a clock: `introSequence.ts` fires the scripted cues
 * from planner events (a wall waits for the previous replan to finish playing), so the steps
 * advance when the planner has really answered and a slow machine can never stack two floods.
 *
 *   1  "This is a city."          the city is painted in, quiet (no search events)
 *   2  "It plans a route with A*" the A* wavefront plays, the route draws, the drone sets off
 *   3  "Something blocks the way" a wall appears on the route; LiDAR catches it; A* replans
 *   4  "It repairs only what ..." D* Lite plans once, quietly; a second wall is then repaired,
 *                                 and the only flood on screen is that incremental repair
 *   outro: "Your turn" (the console lights up, the run stays paused mid-flight)
 *
 * About ten seconds on a normal machine.
 */

export interface IntroStep {
  id: 1 | 2 | 3 | 4;
  caption: string;
}

export const INTRO_STEPS: readonly IntroStep[] = [
  { id: 1, caption: 'This is a city. The drone has to cross it.' },
  { id: 2, caption: 'It plans a route with A*.' },
  { id: 3, caption: 'Something blocks the way.' },
  { id: 4, caption: 'It repairs only what changed with D* Lite.' },
];

export const OUTRO_CAPTION = 'Your turn: draw a wall in its path.';
/** About how long the four guided steps take on a normal machine (the sequencer decides the real end). */
export const STEPS_MS = 10400;
/** How long the "Your turn" prompt stays after the console lights up. */
export const OUTRO_MS = 6000;
export const TOTAL_MS = STEPS_MS + OUTRO_MS;

/** Painting the city in (step 1). */
export const CUES = {
  /** The city starts to be painted in, building by building. */
  paintStart: 0,
  /** Painting spreads over this long (each wall then settles on its own spring). */
  paintMs: 1700,
} as const;
