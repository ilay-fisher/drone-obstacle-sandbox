import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../src/app.js';
import { InMemoryRunRepository, InMemoryScenarioRepository } from '../src/repositories/memory.js';

/** Builds a valid scenario body (default 10x8 grid, one wall, one patrol). */
export function validScenario(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const width = 10;
  const height = 8;
  const cells = new Uint8Array(width * height);
  cells[13] = 1;
  cells[14] = 2;
  return {
    name: 'City block',
    width,
    height,
    cells: Buffer.from(cells).toString('base64'),
    start: { x: 0, y: 0 },
    goal: { x: 9, y: 7 },
    patrols: [{ x: 3, y: 3, dx: 1, dy: 0 }],
    ...overrides,
  };
}

/** Builds a valid run body. */
export function validRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scenarioId: null,
    engineMode: 'C++ Wasm',
    planMode: 'dstar',
    status: 'reached',
    replans: 4,
    avgReplanMs: 0.25,
    maxReplanMs: 0.9,
    nodesExpanded: 1200,
    pathCost: 51.3,
    durationMs: 8000,
    ...overrides,
  };
}

/** Base64 of `n` zero bytes. */
export function zeroCells(n: number): string {
  return Buffer.from(new Uint8Array(n)).toString('base64');
}

export interface TestApp {
  app: FastifyInstance;
  scenarios: InMemoryScenarioRepository;
  runs: InMemoryRunRepository;
}

/** Builds the app over in-memory repositories with logging off. */
export async function buildTestApp(overrides: Partial<AppDeps> = {}): Promise<TestApp> {
  const scenarios = new InMemoryScenarioRepository();
  const runs = new InMemoryRunRepository(scenarios);
  const app = await buildApp({
    scenarios,
    runs,
    checkDb: async () => true,
    logger: false,
    ...overrides,
  });
  return { app, scenarios, runs };
}
