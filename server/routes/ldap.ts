import { X509Certificate } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as ldapRepo from '../repositories/ldapRepo.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import { standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { getAuditCounts, logAudit } from '../utils/audit.ts';
import { validateUserFilterTemplate } from '../utils/ldap-filter.ts';
import { badRequest, parseBoolean, requireNonEmptyString } from '../utils/validation.ts';

// 64 KB matches the UI's file-import size cap (AuthSettings.tsx); keeping these in
// sync prevents a save flow where a 32–64 KB chain passes the picker but fails the API.
const TLS_CA_MAX_LENGTH = 65536;
const PEM_BLOCK_REGEX = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

// Returns the patch fragment to merge into ldapRepo.update():
//   - omitted body field   → {} (preserve existing column)
//   - null / empty / blank → { tlsCaCertificate: '' } (clear the column)
//   - non-empty PEM        → { tlsCaCertificate: <canonical PEM> }
// AuthSettings.tsx does a lighter marker-only check for fast UI feedback;
// this is the authoritative parse via X509Certificate.
const parseTlsCaForPatch = (
  raw: unknown,
): { ok: true; patch: { tlsCaCertificate?: string } } | { ok: false; message: string } => {
  if (raw === undefined) return { ok: true, patch: {} };
  if (raw === null) return { ok: true, patch: { tlsCaCertificate: '' } };
  if (typeof raw !== 'string') {
    return { ok: false, message: 'tlsCaCertificate must be a string' };
  }
  if (raw.trim() === '') return { ok: true, patch: { tlsCaCertificate: '' } };
  if (raw.length > TLS_CA_MAX_LENGTH) {
    return { ok: false, message: `tlsCaCertificate exceeds ${TLS_CA_MAX_LENGTH} characters` };
  }
  const normalized = `${raw.replace(/\r\n/g, '\n').trim()}\n`;
  const blocks = normalized.match(PEM_BLOCK_REGEX);
  if (!blocks || blocks.length === 0) {
    return {
      ok: false,
      message: 'tlsCaCertificate must be PEM-encoded with BEGIN/END CERTIFICATE markers',
    };
  }
  for (const block of blocks) {
    try {
      new X509Certificate(block);
    } catch {
      return { ok: false, message: 'tlsCaCertificate is not a valid PEM certificate' };
    }
  }
  return { ok: true, patch: { tlsCaCertificate: normalized } };
};

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
    tlsCaCertificate: { type: 'string' },
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
    'tlsCaCertificate',
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
    tlsCaCertificate: { type: ['string', 'null'], maxLength: TLS_CA_MAX_LENGTH },
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
      const body = request.body as {
        enabled?: boolean;
        serverUrl?: string;
        baseDn?: string;
        bindDn?: string;
        bindPassword?: string;
        userFilter?: string;
        groupBaseDn?: string;
        groupFilter?: string;
        roleMappings?: Array<{ ldapGroup?: string; role?: string }>;
        tlsCaCertificate?: string | null;
      };
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
      } = body;
      const enabledValue = parseBoolean(enabled);
      const tlsCaResult = parseTlsCaForPatch(body.tlsCaCertificate);
      if (!tlsCaResult.ok) {
        return badRequest(reply, tlsCaResult.message);
      }
      let normalizedUserFilter = userFilter;

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
        groupFilter,
        roleMappings: validatedMappings,
        ...tlsCaResult.patch,
      });

      // Drop the cached config in the singleton LDAPService so the next
      // authenticate()/syncUsers() call re-reads from the DB. Without this,
      // any config change (CA cert, server URL, bind creds) would only
      // take effect after a backend restart.
      const ldapService = (await import('../services/ldap.ts')).default;
      ldapService.invalidateConfig();

      await logAudit({
        request,
        action: 'ldap_config.updated',
        entityType: 'ldap_config',
        details: { secondaryLabel: updated.serverUrl },
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
