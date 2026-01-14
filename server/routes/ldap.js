import { query } from '../db/index.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

export default async function (fastify, opts) {
    // GET /config - Get LDAP configuration (admin only)
    fastify.get('/config', {
        onRequest: [authenticateToken, requireRole('admin')]
    }, async (request, reply) => {
        const result = await query(
            `SELECT enabled, server_url, base_dn, bind_dn, bind_password, 
              user_filter, group_base_dn, group_filter, role_mappings
       FROM ldap_config WHERE id = 1`
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
                roleMappings: []
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
            roleMappings: c.role_mappings || []
        };
    });

    // PUT /config - Update LDAP configuration (admin only)
    fastify.put('/config', {
        onRequest: [authenticateToken, requireRole('admin')]
    }, async (request, reply) => {
        const { enabled, serverUrl, baseDn, bindDn, bindPassword, userFilter, groupBaseDn, groupFilter, roleMappings } = request.body;

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
            [enabled, serverUrl, baseDn, bindDn, bindPassword, userFilter, groupBaseDn, groupFilter, JSON.stringify(roleMappings || [])]
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
            roleMappings: c.role_mappings || []
        };
    });

    // POST /sync - Trigger LDAP user sync (admin only)
    fastify.post('/sync', {
        onRequest: [authenticateToken, requireRole('admin')]
    }, async (request, reply) => {
        const ldapService = (await import('../services/ldap.js')).default;
        const stats = await ldapService.syncUsers();
        return { success: true, ...stats };
    });
}
