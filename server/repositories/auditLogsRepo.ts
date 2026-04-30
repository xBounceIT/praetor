import pool, { type QueryExecutor } from '../db/index.ts';
import type { AuditLogDetails } from '../utils/audit.ts';
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

export const list = async (
  filter: AuditLogFilter,
  exec: QueryExecutor = pool,
): Promise<AuditLog[]> => {
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (filter.startDate) {
    params.push(filter.startDate);
    conditions.push(`al.created_at >= $${params.length}::timestamptz`);
  }

  if (filter.endDate) {
    params.push(filter.endDate);
    conditions.push(`al.created_at <= $${params.length}::timestamptz`);
  }

  const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

  const sql = `SELECT
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
      JOIN users u ON u.id = al.user_id${whereClause}
      ORDER BY al.created_at DESC
      LIMIT 500`;

  const { rows } = await exec.query<AuditLog>(sql, params);
  return rows;
};

export type AuditLogInsert = {
  userId: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ipAddress: string;
  details: AuditLogDetails | null;
};

export const create = async (input: AuditLogInsert, exec: QueryExecutor = pool): Promise<void> => {
  await exec.query(
    `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, ip_address, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      generatePrefixedId('audit'),
      input.userId,
      input.action,
      input.entityType,
      input.entityId,
      input.ipAddress,
      input.details ? JSON.stringify(input.details) : null,
    ],
  );
};
