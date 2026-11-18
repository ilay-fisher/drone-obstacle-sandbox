import { z } from 'zod';

/** Cell values: 0 free, 1 wall, 2 wind/jamming zone (docs/CONTRACTS.md section 1). */
const CELL_VALUES = new Set([0, 1, 2]);

const int = z.number().int();
const point = z.object({ x: int, y: int });
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Decodes a strict base64 string into bytes, or returns null when the text is not
 * canonical base64. Buffer.from alone silently skips invalid characters, so the
 * alphabet is checked first.
 */
export function decodeBase64(text: string): Buffer | null {
  return BASE64.test(text) ? Buffer.from(text, 'base64') : null;
}

/** Scenario body as sent by the client (docs/CONTRACTS.md section 4). */
const scenarioShape = z.object({
  name: z.string().min(1).max(80),
  width: int.min(8).max(128),
  height: int.min(8).max(128),
  cells: z.string(),
  start: point,
  goal: point,
  patrols: z.array(point.extend({ dx: int, dy: int })).max(32),
});

export const scenarioInputSchema = scenarioShape.superRefine((s, ctx) => {
  const bytes = decodeBase64(s.cells);
  if (!bytes) {
    ctx.addIssue({ code: 'custom', path: ['cells'], message: 'cells must be base64' });
  } else if (bytes.length !== s.width * s.height) {
    ctx.addIssue({ code: 'custom', path: ['cells'], message: `cells must decode to width*height = ${s.width * s.height} bytes, got ${bytes.length}` });
  } else if (bytes.some((b) => !CELL_VALUES.has(b))) {
    ctx.addIssue({ code: 'custom', path: ['cells'], message: 'every cell byte must be 0, 1 or 2' });
  }
  const inside = (p: { x: number; y: number }) => p.x >= 0 && p.x < s.width && p.y >= 0 && p.y < s.height;
  if (!inside(s.start)) ctx.addIssue({ code: 'custom', path: ['start'], message: 'start must be inside the grid' });
  if (!inside(s.goal)) ctx.addIssue({ code: 'custom', path: ['goal'], message: 'goal must be inside the grid' });
  s.patrols.forEach((p, i) => {
    if (!inside(p)) ctx.addIssue({ code: 'custom', path: ['patrols', i], message: 'patrol must start inside the grid' });
  });
});
export type ScenarioInput = z.infer<typeof scenarioInputSchema>;

const idFields = { id: z.uuid(), createdAt: z.iso.datetime() };
export const scenarioSchema = scenarioShape.extend(idFields);
export type Scenario = z.infer<typeof scenarioSchema>;

export const scenarioSummarySchema = z.object({
  ...idFields,
  name: z.string(),
  width: z.number(),
  height: z.number(),
});
export type ScenarioSummary = z.infer<typeof scenarioSummarySchema>;

const nonNegative = z.number().min(0).finite();

/** Run telemetry body. pathCost is -1 when no path was found (see DronePlanner.getPathCost). */
export const runInputSchema = z.object({
  scenarioId: z.uuid().nullable(),
  engineMode: z.enum(['C++ Wasm', 'TS Fallback']),
  planMode: z.enum(['astar', 'dstar']),
  status: z.enum(['reached', 'blocked', 'aborted']),
  replans: int.min(0).max(2_147_483_647),
  avgReplanMs: nonNegative,
  maxReplanMs: nonNegative,
  nodesExpanded: int.min(0).max(2_147_483_647),
  pathCost: z.number().min(-1).finite(),
  durationMs: nonNegative,
});
export type RunInput = z.infer<typeof runInputSchema>;

export const runSchema = runInputSchema.extend(idFields);
export type Run = z.infer<typeof runSchema>;

export const statsSchema = z.object({
  totalRuns: z.number(),
  avgReplanMs: z.number(),
  p95ReplanMs: z.number(),
  byEngine: z.array(z.object({ mode: z.string(), runs: z.number(), avgReplanMs: z.number() })),
});
export type Stats = z.infer<typeof statsSchema>;

export const idParamsSchema = z.object({ id: z.uuid() });
export const runsQuerySchema = z.object({
  scenarioId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type RunsQuery = z.infer<typeof runsQuerySchema>;

export const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
