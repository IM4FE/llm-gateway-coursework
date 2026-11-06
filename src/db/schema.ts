import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { PROVIDER_TYPES } from '../core/types.js';

export const providerTypeEnum = pgEnum('provider_type', PROVIDER_TYPES);

export const requestStatusEnum = pgEnum('request_status', [
  'success',
  'error',
  'timeout',
  'cancelled',
]);

export const attemptStatusEnum = pgEnum('attempt_status', [
  'success',
  'error',
  'timeout',
  'skipped',
]);

export const clients = pgTable(
  'clients',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    keyPrefix: varchar('key_prefix', { length: 16 }).notNull(),
    rateLimitRpm: integer('rate_limit_rpm').notNull().default(60),
    monthlyBudgetMicros: bigint('monthly_budget_micros', { mode: 'number' })
      .notNull()
      .default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('clients_key_hash_uq').on(table.keyHash)],
);

export const providers = pgTable(
  'providers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    type: providerTypeEnum('type').notNull(),
    baseUrl: text('base_url').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    timeoutMs: integer('timeout_ms').notNull().default(60_000),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('providers_name_uq').on(table.name)],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    fingerprint: text('fingerprint').notNull(),
    encryptedKey: text('encrypted_key').notNull(),
    iv: text('iv').notNull(),
    authTag: text('auth_tag').notNull(),
    keyHint: varchar('key_hint', { length: 16 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    failureCount: integer('failure_count').notNull().default(0),
    cooldownUntil: timestamp('cooldown_until', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('api_keys_provider_fingerprint_uq').on(
      table.providerId,
      table.fingerprint,
    ),
    index('api_keys_provider_active_idx').on(table.providerId, table.isActive),
  ],
);

export const models = pgTable(
  'models',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    upstreamModel: text('upstream_model').notNull(),
    displayName: text('display_name').notNull(),
    inputPriceMicrosPer1m: bigint('input_price_micros_per_1m', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    outputPriceMicrosPer1m: bigint('output_price_micros_per_1m', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    contextWindow: integer('context_window'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('models_provider_upstream_uq').on(
      table.providerId,
      table.upstreamModel,
    ),
    index('models_provider_idx').on(table.providerId),
  ],
);

export const modelRoutes = pgTable(
  'model_routes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    alias: text('alias').notNull(),
    modelId: uuid('model_id')
      .notNull()
      .references(() => models.id, { onDelete: 'cascade' }),
    priority: integer('priority').notNull().default(1),
    weight: integer('weight').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('model_routes_alias_model_uq').on(table.alias, table.modelId),
    index('model_routes_alias_priority_idx').on(table.alias, table.priority),
  ],
);

export const requestLogs = pgTable(
  'request_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    requestId: text('request_id').notNull(),
    clientId: uuid('client_id').references(() => clients.id, {
      onDelete: 'set null',
    }),
    requestedModel: text('requested_model').notNull(),
    actualModel: text('actual_model'),
    providerId: uuid('provider_id').references(() => providers.id, {
      onDelete: 'set null',
    }),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id, {
      onDelete: 'set null',
    }),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    ttftMs: integer('ttft_ms'),
    status: requestStatusEnum('status').notNull(),
    errorCode: text('error_code'),
    isStream: boolean('is_stream').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('request_logs_request_id_uq').on(table.requestId),
    index('request_logs_created_at_idx').on(table.createdAt),
    index('request_logs_client_created_idx').on(
      table.clientId,
      table.createdAt,
    ),
  ],
);

export const requestAttempts = pgTable(
  'request_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    requestLogId: uuid('request_log_id')
      .notNull()
      .references(() => requestLogs.id, { onDelete: 'cascade' }),
    attemptNo: integer('attempt_no').notNull(),
    providerId: uuid('provider_id').references(() => providers.id, {
      onDelete: 'set null',
    }),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id, {
      onDelete: 'set null',
    }),
    status: attemptStatusEnum('status').notNull(),
    httpStatus: integer('http_status'),
    errorCode: text('error_code'),
    latencyMs: integer('latency_ms').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('request_attempts_log_attempt_uq').on(
      table.requestLogId,
      table.attemptNo,
    ),
    index('request_attempts_log_idx').on(table.requestLogId),
  ],
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;

export type Provider = typeof providers.$inferSelect;
export type NewProvider = typeof providers.$inferInsert;

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type Model = typeof models.$inferSelect;
export type NewModel = typeof models.$inferInsert;

export type ModelRoute = typeof modelRoutes.$inferSelect;
export type NewModelRoute = typeof modelRoutes.$inferInsert;

export type RequestLog = typeof requestLogs.$inferSelect;
export type NewRequestLog = typeof requestLogs.$inferInsert;

export type RequestAttempt = typeof requestAttempts.$inferSelect;
export type NewRequestAttempt = typeof requestAttempts.$inferInsert;
