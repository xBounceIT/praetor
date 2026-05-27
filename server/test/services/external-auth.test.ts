import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import {
  externalGroupsYieldNoKnownRole,
  mapExternalGroupsToMatchedRoleIds,
  mapExternalGroupsToRoleIds,
} from '../../services/external-auth.ts';

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

describe('mapExternalGroupsToMatchedRoleIds', () => {
  test('returns empty array when no mapping matches (no default fallback) — regression #318', () => {
    const result = mapExternalGroupsToMatchedRoleIds(
      ['cn=guests,ou=groups,dc=example,dc=com'],
      [{ externalGroup: 'admins', role: 'admin' }],
    );

    expect(result).toEqual([]);
  });

  test('returns matched roles when groups match', () => {
    const result = mapExternalGroupsToMatchedRoleIds(
      ['cn=admins,ou=groups,dc=example,dc=com'],
      [
        { externalGroup: 'admins', role: 'admin' },
        { externalGroup: 'managers', role: 'top_manager' },
      ],
    );

    expect(result).toEqual(['admin']);
  });

  test('returns empty array when no mappings are configured', () => {
    const result = mapExternalGroupsToMatchedRoleIds(['cn=anything,dc=x'], []);
    expect(result).toEqual([]);
  });

  test('returns empty array when no groups are present', () => {
    const result = mapExternalGroupsToMatchedRoleIds(
      [],
      [{ externalGroup: 'admins', role: 'admin' }],
    );
    expect(result).toEqual([]);
  });
});

describe('externalGroupsYieldNoKnownRole', () => {
  const rolesRepoSnap = { ...realRolesRepo };
  const findExistingIdsMock = mock();

  beforeAll(() => {
    mock.module('../../repositories/rolesRepo.ts', () => ({
      ...rolesRepoSnap,
      findExistingIds: findExistingIdsMock,
    }));
  });

  afterAll(() => {
    mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  });

  beforeEach(() => {
    findExistingIdsMock.mockReset();
    // Default: every queried role exists. Tests exercising the deleted-role branch
    // override per-test.
    findExistingIdsMock.mockImplementation(async (ids: string[]) => new Set(ids));
  });

  test('returns false when no role mappings are configured (admin opted out of mapping)', async () => {
    const result = await externalGroupsYieldNoKnownRole(['cn=admins,dc=x'], []);
    expect(result).toBe(false);
    // No DB query should fire in the short-circuit path.
    expect(findExistingIdsMock).not.toHaveBeenCalled();
  });

  test('returns true when mappings exist but no group matches any of them', async () => {
    const result = await externalGroupsYieldNoKnownRole(
      ['cn=guests,dc=x'],
      [{ externalGroup: 'admins', role: 'admin' }],
    );
    expect(result).toBe(true);
    // No DB query needed — short-circuited before filterToExistingRoleIds.
    expect(findExistingIdsMock).not.toHaveBeenCalled();
  });

  test('returns true when groups match a mapping but the target role has been deleted', async () => {
    findExistingIdsMock.mockResolvedValue(new Set());
    const result = await externalGroupsYieldNoKnownRole(
      ['cn=admins,dc=x'],
      [{ externalGroup: 'admins', role: 'ghost-admin' }],
    );
    expect(result).toBe(true);
    expect(findExistingIdsMock).toHaveBeenCalledWith(['ghost-admin']);
  });

  test('returns false when groups match a mapping that resolves to an existing role', async () => {
    findExistingIdsMock.mockResolvedValue(new Set(['admin']));
    const result = await externalGroupsYieldNoKnownRole(
      ['cn=admins,dc=x'],
      [{ externalGroup: 'admins', role: 'admin' }],
    );
    expect(result).toBe(false);
  });
});
