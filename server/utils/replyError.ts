import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuditLogDetails } from '../db/schema/auditLogs.ts';
import { logAudit } from './audit.ts';

export type AuditableErrorStatus = 400 | 403 | 404 | 409;

export interface ReplyErrorParams {
  statusCode: AuditableErrorStatus;
  message: string;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: AuditLogDetails;
  errorCode?: string;
  skipAudit?: boolean;
  // Additional fields merged into the response body alongside `error` (and optional `errorCode`).
  // Use sparingly: API clients already key on `error` and HTTP status.
  extraBody?: Record<string, unknown>;
}

// Emits an audit row for 4xx error responses (400/403/404/409) before sending the reply.
// `logAudit` swallows its own insert failures, so this helper never throws on audit failure.
export async function replyError(
  request: FastifyRequest,
  reply: FastifyReply,
  params: ReplyErrorParams,
): Promise<FastifyReply> {
  if (!params.skipAudit) {
    await logAudit({
      request,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      details: params.details,
    });
  }
  const body: Record<string, unknown> = { error: params.message };
  if (params.errorCode) body.errorCode = params.errorCode;
  if (params.extraBody) Object.assign(body, params.extraBody);
  return reply.code(params.statusCode).send(body);
}
