import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import { standardRateLimitedErrorResponses } from '../schemas/common.ts';
import * as ssoService from '../services/sso.ts';
import { logAudit } from '../utils/audit.ts';
import { badRequest, parseBoolean, requireNonEmptyString } from '../utils/validation.ts';

const roleMappingSchema = {
  type: 'object',
  properties: {
    externalGroup: { type: 'string' },
    role: { type: 'string' },
  },
  required: ['externalGroup', 'role'],
} as const;

const providerSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    protocol: { type: 'string', enum: ['oidc', 'saml'] },
    slug: { type: 'string' },
    name: { type: 'string' },
    enabled: { type: 'boolean' },
    issuerUrl: { type: 'string' },
    clientId: { type: 'string' },
    clientSecret: { type: 'string' },
    scopes: { type: 'string' },
    metadataUrl: { type: 'string' },
    metadataXml: { type: 'string' },
    entryPoint: { type: 'string' },
    idpIssuer: { type: 'string' },
    idpCert: { type: 'string' },
    spIssuer: { type: 'string' },
    privateKey: { type: 'string' },
    publicCert: { type: 'string' },
    usernameAttribute: { type: 'string' },
    nameAttribute: { type: 'string' },
    emailAttribute: { type: 'string' },
    groupsAttribute: { type: 'string' },
    roleMappings: { type: 'array', items: roleMappingSchema },
  },
  required: ['id', 'protocol', 'slug', 'name', 'enabled', 'roleMappings'],
} as const;

const providerBodySchema = {
  type: 'object',
  properties: providerSchema.properties,
} as const;

const publicProviderSchema = {
  type: 'object',
  properties: {
    protocol: { type: 'string', enum: ['oidc', 'saml'] },
    slug: { type: 'string' },
    name: { type: 'string' },
  },
  required: ['protocol', 'slug', 'name'],
} as const;

const idParamsSchema = {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
} as const;

const slugPattern = /^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]$/;

