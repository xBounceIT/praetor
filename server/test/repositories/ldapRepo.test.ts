import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as ldapRepo from '../../repositories/ldapRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// drizzle-orm/node-postgres uses rowMode: 'array' for select queries; rows are positional
// in the projection-declaration order from `LDAP_PROJECTION` in ldapRepo.ts. Tests use
// `buildRow` (below) to construct fixtures by field name rather than by index, so a column
// reorder in the repo is caught either at TS compile time (unknown key) or at test time
// (wrong-shaped row). PROJECTION_KEYS MUST stay in sync with `LDAP_PROJECTION`.
const PROJECTION_KEYS = [
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
] as const;
type ProjectionKey = (typeof PROJECTION_KEYS)[number];
type RowFields = Record<ProjectionKey, unknown>;

const baseFields: RowFields = {
  enabled: false,
  serverUrl: 'ldap://example',
  baseDn: 'dc=example',
  bindDn: 'cn=admin',
  bindPassword: '',
  userFilter: '(uid={0})',
  groupBaseDn: 'ou=groups',
  groupFilter: '(member={0})',
  roleMappings: [] as ldapRepo.LdapRoleMapping[],
  tlsCaCertificate: null,
};

const buildRow = (overrides: Partial<RowFields> = {}): unknown[] => {
  const merged: RowFields = { ...baseFields, ...overrides };
  return PROJECTION_KEYS.map((k) => merged[k]);
};

describe('get', () => {
  test('returns null when no row exists', async () => {
    exec.enqueue({ rows: [] });
    const result = await ldapRepo.get(testDb);
    expect(result).toBeNull();
  });

  test('returns the row, including JSONB roleMappings as a JS array', async () => {
    const mappings: ldapRepo.LdapRoleMapping[] = [{ ldapGroup: 'admins', role: 'admin' }];
    exec.enqueue({ rows: [buildRow({ roleMappings: mappings })] });
    const result = await ldapRepo.get(testDb);
    expect(result?.roleMappings).toEqual(mappings);
  });

  test('targets the singleton row via WHERE id = 1', async () => {
    exec.enqueue({ rows: [] });
    await ldapRepo.get(testDb);
    expect(exec.calls[0].sql).toMatch(/"id"\s*=\s*\$\d+/);
    expect(exec.calls[0].params).toContain(1);
  });
});

