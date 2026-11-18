import { describe, expect, it } from 'vitest';
import { chipLayout, placeChip, rectHitsPolyline, rectsOverlap, type PlaceInput } from './chipPlacement';

const MAP = { w: 1000, h: 600 };
const BOX = { w: 160, h: 24 };

function base(over: Partial<PlaceInput> = {}): PlaceInput {
  return {
    box: BOX,
    map: MAP,
    margin: 6,
    gap: 8,
    flood: { x: 400, y: 250, w: 80, h: 60 },
    route: new Float32Array([0, 300, 1000, 300]),
    routeN: 2,
    routePad: 10,
    avoid: [],
    ...over,
  };
}

describe('rectsOverlap / rectHitsPolyline', () => {
  it('detects overlap and separation', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 10, h: 10 })).toBe(true);
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
  });

  it('catches a segment that crosses the rect with no vertex inside it', () => {
    const r = { x: 40, y: 40, w: 20, h: 20 };
    expect(rectHitsPolyline(r, new Float32Array([0, 50, 100, 50]), 2, 0)).toBe(true);
    expect(rectHitsPolyline(r, new Float32Array([0, 10, 100, 10]), 2, 0)).toBe(false);
  });

  it('honours the clearance pad', () => {
    const r = { x: 40, y: 40, w: 20, h: 20 };
    const line = new Float32Array([0, 35, 100, 35]);
    expect(rectHitsPolyline(r, line, 2, 0)).toBe(false);
    expect(rectHitsPolyline(r, line, 2, 6)).toBe(true);
  });
});

describe('placeChip', () => {
  it('uses "above the flood" when it clears the route', () => {
    const r = placeChip(base({ flood: { x: 400, y: 340, w: 80, h: 60 } }));
    expect(r.anchor).toBe('above');
    expect(r.y + BOX.h).toBeLessThanOrEqual(340);
  });

  it('never overlaps the route, in any anchor', () => {
    const route = new Float32Array([0, 300, 500, 300, 1000, 200]);
    for (let fy = 20; fy < 560; fy += 40) {
      for (let fx = 20; fx < 900; fx += 90) {
        const input = base({ flood: { x: fx, y: fy, w: 60, h: 40 }, route, routeN: 3 });
        const r = placeChip(input);
        expect(rectHitsPolyline({ x: r.x, y: r.y, w: BOX.w, h: BOX.h }, route, 3, input.routePad)).toBe(false);
      }
    }
  });

  it('skips candidates that would cover the route and falls to a clear side', () => {
    // Flood centred on the route: above/below sit in the open, but a wall of route pads blocks "above".
    const route = new Float32Array([0, 300, 1000, 300, 1000, 100, 0, 100]);
    const r = placeChip(base({ flood: { x: 450, y: 180, w: 80, h: 60 }, route, routeN: 4 }));
    expect(rectHitsPolyline({ x: r.x, y: r.y, w: BOX.w, h: BOX.h }, route, 4, 10)).toBe(false);
  });

  it('stays inside the map with the margin', () => {
    for (const flood of [{ x: 0, y: 0, w: 30, h: 30 }, { x: 970, y: 570, w: 30, h: 30 }, { x: 0, y: 570, w: 1000, h: 30 }]) {
      const r = placeChip(base({ flood, route: new Float32Array([0, 300, 1000, 300]) }));
      expect(r.x).toBeGreaterThanOrEqual(6);
      expect(r.y).toBeGreaterThanOrEqual(6);
      expect(r.x + BOX.w).toBeLessThanOrEqual(MAP.w - 6);
      expect(r.y + BOX.h).toBeLessThanOrEqual(MAP.h - 6);
    }
  });

  it('keeps clear of the drone and the goal pad', () => {
    const avoid = [{ x: 380, y: 200, w: 60, h: 60 }, { x: 500, y: 200, w: 60, h: 60 }];
    const r = placeChip(base({ flood: { x: 420, y: 260, w: 100, h: 60 }, route: new Float32Array([0, 590, 10, 590]), routeN: 2, avoid }));
    for (const a of avoid) expect(rectsOverlap({ x: r.x, y: r.y, w: BOX.w, h: BOX.h }, a)).toBe(false);
  });

  it('near the top edge picks a side that is still clear instead of covering the route', () => {
    const route = new Float32Array([0, 80, 1000, 80]);
    const r = placeChip(base({ flood: { x: 300, y: 20, w: 120, h: 40 }, route, routeN: 2 }));
    expect(rectHitsPolyline({ x: r.x, y: r.y, w: BOX.w, h: BOX.h }, route, 2, 10)).toBe(false);
  });

  it('when nothing clears, returns the least-bad candidate inside the map', () => {
    const route = new Float32Array([0, 0, 1000, 0, 1000, 600, 0, 600, 0, 0, 1000, 600]);
    const r = placeChip(base({ route, routeN: 6, routePad: 400 }));
    expect(r.anchor).toBe('fallback');
    expect(r.x).toBeGreaterThanOrEqual(6);
    expect(r.y).toBeGreaterThanOrEqual(6);
  });
});

describe('chipLayout', () => {
  it('uses the full chip on a roomy map', () => {
    const l = chipLayout(1000);
    expect(l.compact).toBe(false);
    expect(l.font).toBe(11);
  });

  it('goes compact and smaller on a phone map, never below 9px', () => {
    const l = chipLayout(340);
    expect(l.compact).toBe(true);
    expect(l.font).toBeGreaterThanOrEqual(9);
    expect(l.font).toBeLessThan(11);
    expect(chipLayout(100).font).toBe(9);
  });
});
