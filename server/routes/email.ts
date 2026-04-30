import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as emailRepo from '../repositories/emailRepo.ts';
import { errorResponseSchema, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import emailService, { type EmailConfigInput } from '../services/email.ts';
import { logAudit } from '../utils/audit.ts';
import { MASKED_SECRET } from '../utils/crypto.ts';

const sharedConfigProperties = {
  enabled: { type: 'boolean' },
  smtpHost: { type: 'string' },
  smtpPort: { type: 'number' },
  smtpRejectUnauthorized: { type: 'boolean' },
  smtpUser: { type: 'string' },
  smtpPassword: { type: 'string' },
  fromEmail: { type: 'string' },
  fromName: { type: 'string' },
} as const;

// Response tolerates any smtpEncryption string so legacy DB values (older
// versions accepted any string) still load — otherwise the admin UI can't
// reach the form to correct them. EmailService falls back to STARTTLS for
// unknown values. Writes are still constrained by the body schema below.
const emailConfigResponseProperties = {
  ...sharedConfigProperties,
  smtpEncryption: { type: 'string' },
} as const;

const emailConfigSchema = {
  type: 'object',
  properties: emailConfigResponseProperties,
  required: Object.keys(emailConfigResponseProperties),
} as const;

const emailConfigUpdateBodySchema = {
  type: 'object',
  properties: {
    ...sharedConfigProperties,
    smtpEncryption: { type: 'string', enum: [...emailRepo.SMTP_ENCRYPTIONS] },
  },
} as const;

const emailTestBodySchema = {
  type: 'object',
  properties: {
    recipientEmail: { type: 'string' },
  },
  required: ['recipientEmail'],
} as const;

const emailTestResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    code: { type: 'string' },
    params: { type: ['object', 'null'] },
    messageId: { type: 'string' },
  },
  required: ['success', 'code'],
  additionalProperties: true,
} as const;

const emailTestConnectionResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    code: { type: 'string' },
    params: { type: ['object', 'null'] },
  },
  required: ['success', 'code'],
  additionalProperties: true,
} as const;

const serializeForResponse = (config: emailRepo.EmailConfig) => ({
  ...config,
  smtpPassword: config.smtpPassword ? MASKED_SECRET : '',
});

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.get(
    '/config',
    {
      onRequest: [authenticateToken, requirePermission('administration.email.view')],
      schema: {
        tags: ['email'],
        summary: 'Get email configuration',
        response: {
          200: emailConfigSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (_request, _reply) => {
      return serializeForResponse((await emailRepo.get()) ?? emailRepo.DEFAULT_CONFIG);
    },
  );

  fastify.put(
    '/config',
    {
      onRequest: [authenticateToken, requirePermission('administration.email.update')],
      schema: {
        tags: ['email'],
        summary: 'Update email configuration',
        body: emailConfigUpdateBodySchema,
        response: {
          200: emailConfigSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, _reply) => {
      const updated = await emailService.saveConfig(request.body as EmailConfigInput);

      await logAudit({
        request,
        action: 'email_config.updated',
        entityType: 'email_config',
        details: {
          secondaryLabel: updated.fromEmail || updated.smtpHost || undefined,
        },
      });
      return serializeForResponse(updated);
    },
  );

  fastify.post(
    '/test',
    {
      onRequest: [authenticateToken, requirePermission('administration.email.update')],
      schema: {
        tags: ['email'],
        summary: 'Send test email',
        body: emailTestBodySchema,
        response: {
          200: emailTestResponseSchema,
          429: errorResponseSchema,
          400: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { recipientEmail } = request.body as { recipientEmail: string };

      if (!recipientEmail?.includes('@')) {
        return reply.code(400).send({ error: 'INVALID_RECIPIENT', code: 'INVALID_RECIPIENT' });
      }

      const result = await emailService.sendTestEmail(recipientEmail);

      if (!result.success) {
        return reply.code(500).send({
          error: result.code,
          code: result.code,
          params: result.params,
        });
      }

      return {
        success: true,
        code: result.code,
        params: result.params,
        messageId: result.messageId,
      };
    },
  );

  fastify.post(
    '/test-connection',
    {
      onRequest: [authenticateToken, requirePermission('administration.email.update')],
      schema: {
        tags: ['email'],
        summary: 'Test SMTP connection',
        response: {
          200: emailTestConnectionResponseSchema,
          429: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const result = await emailService.testConnection();

      if (!result.success) {
        return reply.code(500).send({
          error: result.code,
          code: result.code,
          params: result.params,
        });
      }

      return {
        success: true,
        code: result.code,
        params: result.params,
      };
    },
  );
}
