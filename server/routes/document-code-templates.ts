import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as documentCodeTemplatesRepo from '../repositories/documentCodeTemplatesRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { previewDocumentCode } from '../services/documentCodes.ts';
import { logAudit } from '../utils/audit.ts';
import { replyDocumentCodeCollision } from '../utils/document-code-replies.ts';
import {
  DOCUMENT_CODE_MODULE_IDS,
  isDocumentCodeModuleId,
  renderDocumentCode,
  validateDocumentCodeTemplate,
} from '../utils/document-codes.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { badRequest } from '../utils/validation.ts';

const moduleIdSchema = { type: 'string', enum: DOCUMENT_CODE_MODULE_IDS } as const;

const templateSchema = {
  type: 'object',
  properties: {
    moduleId: moduleIdSchema,
    label: { type: 'string' },
    prefix: { type: 'string' },
    template: { type: 'string' },
    sequencePadding: { type: 'integer' },
    preview: { type: 'string' },
  },
  required: ['moduleId', 'label', 'prefix', 'template', 'sequencePadding', 'preview'],
} as const;

const previewSchema = {
  type: 'object',
  properties: {
    moduleId: moduleIdSchema,
    preview: { type: 'string' },
    year: { type: 'integer' },
    sequence: { type: 'integer' },
  },
  required: ['moduleId', 'preview', 'year', 'sequence'],
} as const;

const previewQuerySchema = {
  type: 'object',
  properties: {
    moduleId: moduleIdSchema,
    date: { type: 'string' },
  },
  required: ['moduleId'],
  additionalProperties: false,
} as const;

const updateTemplateSchema = {
  type: 'object',
  properties: {
    moduleId: moduleIdSchema,
    prefix: { type: 'string' },
    template: { type: 'string' },
    sequencePadding: { type: 'integer' },
  },
  required: ['moduleId', 'prefix', 'template', 'sequencePadding'],
  additionalProperties: false,
} as const;

const updateBodySchema = {
  type: 'object',
  properties: {
    templates: {
      type: 'array',
      minItems: 1,
      maxItems: DOCUMENT_CODE_MODULE_IDS.length,
      items: updateTemplateSchema,
    },
  },
  required: ['templates'],
  additionalProperties: false,
} as const;

const withPreview = (
  template: Awaited<ReturnType<typeof documentCodeTemplatesRepo.list>>[number],
) => ({
  ...template,
  preview: renderDocumentCode(template, {
    year: new Date().getFullYear(),
    sequence: 1,
  }),
});

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.get(
    '/preview',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requirePermission('administration.general.view'),
      ],
      schema: {
        tags: ['document-code-templates'],
        summary: 'Preview the next document code',
        querystring: previewQuerySchema,
        response: {
          200: previewSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const query = (request.query ?? {}) as { moduleId?: unknown; date?: unknown };
      if (!isDocumentCodeModuleId(query.moduleId)) {
        return badRequest(reply, 'moduleId is invalid');
      }
      if (query.date !== undefined && typeof query.date !== 'string') {
        return badRequest(reply, 'date must be a string');
      }

      try {
        const preview = await previewDocumentCode(query.moduleId, { date: query.date });
        return {
          moduleId: preview.moduleId,
          preview: preview.code,
          year: preview.year,
          sequence: preview.sequence,
        };
      } catch (error) {
        const codeCollision = replyDocumentCodeCollision(
          request,
          reply,
          error,
          'settings.document_codes.preview_failed',
          'settings',
        );
        if (codeCollision) return codeCollision;
        if (error instanceof Error && error.message.includes('date')) {
          return badRequest(reply, error.message);
        }
        throw error;
      }
    },
  );

  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requirePermission('administration.general.view'),
      ],
      schema: {
        tags: ['document-code-templates'],
        summary: 'List document code templates',
        response: {
          200: { type: 'array', items: templateSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async () => {
      const templates = await documentCodeTemplatesRepo.list();
      return templates.map(withPreview);
    },
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
        tags: ['document-code-templates'],
        summary: 'Update document code templates',
        body: updateBodySchema,
        response: {
          200: { type: 'array', items: templateSchema },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as { templates?: unknown };
      if (!Array.isArray(body.templates)) {
        return badRequest(reply, 'templates must be an array');
      }

      const seen = new Set<string>();
      const templates: documentCodeTemplatesRepo.StoredDocumentCodeTemplate[] = [];
      for (const [index, entry] of body.templates.entries()) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return badRequest(reply, `templates[${index}] must be an object`);
        }
        const candidate = entry as {
          moduleId: unknown;
          prefix: unknown;
          template: unknown;
          sequencePadding: unknown;
        };
        const result = validateDocumentCodeTemplate(candidate);
        if (!result.ok) {
          return badRequest(reply, `templates[${index}]: ${result.message}`);
        }
        if (seen.has(result.value.moduleId)) {
          return badRequest(reply, `templates[${index}]: duplicate moduleId`);
        }
        seen.add(result.value.moduleId);
        templates.push(result.value);
      }

      const updated = await documentCodeTemplatesRepo.upsertMany(templates);
      await logAudit({
        request,
        action: 'settings.document_codes.updated',
        entityType: 'settings',
        details: {
          changedFields: ['documentCodeTemplates'],
          counts: { templates: templates.length },
        },
      });
      return updated.map(withPreview);
    },
  );
}
