import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { AppError } from './errors.js';
import type { RunRepository, ScenarioRepository } from './repositories/types.js';
import { runRoutes } from './routes/runs.js';
import { scenarioRoutes } from './routes/scenarios.js';
import { z } from 'zod';

/** Per-client limit applied to POST routes. */
export interface RateLimitConfig {
  max: number;
  timeWindowMs: number;
}

/** Everything the app needs from the outside world, injected so tests can swap it. */
export interface AppDeps {
  scenarios: ScenarioRepository;
  runs: RunRepository;
  /** Resolves true when the database answers; used only by /health. */
  checkDb: () => Promise<boolean>;
  /** A pino logger, or false to silence logs (tests). */
  logger?: FastifyBaseLogger | false;
  corsOrigin?: string;
  rateLimit?: RateLimitConfig;
}

const STATUS_CODES: Record<number, string> = {
  400: 'bad_request',
  404: 'not_found',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
};

/**
 * Builds the Fastify instance without listening, so tests use `app.inject()` and
 * production wires real Postgres repositories in `server.ts`.
 *
 * Every error leaves through one handler in the `{ error: { code, message } }`
 * format; unexpected errors are logged with context but never echoed to clients.
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const limit = deps.rateLimit ?? { max: 120, timeWindowMs: 60_000 };
  const app = Fastify({
    ...(deps.logger ? { loggerInstance: deps.logger } : { logger: false }),
    genReqId: () => randomUUID(),
    requestIdHeader: 'x-request-id',
    // Largest legal grid is 128x128 = 16 KiB (about 22 KiB as base64).
    bodyLimit: 128 * 1024,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      const message = err.validation
        .map((v) => `${v.instancePath.replace(/^\//, '').replaceAll('/', '.') || err.validationContext}: ${v.message}`)
        .join('; ');
      return reply.code(400).send({ error: { code: 'validation_error', message } });
    }
    const { statusCode, message } = err as { statusCode?: number; message: string };
    if (!isResponseSerializationError(err) && statusCode && statusCode >= 400 && statusCode < 500) {
      // Fastify's own client errors (bad JSON, wrong content type, body too large) carry safe messages.
      return reply.code(statusCode).send({ error: { code: STATUS_CODES[statusCode] ?? 'bad_request', message } });
    }
    req.log.error({ err, pgCode: (err as { code?: string }).code, route: req.routeOptions.url }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal_error', message: 'Internal server error' } });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } }),
  );

  await app.register(helmet);
  await app.register(cors, { origin: deps.corsOrigin ?? 'http://localhost:5173' });
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => new AppError(429, 'rate_limited', 'Too many requests, slow down'),
  });
  await app.register(swagger, {
    openapi: { info: { title: 'Drone Sandbox API', version: '1.0.0', description: 'Scenarios and run telemetry' } },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.get('/health', {
    // Docker polls this every few seconds; keep it out of the info-level logs.
    logLevel: 'warn',
    schema: {
      tags: ['health'],
      summary: 'Liveness plus database reachability',
      response: { 200: z.object({ status: z.literal('ok'), db: z.enum(['ok', 'down']) }) },
    },
    handler: async (req) => {
      const up = await deps.checkDb().catch((err: unknown) => {
        req.log.warn({ err }, 'health check: database unreachable');
        return false;
      });
      return { status: 'ok' as const, db: up ? ('ok' as const) : ('down' as const) };
    },
  });
  await app.register(scenarioRoutes(deps.scenarios, limit), { prefix: '/api' });
  await app.register(runRoutes(deps.runs, limit), { prefix: '/api' });
  return app;
}
