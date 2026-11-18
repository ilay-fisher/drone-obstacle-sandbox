/**
 * The two things on the map that are not terrain: patrol obstacles and the goal.
 *
 * Patrols are rounded ember pucks with a heading notch and a faint smear behind them. The
 * simulation moves them one whole cell at a time; the puck glides toward its cell so the
 * motion reads as continuous. The goal is a landing pad with a slow breathing ring. Both are
 * cached sprites (one drawImage each) plus a notch and a ring stroke, so no gradient is built
 * per frame. Under reduced motion pucks snap to their cell and the ring rests.
 */
import type { Simulation } from '../engine/simulation';
import { MAX_PATROLS } from '../engine/simulation';
import type { MapColors } from './mapPalette';

/** Seconds for one slow breath of the landing pad ring. */
const BREATH_PERIOD_S = 3.6;

/**
 * Breathing amount for the pad ring, 0 to 1, at `nowMs`. Fixed at the half-way resting
 * value under reduced motion, so the ring is still there but does not move.
 */
export function breathPhase(nowMs: number, reduced: boolean): number {
  if (reduced) return 0.5;
  return 0.5 + 0.5 * Math.sin((nowMs / 1000 / BREATH_PERIOD_S) * Math.PI * 2);
}

/** Pixels a puck may lag its cell before it snaps (a deleted patrol re-shuffles indices). */
const SNAP_CELLS = 2.5;
/** Rate of the puck glide toward its cell; about 1/20 s time constant. */
const GLIDE_RATE = 22;

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.ceil(w));
  c.height = Math.max(2, Math.ceil(h));
  return c;
}

/** Draws patrol pucks and the goal pad from cached sprites. */
export class MapEntities {
  private puck: HTMLCanvasElement | null = null;
  private pad: HTMLCanvasElement | null = null;
  private glow: HTMLCanvasElement | null = null;
  private key = '';
  private cs = 16;
  private dpr = 1;
  private colors: MapColors | null = null;
  private readonly px = new Float32Array(MAX_PATROLS);
  private readonly py = new Float32Array(MAX_PATROLS);
  private known = 0;

  /** Rebuilds the sprites when the cell size, DPR or colours changed. */
  resize(cs: number, dpr: number, colors: MapColors): void {
    const key = `${cs.toFixed(2)}:${dpr}:${colors.puck}:${colors.padRing}`;
    this.cs = cs;
    this.dpr = dpr;
    this.colors = colors;
    if (key === this.key) return;
    this.key = key;
    this.puck = this.makePuck(cs, dpr, colors);
    this.pad = this.makePad(cs, dpr, colors);
    this.glow = this.makeGlow(cs, dpr, colors);
  }

  /** Forgets glide state so pucks appear exactly on their cells next frame (map replaced). */
  snap(): void {
    this.known = 0;
  }

