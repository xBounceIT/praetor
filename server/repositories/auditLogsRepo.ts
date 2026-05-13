import { type SQL, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { type AuditLogDetails, auditLogs } from '../db/schema/auditLogs.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';

export type AuditLog = {
  id: string;
  userId: string;
  userName: string;
  username: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ipAddress: string;
  createdAt: number;
  details: AuditLogDetails | null;
};

export type AuditLogFilter = {
  startDate?: string;
  endDate?: string;
};

export const list = async (filter: AuditLogFilter, exec: DbExecutor = db): Promise<AuditLog[]> => {
  const conditions: SQL[] = [];
  // Interpret incoming filter strings as UTC. `::timestamptz AT TIME ZONE 'UTC'` first parses
  // the string as a timestamptz (honoring any explicit offset like `Z` or `+02:00`), then
  // converts to a `timestamp without time zone` representing UTC wall-clock. That matches
  // the type of `al.created_at` (declared `timestamp`, not `timestamptz`), so the comparison
  // doesn't trigger an implicit session-timezone conversion. A bare `::timestamptz` cast
  // would have made the comparison depend on the server's `TimeZone` GUC, yielding different
  // result sets across deployments.
  if (filter.startDate) {
    conditions.push(sql`al.created_at >= ${filter.startDate}::timestamptz AT TIME ZONE 'UTC'`);
  }
  if (filter.endDate) {
    conditions.push(sql`al.created_at <= ${filter.endDate}::timestamptz AT TIME ZONE 'UTC'`);
  }

  const whereClause =
    conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

  return await executeRows<AuditLog>(
    exec,
    sql`SELECT
          al.id,
          al.user_id as "userId",
          u.name as "userName",
          u.username,
          al.action,
          al.entity_type as "entityType",
          al.entity_id as "entityId",
          al.ip_address as "ipAddress",
          (EXTRACT(EPOCH FROM al.created_at) * 1000)::float8 as "createdAt",
          CASE WHEN jsonb_typeof(al.details) = 'object' THEN al.details ELSE NULL END as "details"
        FROM audit_logs al
        JOIN users u ON u.id = al.user_id
        ${whereClause}
        ORDER BY al.created_at DESC
        LIMIT 500`,
  );
};

export type AuditLogInsert = {
  userId: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ipAddress: string;
  details: AuditLogDetails | null;
};

export const create = async (input: AuditLogInsert, exec: DbExecutor = db): Promise<void> => {
  await exec.insert(auditLogs).values({
    id: generatePrefixedId('audit'),
    userId: input.userId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    ipAddress: input.ipAddress,
    details: input.details,
  });
};
