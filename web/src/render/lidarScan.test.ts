import { describe, expect, it } from 'vitest';
import {
  FAN_RAD,
  FLASH_ARC,
  SWEEP_RATE,
  collectHits,
  createScanHits,
  flashAmount,
  lineOfSight,
  sweepAngle,
  wrapTau,
} from './lidarScan';

const TAU = Math.PI * 2;

describe('wrapTau', () => {
  it('wraps into [0, 2pi)', () => {
    expect(wrapTau(-0.5)).toBeCloseTo(TAU - 0.5, 12);
    expect(wrapTau(TAU + 0.25)).toBeCloseTo(0.25, 12);
    expect(wrapTau(0)).toBe(0);
  });
});

describe('the fan', () => {
  it('is about 50 degrees', () => {
    expect((FAN_RAD * 180) / Math.PI).toBeCloseTo(50, 6);
  });
});

describe('sweepAngle', () => {
  it('turns at the sweep rate and wraps', () => {
    expect(sweepAngle(0, false)).toBe(0);
    expect(sweepAngle(1000, false)).toBeCloseTo(wrapTau(SWEEP_RATE), 12);
    const a = sweepAngle(123456, false);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(TAU);
  });
  it('is fixed under reduced motion', () => {
    expect(sweepAngle(0, true)).toBe(sweepAngle(99999, true));
  });
});

describe('flashAmount', () => {
  it('is brightest right behind the beam edge and fades out to nothing', () => {
    expect(flashAmount(0)).toBeCloseTo(1, 6);
    expect(flashAmount(FLASH_ARC * 0.5)).toBeLessThan(flashAmount(0.01));
    expect(flashAmount(FLASH_ARC)).toBe(0);
    expect(flashAmount(FLASH_ARC + 1)).toBe(0);
  });
  it('is zero for cells the beam has not reached yet', () => {
    expect(flashAmount(-0.01)).toBe(0);
  });
});

/** Builds a w*h grid with the given wall cells (x,y). */
function grid(w: number, h: number, walls: Array<[number, number]>): Uint8Array {
  const g = new Uint8Array(w * h);
  for (const [x, y] of walls) g[y * w + x] = 1;
  return g;
}

describe('lineOfSight', () => {
  const g = grid(12, 12, [[6, 5], [8, 5]]);
  it('sees a wall with nothing in between', () => {
    expect(lineOfSight(g, 12, 12, 2.5, 5.5, 6.5, 5.5)).toBe(true);
  });
  it('does not see through a wall to the one behind it', () => {
    expect(lineOfSight(g, 12, 12, 2.5, 5.5, 8.5, 5.5)).toBe(false);
  });
});

describe('collectHits', () => {
  const w = 16;
  const g = grid(w, w, [[10, 8], [4, 8], [8, 14]]);
  const drone = { x: 8.5, y: 8.5 };

  it('flashes only the wall the beam edge has just passed', () => {
    const hits = createScanHits(64);
    // Wall (10,8) is due east (angle 0). Beam edge just past it.
    const n = collectHits(g, w, w, drone.x, drone.y, 6, 0.1, hits);
    expect(n).toBe(1);
    expect(hits.cells[0]).toBe(8 * w + 10);
    expect(hits.amount[0]).toBeGreaterThan(0.5);
  });

  it('finds nothing where the beam has not been recently', () => {
    const hits = createScanHits(64);
    // Edge due north: every wall is well behind it, beyond the flash window.
    const n = collectHits(g, w, w, drone.x, drone.y, 6, (3 * Math.PI) / 2, hits);
    expect(n).toBe(0);
  });

  it('ignores walls outside the radius', () => {
    const hits = createScanHits(64);
    const n = collectHits(g, w, w, drone.x, drone.y, 1.2, 0.1, hits);
    expect(n).toBe(0);
  });

  it('ignores walls hidden behind other walls', () => {
    const g2 = grid(w, w, [[10, 8], [11, 8]]);
    const hits = createScanHits(64);
    const n = collectHits(g2, w, w, drone.x, drone.y, 6, 0.1, hits);
    expect(n).toBe(1);
    expect(hits.cells[0]).toBe(8 * w + 10);
  });

  it('wraps around the seam at angle zero', () => {
    const hits = createScanHits(64);
    // The wall sits at about -0.1 rad (just under 2pi); the edge is 0.2 rad past zero.
    const g2 = grid(w, w, [[12, 8]]);
    const n = collectHits(g2, w, w, drone.x, 8.9, 6, 0.2, hits);
    expect(n).toBe(1);
  });

  it('never writes past the buffer', () => {
    const many = grid(w, w, []);
    for (let x = 0; x < w; x++) many[7 * w + x] = 1;
    const hits = createScanHits(2);
    const n = collectHits(many, w, w, 8.5, 8.5, 8, Math.PI, hits);
    expect(n).toBeLessThanOrEqual(2);
  });
});