  /** Draws the pucks. `dtSec` is the frame time, used for the glide. */
  drawPatrols(ctx: CanvasRenderingContext2D, sim: Simulation, dtSec: number, reduced: boolean): void {
    const { puck, colors, cs } = this;
    if (!puck || !colors) return;
    const n = sim.patrolCount;
    const k = 1 - Math.exp(-GLIDE_RATE * dtSec);
    const size = puck.width / this.dpr;
    for (let i = 0; i < n; i++) {
      const tx = sim.patrolX[i] + 0.5;
      const ty = sim.patrolY[i] + 0.5;
      if (reduced || i >= this.known || Math.abs(tx - this.px[i]) > SNAP_CELLS || Math.abs(ty - this.py[i]) > SNAP_CELLS) {
        this.px[i] = tx; this.py[i] = ty;
      } else {
        this.px[i] += (tx - this.px[i]) * k;
        this.py[i] += (ty - this.py[i]) * k;
      }
      const cx = this.px[i] * cs;
      const cy = this.py[i] * cs;
      const dx = sim.patrolDX[i];
      const dy = sim.patrolDY[i];
      // Smear: two fading ghosts trailing the heading while the puck is still catching up.
      const lag = Math.min(1, Math.hypot(tx - this.px[i], ty - this.py[i]) * 1.6);
      if (lag > 0.05) {
        ctx.globalAlpha = 0.16 * lag;
        ctx.drawImage(puck, cx - dx * cs * 0.34 - size / 2, cy - dy * cs * 0.34 - size / 2, size, size);
        ctx.globalAlpha = 0.08 * lag;
        ctx.drawImage(puck, cx - dx * cs * 0.64 - size / 2, cy - dy * cs * 0.64 - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      ctx.drawImage(puck, cx - size / 2, cy - size / 2, size, size);
      if (dx !== 0 || dy !== 0) {
        ctx.strokeStyle = colors.notch;
        ctx.lineWidth = Math.max(1.5, cs * 0.1);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + dx * cs * 0.12, cy + dy * cs * 0.12);
        ctx.lineTo(cx + dx * cs * 0.3, cy + dy * cs * 0.3);
        ctx.stroke();
      }
    }
    this.known = n;
  }

  /** Draws the landing pad with its breathing ring. */
  drawGoal(ctx: CanvasRenderingContext2D, sim: Simulation, nowMs: number, reduced: boolean): void {
    const { pad, glow, colors, cs } = this;
    if (!pad || !glow || !colors) return;
    const b = breathPhase(nowMs, reduced);
    const cx = (sim.goalX + 0.5) * cs;
    const cy = (sim.goalY + 0.5) * cs;
    const gs = glow.width / this.dpr;
    ctx.globalAlpha = 0.45 + 0.4 * b;
    ctx.drawImage(glow, cx - gs / 2, cy - gs / 2, gs, gs);
    ctx.globalAlpha = 1;
    const ps = pad.width / this.dpr;
    ctx.drawImage(pad, cx - ps / 2, cy - ps / 2, ps, ps);
    ctx.strokeStyle = colors.padRing;
    ctx.lineWidth = Math.max(1.2, cs * 0.06);
    ctx.globalAlpha = 0.25 + 0.55 * (1 - b);
    ctx.beginPath();
    ctx.arc(cx, cy, cs * (0.5 + 0.2 * b), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private makePuck(cs: number, dpr: number, c: MapColors): HTMLCanvasElement {
    const size = cs * 1.5;
    const cv = makeCanvas(size * dpr, size * dpr);
    const g = cv.getContext('2d');
    if (!g) return cv;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const m = size / 2;
    const r = cs * 0.37;
    // Contact shadow to the lower right, then the body: a lit dome, deep ember at the lower right.
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = cs * 0.22 * dpr;
    g.shadowOffsetX = cs * 0.13 * dpr;
    g.shadowOffsetY = cs * 0.2 * dpr;
    g.fillStyle = c.puckDeep;
    g.beginPath();
    g.arc(m, m, r, 0, Math.PI * 2);
    g.fill();
    g.shadowColor = 'transparent';
    const grad = g.createRadialGradient(m - r * 0.4, m - r * 0.45, r * 0.1, m, m, r * 1.05);
    grad.addColorStop(0, c.puckHi);
    grad.addColorStop(0.35, c.puck);
    grad.addColorStop(1, c.puckDeep);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(m, m, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,200,150,0.5)';
    g.lineWidth = Math.max(1, cs * 0.04);
    g.beginPath();
    g.arc(m, m, r - g.lineWidth * 0.5, Math.PI * 1.05, Math.PI * 1.65);
    g.stroke();
    return cv;
  }

  private makePad(cs: number, dpr: number, c: MapColors): HTMLCanvasElement {
    const size = cs * 1.4;
    const cv = makeCanvas(size * dpr, size * dpr);
    const g = cv.getContext('2d');
    if (!g) return cv;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const m = size / 2;
    const half = cs * 0.46;
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = cs * 0.16 * dpr;
    g.shadowOffsetX = cs * 0.08 * dpr;
    g.shadowOffsetY = cs * 0.12 * dpr;
    g.fillStyle = c.padPlate;
    g.beginPath();
    g.roundRect(m - half, m - half, half * 2, half * 2, cs * 0.28);
    g.fill();
    g.shadowColor = 'transparent';
    g.strokeStyle = c.padRim;
    g.lineWidth = Math.max(1.2, cs * 0.06);
    g.beginPath();
    g.roundRect(m - half + g.lineWidth, m - half + g.lineWidth, (half - g.lineWidth) * 2, (half - g.lineWidth) * 2, cs * 0.24);
    g.stroke();
    g.beginPath();
    g.arc(m, m, cs * 0.2, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = c.padRing;
    g.beginPath();
    g.arc(m, m, cs * 0.07, 0, Math.PI * 2);
    g.fill();
    return cv;
  }

  private makeGlow(cs: number, dpr: number, c: MapColors): HTMLCanvasElement {
    const size = cs * 3.2;
    const cv = makeCanvas(size * dpr, size * dpr);
    const g = cv.getContext('2d');
    if (!g) return cv;
    const m = cv.width / 2;
    const grad = g.createRadialGradient(m, m, 0, m, m, m);
    grad.addColorStop(0, c.padGlow);
    grad.addColorStop(0.45, c.padGlow.replace(/[\d.]+\)$/, '0.12)'));
    grad.addColorStop(1, c.padGlow.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = grad;
    g.fillRect(0, 0, cv.width, cv.height);
    return cv;
  }
}
