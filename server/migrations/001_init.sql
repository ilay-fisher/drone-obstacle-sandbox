-- Scenarios and run telemetry. cells is the raw grid (one byte per cell, row-major);
-- BYTEA keeps it 1.33x smaller than base64 text and lets the CHECK enforce its size.
CREATE TABLE scenarios (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  width      smallint NOT NULL CHECK (width BETWEEN 8 AND 128),
  height     smallint NOT NULL CHECK (height BETWEEN 8 AND 128),
  cells      bytea NOT NULL,
  start_x    smallint NOT NULL,
  start_y    smallint NOT NULL,
  goal_x     smallint NOT NULL,
  goal_y     smallint NOT NULL,
  patrols    jsonb NOT NULL DEFAULT '[]',
  -- clock_timestamp() (not now()) so rows inserted in one transaction still order correctly.
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (octet_length(cells) = width * height),
  CHECK (start_x < width AND start_y < height AND goal_x < width AND goal_y < height),
  CHECK (jsonb_typeof(patrols) = 'array' AND jsonb_array_length(patrols) <= 32)
);

CREATE INDEX scenarios_created_at_idx ON scenarios (created_at DESC);

-- Runs outlive their scenario: deleting a scenario keeps the telemetry with a NULL reference.
CREATE TABLE runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id     uuid REFERENCES scenarios (id) ON DELETE SET NULL,
  engine_mode     text NOT NULL CHECK (engine_mode IN ('C++ Wasm', 'TS Fallback')),
  plan_mode       text NOT NULL CHECK (plan_mode IN ('astar', 'dstar')),
  status          text NOT NULL CHECK (status IN ('reached', 'blocked', 'aborted')),
  replans         integer NOT NULL CHECK (replans >= 0),
  avg_replan_ms   double precision NOT NULL CHECK (avg_replan_ms >= 0),
  max_replan_ms   double precision NOT NULL CHECK (max_replan_ms >= 0),
  nodes_expanded  integer NOT NULL CHECK (nodes_expanded >= 0),
  path_cost       double precision NOT NULL CHECK (path_cost >= -1),
  duration_ms     double precision NOT NULL CHECK (duration_ms >= 0),
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX runs_scenario_created_idx ON runs (scenario_id, created_at DESC);
CREATE INDEX runs_created_idx ON runs (created_at DESC);
