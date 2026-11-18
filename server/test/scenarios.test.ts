import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, validScenario, zeroCells } from './helpers.js';

let app: FastifyInstance;

beforeEach(async () => {
  ({ app } = await buildTestApp());
});
afterEach(async () => {
  await app.close();
});

const post = (payload: unknown) => app.inject({ method: 'POST', url: '/api/scenarios', payload: payload as object });

describe('POST /api/scenarios', () => {
  it('creates a scenario and returns 201 with id and createdAt', async () => {
    const body = validScenario();
    const res = await post(body);
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(created.createdAt).toString()).not.toBe('Invalid Date');
    expect(created).toMatchObject(body);
  });

  it('accepts an empty patrol list and the extreme grid sizes', async () => {
    expect((await post(validScenario({ patrols: [] }))).statusCode).toBe(201);
    const small = validScenario({ width: 8, height: 8, cells: zeroCells(64), goal: { x: 7, y: 7 }, patrols: [] });
    expect((await post(small)).statusCode).toBe(201);
    const big = validScenario({ width: 128, height: 128, cells: zeroCells(128 * 128), goal: { x: 127, y: 127 }, patrols: [] });
    expect((await post(big)).statusCode).toBe(201);
  });

  const bad: [string, Record<string, unknown>][] = [
    ['empty name', { name: '' }],
    ['name longer than 80', { name: 'x'.repeat(81) }],
    ['missing name', { name: undefined }],
    ['width below 8', { width: 7, cells: zeroCells(56) }],
    ['width above 128', { width: 129, cells: zeroCells(129 * 8) }],
    ['height below 8', { height: 7, cells: zeroCells(70) }],
    ['height above 128', { height: 129, cells: zeroCells(10 * 129) }],
    ['non-integer width', { width: 10.5 }],
    ['cells not base64', { cells: '!!!not base64!!!' }],
    ['cells not a string', { cells: [1, 2, 3] }],
    ['cells too short', { cells: zeroCells(79) }],
    ['cells too long', { cells: zeroCells(81) }],
    ['cell value 3', { cells: Buffer.from([3, ...new Uint8Array(79)]).toString('base64') }],
    ['start x outside grid', { start: { x: 10, y: 0 } }],
    ['start y outside grid', { start: { x: 0, y: 8 } }],
    ['goal negative', { goal: { x: -1, y: 0 } }],
    ['goal non-integer', { goal: { x: 1.5, y: 0 } }],
    ['missing goal', { goal: undefined }],
    ['more than 32 patrols', { patrols: Array.from({ length: 33 }, () => ({ x: 1, y: 1, dx: 1, dy: 0 })) }],
    ['patrol missing dx', { patrols: [{ x: 1, y: 1, dy: 0 }] }],
    ['patrol outside grid', { patrols: [{ x: 10, y: 1, dx: 1, dy: 0 }] }],
  ];
  it.each(bad)('rejects %s with 400 validation_error', async (_label, override) => {
    const res = await post(validScenario(override));
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('validation_error');
    expect(typeof body.error.message).toBe('string');
    expect(Object.keys(body)).toEqual(['error']);
  });

  it('accepts exactly 32 patrols', async () => {
    const patrols = Array.from({ length: 32 }, () => ({ x: 1, y: 1, dx: 1, dy: 0 }));
    expect((await post(validScenario({ patrols }))).statusCode).toBe(201);
  });

  it('rejects a malformed JSON body with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scenarios',
      headers: { 'content-type': 'application/json' },
      payload: '{nope',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBeTypeOf('string');
  });
});

describe('GET /api/scenarios', () => {
  it('returns an empty list initially', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scenarios' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns summaries without cells, start, goal or patrols, newest first', async () => {
    await post(validScenario({ name: 'first' }));
    await post(validScenario({ name: 'second' }));
    const res = await app.inject({ method: 'GET', url: '/api/scenarios' });
    const list = res.json();
    expect(list.map((s: { name: string }) => s.name)).toEqual(['second', 'first']);
    expect(Object.keys(list[0]).sort()).toEqual(['createdAt', 'height', 'id', 'name', 'width']);
  });
});

describe('GET /api/scenarios/:id', () => {
  it('round-trips the full scenario', async () => {
    const created = (await post(validScenario())).json();
    const res = await app.inject({ method: 'GET', url: `/api/scenarios/${created.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(created);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scenarios/6f1c2a9e-0d5b-4c43-8d57-2f0e2a1b9c11' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });

  it('returns 400 for a malformed id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scenarios/not-a-uuid' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });
});

describe('DELETE /api/scenarios/:id', () => {
  it('deletes and returns 204 with an empty body, then 404', async () => {
    const created = (await post(validScenario())).json();
    const del = await app.inject({ method: 'DELETE', url: `/api/scenarios/${created.id}` });
    expect(del.statusCode).toBe(204);
    expect(del.body).toBe('');
    const again = await app.inject({ method: 'DELETE', url: `/api/scenarios/${created.id}` });
    expect(again.statusCode).toBe(404);
    expect(again.json().error.code).toBe('not_found');
    const get = await app.inject({ method: 'GET', url: `/api/scenarios/${created.id}` });
    expect(get.statusCode).toBe(404);
  });
});
