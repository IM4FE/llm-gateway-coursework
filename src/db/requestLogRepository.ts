import type { GatewayErrorCode } from '../core/errors.js';
import type { Database } from './client.js';
import {
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

export type RequestLogWriter = (record: RequestLogRecord) => Promise<void>;

/**
 * Репозиторий журнала запросов.
 *
 * Как и другие репозитории проекта, он отделяет доменную запись
 * от Drizzle: HTTP-слой не знает, как именно она сохраняется.
 */
export class RequestLogRepository {
  constructor(private readonly write: RequestLogWriter) {}

  async save(record: RequestLogRecord): Promise<void> {
    await this.write(record);
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
  return new RequestLogRepository(async (record) => {
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
  });
}
