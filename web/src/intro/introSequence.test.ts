import { describe, expect, it } from 'vitest';
import { DRAW_MS, DRAW_START_MS, TOTAL_MS as REPLAN_TOTAL_MS } from '../render/replanTimeline';
import {
  EVENT_TIMEOUT_MS, HARD_CAP_MS, SEQUENCE, initSeq, stepSeq, type SeqFire, type SeqState,
} from './introSequence';

/** A recording driver: a fake simulation whose planner answers each triggering cue after `latency` ms. */
function drive(opts: { latency?: number; never?: boolean; frame?: number; until?: number } = {}) {
  const { latency = 0, never = false, frame = 16, until = 60000 } = opts;
  let s: SeqState = initSeq();
  let seq = 0;
  const due: { at: number; seq: number }[] = [];
  const fired: { name: string; t: number }[] = [];
  const events: number[] = [];
  let doneAt = -1;
  for (let t = 0; t <= until && doneAt < 0; t += frame) {
    while (due.length && due[0].at <= t) { seq = due.shift()!.seq; events.push(t); }
    const r = stepSeq(s, t, seq);
    s = r.state;
    const f: SeqFire = r.fire;
    if (f === 'finish') { doneAt = t; break; }
    if (f) {
      fired.push({ name: f.name, t });
      if (f.replan && !never) due.push({ at: t + latency, seq: seq + 1 });
    }
  }
  return { fired, events, doneAt };
}
const at = (r: ReturnType<typeof drive>, name: string) => r.fired.find((f) => f.name === name)!.t;

describe('intro sequence', () => {
  it('fires the cues in order and finishes', () => {
    const r = drive();
    expect(r.fired.map((f) => f.name)).toEqual(['loadCity', 'play', 'block1', 'dstar', 'block2']);
    expect(r.doneAt).toBeGreaterThan(0);
  });

  it('on a normal machine the four steps take about 10 to 12 seconds', () => {
    const r = drive();
    expect(r.doneAt).toBeGreaterThanOrEqual(10000);
    expect(r.doneAt).toBeLessThanOrEqual(12000);
  });

  it('never fires a cue before its nominal time', () => {
    const r = drive();
    for (const c of SEQUENCE) expect(at(r, c.name)).toBeGreaterThanOrEqual(c.minAt);
  });

  it('never fires a replanning cue before the previous replan has played out', () => {
    for (const latency of [0, 80, 400, 900]) {
      const r = drive({ latency });
      const loud = r.fired.filter((f) => ['loadCity', 'block1', 'dstar', 'block2'].includes(f.name));
      expect(r.events.length).toBeGreaterThanOrEqual(4);
      for (let i = 1; i < loud.length; i++) {
        const prev = loud[i - 1].name;
        const gap = prev === 'dstar' ? 0 : DRAW_START_MS + DRAW_MS;
        expect(loud[i].t, `${loud[i].name} after ${prev} at latency ${latency}`).toBeGreaterThanOrEqual(r.events[i - 1] + gap);
      }
    }
  });

  it('keeps two floods apart: the quiet D* call waits out the whole replan sequence of the wall before it', () => {
    const r = drive({ latency: 300 });
    // events, in order: loadCity, block1, dstar, block2
    expect(at(r, 'dstar')).toBeGreaterThanOrEqual(r.events[1] + REPLAN_TOTAL_MS);
    expect(at(r, 'block1')).toBeGreaterThanOrEqual(r.events[0] + DRAW_START_MS + DRAW_MS);
    expect(r.doneAt).toBeGreaterThanOrEqual(r.events[3] + REPLAN_TOTAL_MS);
  });

  it('slow planner: a late event delays the next cue instead of overlapping it', () => {
    const fast = drive({ latency: 0 });
    const slow = drive({ latency: 1800 });
    expect(slow.fired.map((f) => f.name)).toEqual(fast.fired.map((f) => f.name));
    expect(at(slow, 'block1')).toBeGreaterThanOrEqual(at(fast, 'block1'));
    for (const n of ['dstar', 'block2']) expect(at(slow, n)).toBeGreaterThan(at(fast, n));
    expect(slow.doneAt).toBeGreaterThan(fast.doneAt);
    // the second wall waits for the quiet D* plan to exist, and the end for the second wall's repair
    expect(at(slow, 'block2')).toBeGreaterThanOrEqual(slow.events[2]);
    expect(slow.doneAt).toBeGreaterThanOrEqual(slow.events[3] + REPLAN_TOTAL_MS);
  });

  it('a planner that never answers cannot hang the intro: each wait times out', () => {
    const r = drive({ never: true });
    expect(r.doneAt).toBeGreaterThan(0);
    expect(r.doneAt).toBeLessThanOrEqual(HARD_CAP_MS + 16);
    expect(r.fired.map((f) => f.name)).toEqual(['loadCity', 'play', 'block1', 'dstar', 'block2']);
    expect(at(r, 'play') - at(r, 'loadCity')).toBeGreaterThanOrEqual(EVENT_TIMEOUT_MS);
  });

  it('the hard cap ends the run even if every wait is stretched', () => {
    const r = drive({ latency: 9000 });
    expect(r.doneAt).toBeGreaterThan(0);
    expect(r.doneAt).toBeLessThanOrEqual(HARD_CAP_MS + 16);
  });

  it('a very late first frame fires one cue per call, never two replans in one go', () => {
    const r1 = stepSeq(initSeq(), 15000, 0);
    expect(r1.fire).not.toBeNull();
    expect(r1.fire).not.toBe('finish');
    if (r1.fire && r1.fire !== 'finish') expect(r1.fire.name).toBe('loadCity');
    const r2 = stepSeq(r1.state, 15000, 0);
    // the city load has not answered yet, so the next cue waits
    expect(r2.fire).toBeNull();
  });

  it('exposes the caption step: 0 before the city loads, then 1, 2, 3 as the step cues fire', () => {
    expect(initSeq().step).toBe(0);
    let s = initSeq();
    let seq = 0;
    const steps: number[] = [];
    for (let t = 0; t <= 14000; t += 16) {
      if (s.pending && s.pending.eventAt === null && t > s.pending.firedAt) seq = s.pending.seq + 1;
      const x = stepSeq(s, t, seq);
      s = x.state;
      if (steps[steps.length - 1] !== s.step) steps.push(s.step);
      if (x.fire === 'finish') break;
    }
    expect(steps).toEqual([0, 1, 2, 3]);
  });

  it('is pure: the input state is never mutated', () => {
    const s = initSeq();
    const copy = JSON.stringify(s);
    stepSeq(s, 5000, 3);
    expect(JSON.stringify(s)).toBe(copy);
  });
});
