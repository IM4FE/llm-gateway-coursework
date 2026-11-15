import { loadEnv } from '../config/env.js';
import type { Env } from '../config/env.js';
import {
  decodeEncryptionKey,
  encryptSecret,
  fingerprintSecret,
  hintSecret,
} from '../core/secrets.js';
import { createDatabase, type Database } from './client.js';
import { apiKeys, models, modelRoutes, providers } from './schema.js';

const PROVIDER_NAME = 'OpenRouter';
const ALIAS = 'fast-model';
const UPSTREAM_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';
const DISPLAY_NAME = 'Llama 3.3 70B Instruct (free)';
const CONTEXT_WINDOW = 131_072;
const TIMEOUT_MS = 60_000;

export interface SeedResult {
  providerId: string;
  modelId: string;
  routeId: string;
  apiKeyId: string;
  apiKeyHint: string;
}

/**
 * Идемпотентно заполняет БД минимальным набором данных:
 * провайдер, модель, alias-маршрут и зашифрованный API-ключ.
 *
 * Повторный запуск не создаёт дубликаты:
 * - провайдер ищется по уникальному имени;
 * - модель — по (provider_id, upstream_model);
 * - маршрут — по (alias, model_id);
 * - ключ — по (provider_id, fingerprint).
 */
export async function seedDatabase(
  db: Database,
  env: Env,
): Promise<SeedResult> {
  const apiKeyValue = env.OPENROUTER_API_KEY?.trim();

  if (apiKeyValue === undefined || apiKeyValue === '') {
    throw new Error(
      'OPENROUTER_API_KEY is required. Fill it in .env before running db:seed.',
    );
  }

  const encryptionKey = decodeEncryptionKey(env.ENCRYPTION_KEY);
  const encrypted = encryptSecret(apiKeyValue, encryptionKey);
  const fingerprint = fingerprintSecret(apiKeyValue);
  const hint = hintSecret(apiKeyValue);

  return db.transaction(async (tx) => {
    const [provider] = await tx
      .insert(providers)
      .values({
        name: PROVIDER_NAME,
        type: 'openai_compatible',
        baseUrl: env.OPENROUTER_BASE_URL,
        isActive: true,
        timeoutMs: TIMEOUT_MS,
      })
      .onConflictDoUpdate({
        target: providers.name,
        set: {
          type: 'openai_compatible',
          baseUrl: env.OPENROUTER_BASE_URL,
          isActive: true,
          timeoutMs: TIMEOUT_MS,
          updatedAt: new Date(),
        },
      })
      .returning({ id: providers.id });

    if (provider === undefined) {
      throw new Error('Failed to upsert the OpenRouter provider');
    }

    const [model] = await tx
      .insert(models)
      .values({
        providerId: provider.id,
        upstreamModel: UPSTREAM_MODEL,
        displayName: DISPLAY_NAME,
        inputPriceMicrosPer1m: 0,
        outputPriceMicrosPer1m: 0,
        contextWindow: CONTEXT_WINDOW,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [models.providerId, models.upstreamModel],
        set: {
          displayName: DISPLAY_NAME,
          contextWindow: CONTEXT_WINDOW,
          isActive: true,
          updatedAt: new Date(),
        },
      })
      .returning({ id: models.id });

    if (model === undefined) {
      throw new Error('Failed to upsert the free Llama model');
    }

    const [route] = await tx
      .insert(modelRoutes)
      .values({
        alias: ALIAS,
        modelId: model.id,
        priority: 1,
        weight: 1,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [modelRoutes.alias, modelRoutes.modelId],
        set: {
          priority: 1,
          weight: 1,
          isActive: true,
          updatedAt: new Date(),
        },
      })
      .returning({ id: modelRoutes.id });

    if (route === undefined) {
      throw new Error('Failed to upsert the fast-model route');
    }

    const [apiKey] = await tx
      .insert(apiKeys)
      .values({
        providerId: provider.id,
        fingerprint,
        encryptedKey: encrypted.encryptedKey,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        keyHint: hint,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [apiKeys.providerId, apiKeys.fingerprint],
        set: {
          encryptedKey: encrypted.encryptedKey,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyHint: hint,
          isActive: true,
          updatedAt: new Date(),
        },
      })
      .returning({ id: apiKeys.id });

    if (apiKey === undefined) {
      throw new Error('Failed to upsert the OpenRouter API key');
    }

    return {
      providerId: provider.id,
      modelId: model.id,
      routeId: route.id,
      apiKeyId: apiKey.id,
      apiKeyHint: hint,
    };
  });
}

const env = loadEnv();
const database = createDatabase(env);

try {
  const result = await seedDatabase(database.db, env);

  console.log('Seed completed successfully:');
  console.log(`  provider: ${PROVIDER_NAME} (${result.providerId})`);
  console.log(`  model:    ${UPSTREAM_MODEL} (${result.modelId})`);
  console.log(`  alias:    ${ALIAS} (${result.routeId})`);
  console.log(`  api key:  ${result.apiKeyHint} (${result.apiKeyId})`);
} catch (error) {
  console.error(
    'Seed failed:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
} finally {
  await database.close();
}
