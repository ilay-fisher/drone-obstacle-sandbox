import { log } from '../logger';

/** Wire types from CONTRACTS section 4. */
export interface PatrolDto { x: number; y: number; dx: number; dy: number }
export interface ScenarioInput {
  name: string;
  width: number;
  height: number;
  /** base64 of the Uint8Array grid (length width*height). */
  cells: string;
  start: { x: number; y: number };
  goal: { x: number; y: number };
  patrols: PatrolDto[];
}
export interface Scenario extends ScenarioInput { id: string; createdAt: string }
export interface ScenarioSummary { id: string; name: string; width: number; height: number; createdAt: string }
export interface RunInput {
  scenarioId: string | null;
  engineMode: 'C++ Wasm' | 'TS Fallback';
  planMode: 'astar' | 'dstar';
  status: 'reached' | 'blocked' | 'aborted';
  replans: number;
  avgReplanMs: number;
  maxReplanMs: number;
  nodesExpanded: number;
  pathCost: number;
  durationMs: number;
}

/** Error from the API layer. `offline` distinguishes "no server" from a server-side rejection. */
export class ApiError extends Error {
  constructor(message: string, readonly offline: boolean, readonly status = 0, readonly code = 'OFFLINE') {
    super(message);
    this.name = 'ApiError';
  }
}

const TIMEOUT_MS = 3000;

/** Encodes grid cells as base64. Chunked to stay clear of argument-count limits. */
export function encodeCells(cells: Uint8Array): string {
  let s = '';
  for (let i = 0; i < cells.length; i += 0x2000) {
    s += String.fromCharCode(...cells.subarray(i, i + 0x2000));
  }
  return btoa(s);
}

/** Decodes a base64 grid back into a `Uint8Array`. */
export function decodeCells(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(path, { ...init, signal: ctrl.signal });
  } catch (err) {
    log.warn('api: unreachable', path, err);
    throw new ApiError('API offline', true);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let code = 'HTTP_ERROR';
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { code: string; message: string } };
      if (body.error) { code = body.error.code; message = body.error.message; }
    } catch { /* body was not JSON; keep the generic message */ }
    log.warn('api: request failed', path, res.status, code);
    throw new ApiError(message, false, res.status, code);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** True when the backend health endpoint answers `status: ok`. Never throws. */
export async function checkHealth(): Promise<boolean> {
  try {
    const h = await request<{ status: string }>('/health');
    return h.status === 'ok';
  } catch {
    return false;
  }
}

/** Lists saved scenarios (summaries only). */
export const listScenarios = () => request<ScenarioSummary[]>('/api/scenarios');
/** Fetches one full scenario. */
export const getScenario = (id: string) => request<Scenario>(`/api/scenarios/${encodeURIComponent(id)}`);
/** Saves a scenario. */
export const createScenario = (s: ScenarioInput) => request<Scenario>('/api/scenarios', json('POST', s));
/** Deletes a scenario. */
export const deleteScenario = (id: string) =>
  request<void>(`/api/scenarios/${encodeURIComponent(id)}`, { method: 'DELETE' });
/** Records a finished mission. */
export const postRun = (r: RunInput) => request<unknown>('/api/runs', json('POST', r));
