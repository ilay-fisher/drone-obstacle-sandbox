import { describe, expect, it } from 'vitest';
import { describeConfig, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig({ DATABASE_URL: 'postgres://u:p@h:5432/db' });
    expect(c).toMatchObject({ port: 3001, logLevel: 'info', corsOrigin: 'http://localhost:5173' });
  });

  it('parses overrides', () => {
    const c = loadConfig({ DATABASE_URL: 'postgres://x', PORT: '4000', LOG_LEVEL: 'debug', CORS_ORIGIN: '*' });
    expect(c).toMatchObject({ port: 4000, logLevel: 'debug', corsOrigin: '*' });
  });

  it('requires DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('rejects an invalid port or log level', () => {
    expect(() => loadConfig({ DATABASE_URL: 'x', PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ DATABASE_URL: 'x', LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });

  it('hides credentials in the loggable view', () => {
    const c = loadConfig({ DATABASE_URL: 'postgres://user:secret@db:5432/app' });
    const text = JSON.stringify(describeConfig(c));
    expect(text).not.toContain('secret');
    expect(text).toContain('db:5432');
  });
});
