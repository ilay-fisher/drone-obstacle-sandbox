import { describe, expect, it } from 'vitest';
import type { CellValue, PlanMode } from '../engine/plannerBridge';
import type { SimState } from '../engine/simulation';
import { buildPreset } from '../scenarios/presets';
import { DRAW_MS, DRAW_START_MS, TOTAL_MS as REPLAN_TOTAL_MS } from '../render/replanTimeline';
import { INTRO_SPEED, IntroRunner, type IntroHost, type IntroSim } from './introRunner';
import { pickWall } from './introCues';
import { CUES } from './introScript';
import { EVENT_TIMEOUT_MS, HARD_CAP_MS, SEQUENCE } from './introSequence';

const W = 48;
const H = 30;

interface Fake extends IntroSim {
  log: string[];
  edits: [number, number, number][];
  cells: Uint8Array;
  /** Plays the simulation tick: a planning call lands `latency` ms after it was asked for. */
  pump(t: number): void;
  latency: number;
  never: boolean;
  replanSeq: number;
  /** Times at which a planning call finished. */
  planned: number[];
  stamp: (s: string) => void;
}

/** A recording stand-in for Simulation: a straight route along the middle row and a planner with a latency. */
function fakeSim(): Fake {
  const log: string[] = [];
  const edits: [number, number, number][] = [];
  let mode: PlanMode = 'astar';
  let needsAt = -1;
  let clock = 0;
  const sim: Fake = {
    log, edits, width: W, height: H, speed: 1, lidarRadius: 6,
    cells: new Uint8Array(W * H),
    replanSeq: 0,
    latency: 0, never: false, planned: [],
    path: Int32Array.from({ length: 44 }, (_, i) => 15 * W + 2 + i), pathIdx: 4, pathLen: 44,
    stamp: (s) => log.push(s),
    importState(s: SimState) {
      sim.cells = Uint8Array.from(s.cells);
      log.push(s.cells.some((c) => c === 1) ? 'import:city' : 'import:empty');
      sim.replanSeq++; // a map load plans a preview at once
      sim.planned.push(clock);
      return true;
    },
    editCell(x: number, y: number, v: CellValue) {
      edits.push([x, y, v]);
      if (sim.cells[y * W + x] !== v) { sim.cells[y * W + x] = v; if (needsAt < 0) needsAt = clock; }
    },
    copyVisualGrid(out: Uint8Array) { out.set(sim.cells); },
    reset() { log.push('reset'); sim.replanSeq++; needsAt = -1; },
    setMode(m: PlanMode) { log.push(`mode:${m}`); if (m !== mode) { mode = m; if (needsAt < 0) needsAt = clock; } },
    setPlaying(on: boolean) { log.push(`playing:${on}`); },
    pump(t: number) {
      clock = t;
      if (needsAt >= 0 && !sim.never && t >= needsAt + sim.latency) { needsAt = -1; sim.replanSeq++; sim.planned.push(t); }
    },
  };
  return sim;
}
interface FakeHost extends IntroHost { log: string[] }
function fakeHost(stamp?: (s: string) => void): FakeHost {
  const log: string[] = [];
  const push = (s: string) => { log.push(s); stamp?.(`host:${s}`); };
  return {
    log,
    setMode: (m) => push(`ui-mode:${m}`),
    setPlaying: (on) => push(`ui-playing:${on}`),
    setQuiet: (q) => push(`quiet:${q}`),
    setCalm: (c) => push(`calm:${c}`),
    restore: () => push('restore'),
  };
}
const city = () => buildPreset('Urban Canyon', W, H);
const empty = () => buildPreset('Empty Arena', W, H);
const count = (cells: Uint8Array, v: number) => cells.reduce((n, c) => n + (c === v ? 1 : 0), 0);

/** Frames inside the painting window. */
function paintAll(r: IntroRunner, sim: Fake) {
  for (let t = 0; t <= CUES.paintMs + 400; t += 16) { sim.pump(t); r.update(t); }
}

