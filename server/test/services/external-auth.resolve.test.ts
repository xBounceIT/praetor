import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realExternalIdentitiesRepo from '../../repositories/externalIdentitiesRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realSettingsRepo from '../../repositories/settingsRepo.ts';
import * as realUserAssignmentsRepo from '../../repositories/userAssignmentsRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';

const drizzleSnap = { ...realDrizzle };
const externalIdentitiesRepoSnap = { ...realExternalIdentitiesRepo };
const rolesRepoSnap = { ...realRolesRepo };
const settingsRepoSnap = { ...realSettingsRepo };
const userAssignmentsRepoSnap = { ...realUserAssignmentsRepo };
const usersRepoSnap = { ...realUsersRepo };

const withDbTransactionMock = mock(async (cb: (tx: unknown) => unknown) => cb(undefined));
const findByIdentityMock = mock();
const insertIdentityMock = mock();
const findExistingIdsMock = mock();
const upsertForUserMock = mock();
const syncTopManagerAssignmentsForUserMock = mock();
const findLoginUserByIdMock = mock();
const findLoginUserByNormalizedUsernameMock = mock();
const insertUserMock = mock();
const replaceUserRolesMock = mock();
const setPrimaryRoleMock = mock();

let resolveExternalIdentity: typeof import('../../services/external-auth.ts').resolveExternalIdentity;

beforeAll(async () => {
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));
  mock.module('../../repositories/externalIdentitiesRepo.ts', () => ({
    ...externalIdentitiesRepoSnap,
    findByIdentity: findByIdentityMock,
    insert: insertIdentityMock,
  }));
  mock.module('../../repositories/rolesRepo.ts', () => ({
    ...rolesRepoSnap,
    findExistingIds: findExistingIdsMock,
  }));
  mock.module('../../repositories/settingsRepo.ts', () => ({
    ...settingsRepoSnap,
    upsertForUser: upsertForUserMock,
  }));
  mock.module('../../repositories/userAssignmentsRepo.ts', () => ({
    ...userAssignmentsRepoSnap,
    syncTopManagerAssignmentsForUser: syncTopManagerAssignmentsForUserMock,
  }));
  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findLoginUserById: findLoginUserByIdMock,
    findLoginUserByNormalizedUsername: findLoginUserByNormalizedUsernameMock,
    insertUser: insertUserMock,
    replaceUserRoles: replaceUserRolesMock,
    setPrimaryRole: setPrimaryRoleMock,
  }));

  ({ resolveExternalIdentity } = await import('../../services/external-auth.ts'));
});

beforeEach(() => {
  for (const m of [
    withDbTransactionMock,
    findByIdentityMock,
    insertIdentityMock,
    findExistingIdsMock,
    upsertForUserMock,
    syncTopManagerAssignmentsForUserMock,
    findLoginUserByIdMock,
    findLoginUserByNormalizedUsernameMock,
    insertUserMock,
    replaceUserRolesMock,
    setPrimaryRoleMock,
  ]) {
    m.mockReset();
  }
  withDbTransactionMock.mockImplementation(async (cb) => cb(undefined));
  findExistingIdsMock.mockResolvedValue(new Set(['user']));
  syncTopManagerAssignmentsForUserMock.mockResolvedValue(undefined);
  replaceUserRolesMock.mockResolvedValue(undefined);
  setPrimaryRoleMock.mockResolvedValue(undefined);
});

const input = {
  providerId: 'sso-1',
  protocol: 'oidc' as const,
  issuer: 'https://idp.example.com',
  subject: 'sub-1',
  username: 'alice',
  name: 'Alice',
  email: 'alice@example.com',
  groups: [],
  roleMappings: [],
};

describe('resolveExternalIdentity auth method enforcement', () => {
  test('binds existing username only when method and provider match', async () => {
    findByIdentityMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'eid-1',
      providerId: 'sso-1',
      protocol: 'oidc',
      issuer: input.issuer,
      subject: input.subject,
      userId: 'u1',
    });
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({
      id: 'u1',
      name: 'Alice',
      username: 'alice',
      role: 'user',
      avatarInitials: 'AL',
      isDisabled: false,
      passwordHash: 'hash',
      authMethod: 'oidc',
      authProviderId: 'sso-1',
    });

    const result = await resolveExternalIdentity(input);

    expect(result.wasBound).toBe(true);
    expect(insertIdentityMock).toHaveBeenCalled();
  });

  test('rejects existing username when provider does not match', async () => {
    findByIdentityMock.mockResolvedValue(null);
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({
      id: 'u1',
      name: 'Alice',
      username: 'alice',
      role: 'user',
      avatarInitials: 'AL',
      isDisabled: false,
      passwordHash: 'hash',
      authMethod: 'oidc',
      authProviderId: 'sso-other',
    });

    await expect(resolveExternalIdentity(input)).rejects.toThrow(
      'External identity is not allowed for this Praetor user',
    );
    expect(insertIdentityMock).not.toHaveBeenCalled();
  });
});
