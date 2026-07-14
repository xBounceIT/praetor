import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as auditLogsRepo from '../repositories/auditLogsRepo.ts';
import * as siemRepo from '../repositories/siemRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { errorResponseSchema, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import siemService, { type SiemConfigInput } from '../services/siem.ts';
import { AUDIT_ENTITY_TYPES, getAuditChangedFields, logAudit } from '../utils/audit.ts';
import { MASKED_SECRET } from '../utils/crypto.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';

const auditLogDetailsSchema = {
  type: 'object',
  properties: {
    targetLabel: { type: 'string' },
    secondaryLabel: { type: 'string' },
    changedFields: { type: 'array', items: { type: 'string' } },
    counts: { type: 'object', additionalProperties: { type: 'number' } },
    fromValue: { type: 'string' },
    toValue: { type: 'string' },
    reason: { type: 'string' },
  },
  additionalProperties: false,
} as const;

const auditLogSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    userName: { type: 'string' },
    username: { type: 'string' },
    action: { type: 'string' },
    entityType: { type: ['string', 'null'] },
    entityId: { type: ['string', 'null'] },
    ipAddress: { type: 'string' },
    createdAt: { type: 'number' },
    details: { anyOf: [auditLogDetailsSchema, { type: 'null' }] },
  },
  required: ['id', 'userId', 'userName', 'username', 'action', 'ipAddress', 'createdAt'],
} as const;

const auditLogListSchema = {
  type: 'array',
  items: auditLogSchema,
} as const;

const auditLogQuerySchema = {
  type: 'object',
  properties: {
    startDate: { type: 'string', format: 'date-time' },
    endDate: { type: 'string', format: 'date-time' },
    userId: { type: 'string', maxLength: 50 },
    username: { type: 'string', maxLength: 255 },
    action: { type: 'string', maxLength: 100 },
    entityType: { type: 'string', enum: AUDIT_ENTITY_TYPES },
  },
} as const;

const nullableDateSchema = { type: ['string', 'null'], format: 'date-time' } as const;
const siemConfigProperties = {
  enabled: { type: 'boolean' },
  host: { type: 'string' },
  port: { type: 'integer' },
  protocol: { type: 'string', enum: ['udp', 'tcp', 'tls'] },
  tcpFraming: { type: 'string', enum: ['newline', 'octet-counting'] },
  sourceIdentifier: { type: 'string' },
  facility: { type: 'integer' },
  runtimeLevel: { type: 'string', enum: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] },
  includeRuntime: { type: 'boolean' },
  includeAudit: { type: 'boolean' },
  caPem: { type: 'string' },
  serverName: { type: 'string' },
  clientCertPem: { type: 'string' },
  clientKey: { type: 'string' },
  retentionDays: { type: 'integer' },
  maxEvents: { type: 'integer' },
  revision: { type: 'integer' },
  testedRevision: { type: ['integer', 'null'] },
  lastTestAt: nullableDateSchema,
  lastTestSuccess: { type: ['boolean', 'null'] },
  lastDeliveryAt: nullableDateSchema,
  lastErrorAt: nullableDateSchema,
  lastError: { type: ['string', 'null'] },
  droppedRetention: { type: 'integer' },
  droppedCapacity: { type: 'integer' },
  updatedAt: { type: 'string', format: 'date-time' },
} as const;

const siemConfigSchema = {
  type: 'object',
  properties: siemConfigProperties,
  required: Object.keys(siemConfigProperties),
} as const;

const siemConfigUpdateSchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    host: { type: 'string', minLength: 1, maxLength: 255 },
    port: { type: 'integer', minimum: 1, maximum: 65535 },
    protocol: { type: 'string', enum: ['udp', 'tcp', 'tls'] },
    tcpFraming: { type: 'string', enum: ['newline', 'octet-counting'] },
    sourceIdentifier: { type: 'string', minLength: 1, maxLength: 255 },
    facility: { type: 'integer', minimum: 0, maximum: 23 },
    runtimeLevel: { type: 'string', enum: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] },
    includeRuntime: { type: 'boolean' },
    includeAudit: { type: 'boolean' },
    caPem: { type: 'string', maxLength: 100000 },
    serverName: { type: 'string', maxLength: 255 },
    clientCertPem: { type: 'string', maxLength: 100000 },
    clientKey: { type: 'string', maxLength: 100000 },
    retentionDays: { type: 'integer', minimum: 1, maximum: 30 },
    maxEvents: { type: 'integer', minimum: 10000, maximum: 1000000 },
  },
} as const;

const siemStatusProperties = {
  enabled: { type: 'boolean' },
  revision: { type: 'integer' },
  testedRevision: { type: ['integer', 'null'] },
  lastTestAt: nullableDateSchema,
  lastTestSuccess: { type: ['boolean', 'null'] },
  lastDeliveryAt: nullableDateSchema,
  lastErrorAt: nullableDateSchema,
  lastError: { type: ['string', 'null'] },
  droppedRetention: { type: 'integer' },
  droppedCapacity: { type: 'integer' },
  pendingCount: { type: 'integer' },
  oldestPendingAt: nullableDateSchema,
} as const;

const siemStatusSchema = {
  type: 'object',
  properties: siemStatusProperties,
  required: Object.keys(siemStatusProperties),
} as const;

