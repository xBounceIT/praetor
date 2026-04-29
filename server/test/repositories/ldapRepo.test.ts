import { beforeEach, describe, expect, test } from 'bun:test';
import type { LdapRoleMapping } from '../../repositories/ldapRepo.ts';
import * as ldapRepo from '../../repositories/ldapRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

const baseRow = {
  enabled: false,
  serverUrl: 'ldap://example',
  baseDn: 'dc=example',
  bindDn: 'cn=admin',
  bindPassword: '',
  userFilter: '(uid={0})',
  groupBaseDn: 'ou=groups',
  groupFilter: '(member={0})',
  roleMappings: [] as LdapRoleMapping[],
};

describe('get', () => {
  test('returns null when no row exists', async () => {
    exec.enqueue({ rows: [] });
    const result = await ldapRepo.get(exec);
    expect(result).toBeNull();
  });

  test('returns the row verbatim, including JSONB roleMappings as a JS array', async () => {
    const mappings: LdapRoleMapping[] = [{ ldapGroup: 'admins', role: 'admin' }];
    exec.enqueue({ rows: [{ ...baseRow, roleMappings: mappings }] });
    const result = await ldapRepo.get(exec);
    expect(result?.roleMappings).toEqual(mappings);
  });
});

describe('update', () => {
  test('throws the seed-missing guard when UPDATE returns 0 rows', async () => {
    exec.enqueue({ rows: [] });
    await expect(ldapRepo.update({}, exec)).rejects.toThrow(/ldap_config row \(id=1\) not found/);
  });

  test('JSON.stringifies a non-empty roleMappings array as $9', async () => {
    exec.enqueue({ rows: [baseRow] });
    const mappings = [{ ldapGroup: 'g', role: 'r' }];
    await ldapRepo.update({ roleMappings: mappings }, exec);
    expect(exec.calls[0].params[8]).toBe(JSON.stringify(mappings));
  });

  test('serializes an empty roleMappings array via JSON.stringify (set-to-empty case)', async () => {
    exec.enqueue({ rows: [baseRow] });
    await ldapRepo.update({ roleMappings: [] }, exec);
    expect(exec.calls[0].params[8]).toBe(JSON.stringify([]));
  });

  test('passes null for roleMappings when omitted (leave-unchanged case)', async () => {
    exec.enqueue({ rows: [baseRow] });
    await ldapRepo.update({ enabled: true }, exec);
    expect(exec.calls[0].params[8]).toBeNull();
  });

  test('passes the other patch fields in $1..$8 order', async () => {
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
      exec,
    );
    expect(exec.calls[0].params.slice(0, 8)).toEqual([
      true,
      'ldaps://x',
      'dc=y',
      'cn=z',
      'pw',
      '(cn={0})',
      'ou=g',
      '(uniqueMember={0})',
    ]);
  });
});
