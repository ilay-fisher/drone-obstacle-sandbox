import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { NotFoundError } from '../errors.js';
import type { ScenarioRepository } from '../repositories/types.js';
import { errorSchema, idParamsSchema, scenarioInputSchema, scenarioSchema, scenarioSummarySchema } from '../schemas.js';
import type { RateLimitConfig } from '../app.js';

/** Scenario CRUD under /api/scenarios. */
export function scenarioRoutes(repo: ScenarioRepository, limit: RateLimitConfig): FastifyPluginAsyncZod {
  return async (app) => {
    app.get('/scenarios', {
      schema: { tags: ['scenarios'], summary: 'List scenarios (summaries, newest first)', response: { 200: z.array(scenarioSummarySchema) } },
      handler: () => repo.list(),
    });

    app.get('/scenarios/:id', {
      schema: { tags: ['scenarios'], summary: 'Get one scenario', params: idParamsSchema, response: { 200: scenarioSchema, 404: errorSchema } },
      handler: async (req) => {
        const scenario = await repo.get(req.params.id);
        if (!scenario) throw new NotFoundError('Scenario');
        return scenario;
      },
    });

    app.post('/scenarios', {
      config: { rateLimit: { max: limit.max, timeWindow: limit.timeWindowMs } },
      schema: { tags: ['scenarios'], summary: 'Create a scenario', body: scenarioInputSchema, response: { 201: scenarioSchema, 400: errorSchema } },
      handler: async (req, reply) => {
        const scenario = await repo.create(req.body);
        // Log sizes only: grids are up to 16 KiB and not useful in logs.
        req.log.info(
          { scenarioId: scenario.id, width: scenario.width, height: scenario.height, cellsChars: req.body.cells.length, patrols: scenario.patrols.length },
          'scenario created',
        );
        return reply.code(201).send(scenario);
      },
    });

    app.delete('/scenarios/:id', {
      schema: { tags: ['scenarios'], summary: 'Delete a scenario (its runs are kept)', params: idParamsSchema, response: { 204: z.null().describe('Deleted'), 404: errorSchema } },
      handler: async (req, reply) => {
        if (!(await repo.delete(req.params.id))) throw new NotFoundError('Scenario');
        return reply.code(204).send(null);
      },
    });
  };
}
