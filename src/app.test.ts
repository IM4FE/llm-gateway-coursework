import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { Env } from './config/env.js';

const testEnv: Env = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3000,
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://gateway:gateway@localhost:5432/llm_gateway',
  ADMIN_TOKEN: '0123456789abcdef',
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
};

describe('HTTP app', () => {
  it('responds to the health check', async () => {
    const app = buildApp(testEnv);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });

    await app.close();
  });

  it('responds to the readiness check', async () => {
    const app = buildApp(testEnv);

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });

    await app.close();
  });
});
