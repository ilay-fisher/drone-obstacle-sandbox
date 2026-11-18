import { describe, expect, it } from 'vitest';
import type { PlanMode } from '../engine/plannerBridge';
import type { SimState } from '../engine/simulation';
import { buildPreset } from '../scenarios/presets';
import { INTRO_SPEED, IntroRunner, type IntroHost, type IntroSim } from './introRunner';
import { CUES, STEPS_MS } from './introScript';

const W = 48;
const H = 30;

/** A recording stand-in for Simulation: a straight route along the middle row. */
function fakeSim() {
  const log: string[] = [];
  const edits: [number, number, number][] = [];
  const sim: IntroSim & { log: string[]; edits: typeof edits } = {
    log, edits, width: W, height: H, speed: 1,
    path: Int32Array.from({ length: 44 }, (_, i) => 15 * W + 2 + i), pathIdx: 4, pathLen: 44,
    importState: (s: SimState) => { log.push(s.cells.some((c) => c === 1) ? 'import:city' : 'import:empty'); return true; },
    editCell: (x, y, v) => { edits.push([x, y, v]); },
    reset: () => { log.push('reset'); },
    setMode: (m: PlanMode) => { log.push(`mode:${m}`); },
    setPlaying: (on: boolean) => { log.push(`playing:${on}`); },
  };
  return sim;
}
function fakeHost() {
  const log: string[] = [];
  const host: IntroHost & { log: string[] } = {
    log,
    setMode: (m) => log.push(`ui-mode:${m}`),
    setPlaying: (on) => log.push(`ui-playing:${on}`),
    setQuiet: (q) => log.push(`quiet:${q}`),
    restore: () => log.push('restore'),
  };
  return host;
}
const city = () => buildPreset('Urban Canyon', W, H);
const empty = () => buildPreset('Empty Arena', W, H);
/** Frames inside the painting window: a building lands per frame, never two at once. */
function paintAll(r: IntroRunner) {
  for (let t = 0; t <= CUES.paintMs + 400; t += 16) r.update(t);
}
const count = (cells: Uint8Array, v: number) => cells.reduce((n, c) => n + (c === v ? 1 : 0), 0);

describe('IntroRunner painting', () => {
  it('paints at most one building per frame so each is one clean animated drop', () => {
    const sim = fakeSim();
    const r = new IntroRunner(sim, fakeHost(), city(), empty());
    r.start();
    let worst = 0;
    for (let t = 0; t <= CUES.paintMs + 400; t += 16) {
      const before = sim.edits.filter((e) => e[2] === 1).length;
      r.update(t);
      worst = Math.max(worst, sim.edits.filter((e) => e[2] === 1).length - before);
    }
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThanOrEqual(40);
  });

  it('finishes painting before the city is loaded for the A* plan', () => {
    const sim = fakeSim();
    const r = new IntroRunner(sim, fakeHost(), city(), empty());
    r.start();
    for (let t = 0; t <= CUES.paintMs + 400; t += 16) r.update(t);
    expect(CUES.paintMs + 400).toBeLessThan(CUES.loadCity);
    expect(sim.edits.filter((e) => e[2] === 1).length).toBe(count(city().cells, 1));
  });
});

