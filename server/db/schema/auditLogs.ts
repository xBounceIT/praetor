import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

export interface AuditLogDetails {
  targetLabel?: string;
  secondaryLabel?: string;
  changedFields?: string[];
  counts?: Record<string, number>;
  fromValue?: string;
  toValue?: string;
}

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    userId: varchar('user_id', { length: 50 }).notNull(),
    action: varchar('action', { length: 100 }).notNull().default('user.login'),
    entityType: varchar('entity_type', { length: 50 }),
    entityId: varchar('entity_id', { length: 100 }),
    ipAddress: varchar('ip_address', { length: 255 }).notNull(),
    details: jsonb('details').$type<AuditLogDetails | null>(),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_audit_logs_created_at').on(table.createdAt.desc()),
    index('idx_audit_logs_user_id').on(table.userId),
    index('idx_audit_logs_action').on(table.action),
  ],
);
