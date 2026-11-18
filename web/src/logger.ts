/**
 * Tiny level-switched logger. The level comes from `localStorage.logLevel`, then
 * `VITE_LOG_LEVEL`, then defaults to `info` in dev and `warn` in production builds.
 * Callers should log engine selection, Wasm failures, slow replans and API failures only.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

function initialLevel(): LogLevel {
  try {
    const stored = globalThis.localStorage?.getItem('logLevel') as LogLevel | null;
    if (stored && stored in ORDER) return stored;
  } catch {
    /* storage can be blocked; fall through to the defaults */
  }
  const env = import.meta.env?.VITE_LOG_LEVEL as LogLevel | undefined;
  if (env && env in ORDER) return env;
  return import.meta.env?.DEV ? 'info' : 'warn';
}

let level: LogLevel = initialLevel();

/** Changes the active level at runtime (e.g. from the devtools console). */
export function setLogLevel(next: LogLevel): void {
  level = next;
}

function emit(at: Exclude<LogLevel, 'silent'>, args: unknown[]): void {
  if (ORDER[at] < ORDER[level]) return;
  console[at]('[drone]', ...args);
}

/** Leveled logger; every method is a no-op below the active level. */
export const log = {
  debug: (...a: unknown[]) => emit('debug', a),
  info: (...a: unknown[]) => emit('info', a),
  warn: (...a: unknown[]) => emit('warn', a),
  error: (...a: unknown[]) => emit('error', a),
};
