import { asc, desc, eq } from 'drizzle-orm';

import type { GatewayErrorCode } from '../core/errors.js';
import type { Database } from './client.js';
import {
  clients,
  providers,
  requestAttempts,
  requestLogs,
  type RequestAttempt,
  type RequestLog,
} from './schema.js';

export type RequestLogStatus = RequestLog['status'];
export type AttemptStatus = RequestAttempt['status'];

/**
 * Одна попытка Router'а: конкретный провайдер и конкретный ключ.
 *
 * Поля nullable, потому что в БД они тоже nullable: например,
 * у попытки может не быть providerStatus, если ошибка произошла
 * на уровне сети.
 */
export interface RequestAttemptRecord {
  attemptNo: number;
  providerId: string | null;
  apiKeyId: string | null;
  status: AttemptStatus;
  httpStatus: number | null;
  errorCode: GatewayErrorCode | null;
  latencyMs: number;
}

/**
 * Итоговая запись о запросе клиента.
 *
 * Попытки передаются вместе с логом и сохраняются в одной
 * транзакции: либо есть и запрос, и все его попытки, либо нет
 * ничего.
 */
export interface RequestLogRecord {
  requestId: string;
  clientId: string | null;
  requestedModel: string;
  actualModel: string | null;
  providerId: string | null;
  apiKeyId: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costMicros: number;
  latencyMs: number;
  ttftMs: number | null;
  status: RequestLogStatus;
  errorCode: GatewayErrorCode | null;
  isStream: boolean;
  attempts: RequestAttemptRecord[];
}

/**
 * Запись журнала для списка запросов.
 *
 * В отличие от `RequestLogRecord`, здесь есть имена клиента и
 * провайдера: администратору они понятнее, чем UUID. Попытки в
 * список не входят, чтобы не раздувать ответ.
 */
export interface RequestLogSummary {
  id: string;
  requestId: string;
  requestedModel: string;
  actualModel: string | null;
  clientName: string | null;
  providerName: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costMicros: number;
  latencyMs: number;
  ttftMs: number | null;
  status: RequestLogStatus;
  errorCode: string | null;
  isStream: boolean;
  createdAt: Date;
}

export interface RequestAttemptSummary {
  attemptNo: number;
  providerName: string | null;
  status: AttemptStatus;
  httpStatus: number | null;
  errorCode: string | null;
  latencyMs: number;
  createdAt: Date;
}

export interface RequestLogDetails extends RequestLogSummary {
  attempts: RequestAttemptSummary[];
}

export type RequestLogWriter = (record: RequestLogRecord) => Promise<void>;
export type RequestLogListReader = (
  limit: number,
) => Promise<RequestLogSummary[]>;
export type RequestLogDetailsReader = (
  requestId: string,
) => Promise<RequestLogDetails | undefined>;

/**
 * Репозиторий журнала запросов.
 *
 * Как и другие репозитории проекта, он отделяет доменную запись
 * от Drizzle: HTTP-слой не знает, как именно она сохраняется.
 * Чтение вынесено в отдельные загрузчики, чтобы страницы консоли
 * могли получать журнал без прямого доступа к БД.
 */
export class RequestLogRepository {
  constructor(
    private readonly write: RequestLogWriter,
    private readonly listReader?: RequestLogListReader,
    private readonly detailsReader?: RequestLogDetailsReader,
  ) {}

  async save(record: RequestLogRecord): Promise<void> {
    await this.write(record);
  }

  async list(limit = 50): Promise<RequestLogSummary[]> {
    if (this.listReader === undefined) {
      return [];
    }

    return this.listReader(limit);
  }

  async findByRequestId(
    requestId: string,
  ): Promise<RequestLogDetails | undefined> {
    if (this.detailsReader === undefined) {
      return undefined;
    }

    return this.detailsReader(requestId);
  }
}

/**
 * Сохраняет запрос и все его попытки одной транзакцией.
 *
 * Если вставка попыток упадёт, запись о запросе тоже откатится.
 * Это важно: иначе в журнале появились бы запросы без истории
 * fallback'а.
 */
