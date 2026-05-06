import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as ldapRepo from '../repositories/ldapRepo.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import { standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { getAuditCounts, logAudit } from '../utils/audit.ts';
import { validateGroupFilterTemplate, validateUserFilterTemplate } from '../utils/ldap-filter.ts';
import { badRequest, parseBoolean, requireNonEmptyString } from '../utils/validation.ts';

const roleMappingSchema = {
  type: 'object',
  properties: {
    ldapGroup: { type: 'string' },
    role: { type: 'string' },
  },
  required: ['ldapGroup', 'role'],
} as const;

const ldapConfigSchema = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    serverUrl: { type: 'string' },
    baseDn: { type: 'string' },
    bindDn: { type: 'string' },
    bindPassword: { type: 'string' },
    userFilter: { type: 'string' },
    groupBaseDn: { type: 'string' },
    groupFilter: { type: 'string' },
    roleMappings: { type: 'array', items: roleMappingSchema },
  },
  required: [
    'enabled',
    'serverUrl',
    'baseDn',
    'bindDn',
    'bindPassword',
    'userFilter',
    'groupBaseDn',
    'groupFilter',
    'roleMappings',
  ],
} as const;

const ldapConfigUpdateBodySchema = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    serverUrl: { type: 'string' },
    baseDn: { type: 'string' },
    bindDn: { type: 'string' },
    bindPassword: { type: 'string' },
    userFilter: { type: 'string' },
    groupBaseDn: { type: 'string' },
    groupFilter: { type: 'string' },
    roleMappings: { type: 'array', items: roleMappingSchema },
  },
} as const;

const ldapSyncResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
  },
  required: ['success'],
  additionalProperties: true,
} as const;

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // GET /config - Get LDAP configuration (admin only)
  fastify.get(
    '/config',
    {
      onRequest: [authenticateToken, requirePermission('administration.authentication.view')],
      schema: {
        tags: ['ldap'],
        summary: 'Get LDAP configuration',
        response: {
          200: ldapConfigSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (_request, _reply) => (await ldapRepo.get()) ?? ldapRepo.DEFAULT_CONFIG,
  );

  // PUT /config - Update LDAP configuration (admin only)
  fastify.put(
    '/config',
    {
      onRequest: [authenticateToken, requirePermission('administration.authentication.update')],
      schema: {
        tags: ['ldap'],
        summary: 'Update LDAP configuration',
        body: ldapConfigUpdateBodySchema,
        response: {
          200: ldapConfigSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        enabled,
        serverUrl,
        baseDn,
        bindDn,
        bindPassword,
        userFilter,
        groupBaseDn,
        groupFilter,
        roleMappings,
      } = request.body as {
        enabled?: boolean;
        serverUrl?: string;
        baseDn?: string;
        bindDn?: string;
        bindPassword?: string;
        userFilter?: string;
        groupBaseDn?: string;
        groupFilter?: string;
        roleMappings?: Array<{ ldapGroup?: string; role?: string }>;
      };
      const enabledValue = parseBoolean(enabled);
      let normalizedUserFilter = userFilter;
      let normalizedGroupFilter = groupFilter;

      if (enabledValue) {
        const serverUrlResult = requireNonEmptyString(serverUrl, 'serverUrl');
        if (!serverUrlResult.ok) return badRequest(reply, serverUrlResult.message);

        const baseDnResult = requireNonEmptyString(baseDn, 'baseDn');
        if (!baseDnResult.ok) return badRequest(reply, baseDnResult.message);

        const userFilterResult = requireNonEmptyString(userFilter, 'userFilter');
        if (!userFilterResult.ok) return badRequest(reply, userFilterResult.message);
        const userFilterTemplateResult = validateUserFilterTemplate(userFilterResult.value);
        if (!userFilterTemplateResult.ok) {
          return badRequest(reply, userFilterTemplateResult.message);
        }
        normalizedUserFilter = userFilterTemplateResult.value;

        const groupBaseDnResult = requireNonEmptyString(groupBaseDn, 'groupBaseDn');
        if (!groupBaseDnResult.ok) return badRequest(reply, groupBaseDnResult.message);

        const groupFilterResult = requireNonEmptyString(groupFilter, 'groupFilter');
        if (!groupFilterResult.ok) return badRequest(reply, groupFilterResult.message);
        const groupFilterTemplateResult = validateGroupFilterTemplate(groupFilterResult.value);
        if (!groupFilterTemplateResult.ok) {
          return badRequest(reply, groupFilterTemplateResult.message);
        }
        normalizedGroupFilter = groupFilterTemplateResult.value;
      }

      const hasBindDn = bindDn !== undefined && bindDn !== null && bindDn !== '';
      const hasBindPassword =
        bindPassword !== undefined && bindPassword !== null && bindPassword !== '';
      if (hasBindDn !== hasBindPassword) {
        return badRequest(reply, 'bindDn and bindPassword must be provided together or not at all');
      }

      let validatedMappings: ldapRepo.LdapRoleMapping[] | undefined;
      if (roleMappings !== undefined && roleMappings !== null) {
        if (!Array.isArray(roleMappings)) {
          return badRequest(reply, 'roleMappings must be an array');
        }
        validatedMappings = [];
        for (let i = 0; i < roleMappings.length; i++) {
          const mapping = roleMappings[i];
          if (typeof mapping !== 'object' || mapping === null) {
            return badRequest(reply, `roleMappings[${i}] must be an object`);
          }
          const ldapGroupResult = requireNonEmptyString(
            mapping.ldapGroup,
            `roleMappings[${i}].ldapGroup`,
          );
          if (!ldapGroupResult.ok) return badRequest(reply, ldapGroupResult.message);
          const roleResult = requireNonEmptyString(mapping.role, `roleMappings[${i}].role`);
          if (!roleResult.ok) return badRequest(reply, roleResult.message);
          validatedMappings.push({
            ldapGroup: ldapGroupResult.value,
            role: roleResult.value,
          });
        }

        const uniqueRoleIds = new Set(validatedMappings.map((m) => m.role));
        if (uniqueRoleIds.size > 0) {
          const existing = await rolesRepo.findExistingIds([...uniqueRoleIds]);
          for (const roleId of uniqueRoleIds) {
            if (!existing.has(roleId)) {
              return badRequest(reply, `roleMappings role '${roleId}' does not exist`);
            }
          }
        }
      }

      const updated = await ldapRepo.update({
        enabled: enabledValue,
        serverUrl,
        baseDn,
        bindDn,
        bindPassword,
        userFilter: normalizedUserFilter,
        groupBaseDn,
        groupFilter: normalizedGroupFilter,
        roleMappings: validatedMappings,
      });

      await logAudit({
        request,
        action: 'ldap_config.updated',
        entityType: 'ldap_config',
        details: {
          secondaryLabel: updated.serverUrl,
        },
      });
      return updated;
    },
  );

  // POST /sync - Trigger LDAP user sync (admin only)
  fastify.post(
    '/sync',
    {
      onRequest: [authenticateToken, requirePermission('administration.authentication.update')],
      schema: {
        tags: ['ldap'],
        summary: 'Trigger LDAP sync',
        response: {
          200: ldapSyncResponseSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const ldapService = (await import('../services/ldap.ts')).default;
      const stats = await ldapService.syncUsers();
      await logAudit({
        request,
        action: 'ldap.synced',
        entityType: 'ldap_config',
        details: {
          secondaryLabel:
            typeof stats.reason === 'string' && stats.reason.length > 0 ? stats.reason : undefined,
          counts: getAuditCounts({
            synced: stats.synced,
            created: stats.created,
          }),
        },
      });
      return { success: true, ...stats };
    },
  );
}
