import { useEffect, useRef, useState } from 'react';
import type { Simulation } from '../engine/simulation';
import { installPerfProbe } from '../perf/perfProbe';
import { clampDt, effectiveDpr, shouldRun, type LoopVisibility } from '../render/loopControl';
import { prefersReducedMotion } from '../motion/spring';
import { readPalette } from '../render/palette';
import { Renderer } from '../render/renderer';
import type { Brush } from './ControlPanel';

interface Props {
  sim: Simulation;
  brush: Brush;
  showHeat: boolean;
  showLidar: boolean;
  /** Read every frame (a ref, not state, so the intro can flip it on the exact frame it needs). */
  quietRef?: { current: boolean };
}

interface Hover { x: number; y: number; left: number; top: number; flip: boolean }

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** The frame-time probe; null (and free) unless the URL has `?perf=1`. */
const probe = installPerfProbe();

/**
 * Canvas view of the simulation. One requestAnimationFrame loop advances the simulation
 * and draws; React state is only used for the hover tooltip, never inside the loop.
 * The loop stops while the canvas is off screen or the tab is hidden and resumes without
 * a time jump. The canvas fills its box, which keeps the map's aspect ratio (see CSS).
 */
export function DroneCanvas({ sim, brush, showHeat, showLidar, quietRef }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const opts = useRef({ brush, showHeat, showLidar, quiet: false });
  opts.current = { brush, showHeat, showLidar, quiet: false };
  const cellRef = useRef(16);
  const [hover, setHover] = useState<Hover | null>(null);
  const drag = useRef({ down: false, lx: -1, ly: -1, dir: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !wrap || !ctx) return;
    const renderer = new Renderer(ctx, sim, readPalette(), prefersReducedMotion());
    const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    const onMotion = () => renderer.setReduced(prefersReducedMotion());
    motionQuery?.addEventListener?.('change', onMotion);
    const resize = () => {
      const width = wrap.clientWidth;
      if (width <= 0) return;
      const dpr = effectiveDpr(window.devicePixelRatio);
      const cell = width / sim.width;
      cellRef.current = cell;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(cell * sim.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderer.resize(cell, dpr);
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
      const dt = clampDt(last, now);
      sim.tick(dt);
      opts.current.quiet = quietRef?.current ?? false;
      renderer.frame(now, dt, opts.current);
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
      motionQuery?.removeEventListener?.('change', onMotion);
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
