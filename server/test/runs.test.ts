import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, validRun, validScenario } from './helpers.js';

let app: FastifyInstance;

beforeEach(async () => {
  ({ app } = await buildTestApp());
});
afterEach(async () => {
  await app.close();
});

const post = (payload: unknown) => app.inject({ method: 'POST', url: '/api/runs', payload: payload as object });

describe('POST /api/runs', () => {
  it('creates a run with a null scenario', async () => {
    const res = await post(validRun());
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject(validRun());
    expect(res.json().id).toBeTypeOf('string');
    expect(res.json().createdAt).toBeTypeOf('string');
  });

  it('creates a run linked to an existing scenario', async () => {
    const sc = (await app.inject({ method: 'POST', url: '/api/scenarios', payload: validScenario() })).json();
    const res = await post(validRun({ scenarioId: sc.id }));
    expect(res.statusCode).toBe(201);
    expect(res.json().scenarioId).toBe(sc.id);
  });

  it('returns 404 when the scenario does not exist', async () => {
    const res = await post(validRun({ scenarioId: '6f1c2a9e-0d5b-4c43-8d57-2f0e2a1b9c11' }));
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });

  it('accepts pathCost -1 for blocked runs', async () => {
    expect((await post(validRun({ status: 'blocked', pathCost: -1 }))).statusCode).toBe(201);
  });

  const bad: [string, Record<string, unknown>][] = [
    ['unknown engineMode', { engineMode: 'GPU' }],
    ['unknown planMode', { planMode: 'bfs' }],
    ['unknown status', { status: 'crashed' }],
    ['scenarioId not a uuid', { scenarioId: 'abc' }],
    ['missing scenarioId', { scenarioId: undefined }],
    ['negative replans', { replans: -1 }],
    ['fractional replans', { replans: 1.5 }],
    ['negative avgReplanMs', { avgReplanMs: -0.1 }],
    ['string maxReplanMs', { maxReplanMs: 'fast' }],
    ['negative nodesExpanded', { nodesExpanded: -5 }],
    ['pathCost below -1', { pathCost: -2 }],
    ['negative durationMs', { durationMs: -1 }],
    ['missing durationMs', { durationMs: undefined }],
  ];
  it.each(bad)('rejects %s with 400 validation_error', async (_label, override) => {
    const res = await post(validRun(override));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });
});

describe('GET /api/runs', () => {
  const seed = async (n: number, scenarioId: string | null = null) => {
    for (let i = 0; i < n; i++) await post(validRun({ scenarioId, replans: i }));
  };

  it('returns newest first', async () => {
    await seed(3);
    const list = (await app.inject({ method: 'GET', url: '/api/runs' })).json();
    expect(list.map((r: { replans: number }) => r.replans)).toEqual([2, 1, 0]);
  });

  it('defaults the limit to 20', async () => {
    await seed(25);
    const list = (await app.inject({ method: 'GET', url: '/api/runs' })).json();
    expect(list).toHaveLength(20);
  });

  it('honours limit', async () => {
    await seed(5);
    const list = (await app.inject({ method: 'GET', url: '/api/runs?limit=2' })).json();
    expect(list.map((r: { replans: number }) => r.replans)).toEqual([4, 3]);
  });

  it.each(['0', '101', 'abc', '-3', '1.5'])('rejects limit=%s with 400', async (limit) => {
    const res = await app.inject({ method: 'GET', url: `/api/runs?limit=${limit}` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('accepts the limit bounds 1 and 100', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/runs?limit=1' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/runs?limit=100' })).statusCode).toBe(200);
  });

  it('filters by scenarioId', async () => {
    const a = (await app.inject({ method: 'POST', url: '/api/scenarios', payload: validScenario() })).json();
    const b = (await app.inject({ method: 'POST', url: '/api/scenarios', payload: validScenario() })).json();
    await seed(2, a.id);
    await seed(3, b.id);
    const list = (await app.inject({ method: 'GET', url: `/api/runs?scenarioId=${a.id}` })).json();
    expect(list).toHaveLength(2);
    expect(list.every((r: { scenarioId: string }) => r.scenarioId === a.id)).toBe(true);
  });

  it('rejects a malformed scenarioId', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs?scenarioId=zzz' });
    expect(res.statusCode).toBe(400);
  });

  it('keeps runs (scenarioId becomes null) after their scenario is deleted', async () => {
    const sc = (await app.inject({ method: 'POST', url: '/api/scenarios', payload: validScenario() })).json();
    await seed(1, sc.id);
    await app.inject({ method: 'DELETE', url: `/api/scenarios/${sc.id}` });
    const list = (await app.inject({ method: 'GET', url: '/api/runs' })).json();
    expect(list).toHaveLength(1);
    expect(list[0].scenarioId).toBeNull();
  });
});
