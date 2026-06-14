import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken, requireAnyPermission, requirePermission } from '../middleware/auth.ts';
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
import { hasAnyPermission, type Permission } from '../utils/permissions.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { badRequest } from '../utils/validation.ts';

const moduleIdSchema = { type: 'string', enum: DOCUMENT_CODE_MODULE_IDS } as const;
const templateDescription =
  'Supports {PREFIX}, {YY}, {YYYY}, and {SEQ}; {SEQ} and one year token ({YY} or {YYYY}) are required. Literal text may contain only letters, numbers, underscores, and hyphens.';

const templateSchema = {
  type: 'object',
  properties: {
    moduleId: moduleIdSchema,
    label: { type: 'string' },
    prefix: { type: 'string' },
    template: { type: 'string', description: templateDescription },
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

const PREVIEW_ADMIN_PERMISSION = 'administration.general.view' as const;

const PREVIEW_CREATE_PERMISSION_BY_MODULE = {
  client_quote: 'sales.client_quotes.create',
  client_offer: 'sales.client_offers.create',
  supplier_quote: 'sales.supplier_quotes.create',
  client_order: 'accounting.clients_orders.create',
  supplier_order: 'accounting.supplier_orders.create',
  client_invoice: 'accounting.clients_invoices.create',
  supplier_invoice: 'accounting.supplier_invoices.create',
} satisfies Record<(typeof DOCUMENT_CODE_MODULE_IDS)[number], Permission>;

const PREVIEW_ROUTE_PERMISSIONS = [
  PREVIEW_ADMIN_PERMISSION,
  ...Object.values(PREVIEW_CREATE_PERMISSION_BY_MODULE),
] as [Permission, ...Permission[]];

const updateTemplateSchema = {
  type: 'object',
  properties: {
    moduleId: moduleIdSchema,
    prefix: { type: 'string' },
    template: { type: 'string', description: templateDescription },
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

const denyPreviewPermission = async (
  request: FastifyRequest,
  reply: FastifyReply,
  required: Permission[],
) => {
  const routeLabel = `${request.method} ${(request as { routeOptions?: { url?: string } }).routeOptions?.url ?? request.url}`;
  await logAudit({
    request,
    action: 'auth.permission_denied',
    entityType: 'route',
    entityId: routeLabel,
    details: {
      targetLabel: routeLabel,
      secondaryLabel: 'permission',
      changedFields: required.toSorted(),
    },
  });
  return reply.code(403).send({ error: 'Insufficient permissions' });
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.get(
    '/preview',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requireAnyPermission(...PREVIEW_ROUTE_PERMISSIONS),
      ],
      schema: {
        tags: ['document-code-templates'],
        summary: 'Preview the next document code',
        description:
          'Requires administration.general.view or the create permission for the requested document module.',
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
      const previewPermissions = [
        PREVIEW_ADMIN_PERMISSION,
        PREVIEW_CREATE_PERMISSION_BY_MODULE[query.moduleId],
      ];
      if (!hasAnyPermission(request.user?.permissions, previewPermissions)) {
        return denyPreviewPermission(request, reply, previewPermissions);
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
