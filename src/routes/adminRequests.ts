import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { RequestLogRepository } from '../db/requestLogRepository.js';

export interface AdminRequestDependencies {
  requestLogs?: RequestLogRepository | undefined;
}

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Read-only API журнала запросов для веб-консоли.
 *
 * Журнал не содержит секретов: только alias, имена клиента и
 * провайдера, токены, стоимость и попытки. Поэтому чтение открыто
 * без admin-токена — иначе основной сценарий MVP требовал бы
 * отдельного входа в админку перед просмотром своего же запроса.
 */
export function registerAdminRequestRoutes(
  app: FastifyInstance,
  dependencies: AdminRequestDependencies,
): void {
  app.get<{ Querystring: { limit?: string } }>(
    '/api/requests',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');

      const repository = dependencies.requestLogs;

      if (repository === undefined) {
        return sendApiError(
          reply,
          503,
          'request_log_unavailable',
          'Request log repository is not configured',
        );
      }

      const parsed = listQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return sendApiError(
          reply,
          400,
          'invalid_request',
          'limit must be an integer between 1 and 200',
        );
      }

      const requests = await repository.list(parsed.data.limit);

      return { requests };
    },
  );

  app.get<{ Params: { requestId: string } }>(
    '/api/requests/:requestId',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');

      const repository = dependencies.requestLogs;

      if (repository === undefined) {
        return sendApiError(
          reply,
          503,
          'request_log_unavailable',
          'Request log repository is not configured',
        );
      }

      const log = await repository.findByRequestId(request.params.requestId);

      if (log === undefined) {
        return sendApiError(
          reply,
          404,
          'request_not_found',
          `Request ${request.params.requestId} was not found`,
        );
      }

      return log;
    },
  );
}

function sendApiError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
): FastifyReply {
  return reply.status(status).send({
    error: {
      code,
      message,
    },
  });
}
