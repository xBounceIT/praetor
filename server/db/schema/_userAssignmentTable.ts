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

// Factory for the user_clients / user_projects / user_tasks join tables. They share an identical
// shape (user FK, target FK, assignment_source enum, created_at), differing only in the target
// table/column. `assignment_source` distinguishes manual rows from automatic ones (top-manager
// auto-assign, project-cascade) so the sync logic in `userAssignmentsRepo` can preserve manual
// edits while reconciling auto rows.
export function defineUserAssignmentTable<TName extends string, TFkKey extends string>(args: {
  tableName: TName;
  fkColumnName: string;
  fkColumnKey: TFkKey;
  fkTarget: () => AnyPgColumn;
  checkName: string;
}) {
  return pgTable(
    args.tableName,
    {
      userId: varchar('user_id', { length: 50 })
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
      [args.fkColumnKey]: varchar(args.fkColumnName, { length: 50 })
        .notNull()
        .references(args.fkTarget, { onDelete: 'cascade' }),
      assignmentSource: varchar('assignment_source', { length: 20 })
        .$type<'manual' | 'top_manager_auto' | 'project_cascade'>()
        .notNull()
        .default('manual'),
      createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    },
    (table) => [
      // Drizzle's pgTable column-map type doesn't propagate the literal `TFkKey` through a
      // computed property key, so the indexed access widens to `unknown` here even though
      // the call-site sees `userClients.clientId` correctly. Cast to keep the PK column list
      // typed without altering runtime behaviour.
      primaryKey({ columns: [table.userId, table[args.fkColumnKey] as AnyPgColumn] }),
      check(
        args.checkName,
        sql`${table.assignmentSource} IN ('manual', 'top_manager_auto', 'project_cascade')`,
      ),
    ],
  );
}
