import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { drizzle, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import pool from './index.ts';
import * as schema from './schema/index.ts';

export const db = drizzle(pool, { schema });

export type DbExecutor = PgDatabase<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
