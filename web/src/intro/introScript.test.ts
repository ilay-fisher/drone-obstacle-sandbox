import { describe, expect, it } from 'vitest';
import { SEQUENCE } from './introSequence';
import { CUES, INTRO_STEPS, OUTRO_CAPTION, OUTRO_MS, STEPS_MS, TOTAL_MS } from './introScript';

describe('intro script', () => {
  it('has the four spec captions in order', () => {
    expect(INTRO_STEPS.map((s) => s.caption)).toEqual([
      'This is a city. The drone has to cross it.',
      'It plans a route with A*.',
      'Something blocks the way.',
      'It repairs only what changed with D* Lite.',
    ]);
    expect(INTRO_STEPS.map((s) => s.id)).toEqual([1, 2, 3, 4]);
    expect(OUTRO_CAPTION).toBe('Your turn: draw a wall in its path.');
  });

  it('runs about ten seconds of guided steps, then a short outro', () => {
    expect(STEPS_MS).toBeGreaterThanOrEqual(9000);
    expect(STEPS_MS).toBeLessThanOrEqual(11000);
    expect(TOTAL_MS).toBe(STEPS_MS + OUTRO_MS);
  });

  it('paints the city before it is loaded for the A* plan', () => {
    expect(CUES.paintStart).toBe(0);
    expect(CUES.paintStart + CUES.paintMs).toBeLessThanOrEqual(SEQUENCE[0].minAt);
  });

  it('the cue table is in time order and ends inside the guided steps', () => {
    for (let i = 1; i < SEQUENCE.length; i++) expect(SEQUENCE[i].minAt).toBeGreaterThanOrEqual(SEQUENCE[i - 1].minAt);
    expect(SEQUENCE[SEQUENCE.length - 1].minAt).toBeLessThan(STEPS_MS);
  });
});
