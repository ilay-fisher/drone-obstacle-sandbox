import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, checkHealth, decodeCells, encodeCells, listScenarios, postRun } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('cell encoding', () => {
  it('round-trips every byte value', () => {
    const a = new Uint8Array(256);
    for (let i = 0; i < 256; i++) a[i] = i;
    expect(Array.from(decodeCells(encodeCells(a)))).toEqual(Array.from(a));
  });

  it('round-trips a full default grid', () => {
    const a = new Uint8Array(48 * 30);
    for (let i = 0; i < a.length; i++) a[i] = i % 3;
    const b64 = encodeCells(a);
    expect(typeof b64).toBe('string');
    expect(Array.from(decodeCells(b64))).toEqual(Array.from(a));
  });
});

describe('api client', () => {
  // Pin demo mode off so these tests do not depend on an ambient VITE_DEMO_MODE (e.g. CI).
  beforeEach(() => vi.stubEnv('VITE_DEMO_MODE', 'false'));

  it('flags network failures as offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed to fetch')));
    await expect(listScenarios()).rejects.toMatchObject({ offline: true });
    await expect(listScenarios()).rejects.toBeInstanceOf(ApiError);
    expect(await checkHealth()).toBe(false);
  });

  it('maps server errors to ApiError with the contract code', async () => {
    const body = { error: { code: 'NOT_FOUND', message: 'nope' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 404 })));
    await expect(listScenarios()).rejects.toMatchObject({ offline: false, code: 'NOT_FOUND', status: 404 });
  });

  it('parses a scenario list', async () => {
    const rows = [{ id: 'a', name: 'x', width: 48, height: 30, createdAt: 't' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(rows), { status: 200 })));
    expect(await listScenarios()).toEqual(rows);
  });

  it('posts runs as JSON', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', f);
    await postRun({
      scenarioId: null, engineMode: 'TS Fallback', planMode: 'astar', status: 'reached',
      replans: 1, avgReplanMs: 1, maxReplanMs: 1, nodesExpanded: 1, pathCost: 1, durationMs: 1,
    });
    expect(f.mock.calls[0][0]).toBe('/api/runs');
    expect(f.mock.calls[0][1].method).toBe('POST');
  });
});
