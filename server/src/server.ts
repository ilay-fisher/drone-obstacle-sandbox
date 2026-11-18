import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import pino from 'pino';
import { buildApp } from './app.js';
import { describeConfig, loadConfig } from './config.js';
import { runMigrations } from './migrate.js';
import { PgRunRepository, PgScenarioRepository } from './repositories/pg.js';

/** Retries migrations while Postgres is still starting (compose `depends_on` already helps, this covers other setups). */
async function migrateWithRetry(pool: pg.Pool, log: { warn(o: object, m: string): void }): Promise<string[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await runMigrations(pool);
    } catch (err) {
      if (attempt >= 10) throw err;
      log.warn({ err, attempt }, 'database not ready, retrying');
      await sleep(1000);
    }
  }
}

/** Process entrypoint: config, pool, migrations, HTTP server, graceful shutdown. */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const pretty = config.nodeEnv === 'development';
  // JSON logs in production; pino-pretty is a dev-only dependency.
  const log = pino({ level: config.logLevel, ...(pretty ? { transport: { target: 'pino-pretty' } } : {}) });
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  const app = await buildApp({
    scenarios: new PgScenarioRepository(pool, log),
    runs: new PgRunRepository(pool, log),
    checkDb: async () => (await pool.query('SELECT 1')).rowCount === 1,
    corsOrigin: config.corsOrigin,
    logger: log,
  });
  pool.on('error', (err) => app.log.error({ err }, 'idle database client error'));
  app.log.info({ config: describeConfig(config) }, 'starting');

  const applied = await migrateWithRetry(pool, app.log);
  app.log.info({ applied }, 'migrations complete');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      await pool.end();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((err: unknown) => {
  console.error('fatal startup error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