export function createRequestLogRepository(
  db: Database,
): RequestLogRepository {
  return new RequestLogRepository(
    async (record) => {
      await db.transaction(async (tx) => {
        const [log] = await tx
          .insert(requestLogs)
          .values({
            requestId: record.requestId,
            clientId: record.clientId,
            requestedModel: record.requestedModel,
            actualModel: record.actualModel,
            providerId: record.providerId,
            apiKeyId: record.apiKeyId,
            promptTokens: record.promptTokens,
            completionTokens: record.completionTokens,
            totalTokens: record.totalTokens,
            costMicros: record.costMicros,
            latencyMs: record.latencyMs,
            ttftMs: record.ttftMs,
            status: record.status,
            errorCode: record.errorCode,
            isStream: record.isStream,
          })
          .returning({ id: requestLogs.id });

        if (log === undefined) {
          throw new Error('Failed to insert request log');
        }

        if (record.attempts.length === 0) {
          return;
        }

        await tx.insert(requestAttempts).values(
          record.attempts.map((attempt) => ({
            requestLogId: log.id,
            attemptNo: attempt.attemptNo,
            providerId: attempt.providerId,
            apiKeyId: attempt.apiKeyId,
            status: attempt.status,
            httpStatus: attempt.httpStatus,
            errorCode: attempt.errorCode,
            latencyMs: attempt.latencyMs,
          })),
        );
      });
    },
    async (limit) => {
      return db
        .select({
          id: requestLogs.id,
          requestId: requestLogs.requestId,
          requestedModel: requestLogs.requestedModel,
          actualModel: requestLogs.actualModel,
          clientName: clients.name,
          providerName: providers.name,
          promptTokens: requestLogs.promptTokens,
          completionTokens: requestLogs.completionTokens,
          totalTokens: requestLogs.totalTokens,
          costMicros: requestLogs.costMicros,
          latencyMs: requestLogs.latencyMs,
          ttftMs: requestLogs.ttftMs,
          status: requestLogs.status,
          errorCode: requestLogs.errorCode,
          isStream: requestLogs.isStream,
          createdAt: requestLogs.createdAt,
        })
        .from(requestLogs)
        .leftJoin(clients, eq(requestLogs.clientId, clients.id))
        .leftJoin(providers, eq(requestLogs.providerId, providers.id))
        .orderBy(desc(requestLogs.createdAt), desc(requestLogs.id))
        .limit(limit);
    },
    async (requestId) => {
      const [log] = await db
        .select({
          id: requestLogs.id,
          requestId: requestLogs.requestId,
          requestedModel: requestLogs.requestedModel,
          actualModel: requestLogs.actualModel,
          clientName: clients.name,
          providerName: providers.name,
          promptTokens: requestLogs.promptTokens,
          completionTokens: requestLogs.completionTokens,
          totalTokens: requestLogs.totalTokens,
          costMicros: requestLogs.costMicros,
          latencyMs: requestLogs.latencyMs,
          ttftMs: requestLogs.ttftMs,
          status: requestLogs.status,
          errorCode: requestLogs.errorCode,
          isStream: requestLogs.isStream,
          createdAt: requestLogs.createdAt,
        })
        .from(requestLogs)
        .leftJoin(clients, eq(requestLogs.clientId, clients.id))
        .leftJoin(providers, eq(requestLogs.providerId, providers.id))
        .where(eq(requestLogs.requestId, requestId))
        .limit(1);

      if (log === undefined) {
        return undefined;
      }

      const attempts = await db
        .select({
          attemptNo: requestAttempts.attemptNo,
          providerName: providers.name,
          status: requestAttempts.status,
          httpStatus: requestAttempts.httpStatus,
          errorCode: requestAttempts.errorCode,
          latencyMs: requestAttempts.latencyMs,
          createdAt: requestAttempts.createdAt,
        })
        .from(requestAttempts)
        .leftJoin(providers, eq(requestAttempts.providerId, providers.id))
        .where(eq(requestAttempts.requestLogId, log.id))
        .orderBy(asc(requestAttempts.attemptNo));

      return {
        ...log,
        attempts,
      };
    },
  );
}
