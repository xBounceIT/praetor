import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requireRole } from '../middleware/auth.ts';
import {
  parseBoolean,
  requireNonEmptyString,
  validateEnum,
  badRequest,
} from '../utils/validation.ts';

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // GET /config - Get LDAP configuration (admin only)
  fastify.get(
    '/config',
    {
      onRequest: [authenticateToken, requireRole('admin')],
    },
    async (_request, _reply) => {
      const result = await query(
        `SELECT enabled, server_url, base_dn, bind_dn, bind_password, 
              user_filter, group_base_dn, group_filter, role_mappings
       FROM ldap_config WHERE id = 1`,
      );

      if (result.rows.length === 0) {
        return {
          enabled: false,
          serverUrl: 'ldap://ldap.example.com:389',
          baseDn: 'dc=example,dc=com',
          bindDn: 'cn=read-only-admin,dc=example,dc=com',
          bindPassword: '',
          userFilter: '(uid={0})',
          groupBaseDn: 'ou=groups,dc=example,dc=com',
          groupFilter: '(member={0})',
          roleMappings: [],
        };
      }

      const c = result.rows[0];
      return {
        enabled: c.enabled,
        serverUrl: c.server_url,
        baseDn: c.base_dn,
        bindDn: c.bind_dn,
        bindPassword: c.bind_password,
        userFilter: c.user_filter,
        groupBaseDn: c.group_base_dn,
        groupFilter: c.group_filter,
        roleMappings: c.role_mappings || [],
      };
    },
  );

  // PUT /config - Update LDAP configuration (admin only)
  fastify.put(
    '/config',
    {
      onRequest: [authenticateToken, requireRole('admin')],
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

      if (enabledValue) {
        const serverUrlResult = requireNonEmptyString(serverUrl, 'serverUrl');
        if (!serverUrlResult.ok) return badRequest(reply, serverUrlResult.message);

        const baseDnResult = requireNonEmptyString(baseDn, 'baseDn');
        if (!baseDnResult.ok) return badRequest(reply, baseDnResult.message);

        const userFilterResult = requireNonEmptyString(userFilter, 'userFilter');
        if (!userFilterResult.ok) return badRequest(reply, userFilterResult.message);

        const groupBaseDnResult = requireNonEmptyString(groupBaseDn, 'groupBaseDn');
        if (!groupBaseDnResult.ok) return badRequest(reply, groupBaseDnResult.message);

        const groupFilterResult = requireNonEmptyString(groupFilter, 'groupFilter');
        if (!groupFilterResult.ok) return badRequest(reply, groupFilterResult.message);
      }

      // bindDn and bindPassword must be provided together or not at all
      const hasBindDn = bindDn !== undefined && bindDn !== null && bindDn !== '';
      const hasBindPassword =
        bindPassword !== undefined && bindPassword !== null && bindPassword !== '';
      if (hasBindDn !== hasBindPassword) {
        return badRequest(reply, 'bindDn and bindPassword must be provided together or not at all');
      }

      // Validate roleMappings if provided
      if (roleMappings !== undefined && roleMappings !== null) {
        if (!Array.isArray(roleMappings)) {
          return badRequest(reply, 'roleMappings must be an array');
        }
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
          const roleResult = validateEnum(
            mapping.role,
            ['admin', 'manager', 'user'],
            `roleMappings[${i}].role`,
          );
          if (!roleResult.ok) return badRequest(reply, roleResult.message);
        }
      }

      const result = await query(
        `UPDATE ldap_config SET
         enabled = COALESCE($1, enabled),
         server_url = COALESCE($2, server_url),
         base_dn = COALESCE($3, base_dn),
         bind_dn = COALESCE($4, bind_dn),
         bind_password = COALESCE($5, bind_password),
         user_filter = COALESCE($6, user_filter),
         group_base_dn = COALESCE($7, group_base_dn),
         group_filter = COALESCE($8, group_filter),
         role_mappings = COALESCE($9, role_mappings),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = 1
       RETURNING *`,
        [
          enabledValue,
          serverUrl,
          baseDn,
          bindDn,
          bindPassword,
          userFilter,
          groupBaseDn,
          groupFilter,
          JSON.stringify(roleMappings || []),
        ],
      );

      const c = result.rows[0];
      return {
        enabled: c.enabled,
        serverUrl: c.server_url,
        baseDn: c.base_dn,
        bindDn: c.bind_dn,
        bindPassword: c.bind_password,
        userFilter: c.user_filter,
        groupBaseDn: c.group_base_dn,
        groupFilter: c.group_filter,
        roleMappings: c.role_mappings || [],
      };
    },
  );

  // POST /sync - Trigger LDAP user sync (admin only)
  fastify.post(
    '/sync',
    {
      onRequest: [authenticateToken, requireRole('admin')],
    },
    async (_request, _reply) => {
      const ldapService = (await import('../services/ldap.ts')).default;
      const stats = await ldapService.syncUsers();
      return { success: true, ...stats };
    },
  );
}
