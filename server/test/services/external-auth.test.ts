import { describe, expect, test } from 'bun:test';
import { mapExternalGroupsToRoleIds } from '../../services/external-auth.ts';

describe('mapExternalGroupsToRoleIds', () => {
  test('returns all matching roles in mapping order', () => {
    const result = mapExternalGroupsToRoleIds(
      ['cn=managers,ou=groups,dc=example,dc=com', 'finance'],
      [
        { externalGroup: 'finance', role: 'manager' },
        { externalGroup: 'managers', role: 'top_manager' },
        { externalGroup: 'missing', role: 'admin' },
      ],
    );

    expect(result).toEqual(['manager', 'top_manager']);
  });

  test('matches full DN, first RDN, and CN aliases without duplicating roles', () => {
    const result = mapExternalGroupsToRoleIds(
      ['cn=admins,ou=groups,dc=example,dc=com'],
      [
        { externalGroup: 'cn=admins,ou=groups,dc=example,dc=com', role: 'admin' },
        { externalGroup: 'cn=admins', role: 'admin' },
        { externalGroup: 'admins', role: 'admin' },
      ],
    );

    expect(result).toEqual(['admin']);
  });

  test('falls back to user when no mapping matches', () => {
    const result = mapExternalGroupsToRoleIds(
      ['cn=guests,ou=groups,dc=example,dc=com'],
      [{ externalGroup: 'admins', role: 'admin' }],
    );

    expect(result).toEqual(['user']);
  });
});
