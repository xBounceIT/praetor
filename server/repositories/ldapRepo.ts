import { eq, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { ldapConfig } from '../db/schema/ldapConfig.ts';
import { decrypt, encrypt, isEncrypted } from '../utils/crypto.ts';
import { createChildLogger, serializeError } from '../utils/logger.ts';

const logger = createChildLogger({ module: 'ldapRepo' });

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
  tlsCaCertificate: string;
  autoProvisionAll: boolean;
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
  tlsCaCertificate: '',
  autoProvisionAll: false,
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
  tlsCaCertificate: ldapConfig.tlsCaCertificate,
  autoProvisionAll: ldapConfig.autoProvisionAll,
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
  tlsCaCertificate: string | null;
  autoProvisionAll: boolean | null;
};

// Schema columns are nullable but always populated at runtime via DB defaults on the seeded
// id=1 row, so the `??` fallbacks are a TS-strict appeasement matching the non-nullable
// `LdapConfig`. Falling back to the corresponding `DEFAULT_CONFIG` value (rather than `''`)
// keeps the read-with-null-column path consistent with the route's no-row fallback
// (`(await ldapRepo.get()) ?? ldapRepo.DEFAULT_CONFIG`). `roleMappings` falls back to a
// fresh `[]` rather than `DEFAULT_CONFIG.roleMappings` so the module-level default array
// can't be aliased and mutated by callers.
// Legacy plaintext rows predating this encryption layer (and rows where someone
// inserted plaintext directly) are returned as-is so reads keep working; the lazy
// migration in `get()` rewrites them. Values that pass the shape check but fail GCM
// authentication propagate the throw from `decrypt()` — that signals real corruption
// (key rotation, tampered row) and must not be silently re-encrypted as if plaintext.
const decodeBindPassword = (raw: string | null): string => {
  if (!raw) return DEFAULT_CONFIG.bindPassword;
  if (!isEncrypted(raw)) return raw;
  return decrypt(raw);
};

const mapRow = (row: LdapRow): LdapConfig => ({
  enabled: row.enabled ?? DEFAULT_CONFIG.enabled,
  serverUrl: row.serverUrl ?? DEFAULT_CONFIG.serverUrl,
  baseDn: row.baseDn ?? DEFAULT_CONFIG.baseDn,
  bindDn: row.bindDn ?? DEFAULT_CONFIG.bindDn,
  bindPassword: decodeBindPassword(row.bindPassword),
  userFilter: row.userFilter ?? DEFAULT_CONFIG.userFilter,
  groupBaseDn: row.groupBaseDn ?? DEFAULT_CONFIG.groupBaseDn,
  groupFilter: row.groupFilter ?? DEFAULT_CONFIG.groupFilter,
  roleMappings: row.roleMappings ?? [],
  tlsCaCertificate: row.tlsCaCertificate ?? '',
  autoProvisionAll: row.autoProvisionAll ?? DEFAULT_CONFIG.autoProvisionAll,
});

// Self-heals legacy plaintext rows by re-encrypting them in place. Idempotent: subsequent
// reads find ciphertext and skip the write. Failures are swallowed so a transient DB error
// can't break LDAP auth on what is otherwise a successful read.
const migrateLegacyBindPasswordIfNeeded = async (
  rawValue: string | null,
  exec: DbExecutor,
): Promise<void> => {
  if (!rawValue || isEncrypted(rawValue)) return;
  try {
    await exec
      .update(ldapConfig)
      .set({ bindPassword: encrypt(rawValue) })
      .where(eq(ldapConfig.id, 1));
  } catch (err) {
    logger.warn(
      { err: serializeError(err) },
      'failed to migrate legacy plaintext bindPassword to encrypted form',
    );
  }
};

export const get = async (exec: DbExecutor = db): Promise<LdapConfig | null> => {
  const rows = await exec.select(LDAP_PROJECTION).from(ldapConfig).where(eq(ldapConfig.id, 1));
  if (!rows[0]) return null;
  await migrateLegacyBindPasswordIfNeeded(rows[0].bindPassword, exec);
  return mapRow(rows[0]);
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
  // `tlsCaCertificate` is the only nullable text column that callers can explicitly clear:
  // omit key → preserve, '' → NULL (clear), non-empty string → set. COALESCE can't express
  // "clear" because null and undefined both collapse to the existing-value branch.
  const tlsCaParam =
    patch.tlsCaCertificate === undefined
      ? sql`${ldapConfig.tlsCaCertificate}`
      : patch.tlsCaCertificate === ''
        ? sql`NULL`
        : sql`${patch.tlsCaCertificate}`;
  // bindPassword is encrypted at rest. `encrypt('')` returns '' so the explicit-clear
  // semantic is preserved; `undefined` keeps the COALESCE preserve-existing branch.
  // Callers must pass plaintext — the route layer converts the masked sentinel to undefined.
  const bindPasswordParam = patch.bindPassword === undefined ? null : encrypt(patch.bindPassword);
  const result = await exec
    .update(ldapConfig)
    .set({
      enabled: sql`COALESCE(${patch.enabled ?? null}, ${ldapConfig.enabled})`,
      serverUrl: sql`COALESCE(${patch.serverUrl ?? null}, ${ldapConfig.serverUrl})`,
      baseDn: sql`COALESCE(${patch.baseDn ?? null}, ${ldapConfig.baseDn})`,
      bindDn: sql`COALESCE(${patch.bindDn ?? null}, ${ldapConfig.bindDn})`,
      bindPassword: sql`COALESCE(${bindPasswordParam}, ${ldapConfig.bindPassword})`,
      userFilter: sql`COALESCE(${patch.userFilter ?? null}, ${ldapConfig.userFilter})`,
      groupBaseDn: sql`COALESCE(${patch.groupBaseDn ?? null}, ${ldapConfig.groupBaseDn})`,
      groupFilter: sql`COALESCE(${patch.groupFilter ?? null}, ${ldapConfig.groupFilter})`,
      roleMappings: sql`COALESCE(${roleMappingsParam}::jsonb, ${ldapConfig.roleMappings})`,
      tlsCaCertificate: tlsCaParam,
      autoProvisionAll: sql`COALESCE(${patch.autoProvisionAll ?? null}, ${ldapConfig.autoProvisionAll})`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(ldapConfig.id, 1))
    .returning(LDAP_PROJECTION);
  if (result.length === 0) {
    throw new Error('ldap_config row (id=1) not found; seed missing');
  }
  return mapRow(result[0]);
};
