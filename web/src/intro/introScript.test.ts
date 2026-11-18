import { describe, expect, it } from 'vitest';
import { TOTAL_MS as REPLAN_TOTAL_MS } from '../render/replanTimeline';
import {
  CUES, INTRO_STEPS, OUTRO_CAPTION, OUTRO_MS, STEPS_MS, TOTAL_MS, captionAt, phaseAt, stepAt, stepIndexAt,
} from './introScript';

describe('intro script timeline', () => {
  it('has the four spec captions in order', () => {
    expect(INTRO_STEPS.map((s) => s.caption)).toEqual([
      'This is a city. The drone has to cross it.',
      'It plans a route with A*.',
      'Something blocks the way.',
      'It repairs only what changed with D* Lite.',
    ]);
    expect(OUTRO_CAPTION).toBe('Your turn: draw a wall in its path.');
  });

  it('steps are contiguous, start at 0 and end at STEPS_MS', () => {
    expect(INTRO_STEPS[0].startMs).toBe(0);
    for (let i = 1; i < INTRO_STEPS.length; i++) expect(INTRO_STEPS[i].startMs).toBe(INTRO_STEPS[i - 1].endMs);
    expect(INTRO_STEPS[INTRO_STEPS.length - 1].endMs).toBe(STEPS_MS);
    for (const s of INTRO_STEPS) expect(s.endMs).toBeGreaterThan(s.startMs);
  });

  it('runs about ten seconds of guided steps, then a short outro', () => {
    expect(STEPS_MS).toBeGreaterThanOrEqual(9000);
    expect(STEPS_MS).toBeLessThanOrEqual(11000);
    expect(TOTAL_MS).toBe(STEPS_MS + OUTRO_MS);
  });

  it('returns the step in force at time t, with exact boundaries belonging to the next step', () => {
    expect(stepIndexAt(0)).toBe(0);
    expect(stepIndexAt(INTRO_STEPS[0].endMs - 1)).toBe(0);
    for (let i = 1; i < INTRO_STEPS.length; i++) {
      expect(stepIndexAt(INTRO_STEPS[i].startMs - 1)).toBe(i - 1);
      expect(stepIndexAt(INTRO_STEPS[i].startMs)).toBe(i);
    }
    expect(stepAt(INTRO_STEPS[2].startMs + 10)?.id).toBe(3);
  });

  it('is -1 outside the guided steps and clamps bad input', () => {
    expect(stepIndexAt(STEPS_MS)).toBe(-1);
    expect(stepIndexAt(TOTAL_MS + 1)).toBe(-1);
    expect(stepIndexAt(-5)).toBe(0);
    expect(stepIndexAt(Number.NaN)).toBe(0);
    expect(stepAt(STEPS_MS + 5)).toBeNull();
  });

  it('phases: steps, then outro, then done', () => {
    expect(phaseAt(0)).toBe('steps');
    expect(phaseAt(STEPS_MS - 1)).toBe('steps');
    expect(phaseAt(STEPS_MS)).toBe('outro');
    expect(phaseAt(TOTAL_MS - 1)).toBe('outro');
    expect(phaseAt(TOTAL_MS)).toBe('done');
  });

  it('captionAt follows the phases and is null when done', () => {
    expect(captionAt(100)).toBe(INTRO_STEPS[0].caption);
    expect(captionAt(STEPS_MS + 10)).toBe(OUTRO_CAPTION);
    expect(captionAt(TOTAL_MS)).toBeNull();
  });
});

describe('intro cues', () => {
  it('fire in order inside their steps', () => {
    expect(CUES.paintStart).toBe(0);
    expect(CUES.paintStart + CUES.paintMs).toBeLessThanOrEqual(CUES.loadCity);
    expect(CUES.loadCity).toBe(INTRO_STEPS[1].startMs);
    expect(CUES.play).toBeGreaterThan(CUES.loadCity);
    expect(CUES.play).toBeLessThan(INTRO_STEPS[2].startMs);
    expect(CUES.block1).toBeGreaterThanOrEqual(INTRO_STEPS[2].startMs);
    expect(CUES.block1).toBeLessThan(INTRO_STEPS[2].endMs);
    expect(CUES.dstar).toBeGreaterThanOrEqual(INTRO_STEPS[3].startMs);
    expect(CUES.block2).toBeGreaterThan(CUES.dstar);
    expect(CUES.block2).toBeLessThan(STEPS_MS);
  });

  it('keep replans a full replan sequence apart (one loud motion at a time)', () => {
    const lidarDelay = 500;
    expect(CUES.dstar - CUES.block1).toBeGreaterThanOrEqual(REPLAN_TOTAL_MS + lidarDelay);
    expect(CUES.block2 - CUES.dstar).toBeGreaterThanOrEqual(REPLAN_TOTAL_MS);
    expect(CUES.loadCity + REPLAN_TOTAL_MS).toBeLessThanOrEqual(CUES.block1);
  });

  it('never put a caption change inside a replan sequence unless it is the replan that caused it', () => {
    // A caption change may only tick; the cue that starts a step may coincide with its own replan.
    const replanStarts = [CUES.loadCity, CUES.dstar];
    const stepStarts = INTRO_STEPS.slice(1).map((s) => s.startMs);
    for (const c of stepStarts) {
      for (const r of replanStarts) {
        const inside = c > r && c < r + REPLAN_TOTAL_MS;
        expect(inside, `step change ${c} inside replan starting ${r}`).toBe(false);
      }
    }
  });
});
