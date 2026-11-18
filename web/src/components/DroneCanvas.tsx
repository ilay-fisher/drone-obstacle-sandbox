import { useEffect, useRef, useState } from 'react';
import type { Simulation } from '../engine/simulation';
import { installPerfProbe } from '../perf/perfProbe';
import { clampDt, effectiveDpr, shouldRun, type LoopVisibility } from '../render/loopControl';
import { readPalette, type Palette } from '../render/palette';
import type { Brush } from './ControlPanel';

interface Props {
  sim: Simulation;
  brush: Brush;
  showHeat: boolean;
  showLidar: boolean;
}

interface Hover { x: number; y: number; left: number; top: number; flip: boolean }

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** The frame-time probe; null (and free) unless the URL has `?perf=1`. */
const probe = installPerfProbe();

/** Builds the hatched wind tile once; reused as a canvas pattern for every wind cell. */
function makeWindPattern(ctx: CanvasRenderingContext2D, pal: Palette): CanvasPattern | null {
  const t = document.createElement('canvas');
  t.width = t.height = 8;
  const g = t.getContext('2d');
  if (!g) return null;
  g.fillStyle = pal.windFill;
  g.fillRect(0, 0, 8, 8);
  g.strokeStyle = pal.windStroke;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(-2, 10); g.lineTo(10, -2);
  g.moveTo(-2, 2); g.lineTo(2, -2);
  g.moveTo(6, 10); g.lineTo(10, 6);
  g.stroke();
  return ctx.createPattern(t, 'repeat');
}

/**
 * Renders the static ground (fill plus one faint dot per cell centre) into its own canvas.
 * It only changes on resize, so each frame is a single drawImage instead of 1440 arcs.
 */
function makeGroundLayer(w: number, h: number, cell: number, dpr: number, pal: Palette): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(w * cell * dpr);
  c.height = Math.round(h * cell * dpr);
  const g = c.getContext('2d');
  if (!g) return c;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = pal.ground;
  g.fillRect(0, 0, w * cell, h * cell);
  g.fillStyle = pal.dot;
  const r = Math.max(0.9, cell * 0.05);
  g.beginPath();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = (x + 0.5) * cell;
      const cy = (y + 0.5) * cell;
      g.moveTo(cx + r, cy);
      g.arc(cx, cy, r, 0, Math.PI * 2);
    }
  }
  g.fill();
  return c;
}

interface DrawOpts { showHeat: boolean; showLidar: boolean }

/** Everything `draw` needs that changes only on resize or mount. */
interface View {
  cell: number;
  dpr: number;
  pal: Palette;
  wind: CanvasPattern | null;
  ground: HTMLCanvasElement | null;
}

