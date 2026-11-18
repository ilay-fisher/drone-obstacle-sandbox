/**
 * Pre-rendered sprites for the drone layer. Everything with a gradient or a blur is painted
 * here once, when the cell size, DPR or palette changes (and for the fan, when the LiDAR
 * radius changes), so a frame is only `drawImage` calls and a few strokes.
 *
 * All body sprites are drawn in the drone's own frame: +x is forward, the light is top left.
 *
 *   body    anodised dark shell, two diagonal arms, four motor hubs, camera dome, bevel highlight
 *   rotor   a translucent disc with two blades and their motion-blur wedge (rotated per frame)
 *   shadow  the drone's silhouette, once tight and once soft (cross-faded by the layer)
 *   glow    the orange nav light's halo
 *   fan     the 50 degree LiDAR wedge with its decaying phosphor trail (rotated per frame)
 */
import { FAN_RAD } from './lidarScan';
import { mix, parseHex, withAlpha } from './mapPalette';
import type { Palette } from './palette';

/** Rotor centre distance from the body centre along each axis, and rotor radius, in cells. */
export const ROTOR_OFFSET = 0.5;
export const ROTOR_RADIUS = 0.31;
/** Nose position of the nav light, in cells ahead of the centre. */
export const NAV_X = 0.47;

/** A cached sprite and its size in CSS px. */
export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Width and height in CSS px (the canvas is this times the DPR). */
  size: number;
}

function makeSprite(size: number, dpr: number): { sprite: Sprite; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  const px = Math.max(2, Math.ceil(size * dpr));
  c.width = px;
  c.height = px;
  const g = c.getContext('2d')!;
  g.setTransform(px / size, 0, 0, px / size, 0, 0);
  return { sprite: { canvas: c, size }, g };
}

/** Everything the layer draws per frame except the fan. */
export interface DroneSprites {
  body: Sprite;
  rotor: Sprite;
  shadowTight: Sprite;
  shadowSoft: Sprite;
  glow: Sprite;
}

