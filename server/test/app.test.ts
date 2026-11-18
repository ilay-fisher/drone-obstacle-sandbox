import { describe, expect, it } from 'vitest';
import { buildTestApp, validRun, validScenario } from './helpers.js';
import type { ScenarioRepository } from '../src/repositories/types.js';

describe('health', () => {
  it('reports db ok', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
    await app.close();
  });

  it('reports db down when the check fails or throws', async () => {
    for (const checkDb of [
      async () => false,
      async (): Promise<boolean> => {
        throw new Error('boom');
      },
    ]) {
      const { app } = await buildTestApp({ checkDb });
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok', db: 'down' });
      await app.close();
    }
  });
});

describe('error handling', () => {
  it('returns a JSON 404 for unknown routes', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    await app.close();
  });

  it('returns 500 internal_error without leaking details or stack', async () => {
    const { scenarios } = await buildTestApp();
    const broken: ScenarioRepository = {
      list: async () => {
        throw new Error('password=hunter2 at /srv/secret.ts');
      },
      get: scenarios.get.bind(scenarios),
      create: scenarios.create.bind(scenarios),
      delete: scenarios.delete.bind(scenarios),
    };
    const { app } = await buildTestApp({ scenarios: broken });
    const res = await app.inject({ method: 'GET', url: '/api/scenarios' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'internal_error', message: 'Internal server error' } });
    expect(res.body).not.toContain('hunter2');
    expect(res.body).not.toContain('secret.ts');
    await app.close();
  });

  it('rate limits POST routes with 429 and the error format', async () => {
    const { app } = await buildTestApp({ rateLimit: { max: 2, timeWindowMs: 60_000 } });
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) {
      codes.push((await app.inject({ method: 'POST', url: '/api/runs', payload: validRun() })).statusCode);
    }
    expect(codes).toEqual([201, 201, 429]);
    const limited = await app.inject({ method: 'POST', url: '/api/scenarios', payload: validScenario() });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('rate_limited');
    // GET routes are not limited.
    for (let i = 0; i < 5; i++) {
      expect((await app.inject({ method: 'GET', url: '/api/runs' })).statusCode).toBe(200);
    }
    await app.close();
  });
});

describe('platform plugins', () => {
  it('serves the OpenAPI document and UI under /docs', async () => {
    const { app } = await buildTestApp();
    const json = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(json.statusCode).toBe(200);
    const paths = Object.keys(json.json().paths);
    expect(paths).toEqual(
      expect.arrayContaining(['/api/scenarios', '/api/scenarios/{id}', '/api/runs', '/api/stats', '/health']),
    );
    const ui = await app.inject({ method: 'GET', url: '/docs' });
    expect([200, 302]).toContain(ui.statusCode);
    await app.close();
  });

  it('sends CORS headers for the configured origin and helmet headers', async () => {
    const { app } = await buildTestApp({ corsOrigin: 'http://localhost:5173' });
    const res = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'http://localhost:5173' } });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    await app.close();
  });
});