describe('IntroRunner', () => {
  it('start loads an empty map, goes quiet, selects A* and sets the intro speed', () => {
    const sim = fakeSim();
    const host = fakeHost();
    new IntroRunner(sim, host, city(), empty()).start();
    expect(sim.log).toEqual(['import:empty', 'mode:astar']);
    expect(host.log).toEqual(['quiet:true', 'ui-mode:astar', 'ui-playing:false']);
    expect(sim.speed).toBe(INTRO_SPEED);
  });

  it('paints the city in over step 1 (walls and wind), resetting each frame so no replans are counted', () => {
    const sim = fakeSim();
    const r = new IntroRunner(sim, fakeHost(), city(), empty());
    r.start();
    sim.log.length = 0;
    r.update(CUES.paintStart + CUES.paintMs / 2);
    const mid = sim.edits.filter((e) => e[2] === 1).length;
    const wallsTotal = count(city().cells, 1);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(wallsTotal);
    expect(sim.log).toContain('reset');
    paintAll(r);
    expect(sim.edits.filter((e) => e[2] === 1).length).toBe(wallsTotal);
    expect(sim.edits.filter((e) => e[2] === 2).length).toBe(count(city().cells, 2));
  });

  it('does not repaint cells it has already painted', () => {
    const sim = fakeSim();
    const r = new IntroRunner(sim, fakeHost(), city(), empty());
    r.start();
    paintAll(r);
    const n = sim.edits.length;
    r.update(CUES.paintMs + 10);
    r.update(CUES.paintMs + 20);
    expect(sim.edits.length).toBe(n);
  });

  it('runs every cue exactly once, in order, even when frames are sparse', () => {
    const sim = fakeSim();
    const host = fakeHost();
    const r = new IntroRunner(sim, host, city(), empty());
    r.start();
    paintAll(r);
    sim.log.length = 0;
    sim.edits.length = 0;
    host.log.length = 0;
    for (let t = CUES.paintMs; t <= STEPS_MS; t += 250) r.update(t);
    r.update(STEPS_MS);
    const order = sim.log.filter((l) => l !== 'reset');
    expect(order).toEqual(['import:city', 'mode:astar', 'playing:true', 'mode:dstar']);
    expect(host.log).toEqual(['quiet:false', 'ui-mode:astar', 'ui-playing:true', 'ui-mode:dstar']);
    // two wall blocks of five cells each: one on the A* route, one on the D* route
    expect(sim.edits.filter((e) => e[2] === 1).length).toBe(10);
  });

  it('a late first frame still plays all earlier cues in order', () => {
    const sim = fakeSim();
    const host = fakeHost();
    const r = new IntroRunner(sim, host, city(), empty());
    r.start();
    host.log.length = 0;
    r.update(STEPS_MS);
    expect(host.log.indexOf('quiet:false')).toBeLessThan(host.log.indexOf('ui-playing:true'));
    expect(host.log.indexOf('ui-playing:true')).toBeLessThan(host.log.indexOf('ui-mode:dstar'));
  });

  it('finish pauses where the drone is, hands the console back and restores speed and radius', () => {
    const sim = fakeSim();
    const host = fakeHost();
    const r = new IntroRunner(sim, host, city(), empty());
    r.start();
    r.update(STEPS_MS);
    sim.log.length = 0;
    host.log.length = 0;
    r.finish();
    expect(sim.log).toEqual(['playing:false']);
    expect(host.log).toEqual(['quiet:false', 'ui-playing:false', 'restore']);
  });

  it('skip leaves a normal state: Urban Canyon loaded, A*, paused, not quiet, restored', () => {
    const sim = fakeSim();
    const host = fakeHost();
    const r = new IntroRunner(sim, host, city(), empty());
    r.start();
    r.update(CUES.block1 + 50);
    sim.log.length = 0;
    host.log.length = 0;
    r.skip();
    expect(sim.log).toEqual(['playing:false', 'import:city', 'mode:astar']);
    expect(host.log).toEqual(['quiet:false', 'ui-mode:astar', 'ui-playing:false', 'restore']);
  });

  it('is inert after finish or skip', () => {
    const sim = fakeSim();
    const r = new IntroRunner(sim, fakeHost(), city(), empty());
    r.start();
    r.skip();
    sim.log.length = 0;
    sim.edits.length = 0;
    r.update(5000);
    r.finish();
    expect(sim.log).toEqual([]);
    expect(sim.edits).toEqual([]);
  });

  it('showFinished (reduced motion) loads the city paused with A* and no animation', () => {
    const sim = fakeSim();
    const host = fakeHost();
    new IntroRunner(sim, host, city(), empty()).showFinished();
    expect(sim.log).toEqual(['playing:false', 'import:city', 'mode:astar']);
    expect(host.log).toEqual(['quiet:false', 'ui-mode:astar', 'ui-playing:false', 'restore']);
  });
});
