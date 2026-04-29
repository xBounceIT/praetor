import pool, { type QueryExecutor } from '../db/index.ts';

export type LdapRoleMapping = { ldapGroup: string; role: string };

export type LdapConfig = {
  enabled: boolean;
  serverUrl: string;
  baseDn: string;
  bindDn: string;
  bindPassword: string;
  userFilter: string;
  groupBaseDn: string;
  groupFilter: string;
  roleMappings: LdapRoleMapping[];
};

export type LdapConfigPatch = Partial<LdapConfig>;

export const DEFAULT_CONFIG: LdapConfig = {
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

const SELECT_COLUMNS = `enabled,
        server_url as "serverUrl",
        base_dn as "baseDn",
        bind_dn as "bindDn",
        bind_password as "bindPassword",
        user_filter as "userFilter",
        group_base_dn as "groupBaseDn",
        group_filter as "groupFilter",
        COALESCE(role_mappings, '[]'::jsonb) as "roleMappings"`;

export const get = async (exec: QueryExecutor = pool): Promise<LdapConfig | null> => {
  const { rows } = await exec.query<LdapConfig>(
    `SELECT ${SELECT_COLUMNS} FROM ldap_config WHERE id = 1`,
  );
  if (rows.length === 0) return null;
  return rows[0];
};

export const update = async (
  patch: LdapConfigPatch,
  exec: QueryExecutor = pool,
): Promise<LdapConfig> => {
  const { rows } = await exec.query<LdapConfig>(
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
      RETURNING ${SELECT_COLUMNS}`,
    [
      patch.enabled,
      patch.serverUrl,
      patch.baseDn,
      patch.bindDn,
      patch.bindPassword,
      patch.userFilter,
      patch.groupBaseDn,
      patch.groupFilter,
      patch.roleMappings === undefined ? null : JSON.stringify(patch.roleMappings),
    ],
  );
  return rows[0];
};
