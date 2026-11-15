import { loadEnv } from '../config/env.js';
import {
  clientKeyPrefix,
  generateClientKey,
  hashClientKey,
} from '../core/clientKeys.js';
import { createDatabase } from './client.js';
import { clients } from './schema.js';

const DEFAULT_RATE_LIMIT_RPM = 60;

/**
 * Создаёт клиента шлюза и один раз печатает его API-ключ.
 *
 * В БД сохраняется только SHA-256-хэш и короткий префикс, поэтому
 * потерянный ключ нельзя восстановить — можно только создать новый.
 *
 * Использование:
 *   npm run db:create-client -- "Postman" 60
 */
async function main(): Promise<void> {
  const [nameArg, rpmArg] = process.argv.slice(2);
  const name = nameArg?.trim() ?? '';

  if (name === '') {
    throw new Error(
      'Usage: npm run db:create-client -- <name> [rateLimitRpm]',
    );
  }

  const rateLimitRpm = parseRateLimit(rpmArg);
  const env = loadEnv();
  const database = createDatabase(env);

  try {
    const apiKey = generateClientKey();
    const keyPrefix = clientKeyPrefix(apiKey);

    const [client] = await database.db
      .insert(clients)
      .values({
        name,
        keyHash: hashClientKey(apiKey),
        keyPrefix,
        rateLimitRpm,
        isActive: true,
      })
      .returning({
        id: clients.id,
        name: clients.name,
        rateLimitRpm: clients.rateLimitRpm,
      });

    if (client === undefined) {
      throw new Error('Failed to create the client');
    }

    console.log('Client created successfully:');
    console.log(`  id:          ${client.id}`);
    console.log(`  name:        ${client.name}`);
    console.log(`  rate limit:  ${client.rateLimitRpm} rpm`);
    console.log(`  key prefix:  ${keyPrefix}`);
    console.log(`  api key:     ${apiKey}`);
    console.log('');
    console.log(
      'Store the API key now: only its SHA-256 hash is saved in the database.',
    );
  } finally {
    await database.close();
  }
}

function parseRateLimit(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_RATE_LIMIT_RPM;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('rateLimitRpm must be a positive integer');
  }

  return parsed;
}

try {
  await main();
} catch (error) {
  console.error(
    'Client creation failed:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
}
