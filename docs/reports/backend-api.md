# Report: backend API (Agent C)

Branch `feat/backend-api`. Scope: `server/`, `docker-compose.yml`, `.github/workflows/ci-server.yml`, this file.

## What was built
Fastify 5 + TypeScript (strict) REST API implementing `docs/CONTRACTS.md` section 4, backed by
PostgreSQL 16, with an in-memory twin of the persistence layer for unit tests.

```
routes/ (zod schemas, HTTP only)
   |  depends on interfaces only
repositories/types.ts  <-- ScenarioRepository, RunRepository
   |-- pg.ts      PgScenarioRepository / PgRunRepository (pg Pool, SQL, BYTEA, percentile_cont)
   '-- memory.ts  InMemory* (tests)
app.ts   buildApp(deps): plugins, error handler, routes (no listen)
server.ts  entrypoint: config, pool, migrations, listen, SIGTERM/SIGINT shutdown
```

Endpoints: `GET /health`, `GET/POST /api/scenarios`, `GET/DELETE /api/scenarios/:id`,
`POST/GET /api/runs`, `GET /api/stats`, OpenAPI UI at `/docs` (JSON at `/docs/json`).

## Decisions
- **Validation**: zod 4 with `fastify-type-provider-zod`. One `superRefine` on the scenario body checks strict base64, decoded length equals `width*height`, every byte in {0,1,2}, start/goal/patrols inside the grid. Schemas also feed OpenAPI.
- **Errors**: one handler. `AppError` subclasses carry safe messages; zod errors become `400 validation_error`; Fastify client errors (bad JSON, 413, 415) keep their status; everything else is `500 internal_error` with a fixed message, details only in the log.
- **Storage**: `cells` is BYTEA with a CHECK that its size equals `width*height`. `created_at` defaults to `clock_timestamp()` so ordering is stable inside one transaction. Indexes: `runs(scenario_id, created_at DESC)`, `runs(created_at DESC)`, `scenarios(created_at DESC)`.
- **Stats**: a single SQL statement (count, avg, `percentile_cont(0.95)`, per-engine `json_agg`) so totals and breakdown share one snapshot. The in-memory repo implements the same linear-interpolation percentile, and both test suites assert the same value (9.55 for 1..10). The statistic is over each run's `avgReplanMs`.
- **Migrations**: plain SQL in `server/migrations`, runner takes a Postgres advisory lock, applies each file in a transaction, records it in `schema_migrations`. Startup retries up to 10 times while Postgres boots.
- **Logging**: pino JSON, request id (`x-request-id` or uuid), latency from Fastify. Grids are never logged, only sizes. DB failures log operation name and `pgCode`. Startup logs config with the DB credentials stripped. `/health` logs at warn level to keep Docker polling out of the logs. `pino-pretty` only when `NODE_ENV=development`.
- **Security**: helmet, CORS limited to `CORS_ORIGIN` (default `http://localhost:5173`), body limit 128 KiB, rate limit on POST routes (120 per minute per client per route).
- **Compose**: host ports bind to 127.0.0.1 and are overridable with `API_PORT` / `DB_PORT` (port 3001 was already used on the dev machine).

## Deviations / additions to the contract (all additive)
- `GET /api/scenarios/:id` with a non-uuid id returns 400 `validation_error` (not 404).
- `POST /api/runs` with an unknown `scenarioId` returns 404 `not_found`. Deleting a scenario keeps its runs with `scenarioId: null` (`ON DELETE SET NULL`).
- Extra bounds on `RunInput` (not in the contract): counts are integers >= 0, times >= 0, `pathCost >= -1` (-1 means no path, per `getPathCost`).
- Patrols must start inside the grid; `dx`/`dy` are integers.
- `/health` always answers 200 with `db: "down"` when Postgres is unreachable (matches the contract's shape; the API process itself is alive).
- `/api/stats` returns zeros and an empty `byEngine` when there are no runs.
- The 429 limit is per route, not shared across POST routes.

## Tests
- `npm test` without a database: 76 passed, 10 skipped (integration).
- With `DATABASE_URL` set: 86 passed (adds migrations idempotence, index presence, BYTEA round trip, ordering and limit, FK `SET NULL`, percentile and per-engine stats, empty stats).
- Unit suite covers every endpoint, every validation failure listed in the contract, 404s, error format, 500 masking, 429, CORS/helmet, `/docs`, config parsing, stats math.

## Size (non-test)
About 720 lines of TypeScript plus 40 lines of SQL, slightly above the 500-700 budget (long, explicit pg mapping and doc comments account for it).

## Known limits
- No authentication; anyone who can reach the port can read and write. Acceptable for a local sandbox, not for the public internet.
- Rate limiter state is in memory, so it is per process.
- No pagination on `GET /api/scenarios`.
- Fastify's `trustProxy` is off: behind a reverse proxy the limiter would see the proxy's address.
- The Docker image was built and run locally; the GitHub Actions workflow is unverified until it runs on the PR.