interface Run { sim: Fake; host: FakeHost; r: IntroRunner; doneAt: number; marks: { t: number; what: string }[] }
/** Runs the whole intro against a fake planner with the given latency, frame by frame. */
function runAll(latency = 0, opts: { never?: boolean; frame?: number } = {}): Run {
  const sim = fakeSim();
  sim.latency = latency;
  sim.never = opts.never ?? false;
  const marks: { t: number; what: string }[] = [];
  let now = 0;
  sim.stamp = () => {};
  const host = fakeHost((s) => marks.push({ t: now, what: s }));
  const r = new IntroRunner(sim, host, city(), empty());
  r.start();
  let doneAt = -1;
  let seenLog = 0;
  let seenEdits = 0;
  for (let t = 0; t <= 60000; t += opts.frame ?? 16) {
    now = t;
    sim.pump(t);
    r.update(t);
    for (; seenLog < sim.log.length; seenLog++) marks.push({ t, what: sim.log[seenLog] });
    for (; seenEdits < sim.edits.length; seenEdits++) if (sim.edits[seenEdits][2] === 1 && t > CUES.paintMs + 400) marks.push({ t, what: 'wall' });
    if (r.done) { doneAt = t; break; }
  }
  return { sim, host, r, doneAt, marks };
}
const firstMark = (run: Run, what: string, after = 0) => run.marks.find((m) => m.what === what && m.t >= after)?.t ?? -1;

