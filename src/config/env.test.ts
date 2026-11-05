import { describe, expect, it } from 'vitest';

import { parseEnv } from './env.js';

const validEnvironment = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '3000',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://gateway:gateway@localhost:5432/llm_gateway',
  ADMIN_TOKEN: '0123456789abcdef',
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
} satisfies NodeJS.ProcessEnv;

describe('parseEnv', () => {
  it('parses and coerces a valid environment', () => {
    const env = parseEnv(validEnvironment);

    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('test');
    expect(env.OPENROUTER_BASE_URL).toBe('https://openrouter.ai/api/v1');
  });

  it('rejects a short admin token', () => {
    expect(() => parseEnv({ ...validEnvironment, ADMIN_TOKEN: 'short' })).toThrow(
      /ADMIN_TOKEN/,
    );
  });

  it('rejects an invalid encryption key', () => {
    expect(() =>
      parseEnv({ ...validEnvironment, ENCRYPTION_KEY: 'not-a-32-byte-key' }),
    ).toThrow(/ENCRYPTION_KEY/);
  });

  it('rejects a non-PostgreSQL database URL', () => {
    expect(() =>
      parseEnv({ ...validEnvironment, DATABASE_URL: 'mysql://localhost/gateway' }),
    ).toThrow(/DATABASE_URL/);
  });
});
