import type { FastifyInstance } from 'fastify';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as revisionCodeTemplateRepo from '../repositories/revisionCodeTemplateRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { renderRevisionCode, validateRevisionCodeTemplate } from '../utils/revision-codes.ts';
import { badRequest } from '../utils/validation.ts';

const responseSchema = {
  type: 'object',
  properties: {
    prefix: { type: 'string' },
    template: { type: 'string' },
    sequencePadding: { type: 'integer' },
    preview: { type: 'string' },
  },
  required: ['prefix', 'template', 'sequencePadding', 'preview'],
} as const;

const withPreview = (config: Awaited<ReturnType<typeof revisionCodeTemplateRepo.get>>) => ({
  ...config,
  preview: renderRevisionCode(config, 1),
});

export default async function (fastify: FastifyInstance) {
  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requirePermission('administration.general.view'),
      ],
      schema: {
        tags: ['revision-code-template'],
        summary: 'Get the revision code template',
        response: { 200: responseSchema, ...standardRateLimitedErrorResponses },
      },
    },
    async () => withPreview(await revisionCodeTemplateRepo.get()),
  );

  fastify.put(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requirePermission('administration.general.update'),
      ],
      schema: {
        tags: ['revision-code-template'],
        summary: 'Update the revision code template',
        body: {
          type: 'object',
          properties: {
            prefix: { type: 'string' },
            template: { type: 'string' },
            sequencePadding: { type: 'integer' },
          },
          required: ['prefix', 'template', 'sequencePadding'],
          additionalProperties: false,
        },
        response: { 200: responseSchema, ...standardErrorResponses },
      },
    },
    async (request, reply) => {
      const parsed = validateRevisionCodeTemplate(request.body);
      if (!parsed.ok) return badRequest(reply, parsed.message);
      const updated = await revisionCodeTemplateRepo.upsert(parsed.value);
      await logAudit({
        request,
        action: 'settings.revision_code.updated',
        entityType: 'settings',
        details: { changedFields: ['revisionCodeTemplate'] },
      });
      return withPreview(updated);
    },
  );
}
