import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import type { LdapRoleMapping } from '../../repositories/ldapRepo.ts';
import * as ldapRepo from '../../repositories/ldapRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// drizzle-orm/node-postgres uses rowMode: 'array' for select queries; rows are positional
// in the projection-declaration order from `LDAP_PROJECTION` in ldapRepo.ts:
// [enabled, serverUrl, baseDn, bindDn, bindPassword, userFilter, groupBaseDn, groupFilter, roleMappings]

const baseRow = [
  false,
  'ldap://example',
  'dc=example',
  'cn=admin',
  '',
  '(uid={0})',
  'ou=groups',
  '(member={0})',
  [] as LdapRoleMapping[],
];

describe('get', () => {
  test('returns null when no row exists', async () => {
    exec.enqueue({ rows: [] });
    const result = await ldapRepo.get(testDb);
    expect(result).toBeNull();
  });

  test('returns the row, including JSONB roleMappings as a JS array', async () => {
    const mappings: LdapRoleMapping[] = [{ ldapGroup: 'admins', role: 'admin' }];
    const row = baseRow.slice();
    row[8] = mappings;
    exec.enqueue({ rows: [row] });
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
    const mappings: LdapRoleMapping[] = [{ ldapGroup: 'g', role: 'r' }];
    const returned = baseRow.slice();
    returned[0] = true;
    returned[1] = 'ldaps://x';
    returned[8] = mappings;
    exec.enqueue({ rows: [returned] });
    const result = await ldapRepo.update({ enabled: true, serverUrl: 'ldaps://x' }, testDb);
    expect(result.enabled).toBe(true);
    expect(result.serverUrl).toBe('ldaps://x');
    expect(result.roleMappings).toEqual(mappings);
  });

  test('JSON-stringifies a non-empty roleMappings array as the bound parameter', async () => {
    exec.enqueue({ rows: [baseRow] });
    const mappings = [{ ldapGroup: 'g', role: 'r' }];
    await ldapRepo.update({ roleMappings: mappings }, testDb);
    expect(exec.calls[0].params).toContain(JSON.stringify(mappings));
  });

  test('binds JSON "[]" for an empty roleMappings array (set-to-empty case)', async () => {
    exec.enqueue({ rows: [baseRow] });
    await ldapRepo.update({ roleMappings: [] }, testDb);
    expect(exec.calls[0].params).toContain('[]');
  });

  test('binds NULL for roleMappings when patch.roleMappings is undefined (COALESCE preserves)', async () => {
    exec.enqueue({ rows: [baseRow] });
    await ldapRepo.update({ enabled: true }, testDb);
    // The SET clause always includes role_mappings via COALESCE($N::jsonb, role_mappings);
    // when patch is undefined, $N binds to null and COALESCE returns the existing column.
    expect(exec.calls[0].sql).toContain('::jsonb');
    expect(exec.calls[0].params.filter((p) => p === null).length).toBeGreaterThanOrEqual(8);
  });

  test('passes scalar patch values as bound parameters', async () => {
    exec.enqueue({ rows: [baseRow] });
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
    exec.enqueue({ rows: [baseRow] });
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
    });
  });
});
