import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  NODE_ENV: z.string().default('production'),
});

/** Validated runtime configuration. */
export interface Config {
  port: number;
  databaseUrl: string;
  logLevel: (typeof LOG_LEVELS)[number];
  corsOrigin: string;
  nodeEnv: string;
}

/**
 * Parses and validates environment variables once at startup, so a misconfigured
 * deployment fails fast with a readable message instead of at the first request.
 *
 * @throws Error listing every invalid variable.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${detail}`);
  }
  const e = parsed.data;
  return { port: e.PORT, databaseUrl: e.DATABASE_URL, logLevel: e.LOG_LEVEL, corsOrigin: e.CORS_ORIGIN, nodeEnv: e.NODE_ENV };
}

/** Returns a copy of the config that is safe to log: the database URL keeps host and name but loses credentials. */
export function describeConfig(config: Config): Record<string, unknown> {
  let database = 'invalid-url';
  try {
    const u = new URL(config.databaseUrl);
    database = `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    // Keep the placeholder: never echo an unparsable URL, it may contain a password.
  }
  return { port: config.port, logLevel: config.logLevel, corsOrigin: config.corsOrigin, nodeEnv: config.nodeEnv, database };
}
