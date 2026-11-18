/**
 * DRAW SLOT: the drone layer. The drone is the only thing that moves fast.
 *
 * Drawn last in the frame, above terrain, patrols, goal and route, with the canvas transform
 * already scaled to CSS px. Back to front:
 *
 *   LiDAR        a quiet radius ring, a rotating 50 degree fan with a phosphor trail (one cached
 *                sprite, rotated), and a tick mark on every wall the beam has just passed over.
 *   pulse        the blockage ring (see `blockagePulse.ts`): the one loud motion of the drone.
 *   shadow       lower right, further with speed and altitude, smaller and softer near buildings.
 *   body         anodised quad: it leans into turns (skew and squash across the heading), its
 *                rotors spin as a cached blur sprite, one orange nav light.
 *
 * All the motion maths is in `droneMotion.ts`, `lidarScan.ts` and `blockagePulse.ts` (pure,
 * tested). Sprites are cached in `droneSprites.ts` and rebuilt only when the cell size, DPR,
 * palette or LiDAR radius changes. A frame allocates nothing and builds no gradients.
 *
 * Reduced motion: the LiDAR is a static ring, no bank, no sweep, no pulse, no recoil, the
 * drone sits at its final heading and landing is instant.
 */
import type { Simulation } from '../engine/simulation';
import { PULSE_MS, nearestChange, pulsePhases, shouldPulse } from './blockagePulse';
import {
  MAX_BANK, coverFor, createDroneMotion, kickRecoil, lampMix, shadowLook, speedNorm, stepDroneMotion, type DroneMotion,
} from './droneMotion';
import { NAV_X, ROTOR_OFFSET, buildDroneSprites, buildFanSprite, type DroneSprites, type Sprite } from './droneSprites';
import { collectHits, createScanHits, sweepAngle } from './lidarScan';
import type { DrawOpts, RenderView } from './renderTypes';

const MAX_HITS = 96;

/** Per-simulation drone state: motion, sprites, the last event seen and the running pulse. */
class DroneShow {
  readonly motion: DroneMotion = createDroneMotion();
  readonly hits = createScanHits(MAX_HITS);
  sprites: DroneSprites | null = null;
  fan: Sprite | null = null;
  private spriteKey = '';
  private fanKey = '';
  private lastNow = -1;
  private seq = -1;
  private prevEventTs = -Infinity;
  private pulseStart = -Infinity;
  /** Pad lamp, 0 (orange) to 1 (green). */
  lamp = 0;

  /** Rebuilds whatever sprites went stale. */
  ensure(v: RenderView, lidarRadius: number): void {
    const key = `${v.cell.toFixed(2)}:${v.dpr}:${v.pal.wall}:${v.pal.nav}:${v.pal.drone}`;
    if (key !== this.spriteKey) {
      this.spriteKey = key;
      this.sprites = buildDroneSprites(v.cell, v.dpr, v.pal);
      this.fanKey = '';
    }
    const fkey = `${key}:${Math.round(lidarRadius * v.cell)}`;
    if (fkey !== this.fanKey) {
      this.fanKey = fkey;
      this.fan = buildFanSprite(lidarRadius * v.cell, v.dpr, v.pal);
    }
  }

  /** Seconds since the last frame (0 on the first), clamped. */
  dt(now: number): number {
    const d = this.lastNow < 0 ? 0 : (now - this.lastNow) / 1000;
    this.lastNow = now;
    return d > 0 ? (d < 0.05 ? d : 0.05) : 0;
  }

  /** Looks at the newest replan event once; starts a pulse and a recoil when it earns one. */
  watch(sim: Simulation, v: RenderView, now: number): void {
    const ev = sim.lastReplan;
    if (!ev || ev.seq === this.seq) return;
    this.seq = ev.seq;
    const near = nearestChange(ev.changed, sim.width, sim.droneX, sim.droneY, sim.lidarRadius);
    const go = shouldPulse({
      kind: ev.kind,
      nearChange: near >= 0,
      reduced: v.reduced,
      ageMs: now - ev.timestamp,
      msSincePrevEvent: ev.timestamp - this.prevEventTs,
      msSincePrevPulse: now - this.pulseStart,
    });
    this.prevEventTs = ev.timestamp;
    if (!go) return;
    this.pulseStart = now;
    // Recoil away from the nearest change; straight back when it is on top of the drone.
    const dx = sim.droneX - ((near % sim.width) + 0.5);
    const dy = sim.droneY - (((near / sim.width) | 0) + 0.5);
    const len = Math.hypot(dx, dy);
    if (len > 0.01) kickRecoil(this.motion, dx / len, dy / len, 1);
  }

