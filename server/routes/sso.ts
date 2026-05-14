import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import { standardRateLimitedErrorResponses } from '../schemas/common.ts';
import * as ssoService from '../services/sso.ts';
import { logAudit } from '../utils/audit.ts';
import { replyError } from '../utils/replyError.ts';
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

const handleProviderValidationError = (error: unknown, reply: FastifyReply): boolean => {
  if (error instanceof ssoService.SsoProviderValidationError) {
    badRequest(reply, error.message);
    return true;
  }
  return false;
};

const validateProviderBody = async (
  body: Record<string, unknown>,
  reply: FastifyReply,
  options: { isCreate: boolean },
): Promise<ssoService.SsoProviderInput | null> => {
  // Build a new object rather than mutating `body`: the caller passes `request.body`, and
  // Fastify hooks downstream (audit logging, error handler) shouldn't observe normalized
  // values like trimmed strings or coerced booleans.
  const source = body as ssoService.SsoProviderInput;
  const validated: ssoService.SsoProviderInput = { ...source };

  if (options.isCreate) {
    const protocol = requireNonEmptyString(source.protocol, 'protocol');
    if (!protocol.ok) {
      badRequest(reply, protocol.message);
      return null;
    }
    if (protocol.value !== 'oidc' && protocol.value !== 'saml') {
      badRequest(reply, 'protocol must be oidc or saml');
      return null;
    }
    validated.protocol = protocol.value;
  }

  if (source.slug !== undefined) {
    const slug = requireNonEmptyString(source.slug, 'slug');
    if (!slug.ok) {
      badRequest(reply, slug.message);
      return null;
    }
    if (!slugPattern.test(slug.value.trim().toLowerCase())) {
      badRequest(reply, 'slug must contain lowercase letters, numbers, and hyphens only');
      return null;
    }
    validated.slug = slug.value;
  }

  if (source.name !== undefined) {
    const name = requireNonEmptyString(source.name, 'name');
    if (!name.ok) {
      badRequest(reply, name.message);
      return null;
    }
    validated.name = name.value;
  }

  if (source.enabled !== undefined) {
    validated.enabled = parseBoolean(source.enabled);
  } else if (options.isCreate) {
    validated.enabled = false;
  }

  if (options.isCreate && validated.enabled && validated.protocol === 'oidc') {
    for (const field of ['issuerUrl', 'clientId', 'usernameAttribute'] as const) {
      const result = requireNonEmptyString(source[field], field);
      if (!result.ok) {
        badRequest(reply, result.message);
        return null;
      }
      validated[field] = result.value;
    }
  }

  if (source.roleMappings !== undefined) {
    if (!Array.isArray(source.roleMappings)) {
      badRequest(reply, 'roleMappings must be an array');
      return null;
    }
    const roleMappings: NonNullable<ssoService.SsoProviderInput['roleMappings']> = [];
    for (let i = 0; i < source.roleMappings.length; i++) {
      const mapping = source.roleMappings[i] as { externalGroup?: unknown; role?: unknown };
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
    validated.roleMappings = roleMappings;
  }

  return validated;
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
      let created: ssoService.AdminSsoProvider;
      try {
        created = await ssoService.createProvider(input);
      } catch (error) {
        if (handleProviderValidationError(error, reply)) return reply;
        throw error;
      }
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
      let updated: ssoService.AdminSsoProvider | null;
      try {
        updated = await ssoService.updateProvider(id, input);
      } catch (error) {
        if (handleProviderValidationError(error, reply)) return reply;
        throw error;
      }
      if (!updated) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'SSO provider not found',
          action: 'sso_provider.update.not_found',
          entityType: 'sso_provider',
          entityId: id,
        });
      }
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
      if (!deleted) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'SSO provider not found',
          action: 'sso_provider.delete.not_found',
          entityType: 'sso_provider',
          entityId: id,
        });
      }
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
