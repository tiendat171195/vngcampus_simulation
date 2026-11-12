import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

describe('loadEnv', () => {
  it('falls back to development defaults', () => {
    expect(loadEnv({})).toMatchObject({ NODE_ENV: 'development', API_PORT: 3001 });
  });

  it('coerces numeric strings', () => {
    expect(loadEnv({ API_PORT: '8080' }).API_PORT).toBe(8080);
  });

  it('names the offending variable when a value is invalid', () => {
    expect(() => loadEnv({ API_PORT: 'not-a-port' })).toThrow(/API_PORT/);
  });
});
