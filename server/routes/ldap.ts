import { X509Certificate } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as ldapRepo from '../repositories/ldapRepo.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import { standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { DEFAULT_ROLE_ID } from '../services/external-auth.ts';
import { getAuditCounts, logAudit } from '../utils/audit.ts';
import { MASKED_SECRET } from '../utils/crypto.ts';
import { validateGroupFilterTemplate, validateUserFilterTemplate } from '../utils/ldap-filter.ts';
import { replyError } from '../utils/replyError.ts';
import { badRequest, parseBooleanField, requireNonEmptyString } from '../utils/validation.ts';

// 64 KB matches the UI's file-import size cap (AuthSettings.tsx); keeping these in
// sync prevents a save flow where a 32-64 KB chain passes the picker but fails the API.
const TLS_CA_MAX_LENGTH = 65536;
const PEM_BLOCK_REGEX = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

// bindPassword is masked on GET so the secret never leaves the server, and PUT
// treats the same sentinel as "no change" so a round-tripped form save preserves
// the stored value. The sentinel matches the repo-wide MASKED_SECRET convention
// already used by smtpPassword, clientSecret, privateKey, and API keys.
// (tlsCaCertificate is a public CA certificate, not a private key, so it is
// returned as-is.)
const maskBindPassword = (config: ldapRepo.LdapConfig): ldapRepo.LdapConfig => ({
  ...config,
  bindPassword: config.bindPassword ? MASKED_SECRET : '',
});

// Returns the patch fragment to merge into ldapRepo.update():
//   - omitted body field   -> {} (preserve existing column)
//   - null / empty / blank -> { tlsCaCertificate: '' } (clear the column)
//   - non-empty PEM        -> { tlsCaCertificate: <canonical PEM> }
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
    autoProvisionAll: { type: 'boolean' },
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
    'autoProvisionAll',
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
    autoProvisionAll: { type: 'boolean' },
  },
} as const;

const ldapTestBodySchema = {
  type: 'object',
  properties: {
    username: { type: 'string' },
    password: { type: 'string' },
  },
  required: ['username', 'password'],
} as const;

const ldapTestResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    authenticated: { type: 'boolean' },
    username: { type: 'string' },
    message: { type: 'string' },
    userDn: { type: 'string' },
    groups: { type: 'array', items: { type: 'string' } },
    roleIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['success', 'authenticated', 'username', 'message', 'groups', 'roleIds'],
} as const;

const ldapSyncResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
  },
  required: ['success'],
  additionalProperties: true,
} as const;

const ldapSyncErrorResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    error: { type: 'string' },
    errorCode: { type: 'string' },
    skipped: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['success', 'error'],
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
    async (_request, _reply) => maskBindPassword((await ldapRepo.get()) ?? ldapRepo.DEFAULT_CONFIG),
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
      const body = (request.body ?? {}) as {
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
        autoProvisionAll?: boolean;
      };
      const { serverUrl, baseDn, userFilter, groupBaseDn, groupFilter, roleMappings } = body;
      // bindPassword === MASKED_SECRET means "preserve the stored secret" (the UI round-trips
      // the masked value when the operator did not edit the password field). Bind DN remains
      // editable in that flow: a DN rename often keeps the same service-account password.
      // The paired validation below checks the effective post-save credential pair so a
      // masked password cannot invent a missing stored secret or leave only one side set.
      const isBindPasswordMasked = body.bindPassword === MASKED_SECRET;
      let storedConfigForMaskedPassword: ldapRepo.LdapConfig | undefined;
      let bindDn: string | undefined;
      let bindPassword: string | undefined;
      if (isBindPasswordMasked) {
        storedConfigForMaskedPassword = (await ldapRepo.get()) ?? ldapRepo.DEFAULT_CONFIG;
        bindDn =
          body.bindDn !== undefined && body.bindDn !== storedConfigForMaskedPassword.bindDn
            ? body.bindDn
            : undefined;
        bindPassword = undefined;
      } else {
        bindDn = body.bindDn;
        bindPassword = body.bindPassword;
      }
      const enabledResult = parseBooleanField(body, 'enabled');
      if (!enabledResult.ok) return badRequest(reply, enabledResult.message);
      const enabledValue = enabledResult.value;
      const tlsCaResult = parseTlsCaForPatch(body.tlsCaCertificate);
      if (!tlsCaResult.ok) {
        return badRequest(reply, tlsCaResult.message);
      }
      let normalizedUserFilter = userFilter;
      let normalizedGroupFilter = groupFilter;

      if (enabledValue === true) {
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

      const hasCredentialValue = (value: string | undefined | null): boolean =>
        value !== undefined && value !== null && value !== '';
      const hasBindDn = isBindPasswordMasked
        ? hasCredentialValue(bindDn ?? storedConfigForMaskedPassword?.bindDn)
        : hasCredentialValue(bindDn);
      const hasBindPassword = isBindPasswordMasked
        ? hasCredentialValue(storedConfigForMaskedPassword?.bindPassword)
        : hasCredentialValue(bindPassword);
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

      const autoProvisionAllResult = parseBooleanField(body, 'autoProvisionAll');
      if (!autoProvisionAllResult.ok) {
        return badRequest(reply, autoProvisionAllResult.message);
      }

      const updatePatch: ldapRepo.LdapConfigPatch = {
        enabled: enabledValue,
        serverUrl,
        baseDn,
        bindDn,
        bindPassword,
        userFilter: normalizedUserFilter,
        groupBaseDn,
        groupFilter: normalizedGroupFilter,
        roleMappings: validatedMappings,
        autoProvisionAll: autoProvisionAllResult.value,
        ...tlsCaResult.patch,
      };

      const updated = isBindPasswordMasked
        ? await ldapRepo.updatePreservingStoredBindPassword(updatePatch)
        : await ldapRepo.update(updatePatch);

      if (!updated) {
        return reply.code(409).send({
          error:
            'LDAP bind credentials changed while saving; reload the configuration and try again',
          errorCode: 'ldap_bind_credentials_changed',
        });
      }

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
        details: {
          secondaryLabel: updated.serverUrl,
        },
      });
      return maskBindPassword(updated);
    },
  );

  // POST /test - Test LDAP authentication for supplied credentials (admin only)
  fastify.post(
    '/test',
    {
      onRequest: [authenticateToken, requirePermission('administration.authentication.update')],
      schema: {
        tags: ['ldap'],
        summary: 'Test LDAP authentication',
        description:
          'Tests credentials against the latest saved LDAP configuration, even when LDAP login is disabled.',
        body: ldapTestBodySchema,
        response: {
          200: ldapTestResponseSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { username, password } = request.body as { username: unknown; password: unknown };

      const usernameResult = requireNonEmptyString(username, 'username');
      if (!usernameResult.ok) return badRequest(reply, usernameResult.message);

      const passwordResult = requireNonEmptyString(password, 'password');
      if (!passwordResult.ok) return badRequest(reply, passwordResult.message);

      const ldapService = (await import('../services/ldap.ts')).default;
      let result: Awaited<ReturnType<typeof ldapService.authenticateWithProfile>>;
      try {
        result = await ldapService.authenticateWithProfile(
          usernameResult.value,
          passwordResult.value,
          { allowDisabledConfig: true, reloadConfig: true },
        );
      } catch (err) {
        // Admin diagnostic — surface the outage in the response body instead of a 500
        // so the LDAP-config screen can render a clear "server unreachable" message.
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.warn({ err, username: usernameResult.value }, 'LDAP test failed');
        return {
          success: false,
          authenticated: false,
          username: usernameResult.value,
          message: `LDAP server unreachable: ${message}`,
          groups: [],
          roleIds: [],
        };
      }
      const authenticated = result.authenticated;

      return {
        success: authenticated,
        authenticated,
        username: usernameResult.value,
        message: authenticated
          ? 'LDAP authentication succeeded'
          : 'LDAP authentication failed. Verify the credentials and saved LDAP configuration.',
        userDn: result.userDn,
        groups: authenticated ? result.groups : [],
        roleIds: authenticated
          ? result.matchedRoleIds.length > 0
            ? result.matchedRoleIds
            : [DEFAULT_ROLE_ID]
          : [],
      };
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
          400: ldapSyncErrorResponseSchema,
          503: ldapSyncErrorResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const config = await ldapRepo.get();
      if (!config?.enabled) {
        return replyError(request, reply, {
          statusCode: 400,
          message: 'LDAP is not enabled',
          action: 'ldap.sync.invalid',
          entityType: 'ldap_config',
          errorCode: 'ldap_not_enabled',
          extraBody: { success: false },
        });
      }

      const ldapService = (await import('../services/ldap.ts')).default;
      let stats: Awaited<ReturnType<typeof ldapService.syncUsers>>;
      try {
        stats = await ldapService.syncUsers();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.warn({ err }, 'LDAP sync request failed');
        return reply.code(503).send({
          success: false,
          error: `LDAP sync failed: ${message}`,
          errorCode: 'ldap_sync_failed',
        });
      }

      if (stats.skipped) {
        return replyError(request, reply, {
          statusCode: 400,
          message: stats.reason ?? 'LDAP sync skipped',
          action: 'ldap.sync.invalid',
          entityType: 'ldap_config',
          errorCode: 'ldap_sync_skipped',
          extraBody: { ...stats, success: false },
        });
      }

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
