import type { FastifyRequest } from 'fastify';
import type { AuditLogDetails } from '../db/schema/auditLogs.ts';
import * as auditLogsRepo from '../repositories/auditLogsRepo.ts';
import { createChildLogger, serializeError } from './logger.ts';

const logger = createChildLogger({ module: 'audit' });

const SENSITIVE_AUDIT_FIELDS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'smtpPassword',
  'smtp_password',
  'bindPassword',
  'bind_password',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'clientSecret',
  'apiKey',
  'api_key',
  'geminiApiKey',
  'gemini_api_key',
  'openrouterApiKey',
  'openrouter_api_key',
]);

export interface AuditLogParams {
  request: FastifyRequest;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: AuditLogDetails;
  /** Override user ID — required for the login handler where request.user is not yet populated. */
  userId?: string;
}

export const getAuditChangedFields = (
  input: Record<string, unknown>,
  options: { exclude?: string[] } = {},
): string[] | undefined => {
  const excluded = new Set([...SENSITIVE_AUDIT_FIELDS, ...(options.exclude ?? [])]);
  const changedFields = Object.entries(input)
    .filter(([key, value]) => value !== undefined && !excluded.has(key))
    .map(([key]) => key)
    .sort((left, right) => left.localeCompare(right));

  return changedFields.length > 0 ? changedFields : undefined;
};

export const deriveToggleAction = (
  changedFields: string[] | undefined,
  toggleKey: string,
  baseAction: string,
  onAction: string,
  offAction: string,
  isOn: boolean | undefined,
): string => {
  if (changedFields?.length === 1 && changedFields[0] === toggleKey) {
    return isOn ? onAction : offAction;
  }
  return baseAction;
};

export const getAuditCounts = (
  input: Record<string, number | null | undefined>,
): Record<string, number> | undefined => {
  const counts = Object.fromEntries(
    Object.entries(input).filter(
      ([, value]) => typeof value === 'number' && Number.isFinite(value) && value >= 0,
    ),
  ) as Record<string, number>;

  return Object.keys(counts).length > 0 ? counts : undefined;
};

const normalizeAuditDetails = (details?: AuditLogDetails): AuditLogDetails | null => {
  if (!details) return null;

  const changedFields =
    details.changedFields
      ?.filter((field) => field && !SENSITIVE_AUDIT_FIELDS.has(field))
      .map((field) => field.trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right)) ?? [];

  const counts = details.counts
    ? Object.fromEntries(
        Object.entries(details.counts).filter(
          ([, value]) => typeof value === 'number' && Number.isFinite(value) && value >= 0,
        ),
      )
    : undefined;

  const normalized: AuditLogDetails = {
    targetLabel: details.targetLabel?.trim() || undefined,
    secondaryLabel: details.secondaryLabel?.trim() || undefined,
    changedFields: changedFields.length > 0 ? Array.from(new Set(changedFields)) : undefined,
    counts: counts && Object.keys(counts).length > 0 ? counts : undefined,
    fromValue: details.fromValue?.trim() || undefined,
    toValue: details.toValue?.trim() || undefined,
  };

  return Object.values(normalized).some((value) => value !== undefined) ? normalized : null;
};

export async function logAudit({
  request,
  action,
  entityType,
  entityId,
  details,
  userId,
}: AuditLogParams): Promise<void> {
  const effectiveUserId = userId ?? request.user?.id;
  if (!effectiveUserId) {
    logger.warn({ action }, 'Audit log skipped: no user ID available');
    return;
  }

  try {
    await auditLogsRepo.create({
      userId: effectiveUserId,
      action,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      ipAddress: request.ip || 'unknown',
      details: normalizeAuditDetails(details),
    });
  } catch (err) {
    logger.error(
      { err: serializeError(err), userId: effectiveUserId, action },
      'Audit log insert failed',
    );
  }
}
