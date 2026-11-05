import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import type { Env } from '../config/env.js';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseClient {
  db: Database;
  sql: Sql;
  close: () => Promise<void>;
}

export function createDatabase(env: Env): DatabaseClient {
  const sql = postgres(env.DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  const db = drizzle(sql, { schema });

  return {
    db,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
