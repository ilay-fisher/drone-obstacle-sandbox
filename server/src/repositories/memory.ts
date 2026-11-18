import { randomUUID } from 'node:crypto';
import { NotFoundError } from '../errors.js';
import type { Run, RunInput, RunsQuery, Scenario, ScenarioInput, ScenarioSummary, Stats } from '../schemas.js';
import type { RunRepository, ScenarioRepository } from './types.js';

/**
 * Linear-interpolation percentile over ascending values: the same definition as
 * SQL `percentile_cont(p)`, so unit tests and the Postgres tests agree.
 */
export function percentileCont(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Map-backed scenario store for unit tests. Insertion order doubles as creation order. */
export class InMemoryScenarioRepository implements ScenarioRepository {
  private readonly rows = new Map<string, Scenario>();
  /** Fired when a scenario is deleted so the run store can null its references. */
  onDelete: (id: string) => void = () => {};

  async list(): Promise<ScenarioSummary[]> {
    return [...this.rows.values()]
      .reverse()
      .map(({ id, name, width, height, createdAt }) => ({ id, name, width, height, createdAt }));
  }

  async get(id: string): Promise<Scenario | null> {
    return this.rows.get(id) ?? null;
  }

  async create(input: ScenarioInput): Promise<Scenario> {
    const scenario: Scenario = { ...structuredClone(input), id: randomUUID(), createdAt: new Date().toISOString() };
    this.rows.set(scenario.id, scenario);
    return scenario;
  }

  async delete(id: string): Promise<boolean> {
    const existed = this.rows.delete(id);
    if (existed) this.onDelete(id);
    return existed;
  }
}

/** Array-backed run store for unit tests; mirrors the ON DELETE SET NULL foreign key. */
export class InMemoryRunRepository implements RunRepository {
  private readonly rows: Run[] = [];

  /** @param scenarios when given, enforces the same foreign key as Postgres (existence and SET NULL on delete). */
  constructor(private readonly scenarios?: InMemoryScenarioRepository) {
    if (scenarios) {
      scenarios.onDelete = (id) => {
        for (const r of this.rows) if (r.scenarioId === id) r.scenarioId = null;
      };
    }
  }

  async create(input: RunInput): Promise<Run> {
    if (input.scenarioId && this.scenarios && !(await this.scenarios.get(input.scenarioId))) throw new NotFoundError('Scenario');
    const run: Run = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.rows.push(run);
    return run;
  }

  async list({ scenarioId, limit }: RunsQuery): Promise<Run[]> {
    return this.rows
      .filter((r) => scenarioId === undefined || r.scenarioId === scenarioId)
      .reverse()
      .slice(0, limit);
  }

  async stats(): Promise<Stats> {
    const all = this.rows.map((r) => r.avgReplanMs);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const modes = [...new Set(this.rows.map((r) => r.engineMode))].sort();
    return {
      totalRuns: all.length,
      avgReplanMs: mean(all),
      p95ReplanMs: percentileCont(all.toSorted((a, b) => a - b), 0.95),
      byEngine: modes.map((mode) => {
        const xs = this.rows.filter((r) => r.engineMode === mode).map((r) => r.avgReplanMs);
        return { mode, runs: xs.length, avgReplanMs: mean(xs) };
      }),
    };
  }
}
