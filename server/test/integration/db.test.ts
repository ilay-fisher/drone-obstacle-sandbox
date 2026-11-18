import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { runMigrations } from '../../src/migrate.js';
import { PgRunRepository, PgScenarioRepository } from '../../src/repositories/pg.js';
import { buildApp } from '../../src/app.js';
import { validRun, validScenario } from '../helpers.js';

const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('postgres integration', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;

  const call = (method: 'GET' | 'POST' | 'DELETE', path: string, payload?: object) =>
    app.inject({ method, url: path, ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await runMigrations(pool);
    app = await buildApp({
      scenarios: new PgScenarioRepository(pool),
      runs: new PgRunRepository(pool),
      checkDb: async () => (await pool.query('SELECT 1')).rowCount === 1,
      logger: false,
    });
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE runs, scenarios');
  });

  it('applies migrations idempotently and records them', async () => {
    expect(await runMigrations(pool)).toEqual([]);
    const { rows } = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].name).toMatch(/^001_.*\.sql$/);
  });

  it('creates the runs index on (scenario_id, created_at desc)', async () => {
    const { rows } = await pool.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'runs' AND indexdef ILIKE '%scenario_id, created_at DESC%'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('reports db ok on /health', async () => {
    expect((await call('GET', '/health')).json()).toEqual({ status: 'ok', db: 'ok' });
  });

  it('round-trips a scenario with BYTEA cells byte for byte', async () => {
    const cells = new Uint8Array(10 * 8);
    for (let i = 0; i < cells.length; i++) cells[i] = i % 3;
    const body = validScenario({ cells: Buffer.from(cells).toString('base64') });
    const created = await call('POST', '/api/scenarios', body);
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect((await call('GET', `/api/scenarios/${id}`)).json()).toMatchObject(body);
    const raw = await pool.query('SELECT cells FROM scenarios WHERE id = $1', [id]);
    expect(Buffer.compare(raw.rows[0].cells, Buffer.from(cells))).toBe(0);
  });

  it('lists summaries, deletes and returns 404 afterwards', async () => {
    const id = (await call('POST', '/api/scenarios', validScenario())).json().id;
    const list = (await call('GET', '/api/scenarios')).json();
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('cells');
    expect((await call('DELETE', `/api/scenarios/${id}`)).statusCode).toBe(204);
    expect((await call('DELETE', `/api/scenarios/${id}`)).statusCode).toBe(404);
    expect((await call('GET', `/api/scenarios/${id}`)).statusCode).toBe(404);
  });

  it('orders runs newest first, honours limit and scenario filter', async () => {
    const a = (await call('POST', '/api/scenarios', validScenario())).json().id;
    for (let i = 0; i < 5; i++) {
      await call('POST', '/api/runs', validRun({ scenarioId: i < 3 ? a : null, replans: i }));
    }
    const all = (await call('GET', '/api/runs?limit=3')).json();
    expect(all.map((r: { replans: number }) => r.replans)).toEqual([4, 3, 2]);
    const filtered = (await call('GET', `/api/runs?scenarioId=${a}`)).json();
    expect(filtered.map((r: { replans: number }) => r.replans)).toEqual([2, 1, 0]);
  });

  it('returns 404 for a run that references a missing scenario', async () => {
    const res = await call('POST', '/api/runs', validRun({ scenarioId: '6f1c2a9e-0d5b-4c43-8d57-2f0e2a1b9c11' }));
    expect(res.statusCode).toBe(404);
  });

  it('sets scenario_id to null when the scenario is deleted', async () => {
    const a = (await call('POST', '/api/scenarios', validScenario())).json().id;
    await call('POST', '/api/runs', validRun({ scenarioId: a }));
    await call('DELETE', `/api/scenarios/${a}`);
    const list = (await call('GET', '/api/runs')).json();
    expect(list).toHaveLength(1);
    expect(list[0].scenarioId).toBeNull();
  });

  it('computes avg and p95 with percentile_cont and groups by engine', async () => {
    for (let v = 1; v <= 10; v++) {
      await call('POST', '/api/runs', validRun({ avgReplanMs: v, engineMode: v <= 4 ? 'TS Fallback' : 'C++ Wasm' }));
    }
    const s = (await call('GET', '/api/stats')).json();
    expect(s.totalRuns).toBe(10);
    expect(s.avgReplanMs).toBeCloseTo(5.5, 9);
    expect(s.p95ReplanMs).toBeCloseTo(9.55, 9);
    expect(s.byEngine).toEqual([
      { mode: 'C++ Wasm', runs: 6, avgReplanMs: 8 },
      { mode: 'TS Fallback', runs: 4, avgReplanMs: 2.5 },
    ]);
  });

  it('returns zeros for stats on an empty table', async () => {
    expect((await call('GET', '/api/stats')).json()).toEqual({ totalRuns: 0, avgReplanMs: 0, p95ReplanMs: 0, byEngine: [] });
  });
});
