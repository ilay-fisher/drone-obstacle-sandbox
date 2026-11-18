/**
 * DRAW SLOT: search layer (redesign PR 3 replaces this file).
 *
 * Today this is the original simple drawing, moved as-is with palette colours: a flat heat
 * fill for visited cells and the dashed route. The renderer calls the two functions at fixed
 * points in the frame; keep these signatures and PR 3 can swap the bodies freely.
 *
 * - `drawSearchUnder` runs after the ground and wind and BEFORE the buildings, so a glow
 *   spreads across open ground and the buildings stand on top of it.
 * - `drawSearchOver` runs after the buildings, patrols and goal, BEFORE the drone layer.
 *
 * Both are called with the canvas transform already scaled to CSS px. They must not allocate.
 */
import type { Simulation } from '../engine/simulation';
import type { DrawOpts, RenderView } from './renderTypes';
import { snapCell } from './renderTypes';

/** Heat of visited cells. */
export function drawSearchUnder(ctx: CanvasRenderingContext2D, sim: Simulation, v: RenderView, o: DrawOpts, _now: number): void {
  if (!o.showHeat) return;
  const w = v.w;
  const heat = sim.planner.heat();
  for (let i = 0; i < heat.length; i++) {
    if (heat[i] === 0) continue;
    const cx = i % w;
    const cy = (i / w) | 0;
    ctx.fillStyle = v.pal.heat[heat[i]];
    ctx.fillRect(snapCell(v, cx), snapCell(v, cy), snapCell(v, cx + 1) - snapCell(v, cx), snapCell(v, cy + 1) - snapCell(v, cy));
  }
}

/** The planned route, dashed, from the drone to the goal. */
export function drawSearchOver(ctx: CanvasRenderingContext2D, sim: Simulation, v: RenderView, _o: DrawOpts, _now: number): void {
  if (sim.pathLen <= 1) return;
  const { w, cell } = v;
  ctx.strokeStyle = v.pal.route;
  ctx.lineWidth = Math.max(2, cell * 0.12);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([cell * 0.4, cell * 0.3]);
  ctx.beginPath();
  ctx.moveTo(sim.droneX * cell, sim.droneY * cell);
  for (let i = sim.pathIdx + 1; i < sim.pathLen; i++) {
    const c = sim.path[i];
    ctx.lineTo(((c % w) + 0.5) * cell, (((c / w) | 0) + 0.5) * cell);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineCap = 'butt';
}
