import { randomUUID } from 'crypto';
import type { FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { createChildLogger, serializeError } from './logger.ts';

const logger = createChildLogger({ module: 'audit' });

export interface AuditLogParams {
  request: FastifyRequest;
  action: string;
  entityType?: string;
  entityId?: string;
  /** Override user ID — required for the login handler where request.user is not yet populated. */
  userId?: string;
}

export async function logAudit({
  request,
  action,
  entityType,
  entityId,
  userId,
}: AuditLogParams): Promise<void> {
  const effectiveUserId = userId ?? request.user?.id;
  if (!effectiveUserId) {
    logger.warn({ action }, 'Audit log skipped: no user ID available');
    return;
  }

  try {
    await query(
      'INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, ip_address) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        `audit-${randomUUID()}`,
        effectiveUserId,
        action,
        entityType ?? null,
        entityId ?? null,
        request.ip || 'unknown',
      ],
    );
  } catch (err) {
    logger.error(
      { err: serializeError(err), userId: effectiveUserId, action },
      'Audit log insert failed',
    );
  }
}
