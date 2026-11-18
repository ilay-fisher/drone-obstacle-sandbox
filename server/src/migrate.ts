import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

/** Works from both src/ (tsx, vitest) and dist/ (compiled): migrations/ is a sibling of each. */
const DEFAULT_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
/** Arbitrary constant key so concurrent API replicas serialize their startup migrations. */
const LOCK_KEY = 727_274;

/**
 * Applies every `*.sql` file in `dir` that is not yet recorded in `schema_migrations`,
 * in filename order, each inside its own transaction.
 *
 * Idempotent: a second call applies nothing. A Postgres advisory lock makes it safe
 * when several instances start at once.
 *
 * @returns names of the files applied by this call.
 */
export async function runMigrations(pool: pg.Pool, dir: string = DEFAULT_DIR): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(`${dir}/${file}`, 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
      applied.push(file);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
  return applied;
}