/** The solid silhouette (shell, arms, rotor discs) used for both shadow sprites. */
function silhouette(g: CanvasRenderingContext2D, cs: number, cx: number, cy: number): void {
  const P = cs * ROTOR_OFFSET;
  g.lineCap = 'round';
  g.lineWidth = cs * 0.15;
  g.beginPath();
  g.moveTo(cx - P, cy - P); g.lineTo(cx + P, cy + P);
  g.moveTo(cx - P, cy + P); g.lineTo(cx + P, cy - P);
  g.stroke();
  g.beginPath();
  g.roundRect(cx - cs * 0.5, cy - cs * 0.27, cs, cs * 0.54, cs * 0.27);
  g.fill();
  g.globalAlpha = 0.5;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    g.beginPath();
    g.arc(cx + sx * P, cy + sy * P, cs * ROTOR_RADIUS, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

/**
 * A blurred silhouette. The shape is drawn far outside the canvas and only its shadow is
 * offset back in: `shadowBlur` is the one blur every browser's canvas supports.
 */
function shadowSprite(cs: number, dpr: number, blur: number): Sprite {
  const size = cs * 3.4;
  const { sprite, g } = makeSprite(size, dpr);
  const far = size * 3;
  g.shadowColor = '#000';
  g.shadowBlur = blur * dpr;
  g.shadowOffsetX = far * dpr;
  g.shadowOffsetY = 0;
  g.fillStyle = '#000';
  g.strokeStyle = '#000';
  silhouette(g, cs, size / 2 - far, size / 2);
  return sprite;
}

function bodySprite(cs: number, dpr: number, pal: Palette): Sprite {
  const size = cs * 2.3;
  const { sprite, g } = makeSprite(size, dpr);
  const m = size / 2;
  const P = cs * ROTOR_OFFSET;
  const arm = mix(pal.wall, pal.drone, 0.16);
  const hubDark = mix(pal.wall, '#000000', 0.62);
  const lit = mix(pal.wall, pal.drone, 0.34);
  const dark = mix(pal.wall, '#000000', 0.58);
  const hi = withAlpha(pal.drone, 0.62);

  // Arms: dark anodised bars with a thin lit top edge.
  g.lineCap = 'round';
  g.strokeStyle = arm;
  g.lineWidth = cs * 0.15;
  g.beginPath();
  g.moveTo(m - P, m - P); g.lineTo(m + P, m + P);
  g.moveTo(m - P, m + P); g.lineTo(m + P, m - P);
  g.stroke();
  g.strokeStyle = withAlpha(pal.drone, 0.14);
  g.lineWidth = Math.max(0.8, cs * 0.03);
  g.beginPath();
  g.moveTo(m - P - cs * 0.04, m - P - cs * 0.05); g.lineTo(m + P - cs * 0.04, m + P - cs * 0.05);
  g.moveTo(m - P - cs * 0.04, m + P - cs * 0.05); g.lineTo(m + P - cs * 0.04, m - P - cs * 0.05);
  g.stroke();

  // Motor hubs.
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const hx = m + sx * P;
    const hy = m + sy * P;
    g.fillStyle = hubDark;
    g.beginPath();
    g.arc(hx, hy, cs * 0.14, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = withAlpha(pal.drone, 0.3);
    g.lineWidth = Math.max(0.8, cs * 0.035);
    g.beginPath();
    g.arc(hx, hy, cs * 0.12, Math.PI * 1.05, Math.PI * 1.55);
    g.stroke();
  }

  // Shell: a capsule along the heading, lit from the top left.
  const x0 = m - cs * 0.5;
  const y0 = m - cs * 0.27;
  const grad = g.createLinearGradient(x0, y0, x0 + cs * 0.9, y0 + cs * 0.54);
  grad.addColorStop(0, lit);
  grad.addColorStop(0.45, mix(pal.wall, '#000000', 0.22));
  grad.addColorStop(1, dark);
  g.fillStyle = grad;
  g.beginPath();
  g.roundRect(x0, y0, cs, cs * 0.54, cs * 0.27);
  g.fill();
  // Bevel: a specular along the top-left edge, fading around the curve.
  const bev = g.createLinearGradient(x0, y0, x0 + cs * 0.7, y0 + cs * 0.5);
  bev.addColorStop(0, hi);
  bev.addColorStop(0.5, withAlpha(pal.drone, 0.12));
  bev.addColorStop(1, 'rgba(0,0,0,0)');
  g.strokeStyle = bev;
  g.lineWidth = Math.max(1, cs * 0.05);
  g.beginPath();
  g.roundRect(x0 + g.lineWidth * 0.5, y0 + g.lineWidth * 0.5, cs - g.lineWidth, cs * 0.54 - g.lineWidth, cs * 0.25);
  g.stroke();
  // Dark rim on the shaded side.
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = Math.max(0.8, cs * 0.03);
  g.beginPath();
  g.roundRect(x0 + 0.5, y0 + 0.5, cs - 1, cs * 0.54 - 1, cs * 0.26);
  g.stroke();

  // Camera dome toward the nose, with a specular dot, and a tail panel line.
  g.fillStyle = mix(pal.wall, '#000000', 0.72);
  g.beginPath();
  g.arc(m + cs * 0.17, m, cs * 0.13, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = withAlpha(pal.drone, 0.55);
  g.beginPath();
  g.arc(m + cs * 0.135, m - cs * 0.04, cs * 0.032, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  g.lineWidth = Math.max(0.8, cs * 0.03);
  g.beginPath();
  g.moveTo(m - cs * 0.22, m - cs * 0.2); g.lineTo(m - cs * 0.22, m + cs * 0.2);
  g.stroke();
  return sprite;
}

function rotorSprite(cs: number, dpr: number, pal: Palette): Sprite {
  const R = cs * ROTOR_RADIUS;
  const size = R * 2.2;
  const { sprite, g } = makeSprite(size, dpr);
  const m = size / 2;
  // Dark anodised graphite, in the stage family: flight hardware, not a toy.
  const gr = mix(pal.wall, '#000000', 0.12);
  const rgb = parseHex(gr) ?? [42, 50, 59];
  const col = (a: number): string => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  const lightRgb = parseHex(pal.drone) ?? [236, 232, 223];
  const hi = (a: number): string => `rgba(${lightRgb[0]},${lightRgb[1]},${lightRgb[2]},${a})`;
  // Disc: graphite, a touch lighter toward the top left.
  const disc = g.createLinearGradient(m - R, m - R, m + R, m + R);
  disc.addColorStop(0, mix(gr, pal.drone, 0.1));
  disc.addColorStop(1, mix(gr, '#000000', 0.25));
  g.fillStyle = disc;
  g.globalAlpha = 0.9;
  g.beginPath();
  g.arc(m, m, R, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  const gc = (g as CanvasRenderingContext2D & { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient }).createConicGradient;
  if (typeof gc === 'function') {
    // Two blades with a faint blur wedge each (low alpha, so rotation is felt, not seen).
    const grad = gc.call(g, 0, m, m);
    grad.addColorStop(0, hi(0.07));
    grad.addColorStop(0.1, hi(0.03));
    grad.addColorStop(0.26, hi(0));
    grad.addColorStop(0.5, hi(0.07));
    grad.addColorStop(0.6, hi(0.03));
    grad.addColorStop(0.76, hi(0));
    grad.addColorStop(1, hi(0.07));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(m, m, R * 0.95, 0, Math.PI * 2);
    g.fill();
  }
  // Rim: a thin dark outer line, a faint light line all round so the disc reads against dark
  // ground, and a brighter bevel on the top-left arc (the one light source), fading to the sides.
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = Math.max(0.8, cs * 0.03);
  g.beginPath();
  g.arc(m, m, R * 0.985, 0, Math.PI * 2);
  g.stroke();
  // Only a hint of edge: one thin bevel of about 110 degrees on the top-left arc, no all-round ring.
  g.lineCap = 'round';
  g.strokeStyle = hi(0.3);
  g.lineWidth = Math.max(1, cs * 0.035);
  g.beginPath();
  g.arc(m, m, R * 0.92, Math.PI * 0.96, Math.PI * 1.57);
  g.stroke();
  g.lineCap = 'butt';
  g.fillStyle = col(1);
  g.beginPath();
  g.arc(m, m, cs * 0.06, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = hi(0.35);
  g.beginPath();
  g.arc(m - cs * 0.015, m - cs * 0.015, cs * 0.025, 0, Math.PI * 2);
  g.fill();
  return sprite;
}

function glowSprite(cs: number, dpr: number, nav: string): Sprite {
  const size = cs * 1.1;
  const { sprite, g } = makeSprite(size, dpr);
  const m = size / 2;
  const grad = g.createRadialGradient(m, m, 0, m, m, m);
  grad.addColorStop(0, withAlpha(nav, 0.85));
  grad.addColorStop(0.3, withAlpha(nav, 0.3));
  grad.addColorStop(1, withAlpha(nav, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return sprite;
}

/** Builds the body, rotor, shadow and glow sprites for one cell size and DPR. */
export function buildDroneSprites(cs: number, dpr: number, pal: Palette): DroneSprites {
  return {
    body: bodySprite(cs, dpr, pal),
    rotor: rotorSprite(cs, dpr, pal),
    shadowTight: shadowSprite(cs, dpr, cs * 0.1),
    shadowSoft: shadowSprite(cs, dpr, cs * 0.36),
    glow: glowSprite(cs, dpr, pal.nav),
  };
}

/**
 * The LiDAR wedge for a radius of `rPx` CSS px, in a square sprite of side 2*rPx centred on
 * the drone. The leading edge points along +x (rotate the sprite to the sweep angle); the trail
 * lies behind it, from `-FAN_RAD` to 0, and fades from bright at the edge to nothing. The decay
 * is one conic gradient painted once, never rebuilt per frame; browsers without conic
 * gradients get 18 stepped wedges instead.
 */
export function buildFanSprite(rPx: number, dpr: number, pal: Palette): Sprite {
  const size = rPx * 2;
  const { sprite, g } = makeSprite(size, dpr);
  const m = rPx;
  const rgb = parseHex(pal.drone) ?? [236, 232, 223];
  const col = (a: number): string => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  const LEAD = 0.6;
  const gc = (g as CanvasRenderingContext2D & { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient }).createConicGradient;
  g.beginPath();
  g.moveTo(m, m);
  g.arc(m, m, rPx, -FAN_RAD, 0);
  g.closePath();
  if (typeof gc === 'function') {
    const grad = gc.call(g, -FAN_RAD, m, m);
    const f = FAN_RAD / (Math.PI * 2);
    // Phosphor decay: roughly exponential from the leading edge back to the tail.
    const stops = [0, 0.18, 0.4, 0.62, 0.82, 1];
    const alphas = [0.03, 0.08, 0.15, 0.27, 0.43, LEAD];
    for (let i = 0; i < stops.length; i++) grad.addColorStop(stops[i] * f, col(alphas[i]));
    grad.addColorStop(Math.min(1, f + 0.0001), col(0));
    grad.addColorStop(1, col(0));
    g.fillStyle = grad;
    g.fill();
  } else {
    const slices = 18;
    for (let i = 0; i < slices; i++) {
      const a0 = -FAN_RAD + (FAN_RAD * i) / slices;
      const a1 = -FAN_RAD + (FAN_RAD * (i + 1)) / slices;
      const t = (i + 1) / slices;
      g.fillStyle = col(LEAD * t * t * t);
      g.beginPath();
      g.moveTo(m, m);
      g.arc(m, m, rPx, a0, a1 + 0.004);
      g.closePath();
      g.fill();
    }
  }
  // The beam fades toward its far end, so the radius ring stays the quiet boundary.
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createRadialGradient(m, m, 0, m, m, rPx);
  fade.addColorStop(0, 'rgba(0,0,0,0.35)');
  fade.addColorStop(0.25, 'rgba(0,0,0,1)');
  fade.addColorStop(0.8, 'rgba(0,0,0,0.85)');
  fade.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = fade;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'source-over';
  // Leading edge: a thin amber line, brightest near the drone.
  const edge = g.createLinearGradient(m, 0, m + rPx, 0);
  edge.addColorStop(0, withAlpha(pal.goal, 0.95));
  edge.addColorStop(1, withAlpha(pal.goal, 0.4));
  g.strokeStyle = edge;
  g.lineWidth = Math.max(1.5, rPx * 0.018);
  g.beginPath();
  g.moveTo(m, m);
  g.lineTo(m + rPx, m);
  g.stroke();
  return sprite;
}