  /** Age of the running pulse in ms (Infinity when none). */
  pulseAge(now: number): number {
    return now - this.pulseStart;
  }
}

const shows = new WeakMap<Simulation, DroneShow>();

function showFor(sim: Simulation): DroneShow {
  let s = shows.get(sim);
  if (!s) { s = new DroneShow(); shows.set(sim, s); }
  return s;
}

/** How green the landing pad lamp is (0 to 1); the map entities layer draws the pad with it. */
export function landingLamp(sim: Simulation, reduced: boolean): number {
  const s = shows.get(sim);
  const reached = sim.stats.status === 'Reached';
  if (!s) return reached && reduced ? 1 : 0;
  return lampMix(s.motion.alt.x, reached, reduced);
}

/** True when a wall (not a patrol puck) fills cell (x, y). */
function wallAt(sim: Simulation, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= sim.width || y >= sim.height) return false;
  if (sim.planner.grid()[y * sim.width + x] !== 1) return false;
  for (let i = 0; i < sim.patrolCount; i++) if (sim.patrolX[i] === x && sim.patrolY[i] === y) return false;
  return true;
}

/** LiDAR and drone. `now` is the frame timestamp in ms. */
export function drawDroneLayer(ctx: CanvasRenderingContext2D, sim: Simulation, v: RenderView, o: DrawOpts, now: number): void {
  const { cell, pal } = v;
  const show = showFor(sim);
  show.ensure(v, sim.lidarRadius);
  const sp = show.sprites;
  if (!sp) return;
  const dt = show.dt(now);
  show.watch(sim, v, now);

  const px = sim.droneX;
  const py = sim.droneY;
  const m = show.motion;
  const under = wallAt(sim, Math.floor(px), Math.floor(py));
  const beside = wallAt(sim, Math.floor(px + 0.7), Math.floor(py + 0.7));
  stepDroneMotion(m, {
    x: px, y: py, heading: sim.heading, reached: sim.stats.status === 'Reached',
    cover: coverFor(under, beside), reduced: v.reduced,
  }, dt);

  const dx = px * cell;
  const dy = py * cell;

  if (o.showLidar) drawLidar(ctx, sim, v, show, now, dx, dy);

  const age = show.pulseAge(now);
  if (age < PULSE_MS) drawPulse(ctx, sim, v, dx, dy, age);

  // Ground shadow: lower right, pre-blurred, cross-fading tight and soft.
  const sN = speedNorm(m.speed);
  const alt = m.alt.x;
  const look = shadowLook(sN, alt, m.cover);
  ctx.save();
  ctx.translate(dx + look.dx * cell, dy + look.dy * cell);
  ctx.rotate(m.heading.x);
  ctx.scale(look.scale, look.scale);
  const ss = sp.shadowTight.size;
  ctx.globalAlpha = look.alpha * (1 - look.soft * 0.6);
  ctx.drawImage(sp.shadowTight.canvas, -ss / 2, -ss / 2, ss, ss);
  ctx.globalAlpha = look.alpha * look.soft;
  ctx.drawImage(sp.shadowSoft.canvas, -ss / 2, -ss / 2, ss, ss);
  ctx.restore();

  // Body, in a frame where +x is forward. Bank skews and squashes it across the heading, and
  // nudges it toward the inside of the turn. Higher means a little bigger.
  const bank = m.bank.x;
  const k = bank / MAX_BANK;
  const kAbs = k < 0 ? -k : k;
  const lift = 1 + 0.09 * (alt > 1 ? 1 : alt) + 0.04 * (alt < 0 ? alt : 0);
  ctx.save();
  ctx.translate(dx + m.rx.x * cell, dy + m.ry.x * cell);
  ctx.rotate(m.heading.x);
  ctx.transform(1 + 0.06 * sN, 0, 0.5 * bank, 1 - 0.24 * kAbs, 0, k * cell * 0.1);
  ctx.scale(lift, lift);
  const bs = sp.body.size;
  ctx.drawImage(sp.body.canvas, -bs / 2, -bs / 2, bs, bs);
  const P = cell * ROTOR_OFFSET;
  const rs = sp.rotor.size;
  for (let i = 0; i < 4; i++) {
    const sx = i & 1 ? -1 : 1;
    const sy = i & 2 ? -1 : 1;
    // The rotors on the inside of the turn sit lower, the outside ones higher.
    const inside = sy * (bank >= 0 ? 1 : -1);
    const sc = 1 - 0.07 * kAbs * inside;
    ctx.save();
    ctx.translate(sx * P, sy * P);
    ctx.rotate(m.rotor * sx * sy);
    ctx.scale(sc, sc);
    ctx.drawImage(sp.rotor.canvas, -rs / 2, -rs / 2, rs, rs);
    ctx.restore();
  }
  // The one orange light, on the nose; it breathes slowly.
  const blink = v.reduced ? 1 : 0.72 + 0.28 * Math.sin((now / 1000) * 5.2);
  const gs = sp.glow.size;
  ctx.globalAlpha = blink;
  ctx.drawImage(sp.glow.canvas, NAV_X * cell - gs / 2, -gs / 2, gs, gs);
  ctx.fillStyle = pal.nav;
  ctx.beginPath();
  ctx.arc(NAV_X * cell, 0, cell * 0.065, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();

  show.lamp = lampMix(alt, sim.stats.status === 'Reached', v.reduced);
}

/** The radius ring, the rotating fan and the wall ticks. Reduced motion draws the ring only. */
function drawLidar(ctx: CanvasRenderingContext2D, sim: Simulation, v: RenderView, show: DroneShow, now: number, dx: number, dy: number): void {
  const { cell, pal } = v;
  const r = sim.lidarRadius * cell;
  ctx.fillStyle = pal.lidarFill;
  ctx.beginPath();
  ctx.arc(dx, dy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = pal.lidarEdge;
  ctx.lineWidth = 1.25;
  ctx.stroke();
  if (v.reduced || !show.fan) return;

  const edge = sweepAngle(now, false);
  ctx.save();
  ctx.translate(dx, dy);
  ctx.rotate(edge);
  const fs = show.fan.size;
  ctx.drawImage(show.fan.canvas, -fs / 2, -fs / 2, fs, fs);
  ctx.restore();

  // Ticks on the walls the beam edge has just passed: a short bar across the ray at the wall's near face.
  const hits = show.hits;
  const n = collectHits(sim.planner.grid(), sim.width, sim.height, sim.droneX, sim.droneY, sim.lidarRadius, edge, hits);
  if (n === 0) return;
  ctx.strokeStyle = pal.goal;
  ctx.lineWidth = Math.max(1.4, cell * 0.1);
  ctx.lineCap = 'round';
  const half = cell * 0.3;
  for (let i = 0; i < n; i++) {
    const c = hits.cells[i];
    const wx = ((c % sim.width) + 0.5) * cell;
    const wy = (((c / sim.width) | 0) + 0.5) * cell;
    const ex = wx - dx;
    const ey = wy - dy;
    const len = Math.hypot(ex, ey) || 1;
    const ux = ex / len;
    const uy = ey / len;
    // Near face of the cell, 0.45 cell back toward the drone; bar perpendicular to the ray.
    const cx = wx - ux * cell * 0.45;
    const cy = wy - uy * cell * 0.45;
    ctx.globalAlpha = 0.9 * hits.amount[i];
    ctx.beginPath();
    ctx.moveTo(cx - uy * half, cy + ux * half);
    ctx.lineTo(cx + uy * half, cy - ux * half);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** The blockage ring: an orange stroke expanding from the drone, with a fainter ring just behind it. */
function drawPulse(ctx: CanvasRenderingContext2D, sim: Simulation, v: RenderView, dx: number, dy: number, ageMs: number): void {
  const { cell, pal } = v;
  const p = pulsePhases(ageMs);
  if (!p.active) return;
  const rMax = Math.max(sim.lidarRadius, 3) * cell * 1.02;
  const r = cell * 1.0 + p.radius * (rMax - cell * 1.0);
  ctx.lineCap = 'butt';
  ctx.strokeStyle = pal.route;
  // A thin soft halo behind the rim; never a fill.
  ctx.globalAlpha = 0.2 * p.alpha;
  ctx.lineWidth = cell * (0.22 * p.weight + 0.08);
  ctx.beginPath();
  ctx.arc(dx, dy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.95 * p.alpha;
  ctx.lineWidth = Math.max(1.5, cell * 0.13 * p.weight + 1);
  ctx.beginPath();
  ctx.arc(dx, dy, r, 0, Math.PI * 2);
  ctx.stroke();
  const r2 = r - cell * (0.5 + 0.9 * p.radius);
  if (r2 > cell * 0.6) {
    ctx.strokeStyle = pal.goal;
    ctx.globalAlpha = 0.45 * p.alpha;
    ctx.lineWidth = Math.max(1, cell * 0.07 * p.weight + 0.6);
    ctx.beginPath();
    ctx.arc(dx, dy, r2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