const validateProviderBody = async (
  body: Record<string, unknown>,
  reply: FastifyReply,
  options: { isCreate: boolean },
): Promise<ssoService.SsoProviderInput | null> => {
  const input = body as ssoService.SsoProviderInput;

  if (options.isCreate) {
    const protocol = requireNonEmptyString(input.protocol, 'protocol');
    if (!protocol.ok) {
      badRequest(reply, protocol.message);
      return null;
    }
    if (protocol.value !== 'oidc' && protocol.value !== 'saml') {
      badRequest(reply, 'protocol must be oidc or saml');
      return null;
    }
  }

  if (input.slug !== undefined) {
    const slug = requireNonEmptyString(input.slug, 'slug');
    if (!slug.ok) {
      badRequest(reply, slug.message);
      return null;
    }
    if (!slugPattern.test(slug.value.trim().toLowerCase())) {
      badRequest(reply, 'slug must contain lowercase letters, numbers, and hyphens only');
      return null;
    }
  }

  if (input.name !== undefined) {
    const name = requireNonEmptyString(input.name, 'name');
    if (!name.ok) {
      badRequest(reply, name.message);
      return null;
    }
    input.name = name.value;
  }

  if (input.enabled !== undefined) {
    input.enabled = parseBoolean(input.enabled);
  } else if (options.isCreate) {
    input.enabled = false;
  }

  if (input.enabled && input.protocol === 'oidc') {
    for (const field of ['issuerUrl', 'clientId', 'usernameAttribute'] as const) {
      const result = requireNonEmptyString(input[field], field);
      if (!result.ok) {
        badRequest(reply, result.message);
        return null;
      }
      input[field] = result.value;
    }
  }

  if (input.enabled && input.protocol === 'saml') {
    const hasMetadata = !!input.metadataUrl?.trim() || !!input.metadataXml?.trim();
    const hasManual = !!input.entryPoint?.trim() && !!input.idpCert?.trim();
    if (!hasMetadata && !hasManual) {
      badRequest(reply, 'SAML requires metadata URL/XML or manual entryPoint and idpCert');
      return null;
    }
  }

  if (input.roleMappings !== undefined) {
    if (!Array.isArray(input.roleMappings)) {
      badRequest(reply, 'roleMappings must be an array');
      return null;
    }
    const roleMappings: NonNullable<ssoService.SsoProviderInput['roleMappings']> = [];
    for (let i = 0; i < input.roleMappings.length; i++) {
      const mapping = input.roleMappings[i] as { externalGroup?: unknown; role?: unknown };
      const externalGroup = requireNonEmptyString(
        mapping.externalGroup,
        `roleMappings[${i}].externalGroup`,
      );
      if (!externalGroup.ok) {
        badRequest(reply, externalGroup.message);
        return null;
      }
      const role = requireNonEmptyString(mapping.role, `roleMappings[${i}].role`);
      if (!role.ok) {
        badRequest(reply, role.message);
        return null;
      }
      roleMappings.push({ externalGroup: externalGroup.value, role: role.value });
    }
    const existingRoles = await rolesRepo.findExistingIds(roleMappings.map((m) => m.role));
    for (const mapping of roleMappings) {
      if (!existingRoles.has(mapping.role)) {
        badRequest(reply, `roleMappings role '${mapping.role}' does not exist`);
        return null;
      }
    }
    input.roleMappings = roleMappings;
  }

  return input;
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.get(
    '/providers/public',
    {
      schema: {
        tags: ['sso'],
        summary: 'List enabled public SSO providers',
        security: [],
        response: {
          200: { type: 'array', items: publicProviderSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async () => ssoService.listPublicProviders(),
  );

  fastify.get(
    '/providers',
    {
      onRequest: [authenticateToken, requirePermission('administration.authentication.view')],
      schema: {
        tags: ['sso'],
        summary: 'List SSO providers',
        response: {
          200: { type: 'array', items: providerSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async () => ssoService.listAdminProviders(),
  );

  fastify.post(
    '/providers',
    {
      onRequest: [authenticateToken, requirePermission('administration.authentication.update')],
      schema: {
        tags: ['sso'],
        summary: 'Create SSO provider',
        body: providerBodySchema,
        response: {
          200: providerSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const input = await validateProviderBody(request.body as Record<string, unknown>, reply, {
        isCreate: true,
      });
      if (!input) return reply;
      const created = await ssoService.createProvider(input);
      await logAudit({
        request,
        action: 'sso_provider.created',
        entityType: 'sso_provider',
        entityId: created.id,
        details: { targetLabel: created.name, secondaryLabel: created.protocol },
      });
      return created;
    },
  );

  fastify.put(
    '/providers/:id',
    {
      onRequest: [authenticateToken, requirePermission('administration.authentication.update')],
      schema: {
        tags: ['sso'],
        summary: 'Update SSO provider',
        params: idParamsSchema,
        body: providerBodySchema,
        response: {
          200: providerSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const input = await validateProviderBody(request.body as Record<string, unknown>, reply, {
        isCreate: false,
      });
      if (!input) return reply;
      const updated = await ssoService.updateProvider(id, input);
      if (!updated) return reply.code(404).send({ error: 'SSO provider not found' });
      await logAudit({
        request,
        action: 'sso_provider.updated',
        entityType: 'sso_provider',
        entityId: updated.id,
        details: { targetLabel: updated.name, secondaryLabel: updated.protocol },
      });
      return updated;
    },
  );

  fastify.delete(
    '/providers/:id',
    {
      onRequest: [authenticateToken, requirePermission('administration.authentication.update')],
      schema: {
        tags: ['sso'],
        summary: 'Delete SSO provider',
        params: idParamsSchema,
        response: {
          204: { type: 'null' },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const deleted = await ssoService.deleteProvider(id);
      if (!deleted) return reply.code(404).send({ error: 'SSO provider not found' });
      await logAudit({
        request,
        action: 'sso_provider.deleted',
        entityType: 'sso_provider',
        entityId: id,
      });
      return reply.code(204).send();
    },
  );
}
