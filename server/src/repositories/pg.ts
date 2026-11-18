import type pg from 'pg';
import { NotFoundError } from '../errors.js';
import { decodeBase64 } from '../schemas.js';
import type { Run, RunInput, RunsQuery, Scenario, ScenarioInput, ScenarioSummary, Stats } from '../schemas.js';
import type { RunRepository, ScenarioRepository } from './types.js';

/** Minimal logger surface so repositories stay independent of Fastify. */
export interface DbLogger {
  error(obj: object, msg: string): void;
}

/** Shared query helper: logs failures with the operation name and Postgres error code, then rethrows. */
abstract class PgBase {
  constructor(
    protected readonly pool: pg.Pool,
    private readonly log?: DbLogger,
  ) {}

  protected async query<R extends pg.QueryResultRow>(op: string, text: string, params: unknown[] = []): Promise<pg.QueryResult<R>> {
    try {
      return await this.pool.query<R>(text, params);
    } catch (err) {
      this.log?.error({ err, op, pgCode: (err as { code?: string }).code }, 'database query failed');
      throw err;
    }
  }
}

interface ScenarioRow {
  id: string;
  name: string;
  width: number;
  height: number;
  cells: Buffer;
  start_x: number;
  start_y: number;
  goal_x: number;
  goal_y: number;
  patrols: Scenario['patrols'];
  created_at: Date;
}

const SCENARIO_COLUMNS = 'id, name, width, height, cells, start_x, start_y, goal_x, goal_y, patrols, created_at';

function toScenario(r: ScenarioRow): Scenario {
  return {
    id: r.id,
    name: r.name,
    width: r.width,
    height: r.height,
    cells: r.cells.toString('base64'),
    start: { x: r.start_x, y: r.start_y },
    goal: { x: r.goal_x, y: r.goal_y },
    patrols: r.patrols,
    createdAt: r.created_at.toISOString(),
  };
}

/** Postgres-backed scenario store. Grid bytes are stored as BYTEA, not base64 text. */
export class PgScenarioRepository extends PgBase implements ScenarioRepository {
  async list(): Promise<ScenarioSummary[]> {
    const { rows } = await this.query<Pick<ScenarioRow, 'id' | 'name' | 'width' | 'height' | 'created_at'>>(
      'scenarios.list',
      'SELECT id, name, width, height, created_at FROM scenarios ORDER BY created_at DESC, id DESC',
    );
    return rows.map((r) => ({ id: r.id, name: r.name, width: r.width, height: r.height, createdAt: r.created_at.toISOString() }));
  }

  async get(id: string): Promise<Scenario | null> {
    const { rows } = await this.query<ScenarioRow>('scenarios.get', `SELECT ${SCENARIO_COLUMNS} FROM scenarios WHERE id = $1`, [id]);
    return rows[0] ? toScenario(rows[0]) : null;
  }

  async create(s: ScenarioInput): Promise<Scenario> {
    const cells = decodeBase64(s.cells);
    if (!cells) throw new Error('cells must be validated before reaching the repository');
    const { rows } = await this.query<ScenarioRow>(
      'scenarios.create',
      `INSERT INTO scenarios (name, width, height, cells, start_x, start_y, goal_x, goal_y, patrols)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${SCENARIO_COLUMNS}`,
      [s.name, s.width, s.height, cells, s.start.x, s.start.y, s.goal.x, s.goal.y, JSON.stringify(s.patrols)],
    );
    return toScenario(rows[0]!);
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.query('scenarios.delete', 'DELETE FROM scenarios WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }
}

interface RunRow {
  id: string;
  scenario_id: string | null;
  engine_mode: Run['engineMode'];
  plan_mode: Run['planMode'];
  status: Run['status'];
  replans: number;
  avg_replan_ms: number;
  max_replan_ms: number;
  nodes_expanded: number;
  path_cost: number;
  duration_ms: number;
  created_at: Date;
}

const RUN_COLUMNS =
  'id, scenario_id, engine_mode, plan_mode, status, replans, avg_replan_ms, max_replan_ms, nodes_expanded, path_cost, duration_ms, created_at';

function toRun(r: RunRow): Run {
  return {
    id: r.id,
    scenarioId: r.scenario_id,
    engineMode: r.engine_mode,
    planMode: r.plan_mode,
    status: r.status,
    replans: r.replans,
    avgReplanMs: r.avg_replan_ms,
    maxReplanMs: r.max_replan_ms,
    nodesExpanded: r.nodes_expanded,
    pathCost: r.path_cost,
    durationMs: r.duration_ms,
    createdAt: r.created_at.toISOString(),
  };
}

/** Postgres-backed run store; statistics are computed in SQL, not in Node. */
export class PgRunRepository extends PgBase implements RunRepository {
  async create(r: RunInput): Promise<Run> {
    try {
      const { rows } = await this.query<RunRow>(
        'runs.create',
        `INSERT INTO runs (scenario_id, engine_mode, plan_mode, status, replans, avg_replan_ms, max_replan_ms, nodes_expanded, path_cost, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${RUN_COLUMNS}`,
        [r.scenarioId, r.engineMode, r.planMode, r.status, r.replans, r.avgReplanMs, r.maxReplanMs, r.nodesExpanded, r.pathCost, r.durationMs],
      );
      return toRun(rows[0]!);
    } catch (err) {
      // 23503 = foreign_key_violation: the scenario was deleted between the client's save and this insert.
      if ((err as { code?: string }).code === '23503') throw new NotFoundError('Scenario');
      throw err;
    }
  }

  async list({ scenarioId, limit }: RunsQuery): Promise<Run[]> {
    const where = scenarioId ? 'WHERE scenario_id = $2' : '';
    const params = scenarioId ? [limit, scenarioId] : [limit];
    const { rows } = await this.query<RunRow>(
      'runs.list',
      `SELECT ${RUN_COLUMNS} FROM runs ${where} ORDER BY created_at DESC, id DESC LIMIT $1`,
      params,
    );
    return rows.map(toRun);
  }

  async stats(): Promise<Stats> {
    // One statement keeps the totals and the per-engine breakdown on the same snapshot.
    const { rows } = await this.query<{ total: number; avg: number; p95: number; by_engine: Stats['byEngine'] }>(
      'runs.stats',
      `SELECT count(*)::int AS total,
              coalesce(avg(avg_replan_ms), 0) AS avg,
              coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY avg_replan_ms), 0) AS p95,
              (SELECT coalesce(json_agg(e ORDER BY e.mode), '[]'::json)
                 FROM (SELECT engine_mode AS mode, count(*)::int AS runs, avg(avg_replan_ms) AS "avgReplanMs"
                         FROM runs GROUP BY engine_mode) e) AS by_engine
         FROM runs`,
    );
    const r = rows[0]!;
    return { totalRuns: r.total, avgReplanMs: r.avg, p95ReplanMs: r.p95, byEngine: r.by_engine };
  }
}
