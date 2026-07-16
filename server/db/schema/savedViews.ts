import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.ts';

export type SavedViewKind = 'table' | 'dashboard' | 'report';
export type SavedViewPermission = 'read' | 'write';

// One row per saved view. Both kinds (StandardTable presets and project-dashboard layouts)
// share this table, distinguished by `kind` + `scopeKey`. `config` is an opaque per-kind jsonb
// payload validated in the route layer before it lands here. `scopeKey` namespaces views so
// presets for one table can never collide with another's (or with the dashboard surface).
export const savedViews = pgTable(
  'saved_views',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    ownerId: varchar('owner_id', { length: 50 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 20 }).$type<SavedViewKind>().notNull(),
    scopeKey: varchar('scope_key', { length: 150 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_saved_views_owner_kind_scope').on(table.ownerId, table.kind, table.scopeKey),
    index('idx_saved_views_kind_scope').on(table.kind, table.scopeKey),
    uniqueIndex('idx_saved_views_report_owner_scope_name_unique')
      .on(table.ownerId, table.kind, table.scopeKey, sql`lower(${table.name})`)
      .where(sql`${table.kind} = 'report'`),
    check('saved_views_kind_check', sql`${table.kind} IN ('table', 'dashboard', 'report')`),
  ],
);

// Dedicated share join table. Not `defineUserAssignmentTable` because that factory carries the
// `assignment_source` enum/CHECK we don't need and lacks the per-share `permission` we do.
export const savedViewShares = pgTable(
  'saved_view_shares',
  {
    viewId: varchar('view_id', { length: 50 })
      .notNull()
      .references(() => savedViews.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 50 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permission: varchar('permission', { length: 10 })
      .$type<SavedViewPermission>()
      .notNull()
      .default('read'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.viewId, table.userId] }),
    index('idx_saved_view_shares_user_id').on(table.userId),
    check('saved_view_shares_permission_check', sql`${table.permission} IN ('read', 'write')`),
  ],
);
