import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.ts';

// Single source of truth for the `assignment_source` enum across the schema CHECK constraint,
// the column type, the default value, and the repo-level helpers. Lives here (rather than in
// userAssignmentsRepo) because the schema files import this module to define the join tables;
// userAssignmentsRepo re-exports the constants so existing callsites keep their import path.
export const MANUAL_ASSIGNMENT_SOURCE = 'manual';
export const TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE = 'top_manager_auto';
export const PROJECT_CASCADE_ASSIGNMENT_SOURCE = 'project_cascade';

export type AssignmentSource =
  | typeof MANUAL_ASSIGNMENT_SOURCE
  | typeof TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE
  | typeof PROJECT_CASCADE_ASSIGNMENT_SOURCE;

const camelToSnake = (s: string): string => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

// Factory for the user_clients / user_projects / user_tasks join tables. They share an identical
// shape (user FK, target FK, assignment_source enum, created_at), differing only in the target
// table/column. `assignment_source` distinguishes manual rows from automatic ones (top-manager
// auto-assign, project-cascade) so the sync logic in `userAssignmentsRepo` can preserve manual
// edits while reconciling auto rows.
export function defineUserAssignmentTable<TName extends string, TFkKey extends string>(args: {
  tableName: TName;
  fkColumnKey: TFkKey;
  fkTarget: () => AnyPgColumn;
}) {
  return pgTable(
    args.tableName,
    {
      userId: varchar('user_id', { length: 50 })
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
      [args.fkColumnKey]: varchar(camelToSnake(args.fkColumnKey), { length: 50 })
        .notNull()
        .references(args.fkTarget, { onDelete: 'cascade' }),
      assignmentSource: varchar('assignment_source', { length: 20 })
        .$type<AssignmentSource>()
        .notNull()
        .default(MANUAL_ASSIGNMENT_SOURCE),
      createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    },
    (table) => [
      // Drizzle's pgTable column-map type doesn't propagate the literal `TFkKey` through a
      // computed property key, so the indexed access widens to `unknown` here even though
      // the call-site sees `userClients.clientId` correctly. Cast to keep the PK column list
      // typed without altering runtime behaviour.
      primaryKey({ columns: [table.userId, table[args.fkColumnKey] as AnyPgColumn] }),
      check(
        `${args.tableName}_assignment_source_check`,
        sql`${table.assignmentSource} IN ('manual', 'top_manager_auto', 'project_cascade')`,
      ),
    ],
  );
}
