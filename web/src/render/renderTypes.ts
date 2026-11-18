/**
 * Types shared by the layered renderer and its draw slots. The search layer (`searchLayer.ts`)
 * and the drone layer (`droneLayer.ts`) are drawn through exactly these arguments, so a slot
 * can be replaced without touching the renderer.
 */
import type { Palette } from './palette';

/** Overlay switches from the control panel. */
export interface DrawOpts {
  showHeat: boolean;
  showLidar: boolean;
  /** While true the search layer plays no replan events (the intro is still painting the city). */
  quiet?: boolean;
  /** While true the search layer adopts new plans silently: the route follows, but no flood, glow or chip plays (the intro's quiet D* Lite plan). */
  calm?: boolean;
}

/** Everything a slot needs to know about the canvas: sizes in CSS px, the DPR and the palette. */
export interface RenderView {
  /** Map size in cells. */
  w: number;
  h: number;
  /** CSS px per cell (not an integer). */
  cell: number;
  /** Backing-store scale, already capped at 2. */
  dpr: number;
  pal: Palette;
  /** True when the user asked for reduced motion: slots must draw their finished states. */
  reduced: boolean;
}

/** Cell edge snapped to a device pixel, so neighbouring flat cells never show a seam. */
export function snapCell(v: RenderView, c: number): number {
  return Math.round(c * v.cell * v.dpr) / v.dpr;
}
