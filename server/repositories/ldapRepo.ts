import { eq, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { ldapConfig } from '../db/schema/ldapConfig.ts';

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

const LDAP_PROJECTION = {
  enabled: ldapConfig.enabled,
  serverUrl: ldapConfig.serverUrl,
  baseDn: ldapConfig.baseDn,
  bindDn: ldapConfig.bindDn,
  bindPassword: ldapConfig.bindPassword,
  userFilter: ldapConfig.userFilter,
  groupBaseDn: ldapConfig.groupBaseDn,
  groupFilter: ldapConfig.groupFilter,
  roleMappings: ldapConfig.roleMappings,
} as const;

type LdapRow = {
  enabled: boolean | null;
  serverUrl: string | null;
  baseDn: string | null;
  bindDn: string | null;
  bindPassword: string | null;
  userFilter: string | null;
  groupBaseDn: string | null;
  groupFilter: string | null;
  roleMappings: LdapRoleMapping[] | null;
};

// Schema columns are nullable but always populated at runtime via DB defaults on the seeded
// id=1 row, so `?? <default>` is a TS-strict appeasement matching the non-nullable `LdapConfig`.
const mapRow = (row: LdapRow): LdapConfig => ({
  enabled: row.enabled ?? false,
  serverUrl: row.serverUrl ?? '',
  baseDn: row.baseDn ?? '',
  bindDn: row.bindDn ?? '',
  bindPassword: row.bindPassword ?? '',
  userFilter: row.userFilter ?? '',
  groupBaseDn: row.groupBaseDn ?? '',
  groupFilter: row.groupFilter ?? '',
  roleMappings: row.roleMappings ?? [],
});

export const get = async (exec: DbExecutor = db): Promise<LdapConfig | null> => {
  const rows = await exec.select(LDAP_PROJECTION).from(ldapConfig).where(eq(ldapConfig.id, 1));
  return rows[0] ? mapRow(rows[0]) : null;
};

export const update = async (
  patch: LdapConfigPatch,
  exec: DbExecutor = db,
): Promise<LdapConfig> => {
  // COALESCE preserves the existing column when the patch value is undefined (legacy
  // "undefined leaves column unchanged" semantic). Same pattern as settingsRepo.upsertForUser.
  // `role_mappings` needs the explicit `::jsonb` cast on the bound text param so COALESCE's
  // both branches share the JSONB type.
  const roleMappingsParam =
    patch.roleMappings === undefined ? null : JSON.stringify(patch.roleMappings);
  const result = await exec
    .update(ldapConfig)
    .set({
      enabled: sql`COALESCE(${patch.enabled ?? null}, ${ldapConfig.enabled})`,
      serverUrl: sql`COALESCE(${patch.serverUrl ?? null}, ${ldapConfig.serverUrl})`,
      baseDn: sql`COALESCE(${patch.baseDn ?? null}, ${ldapConfig.baseDn})`,
      bindDn: sql`COALESCE(${patch.bindDn ?? null}, ${ldapConfig.bindDn})`,
      bindPassword: sql`COALESCE(${patch.bindPassword ?? null}, ${ldapConfig.bindPassword})`,
      userFilter: sql`COALESCE(${patch.userFilter ?? null}, ${ldapConfig.userFilter})`,
      groupBaseDn: sql`COALESCE(${patch.groupBaseDn ?? null}, ${ldapConfig.groupBaseDn})`,
      groupFilter: sql`COALESCE(${patch.groupFilter ?? null}, ${ldapConfig.groupFilter})`,
      roleMappings: sql`COALESCE(${roleMappingsParam}::jsonb, ${ldapConfig.roleMappings})`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(ldapConfig.id, 1))
    .returning(LDAP_PROJECTION);
  if (result.length === 0) {
    throw new Error('ldap_config row (id=1) not found; seed missing');
  }
  return mapRow(result[0]);
};
