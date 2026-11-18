/**
 * How the two planners' glows are composited. A* is a dim paper-white wash and may add up
 * (`lighter`): many faint sprites only brighten a little. The D* Lite ember must not: a
 * hundred overlapping orange sprites added together run through yellow to white, so the ember
 * is laid down with ordinary alpha (it saturates at the sprite colour, a deep orange) and the
 * resting glow is capped well below full opacity.
 */
export type GlowMode = 'astar' | 'dstar';

export const GLOW_COMPOSITE: Record<GlowMode, GlobalCompositeOperation> = {
  astar: 'lighter',
  dstar: 'source-over',
};

/** Opacity cap for the whole accumulated resting glow. */
export const REST_GLOW_CAP: Record<GlowMode, number> = { astar: 1, dstar: 0.5 };

/** Share of the way from deep ember to signal orange used for the D* resting sprite (kept deep). */
export const DSTAR_REST_MIX = 0.3;