/** Draws one frame. Pure function of the simulation state; allocates nothing per call. */
function draw(ctx: CanvasRenderingContext2D, sim: Simulation, v: View, o: DrawOpts, now: number): void {
  const { width: w, height: h } = sim;
  const { cell, dpr, pal } = v;
  const grid = sim.planner.grid();
  // Cell edges snap to device pixels so adjacent walls and heat cells never show a seam.
  const snap = (c: number) => Math.round(c * cell * dpr) / dpr;

  if (v.ground) ctx.drawImage(v.ground, 0, 0, w * cell, h * cell);
  else { ctx.fillStyle = pal.ground; ctx.fillRect(0, 0, w * cell, h * cell); }

  if (o.showHeat) {
    const heat = sim.planner.heat();
    for (let i = 0; i < heat.length; i++) {
      if (heat[i] === 0) continue;
      const cx = i % w;
      const cy = (i / w) | 0;
      ctx.fillStyle = pal.heat[heat[i]];
      ctx.fillRect(snap(cx), snap(cy), snap(cx + 1) - snap(cx), snap(cy + 1) - snap(cy));
    }
  }

  for (let i = 0; i < grid.length; i++) {
    const val = grid[i];
    if (val === 0) continue;
    const cx = i % w;
    const cy = (i / w) | 0;
    ctx.fillStyle = val === 1 ? pal.wall : (v.wind ?? pal.windFill);
    ctx.fillRect(snap(cx), snap(cy), snap(cx + 1) - snap(cx), snap(cy + 1) - snap(cy));
  }

  // Patrols cover their stamped wall cell with a distinct marker and a heading tick.
  for (let i = 0; i < sim.patrolCount; i++) {
    const cx = (sim.patrolX[i] + 0.5) * cell;
    const cy = (sim.patrolY[i] + 0.5) * cell;
    ctx.fillStyle = pal.ground;
    ctx.fillRect(cx - cell / 2, cy - cell / 2, cell, cell);
    ctx.fillStyle = pal.patrol;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = pal.ground;
    ctx.lineWidth = Math.max(2, cell * 0.12);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + sim.patrolDX[i] * cell * 0.38, cy + sim.patrolDY[i] * cell * 0.38);
    ctx.stroke();
  }

  const dx = sim.droneX * cell;
  const dy = sim.droneY * cell;

  if (sim.pathLen > 1) {
    ctx.strokeStyle = pal.route;
    ctx.lineWidth = Math.max(2, cell * 0.12);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([cell * 0.4, cell * 0.3]);
    ctx.beginPath();
    ctx.moveTo(dx, dy);
    for (let i = sim.pathIdx + 1; i < sim.pathLen; i++) {
      const c = sim.path[i];
      ctx.lineTo(((c % w) + 0.5) * cell, (((c / w) | 0) + 0.5) * cell);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = 'butt';
  }

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

  const tx = (sim.goalX + 0.5) * cell;
  const ty = (sim.goalY + 0.5) * cell;
  ctx.strokeStyle = pal.goal;
  ctx.lineWidth = Math.max(2, cell * 0.1);
  ctx.beginPath();
  ctx.arc(tx, ty, cell * 0.42, 0, Math.PI * 2);
  ctx.moveTo(tx + cell * 0.2, ty);
  ctx.arc(tx, ty, cell * 0.2, 0, Math.PI * 2);
  ctx.stroke();

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

/**
 * Canvas view of the simulation. One requestAnimationFrame loop advances the simulation
 * and draws; React state is only used for the hover tooltip, never inside the loop.
 * The loop stops while the canvas is off screen or the tab is hidden and resumes without
 * a time jump. The canvas fills its box, which keeps the map's aspect ratio (see CSS).
 */
export function DroneCanvas({ sim, brush, showHeat, showLidar }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const opts = useRef({ brush, showHeat, showLidar });
  opts.current = { brush, showHeat, showLidar };
  const cellRef = useRef(16);
  const [hover, setHover] = useState<Hover | null>(null);
  const drag = useRef({ down: false, lx: -1, ly: -1, dir: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !wrap || !ctx) return;
    const pal = readPalette();
    const view: View = { cell: 16, dpr: 1, pal, wind: makeWindPattern(ctx, pal), ground: null };
    const resize = () => {
      const width = wrap.clientWidth;
      if (width <= 0) return;
      const dpr = effectiveDpr(window.devicePixelRatio);
      const cell = width / sim.width;
      view.cell = cell;
      view.dpr = dpr;
      cellRef.current = cell;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(cell * sim.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      view.ground = makeGroundLayer(sim.width, sim.height, cell, dpr, pal);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const vis: LoopVisibility = { onScreen: true, tabVisible: document.visibilityState !== 'hidden' };
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const t0 = probe ? performance.now() : 0;
      sim.tick(clampDt(last, now));
      draw(ctx, sim, view, opts.current, now);
      if (probe) probe.record(now - last, performance.now() - t0);
      last = now;
    };
    /** Starts or stops the loop to match visibility; on start the clock is rebased so no time is skipped. */
    const sync = () => {
      if (shouldRun(vis)) {
        if (raf) return;
        last = performance.now();
        probe?.resume();
        raf = requestAnimationFrame(frame);
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const onVisibility = () => { vis.tabVisible = document.visibilityState !== 'hidden'; sync(); };
    document.addEventListener('visibilitychange', onVisibility);
    const io = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          vis.onScreen = entries[entries.length - 1].isIntersecting;
          sync();
        })
      : null;
    io?.observe(wrap);
    sync();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sim]);

  const cellAt = (e: React.PointerEvent): { x: number; y: number } => {
    const r = canvasRef.current!.getBoundingClientRect();
    const cell = r.width / sim.width;
    return { x: Math.floor((e.clientX - r.left) / cell), y: Math.floor((e.clientY - r.top) / cell) };
  };

  const paint = (x: number, y: number, first: boolean) => {
    switch (opts.current.brush) {
      case 'wall': sim.editCell(x, y, 1); break;
      case 'wind': sim.editCell(x, y, 2); break;
      case 'erase': sim.erase(x, y); break;
      case 'target': sim.setGoal(x, y); break;
      case 'patrol':
        if (first) {
          const d = DIRS[drag.current.dir++ % DIRS.length];
          sim.addPatrol(x, y, d[0], d[1]);
        }
        break;
    }
  };

  const onDown = (e: React.PointerEvent) => {
    const { x, y } = cellAt(e);
    canvasRef.current!.setPointerCapture(e.pointerId);
    Object.assign(drag.current, { down: true, lx: x, ly: y });
    paint(x, y, true);
  };

  const onMove = (e: React.PointerEvent) => {
    const { x, y } = cellAt(e);
    const inside = x >= 0 && y >= 0 && x < sim.width && y < sim.height;
    if (!inside) { setHover(null); return; }
    // Near the right edge the tooltip flips to the left of the cell so it never widens the page.
    const flip = x > sim.width * 0.6;
    const left = flip ? x * cellRef.current - 8 : (x + 1) * cellRef.current + 8;
    setHover((p) => (p && p.x === x && p.y === y ? p : { x, y, left, top: y * cellRef.current, flip }));
    const d = drag.current;
    if (!d.down || (x === d.lx && y === d.ly)) return;
    // Interpolate between samples so fast drags leave no gaps.
    const n = Math.max(Math.abs(x - d.lx), Math.abs(y - d.ly));
    for (let i = 1; i <= n; i++) paint(Math.round(d.lx + ((x - d.lx) * i) / n), Math.round(d.ly + ((y - d.ly) * i) / n), false);
    d.lx = x; d.ly = y;
  };

  const cellCost = hover ? sim.planner.getCell(hover.x, hover.y) : 0;
  const costText = cellCost === 1 ? 'wall (impassable)' : cellCost === 2 ? 'cost 4.0 (wind)' : 'cost 1.0';

  return (
    <div className="canvas-box" ref={wrapRef} style={{ aspectRatio: `${sim.width} / ${sim.height}` }}>
      <canvas
        ref={canvasRef}
        className="sim-canvas"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => { drag.current.down = false; }}
        onPointerLeave={() => { drag.current.down = false; setHover(null); }}
      />
      {hover && (
        <div className="tooltip" style={{ left: hover.left, top: hover.top, transform: hover.flip ? 'translateX(-100%)' : undefined }}>
          ({hover.x}, {hover.y}) &middot; {costText}
        </div>
      )}
    </div>
  );
}
