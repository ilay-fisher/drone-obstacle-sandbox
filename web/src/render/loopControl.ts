/**
 * Pure decisions for the canvas render loop. Kept out of the component so the rules for
 * "when do we burn CPU" can be unit tested without a browser.
 */

/** Longest simulated step per frame, in seconds. Also what a resume after a pause may advance. */
export const MAX_FRAME_DT = 0.05;

/** Highest device pixel ratio the canvas backing store uses; beyond 2 the cost grows with no visible gain. */
export const MAX_DPR = 2;

/** What the loop needs to know to decide whether to run. */
export interface LoopVisibility {
  /** The canvas intersects the viewport (IntersectionObserver). */
  onScreen: boolean;
  /** The tab is visible (`document.visibilityState === 'visible'`). */
  tabVisible: boolean;
}

/** The loop runs only while someone could see it; otherwise it stops requesting frames. */
export function shouldRun(v: LoopVisibility): boolean {
  return v.onScreen && v.tabVisible;
}

/**
 * Seconds to advance the simulation for a frame at `now` after the previous one at `last`
 * (both milliseconds). Clamped to `MAX_FRAME_DT` so resuming after a hidden tab or an
 * off-screen pause continues from where it was instead of jumping ahead. Never negative.
 */
export function clampDt(last: number, now: number): number {
  const dt = (now - last) / 1000;
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  return Math.min(MAX_FRAME_DT, dt);
}

/** Device pixel ratio to render at: the real one, capped at `MAX_DPR`, and 1 if unknown. */
export function effectiveDpr(raw: number | undefined): number {
  if (!raw || !Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(MAX_DPR, raw);
}
