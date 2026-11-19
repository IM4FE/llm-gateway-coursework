import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app.js';
import type { Env } from '../config/env.js';
import {
  RequestLogRepository,
  type RequestLogDetails,
  type RequestLogDetailsReader,
  type RequestLogListReader,
  type RequestLogSummary,
  type RequestLogWriter,
} from '../db/requestLogRepository.js';

const testEnv: Env = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3000,
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://gateway:gateway@localhost:5432/llm_gateway',
  ADMIN_TOKEN: '0123456789abcdef',
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
  KEY_FAILURE_THRESHOLD: 3,
  KEY_FAILURE_COOLDOWN_MS: 60_000,
};

const summary: RequestLogSummary = {
  id: 'log-1',
  requestId: 'req-1',
  requestedModel: 'fast-model',
  actualModel: 'upstream-model',
  clientName: 'Test Client',
  providerName: 'OpenRouter',
  promptTokens: 10,
  completionTokens: 5,
  totalTokens: 15,
  costMicros: 3,
  latencyMs: 120,
  ttftMs: null,
  status: 'success',
  errorCode: null,
  isStream: false,
  createdAt: new Date('2026-11-17T18:41:12.000Z'),
};

const details: RequestLogDetails = {
  ...summary,
  attempts: [
    {
      attemptNo: 1,
      providerName: 'OpenRouter',
      status: 'success',
      httpStatus: 200,
      errorCode: null,
      latencyMs: 100,
      createdAt: new Date('2026-11-17T18:41:12.000Z'),
    },
  ],
};

const noopWriter: RequestLogWriter = async () => {};

let app: FastifyInstance | undefined;

function createApp(repository?: RequestLogRepository): FastifyInstance {
  app = buildApp(testEnv, {
    ...(repository !== undefined ? { requestLogs: repository } : {}),
  });

  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('admin request routes', () => {
  it('returns the request journal', async () => {
    const listReader = vi
      .fn<RequestLogListReader>()
      .mockResolvedValue([summary]);
    const repository = new RequestLogRepository(
      noopWriter,
      listReader,
    );
    const server = createApp(repository);

    const response = await server.inject({
      method: 'GET',
      url: '/api/requests?limit=5',
    });

    expect(response.statusCode).toBe(200);
    expect(listReader).toHaveBeenCalledWith(5);
    expect(response.json()).toMatchObject({
      requests: [
        {
          requestId: 'req-1',
          requestedModel: 'fast-model',
          clientName: 'Test Client',
          providerName: 'OpenRouter',
          status: 'success',
          costMicros: 3,
        },
      ],
    });
  });

  it('returns request details with attempts', async () => {
    const detailsReader = vi
      .fn<RequestLogDetailsReader>()
      .mockResolvedValue(details);
    const repository = new RequestLogRepository(
      noopWriter,
      undefined,
      detailsReader,
    );
    const server = createApp(repository);

    const response = await server.inject({
      method: 'GET',
      url: '/api/requests/req-1',
    });

    expect(response.statusCode).toBe(200);
    expect(detailsReader).toHaveBeenCalledWith('req-1');
    expect(response.json()).toMatchObject({
      requestId: 'req-1',
      attempts: [
        {
          attemptNo: 1,
          providerName: 'OpenRouter',
          status: 'success',
          httpStatus: 200,
        },
      ],
    });
  });

  it('returns 404 for an unknown request id', async () => {
    const detailsReader = vi
      .fn<RequestLogDetailsReader>()
      .mockResolvedValue(undefined);
    const repository = new RequestLogRepository(
      noopWriter,
      undefined,
      detailsReader,
    );
    const server = createApp(repository);

    const response = await server.inject({
      method: 'GET',
      url: '/api/requests/missing',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: 'request_not_found' },
    });
  });

  it('rejects an invalid limit', async () => {
    const repository = new RequestLogRepository(noopWriter);
    const server = createApp(repository);

    const response = await server.inject({
      method: 'GET',
      url: '/api/requests?limit=500',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'invalid_request' },
    });
  });

  it('returns 503 when the journal is not configured', async () => {
    const server = createApp();

    const response = await server.inject({
      method: 'GET',
      url: '/api/requests',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: { code: 'request_log_unavailable' },
    });
  });
});
