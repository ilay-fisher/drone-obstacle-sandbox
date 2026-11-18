import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, validRun } from './helpers.js';

let app: FastifyInstance;

beforeEach(async () => {
  ({ app } = await buildTestApp());
});
afterEach(async () => {
  await app.close();
});

const postRun = (o: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/runs', payload: validRun(o) });
const stats = async () => (await app.inject({ method: 'GET', url: '/api/stats' })).json();

describe('GET /api/stats', () => {
  it('returns zeros and no engines when there are no runs', async () => {
    expect(await stats()).toEqual({ totalRuns: 0, avgReplanMs: 0, p95ReplanMs: 0, byEngine: [] });
  });

  it('computes avg and linear-interpolated p95 (same as percentile_cont)', async () => {
    // Values 1..10: mean 5.5, p95 at position 0.95 * 9 = 8.55 -> 9 + 0.55 * (10 - 9) = 9.55.
    for (let v = 1; v <= 10; v++) await postRun({ avgReplanMs: v });
    const s = await stats();
    expect(s.totalRuns).toBe(10);
    expect(s.avgReplanMs).toBeCloseTo(5.5, 9);
    expect(s.p95ReplanMs).toBeCloseTo(9.55, 9);
  });

  it('handles a single run', async () => {
    await postRun({ avgReplanMs: 2.5 });
    const s = await stats();
    expect(s.avgReplanMs).toBe(2.5);
    expect(s.p95ReplanMs).toBe(2.5);
  });

  it('groups by engine mode', async () => {
    await postRun({ engineMode: 'C++ Wasm', avgReplanMs: 1 });
    await postRun({ engineMode: 'C++ Wasm', avgReplanMs: 3 });
    await postRun({ engineMode: 'TS Fallback', avgReplanMs: 10 });
    const s = await stats();
    expect(s.byEngine).toEqual([
      { mode: 'C++ Wasm', runs: 2, avgReplanMs: 2 },
      { mode: 'TS Fallback', runs: 1, avgReplanMs: 10 },
    ]);
  });
});
