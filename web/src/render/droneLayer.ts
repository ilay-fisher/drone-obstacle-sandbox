/**
 * DRAW SLOT: drone layer (redesign PR 4 replaces this file).
 *
 * Today this is the original simple drawing, moved as-is with palette colours: the LiDAR
 * disc with its sweep wedge, then the arrow-shaped drone. The renderer calls `drawDroneLayer`
 * last in the frame, above terrain, patrols, goal and route, with the canvas transform
 * already scaled to CSS px. It must not allocate.
 */
import type { Simulation } from '../engine/simulation';
import type { DrawOpts, RenderView } from './renderTypes';

/** LiDAR and drone. `now` is the frame timestamp in ms. */
export function drawDroneLayer(ctx: CanvasRenderingContext2D, sim: Simulation, v: RenderView, o: DrawOpts, now: number): void {
  const { cell, pal } = v;
  const dx = sim.droneX * cell;
  const dy = sim.droneY * cell;

  if (o.showLidar) {
    const r = sim.lidarRadius * cell;
    const a = (now / 1000) * 2.4;
    ctx.fillStyle = pal.lidarFill;
    ctx.beginPath();
    ctx.arc(dx, dy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = pal.lidarEdge;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = pal.lidarSweep;
    ctx.beginPath();
    ctx.moveTo(dx, dy);
    ctx.arc(dx, dy, r, a - 0.7, a);
    ctx.closePath();
    ctx.fill();
  }

  ctx.save();
  ctx.translate(dx, dy);
  ctx.rotate(sim.heading);
  ctx.fillStyle = pal.drone;
  ctx.beginPath();
  ctx.moveTo(cell * 0.5, 0);
  ctx.lineTo(-cell * 0.4, cell * 0.36);
  ctx.lineTo(-cell * 0.2, 0);
  ctx.lineTo(-cell * 0.4, -cell * 0.36);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = pal.nav;
  ctx.beginPath();
  ctx.arc(cell * 0.16, 0, cell * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
