import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { RunRepository } from '../repositories/types.js';
import { errorSchema, runInputSchema, runSchema, runsQuerySchema, statsSchema } from '../schemas.js';
import type { RateLimitConfig } from '../app.js';

/** Run telemetry (/api/runs) and aggregate statistics (/api/stats). */
export function runRoutes(repo: RunRepository, limit: RateLimitConfig): FastifyPluginAsyncZod {
  return async (app) => {
    app.post('/runs', {
      config: { rateLimit: { max: limit.max, timeWindow: limit.timeWindowMs } },
      schema: { tags: ['runs'], summary: 'Record a finished run', body: runInputSchema, response: { 201: runSchema, 400: errorSchema, 404: errorSchema } },
      handler: async (req, reply) => {
        const run = await repo.create(req.body);
        req.log.info({ runId: run.id, status: run.status, engineMode: run.engineMode, planMode: run.planMode }, 'run recorded');
        return reply.code(201).send(run);
      },
    });

    app.get('/runs', {
      schema: { tags: ['runs'], summary: 'List runs, newest first', querystring: runsQuerySchema, response: { 200: z.array(runSchema) } },
      handler: (req) => repo.list(req.query),
    });

    app.get('/stats', {
      schema: { tags: ['runs'], summary: 'Average and p95 replan latency, overall and per engine', response: { 200: statsSchema } },
      handler: () => repo.stats(),
    });
  };
}