const serializeConfig = (config: siemRepo.SiemConfig) => ({
  ...config,
  clientKey: config.clientKey ? MASKED_SECRET : '',
  lastTestAt: config.lastTestAt?.toISOString() ?? null,
  lastDeliveryAt: config.lastDeliveryAt?.toISOString() ?? null,
  lastErrorAt: config.lastErrorAt?.toISOString() ?? null,
  updatedAt: config.updatedAt.toISOString(),
});

const serializeStatus = (status: siemRepo.SiemStatus) => ({
  ...status,
  lastTestAt: status.lastTestAt?.toISOString() ?? null,
  lastDeliveryAt: status.lastDeliveryAt?.toISOString() ?? null,
  lastErrorAt: status.lastErrorAt?.toISOString() ?? null,
  oldestPendingAt: status.oldestPendingAt?.toISOString() ?? null,
});

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.get(
    '/audit',
    {
      onRequest: [authenticateToken, requirePermission('administration.logs.view')],
      schema: {
        tags: ['logs'],
        summary: 'List system audit logs',
        querystring: auditLogQuerySchema,
        response: {
          200: auditLogListSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { startDate, endDate, userId, username, action, entityType } = request.query as {
        startDate?: string;
        endDate?: string;
        userId?: string;
        username?: string;
        action?: string;
        entityType?: string;
      };

      // Resolve `username` → `userId` so the repo can stay strictly typed on userId.
      // A username that doesn't resolve to a user short-circuits to an empty result set
      // (we pass a sentinel that won't match any row) so the API does not silently return
      // unrelated rows when the lookup fails.
      let resolvedUserId = userId;
      if (username && !resolvedUserId) {
        const user = await usersRepo.findLoginUserByNormalizedUsername(username);
        if (!user) {
          return [];
        }
        resolvedUserId = user.id;
      }

      return auditLogsRepo.list({
        startDate,
        endDate,
        userId: resolvedUserId,
        action,
        entityType,
      });
    },
  );

  fastify.get(
    '/siem/config',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requirePermission('administration.logs.view'),
      ],
      schema: {
        tags: ['logs'],
        summary: 'Get SIEM log streaming configuration',
        response: { 200: siemConfigSchema, ...standardRateLimitedErrorResponses },
      },
    },
    async () => serializeConfig(await siemService.getConfig()),
  );

  fastify.put(
    '/siem/config',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requirePermission('administration.logs.update'),
      ],
      schema: {
        tags: ['logs'],
        summary: 'Update SIEM log streaming configuration',
        body: siemConfigUpdateSchema,
        response: {
          200: siemConfigSchema,
          ...standardRateLimitedErrorResponses,
          409: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const body = request.body as SiemConfigInput;
      const updated = await siemService.saveConfig(body);
      await logAudit({
        request,
        action: 'siem_config.updated',
        entityType: 'siem_config',
        details: {
          changedFields: getAuditChangedFields(body as Record<string, unknown>, {
            exclude: ['caPem', 'clientCertPem', 'clientKey'],
          }),
          secondaryLabel: updated.host || undefined,
        },
      });
      return serializeConfig(updated);
    },
  );

  fastify.get(
    '/siem/status',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requirePermission('administration.logs.view'),
      ],
      schema: {
        tags: ['logs'],
        summary: 'Get SIEM outbox and delivery status',
        response: { 200: siemStatusSchema, ...standardRateLimitedErrorResponses },
      },
    },
    async () => serializeStatus(await siemRepo.getStatus()),
  );

  fastify.post(
    '/siem/test',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requirePermission('administration.logs.update'),
      ],
      schema: {
        tags: ['logs'],
        summary: 'Test the saved SIEM destination',
        response: {
          200: {
            type: 'object',
            properties: { success: { type: 'boolean' }, error: { type: 'string' } },
            required: ['success'],
          },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request) => {
      const result = await siemService.test();
      await logAudit({
        request,
        action: 'siem_config.tested',
        entityType: 'siem_config',
        details: { secondaryLabel: result.success ? 'success' : 'failed' },
      });
      return result;
    },
  );

  fastify.post(
    '/siem/enable',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requirePermission('administration.logs.update'),
      ],
      schema: {
        tags: ['logs'],
        summary: 'Enable SIEM log streaming',
        response: {
          200: siemConfigSchema,
          ...standardRateLimitedErrorResponses,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const updated = await siemService.enable();
        await logAudit({ request, action: 'siem_config.enabled', entityType: 'siem_config' });
        return serializeConfig(updated);
      } catch (error) {
        if ((error as { code?: string }).code === 'SIEM_TEST_REQUIRED') {
          return reply
            .code(409)
            .send({ error: 'SIEM_TEST_REQUIRED', errorCode: 'SIEM_TEST_REQUIRED' });
        }
        throw error;
      }
    },
  );

  fastify.post(
    '/siem/disable',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requirePermission('administration.logs.update'),
      ],
      schema: {
        tags: ['logs'],
        summary: 'Disable SIEM log streaming',
        response: { 200: siemConfigSchema, ...standardRateLimitedErrorResponses },
      },
    },
    async (request) => {
      const updated = await siemService.disable();
      await logAudit({ request, action: 'siem_config.disabled', entityType: 'siem_config' });
      return serializeConfig(updated);
    },
  );
}
