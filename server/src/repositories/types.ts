import type { Run, RunInput, RunsQuery, Scenario, ScenarioInput, ScenarioSummary, Stats } from '../schemas.js';

/**
 * Persistence port for scenarios. Routes depend on this interface only, so unit
 * tests run against the in-memory implementation and production uses Postgres.
 */
export interface ScenarioRepository {
  /** Summaries (no grid payload), newest first. */
  list(): Promise<ScenarioSummary[]>;
  get(id: string): Promise<Scenario | null>;
  create(input: ScenarioInput): Promise<Scenario>;
  /** Returns false when no scenario had that id. */
  delete(id: string): Promise<boolean>;
}

/** Persistence port for run telemetry. */
export interface RunRepository {
  create(input: RunInput): Promise<Run>;
  /** Newest first; optionally restricted to one scenario. */
  list(query: RunsQuery): Promise<Run[]>;
  /** Aggregates of the per-run average replan latency. All zero when there are no runs. */
  stats(): Promise<Stats>;
}
