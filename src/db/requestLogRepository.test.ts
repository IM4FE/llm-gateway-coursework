import { describe, expect, it, vi } from 'vitest';

import type { Database } from './client.js';
import {
  RequestLogRepository,
  createRequestLogRepository,
  type RequestLogDetails,
  type RequestLogDetailsReader,
  type RequestLogListReader,
  type RequestLogRecord,
  type RequestLogSummary,
  type RequestLogWriter,
} from './requestLogRepository.js';
import { requestLogs } from './schema.js';

const record: RequestLogRecord = {
  requestId: 'req-1',
  clientId: 'client-1',
  requestedModel: 'fast-model',
  actualModel: 'upstream-model',
  providerId: 'provider-1',
  apiKeyId: 'key-1',
  promptTokens: 10,
  completionTokens: 5,
  totalTokens: 15,
  costMicros: 0,
  latencyMs: 120,
  ttftMs: 40,
  status: 'success',
  errorCode: null,
  isStream: false,
  attempts: [
    {
      attemptNo: 1,
      providerId: 'provider-1',
      apiKeyId: 'key-1',
      status: 'success',
      httpStatus: 200,
      errorCode: null,
      latencyMs: 100,
    },
    {
      attemptNo: 2,
      providerId: 'provider-2',
      apiKeyId: 'key-2',
      status: 'error',
      httpStatus: 429,
      errorCode: 'rate_limited',
      latencyMs: 20,
    },
  ],
};

interface FakeDatabase {
  db: Database;
  insertedLog: () => Record<string, unknown> | undefined;
  insertedAttempts: () => unknown[];
}

/**
 * Минимальная имитация Drizzle: только те методы, которые
 * использует createRequestLogRepository.
 */
function makeFakeDatabase(options: {
  attemptsInsertError?: Error;
} = {}): FakeDatabase {
  let insertedLog: Record<string, unknown> | undefined;
  const insertedAttempts: unknown[] = [];

  const tx = {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        if (table === requestLogs) {
          insertedLog = values as Record<string, unknown>;

          return {
            returning: async () => [{ id: 'log-1' }],
          };
        }

        if (options.attemptsInsertError !== undefined) {
          return Promise.reject(options.attemptsInsertError);
        }

        insertedAttempts.push(values);

        return Promise.resolve();
      },
    }),
  };

  const db = {
    transaction: async (callback: (transaction: unknown) => Promise<void>) => {
      await callback(tx);
    },
  } as unknown as Database;

  return {
    db,
    insertedLog: () => insertedLog,
    insertedAttempts: () => insertedAttempts,
  };
}

describe('RequestLogRepository', () => {
  it('delegates saving to the injected writer', async () => {
    const writer = vi.fn<RequestLogWriter>().mockResolvedValue(undefined);
    const repository = new RequestLogRepository(writer);

    await repository.save(record);

    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer).toHaveBeenCalledWith(record);
  });

  it('propagates writer errors', async () => {
    const writer = vi
      .fn<RequestLogWriter>()
      .mockRejectedValue(new Error('connection refused'));
    const repository = new RequestLogRepository(writer);

    await expect(repository.save(record)).rejects.toThrow('connection refused');
  });
});

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
  costMicros: 0,
  latencyMs: 120,
  ttftMs: null,
  status: 'success',
  errorCode: null,
  isStream: false,
  createdAt: new Date('2026-11-17T18:41:12.000Z'),
};

describe('RequestLogRepository readers', () => {
  it('delegates list to the injected reader', async () => {
    const writer = vi.fn<RequestLogWriter>().mockResolvedValue(undefined);
    const listReader = vi
      .fn<RequestLogListReader>()
      .mockResolvedValue([summary]);
    const repository = new RequestLogRepository(writer, listReader);

    await expect(repository.list(10)).resolves.toEqual([summary]);
    expect(listReader).toHaveBeenCalledWith(10);
  });

  it('delegates request details to the injected reader', async () => {
    const writer = vi.fn<RequestLogWriter>().mockResolvedValue(undefined);
    const details: RequestLogDetails = { ...summary, attempts: [] };
    const detailsReader = vi
      .fn<RequestLogDetailsReader>()
      .mockResolvedValue(details);
    const repository = new RequestLogRepository(
      writer,
      undefined,
      detailsReader,
    );

    await expect(repository.findByRequestId('req-1')).resolves.toEqual(
      details,
    );
    expect(detailsReader).toHaveBeenCalledWith('req-1');
  });

  it('returns empty results when readers are not configured', async () => {
    const writer = vi.fn<RequestLogWriter>().mockResolvedValue(undefined);
    const repository = new RequestLogRepository(writer);

    await expect(repository.list()).resolves.toEqual([]);
    await expect(repository.findByRequestId('req-1')).resolves.toBeUndefined();
  });
});

describe('createRequestLogRepository', () => {
  it('inserts the request log and its attempts in one transaction', async () => {
    const fake = makeFakeDatabase();
    const repository = createRequestLogRepository(fake.db);

    await repository.save(record);

    expect(fake.insertedLog()).toMatchObject({
      requestId: 'req-1',
      clientId: 'client-1',
      requestedModel: 'fast-model',
      actualModel: 'upstream-model',
      providerId: 'provider-1',
      apiKeyId: 'key-1',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      costMicros: 0,
      latencyMs: 120,
      ttftMs: 40,
      status: 'success',
      errorCode: null,
      isStream: false,
    });

    expect(fake.insertedAttempts()).toEqual([
      [
        {
          requestLogId: 'log-1',
          attemptNo: 1,
          providerId: 'provider-1',
          apiKeyId: 'key-1',
          status: 'success',
          httpStatus: 200,
          errorCode: null,
          latencyMs: 100,
        },
        {
          requestLogId: 'log-1',
          attemptNo: 2,
          providerId: 'provider-2',
          apiKeyId: 'key-2',
          status: 'error',
          httpStatus: 429,
          errorCode: 'rate_limited',
          latencyMs: 20,
        },
      ],
    ]);
  });

  it('skips the attempts insert when there were no attempts', async () => {
    const fake = makeFakeDatabase();
    const repository = createRequestLogRepository(fake.db);

    await repository.save({ ...record, attempts: [] });

    expect(fake.insertedLog()).toBeDefined();
    expect(fake.insertedAttempts()).toEqual([]);
  });

  it('propagates attempt insert errors so the transaction can roll back', async () => {
    const fake = makeFakeDatabase({
      attemptsInsertError: new Error('insert failed'),
    });
    const repository = createRequestLogRepository(fake.db);

    await expect(repository.save(record)).rejects.toThrow('insert failed');
  });
});
