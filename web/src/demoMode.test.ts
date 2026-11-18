import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDemoMode, parseDemoFlag } from './demoMode';
import { checkHealth, createScenario, listScenarios, postRun } from './api/client';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('parseDemoFlag', () => {
  it('accepts only the literal string "true"', () => {
    expect(parseDemoFlag('true')).toBe(true);
    expect(parseDemoFlag('false')).toBe(false);
    expect(parseDemoFlag('1')).toBe(false);
    expect(parseDemoFlag('')).toBe(false);
    expect(parseDemoFlag(undefined)).toBe(false);
  });
});

describe('isDemoMode', () => {
  it('is off by default and on when VITE_DEMO_MODE=true', () => {
    vi.stubEnv('VITE_DEMO_MODE', '');
    expect(isDemoMode()).toBe(false);
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    expect(isDemoMode()).toBe(true);
  });
});

describe('api client in demo mode', () => {
  it('makes no network calls and reports the backend as offline', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await checkHealth()).toBe(false);
    await expect(listScenarios()).rejects.toMatchObject({ offline: true });
    await expect(postRun({
      scenarioId: null, engineMode: 'TS Fallback', planMode: 'astar', status: 'reached',
      replans: 1, avgReplanMs: 1, maxReplanMs: 1, nodesExpanded: 1, pathCost: 1, durationMs: 1,
    })).rejects.toMatchObject({ offline: true });
    await expect(createScenario({
      name: 'x', width: 1, height: 1, cells: 'AA==', start: { x: 0, y: 0 }, goal: { x: 0, y: 0 }, patrols: [],
    })).rejects.toMatchObject({ offline: true });
    expect(f).not.toHaveBeenCalled();
  });

  it('still calls fetch when demo mode is off', async () => {
    vi.stubEnv('VITE_DEMO_MODE', '');
    const f = vi.fn().mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    expect(await checkHealth()).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