describe('IntroRunner painting', () => {
  it('paints at most one building per frame so each is one clean animated drop', () => {
    const sim = fakeSim();
    const r = new IntroRunner(sim, fakeHost(), city(), empty());
    r.start();
    let worst = 0;
    for (let t = 0; t <= CUES.paintMs + 400; t += 16) {
      const before = sim.edits.filter((e) => e[2] === 1).length;
      sim.pump(t);
      r.update(t);
      worst = Math.max(worst, sim.edits.filter((e) => e[2] === 1).length - before);
    }
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThanOrEqual(40);
    expect(sim.edits.filter((e) => e[2] === 1).length).toBe(count(city().cells, 1));
  });

  it('does not repaint cells it has already painted', () => {
    const sim = fakeSim();
    const r = new IntroRunner(sim, fakeHost(), city(), empty());
    r.start();
    paintAll(r, sim);
    const n = sim.edits.length;
    r.update(CUES.paintMs + 10);
    r.update(CUES.paintMs + 20);
    expect(sim.edits.length).toBe(n);
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
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(count(city().cells, 1));
    expect(sim.log).toContain('reset');
    paintAll(r, sim);
    expect(sim.edits.filter((e) => e[2] === 2).length).toBe(count(city().cells, 2));
  });

  it('runs every cue once, in order, and reports the four caption steps', () => {
    const run = runAll();
    expect(run.sim.log.filter((l) => l.startsWith('import') || l.startsWith('mode') || l.startsWith('playing'))).toEqual([
      'import:empty', 'mode:astar', 'import:city', 'mode:astar', 'playing:true', 'mode:dstar',
    ]);
    expect(run.r.done).toBe(true);
    expect(run.r.step).toBe(3);
    expect(run.sim.edits.filter((e) => e[2] === 1).length - count(city().cells, 1)).toBeGreaterThanOrEqual(6);
  });

  it('takes about ten to twelve seconds on a normal machine', () => {
    const run = runAll(0);
    expect(run.doneAt).toBeGreaterThanOrEqual(10000);
    expect(run.doneAt).toBeLessThanOrEqual(12000);
  });

  it('the D* Lite plan from scratch is quiet: calm on before it is asked for, off once its event has landed, before the second wall', () => {
    const run = runAll(120);
    const dstar = firstMark(run, 'mode:dstar');
    const calmOn = firstMark(run, 'host:calm:true');
    const calmOff = firstMark(run, 'host:calm:false');
    const wall2 = run.marks.filter((m) => m.what === 'wall').map((m) => m.t).pop()!;
    expect(calmOn).toBeGreaterThan(0);
    expect(calmOn).toBeLessThanOrEqual(dstar);
    expect(calmOff).toBeGreaterThanOrEqual(dstar + 120);
    expect(wall2).toBeGreaterThan(calmOff);
  });

  it('the scripted walls are short straight walls clear of buildings, on the route, and do not overlap', () => {
    const run = runAll();
    const base = count(city().cells, 1);
    const painted = new Set<number>();
    const c = city().cells;
    run.sim.edits.filter((e) => e[2] === 1).forEach((e) => painted.add(e[1] * W + e[0]));
    const walls = [...painted].filter((i) => c[i] !== 1);
    expect(painted.size).toBe(base + walls.length);
    expect(walls.length).toBeGreaterThanOrEqual(6);
    expect(walls.length).toBeLessThanOrEqual(10);
    for (const i of walls) {
      const x = i % W; const y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(c[(y + dy) * W + x + dx]).not.toBe(1);
    }
  });

  it('chooses each wall with pickWall on the live grid and route', () => {
    const sim = fakeSim();
    const grid = new Uint8Array(W * H);
    const want = pickWall({ grid: city().cells, width: W, height: H, path: sim.path, pathIdx: sim.pathIdx, pathLen: sim.pathLen, lidarRadius: sim.lidarRadius });
    expect(want.length).toBeGreaterThanOrEqual(3);
    expect(grid.length).toBe(W * H);
    const run = runAll();
    const first = run.sim.edits.filter((e) => e[2] === 1 && city().cells[e[1] * W + e[0]] !== 1).slice(0, want.length);
    expect(first.map((e) => ({ x: e[0], y: e[1] }))).toEqual(want);
  });

  it('never starts a replan while the previous one is still playing, whatever the planner latency', () => {
    for (const latency of [0, 150, 600, 1400]) {
      const run = runAll(latency);
      const loud = run.sim.planned; // finish times of planning calls: import (load), block1, dstar (calm), block2
      // calls after the empty-map load and the painting resets
      const calls = loud.filter((t) => t >= CUES.paintMs + 400);
      expect(calls.length).toBeGreaterThanOrEqual(4);
      for (let i = 1; i < calls.length; i++) {
        const isCalmCall = i === 2;
        const need = isCalmCall ? DRAW_START_MS + DRAW_MS : (i === 3 ? 0 : DRAW_START_MS + DRAW_MS);
        expect(calls[i] - calls[i - 1], `call ${i} at latency ${latency}`).toBeGreaterThanOrEqual(need - 16);
      }
      // the second repair and the quiet D* plan are each a whole sequence after their neighbours
      expect(calls[2] - calls[1]).toBeGreaterThanOrEqual(REPLAN_TOTAL_MS - 16);
      expect(run.doneAt - calls[3]).toBeGreaterThanOrEqual(REPLAN_TOTAL_MS - 16);
    }
  });

  it('a slow planner stretches the run instead of overlapping floods', () => {
    const fast = runAll(0);
    const slow = runAll(900);
    expect(slow.doneAt).toBeGreaterThan(fast.doneAt);
    expect(slow.r.done).toBe(true);
  });

  it('a planner that never answers cannot hang it: waits time out and the run still finishes', () => {
    const run = runAll(0, { never: true });
    expect(run.r.done).toBe(true);
    expect(run.doneAt).toBeLessThanOrEqual(HARD_CAP_MS + 100);
    expect(EVENT_TIMEOUT_MS).toBeLessThan(HARD_CAP_MS);
  });

  it('a very late first frame still fires only one cue per update (no two replans at once)', () => {
    const sim = fakeSim();
    const host = fakeHost();
    const r = new IntroRunner(sim, host, city(), empty());
    r.start();
    sim.log.length = 0;
    r.update(15000);
    expect(sim.log.filter((l) => l === 'import:city').length).toBe(1);
    expect(sim.log.includes('playing:true')).toBe(false);
    expect(sim.log.includes('mode:dstar')).toBe(false);
  });

  it('finish pauses where the drone is, hands the console back and restores speed', () => {
    const sim = fakeSim();
    const host = fakeHost();
    const r = new IntroRunner(sim, host, city(), empty());
    r.start();
    sim.log.length = 0;
    host.log.length = 0;
    r.finish();
    expect(sim.log).toEqual(['playing:false']);
    expect(host.log).toEqual(['quiet:false', 'calm:false', 'ui-playing:false', 'restore']);
  });

  it('skip leaves a normal state: Urban Canyon loaded, A*, paused, not quiet, restored', () => {
    const sim = fakeSim();
    const host = fakeHost();
    const r = new IntroRunner(sim, host, city(), empty());
    r.start();
    paintAll(r, sim);
    sim.log.length = 0;
    host.log.length = 0;
    r.skip();
    expect(sim.log).toEqual(['playing:false', 'import:city', 'mode:astar']);
    expect(host.log).toEqual(['quiet:false', 'calm:false', 'ui-mode:astar', 'ui-playing:false', 'restore']);
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
    expect(host.log).toEqual(['quiet:false', 'calm:false', 'ui-mode:astar', 'ui-playing:false', 'restore']);
  });

  it('starts on step 0 with an idle readout (no plan from the intro yet)', () => {
    const sim = fakeSim();
    const r = new IntroRunner(sim, fakeHost(), city(), empty());
    r.start();
    expect(r.step).toBe(0);
    expect(r.done).toBe(false);
    expect(SEQUENCE[0].minAt).toBeGreaterThanOrEqual(CUES.paintMs);
  });
});
