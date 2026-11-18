import { useEffect, useRef, useState } from 'react';
import type { Simulation } from '../engine/simulation';
import type { Brush } from './ControlPanel';

interface Props {
  sim: Simulation;
  brush: Brush;
  showHeat: boolean;
  showLidar: boolean;
}

interface Hover { x: number; y: number; left: number; top: number }

const COL = {
  bg: '#0b1020', grid: 'rgba(148,163,184,0.10)', wall: '#334155', wallEdge: '#475569',
  path: 'rgba(52,211,153,0.9)', drone: '#f8fafc', target: '#34d399', patrol: '#fb7185',
  lidarFill: 'rgba(34,211,238,0.06)', lidarSweep: 'rgba(34,211,238,0.20)', lidarEdge: 'rgba(34,211,238,0.55)',
};
/** Heat colours are precomputed once; the render loop never builds style strings. */
const HEAT_STYLES: string[] = Array.from({ length: 256 }, (_, i) =>
  `rgba(168,85,247,${(0.12 + 0.5 * Math.min(1, i / 6)).toFixed(3)})`);
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** Builds the hatched amber tile once; reused as a canvas pattern for every wind cell. */
function makeWindPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const t = document.createElement('canvas');
  t.width = t.height = 8;
  const g = t.getContext('2d');
  if (!g) return null;
  g.fillStyle = 'rgba(245,158,11,0.16)';
  g.fillRect(0, 0, 8, 8);
  g.strokeStyle = 'rgba(245,158,11,0.85)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(-2, 10); g.lineTo(10, -2);
  g.moveTo(-2, 2); g.lineTo(2, -2);
  g.moveTo(6, 10); g.lineTo(10, 6);
  g.stroke();
  return ctx.createPattern(t, 'repeat');
}

interface DrawOpts { showHeat: boolean; showLidar: boolean }

/** Draws one frame. Pure function of the simulation state; allocates nothing per call. */
function draw(ctx: CanvasRenderingContext2D, sim: Simulation, cell: number, o: DrawOpts, wind: CanvasPattern | null, now: number): void {
  const { width: w, height: h } = sim;
  const grid = sim.planner.grid();
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, w * cell, h * cell);

  ctx.strokeStyle = COL.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= w; x++) { ctx.moveTo(x * cell + 0.5, 0); ctx.lineTo(x * cell + 0.5, h * cell); }
  for (let y = 0; y <= h; y++) { ctx.moveTo(0, y * cell + 0.5); ctx.lineTo(w * cell, y * cell + 0.5); }
  ctx.stroke();

  if (o.showHeat) {
    const heat = sim.planner.heat();
    for (let i = 0; i < heat.length; i++) {
      if (heat[i] === 0) continue;
      ctx.fillStyle = HEAT_STYLES[heat[i]];
      ctx.fillRect((i % w) * cell, ((i / w) | 0) * cell, cell, cell);
    }
  }

  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (v === 0) continue;
    const x = (i % w) * cell;
    const y = ((i / w) | 0) * cell;
    if (v === 1) {
      ctx.fillStyle = COL.wall;
      ctx.fillRect(x + 1, y + 1, cell - 1, cell - 1);
    } else if (wind) {
      ctx.fillStyle = wind;
      ctx.fillRect(x + 1, y + 1, cell - 1, cell - 1);
    }
  }

  // Patrols cover their stamped wall cell with a distinct marker and a heading tick.
  for (let i = 0; i < sim.patrolCount; i++) {
    const cx = (sim.patrolX[i] + 0.5) * cell;
    const cy = (sim.patrolY[i] + 0.5) * cell;
    ctx.fillStyle = COL.bg;
    ctx.fillRect(cx - cell / 2 + 1, cy - cell / 2 + 1, cell - 1, cell - 1);
    ctx.fillStyle = COL.patrol;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COL.bg;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + sim.patrolDX[i] * cell * 0.38, cy + sim.patrolDY[i] * cell * 0.38);
    ctx.stroke();
  }

  const dx = sim.droneX * cell;
  const dy = sim.droneY * cell;

  if (sim.pathLen > 1) {
    ctx.strokeStyle = COL.path;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(dx, dy);
    for (let i = sim.pathIdx + 1; i < sim.pathLen; i++) {
      const c = sim.path[i];
      ctx.lineTo(((c % w) + 0.5) * cell, (((c / w) | 0) + 0.5) * cell);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (o.showLidar) {
    const r = sim.lidarRadius * cell;
    const a = (now / 1000) * 2.4;
    ctx.fillStyle = COL.lidarFill;
    ctx.strokeStyle = COL.lidarEdge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(dx, dy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COL.lidarSweep;
    ctx.beginPath();
    ctx.moveTo(dx, dy);
    ctx.arc(dx, dy, r, a - 0.7, a);
    ctx.closePath();
    ctx.fill();
  }

  const tx = (sim.goalX + 0.5) * cell;
  const ty = (sim.goalY + 0.5) * cell;
  ctx.strokeStyle = COL.target;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(tx, ty, cell * 0.42, 0, Math.PI * 2);
  ctx.moveTo(tx + cell * 0.2, ty);
  ctx.arc(tx, ty, cell * 0.2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.save();
  ctx.translate(dx, dy);
  ctx.rotate(sim.heading);
  ctx.fillStyle = COL.drone;
  ctx.beginPath();
  ctx.moveTo(cell * 0.5, 0);
  ctx.lineTo(-cell * 0.4, cell * 0.36);
  ctx.lineTo(-cell * 0.2, 0);
  ctx.lineTo(-cell * 0.4, -cell * 0.36);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Canvas view of the simulation. One requestAnimationFrame loop advances the simulation
 * and draws; React state is only used for the hover tooltip, never inside the loop.
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
    const wind = makeWindPattern(ctx);
    const resize = () => {
      const cell = Math.max(8, Math.floor(Math.min(wrap.clientWidth / sim.width, wrap.clientHeight / sim.height)));
      const dpr = window.devicePixelRatio || 1;
      cellRef.current = cell;
      canvas.style.width = `${cell * sim.width}px`;
      canvas.style.height = `${cell * sim.height}px`;
      canvas.width = cell * sim.width * dpr;
      canvas.height = cell * sim.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      sim.tick(Math.min(0.05, (now - last) / 1000));
      last = now;
      draw(ctx, sim, cellRef.current, opts.current, wind, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [sim]);

  const cellAt = (e: React.PointerEvent): { x: number; y: number } => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: Math.floor((e.clientX - r.left) / cellRef.current), y: Math.floor((e.clientY - r.top) / cellRef.current) };
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
    setHover((p) => (p && p.x === x && p.y === y ? p : { x, y, left: (x + 1) * cellRef.current + 8, top: y * cellRef.current }));
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
    <div className="canvas-wrap" ref={wrapRef}>
      <div className="canvas-box">
        <canvas
          ref={canvasRef}
          className="sim-canvas"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={() => { drag.current.down = false; }}
          onPointerLeave={() => { drag.current.down = false; setHover(null); }}
        />
        {hover && (
          <div className="tooltip" style={{ left: hover.left, top: hover.top }}>
            ({hover.x}, {hover.y}) &middot; {costText}
          </div>
        )}
      </div>
    </div>
  );
}