describe('update', () => {
  test('throws the seed-missing guard when UPDATE returns 0 rows', async () => {
    exec.enqueue({ rows: [] });
    await expect(ldapRepo.update({}, testDb)).rejects.toThrow(/ldap_config row \(id=1\) not found/);
  });

  test('returns the RETURNING row mapped to the LdapConfig shape', async () => {
    const mappings: ldapRepo.LdapRoleMapping[] = [{ ldapGroup: 'g', role: 'r' }];
    exec.enqueue({
      rows: [buildRow({ enabled: true, serverUrl: 'ldaps://x', roleMappings: mappings })],
    });
    const result = await ldapRepo.update({ enabled: true, serverUrl: 'ldaps://x' }, testDb);
    expect(result.enabled).toBe(true);
    expect(result.serverUrl).toBe('ldaps://x');
    expect(result.roleMappings).toEqual(mappings);
  });

  test('JSON-stringifies a non-empty roleMappings array as the bound parameter', async () => {
    exec.enqueue({ rows: [buildRow()] });
    const mappings = [{ ldapGroup: 'g', role: 'r' }];
    await ldapRepo.update({ roleMappings: mappings }, testDb);
    expect(exec.calls[0].params).toContain(JSON.stringify(mappings));
  });

  test('binds JSON "[]" for an empty roleMappings array (set-to-empty case)', async () => {
    exec.enqueue({ rows: [buildRow()] });
    await ldapRepo.update({ roleMappings: [] }, testDb);
    expect(exec.calls[0].params).toContain('[]');
  });

  test('binds NULL for roleMappings when patch.roleMappings is undefined (COALESCE preserves)', async () => {
    exec.enqueue({ rows: [buildRow()] });
    await ldapRepo.update({ enabled: true }, testDb);
    // The SET clause always includes role_mappings via COALESCE($N::jsonb, role_mappings);
    // when patch is undefined, $N binds to null and COALESCE returns the existing column.
    expect(exec.calls[0].sql).toContain('::jsonb');
    expect(exec.calls[0].params.filter((p) => p === null).length).toBeGreaterThanOrEqual(8);
  });

  test('passes scalar patch values as bound parameters', async () => {
    exec.enqueue({ rows: [buildRow()] });
    await ldapRepo.update(
      {
        enabled: true,
        serverUrl: 'ldaps://x',
        baseDn: 'dc=y',
        bindDn: 'cn=z',
        bindPassword: 'pw',
        userFilter: '(cn={0})',
        groupBaseDn: 'ou=g',
        groupFilter: '(uniqueMember={0})',
      },
      testDb,
    );
    const params = exec.calls[0].params;
    expect(params).toContain(true);
    expect(params).toContain('ldaps://x');
    expect(params).toContain('dc=y');
    expect(params).toContain('cn=z');
    expect(params).toContain('pw');
    expect(params).toContain('(cn={0})');
    expect(params).toContain('ou=g');
    expect(params).toContain('(uniqueMember={0})');
  });

  test('targets the singleton row via WHERE id = 1', async () => {
    exec.enqueue({ rows: [buildRow()] });
    await ldapRepo.update({ enabled: true }, testDb);
    expect(exec.calls[0].sql).toMatch(/"id"\s*=\s*\$\d+/);
    expect(exec.calls[0].params).toContain(1);
  });
});

describe('DEFAULT_CONFIG', () => {
  test('matches the schema-default shape used as a fallback when seed is absent', () => {
    expect(ldapRepo.DEFAULT_CONFIG).toEqual({
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
    });
  });
});

describe('tlsCaCertificate clear semantics', () => {
  test('mapRow collapses NULL to empty string so the type stays non-nullable', async () => {
    exec.enqueue({ rows: [buildRow({ tlsCaCertificate: null })] });
    const result = await ldapRepo.get(testDb);
    expect(result?.tlsCaCertificate).toBe('');
  });

  test('mapRow returns the stored PEM unchanged when present', async () => {
    const pem = '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----\n';
    exec.enqueue({ rows: [buildRow({ tlsCaCertificate: pem })] });
    const result = await ldapRepo.get(testDb);
    expect(result?.tlsCaCertificate).toBe(pem);
  });

  test('update with non-empty PEM binds the value as a parameter', async () => {
    exec.enqueue({ rows: [buildRow()] });
    const pem = '-----BEGIN CERTIFICATE-----\nXYZ\n-----END CERTIFICATE-----\n';
    await ldapRepo.update({ tlsCaCertificate: pem }, testDb);
    expect(exec.calls[0].params).toContain(pem);
  });

  test('update with empty string emits literal NULL (clear), not a bound parameter', async () => {
    exec.enqueue({ rows: [buildRow()] });
    await ldapRepo.update({ tlsCaCertificate: '' }, testDb);
    // No bound param holds an empty string — the clear path uses sql`NULL` directly,
    // which Drizzle emits as the SQL token rather than a placeholder.
    expect(exec.calls[0].params).not.toContain('');
    expect(exec.calls[0].sql.toUpperCase()).toContain('NULL');
  });

  test('update with tlsCaCertificate undefined preserves the existing column reference', async () => {
    exec.enqueue({ rows: [buildRow()] });
    await ldapRepo.update({ enabled: true }, testDb);
    // Preserve branch references the column itself; no PEM-shaped bound parameter.
    const params = exec.calls[0].params;
    expect(params.some((p) => typeof p === 'string' && p.includes('BEGIN CERTIFICATE'))).toBe(
      false,
    );
    expect(exec.calls[0].sql).toContain('"tls_ca_certificate"');
  });
});
