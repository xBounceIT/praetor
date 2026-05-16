import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realExternalIdentitiesRepo from '../../repositories/externalIdentitiesRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realSettingsRepo from '../../repositories/settingsRepo.ts';
import * as realUserAssignmentsRepo from '../../repositories/userAssignmentsRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import { makeDbError } from '../helpers/dbErrors.ts';
import { makeWithDbTransactionMock } from '../helpers/withDbTransactionMock.ts';

const drizzleSnap = { ...realDrizzle };
const externalIdentitiesRepoSnap = { ...realExternalIdentitiesRepo };
const rolesRepoSnap = { ...realRolesRepo };
const settingsRepoSnap = { ...realSettingsRepo };
const userAssignmentsRepoSnap = { ...realUserAssignmentsRepo };
const usersRepoSnap = { ...realUsersRepo };

const { withDbTransactionMock, resetWithDbTransactionMock } = makeWithDbTransactionMock();
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

afterAll(() => {
  mock.module('../../db/drizzle.ts', () => drizzleSnap);
  mock.module('../../repositories/externalIdentitiesRepo.ts', () => externalIdentitiesRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../repositories/settingsRepo.ts', () => settingsRepoSnap);
  mock.module('../../repositories/userAssignmentsRepo.ts', () => userAssignmentsRepoSnap);
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
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
  resetWithDbTransactionMock();
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

const matchingSsoUser = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'user',
  avatarInitials: 'AL',
  isDisabled: false,
  passwordHash: 'hash',
  employeeType: 'app_user' as const,
  authMethod: 'oidc' as const,
  authProviderId: 'sso-1',
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
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(matchingSsoUser);

    const result = await resolveExternalIdentity(input);

    expect(result.wasBound).toBe(true);
    expect(insertIdentityMock).toHaveBeenCalled();
  });

  test('retries after a concurrent first-time SSO username insert conflict', async () => {
    findByIdentityMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'eid-1',
        providerId: 'sso-1',
        protocol: 'oidc',
        issuer: input.issuer,
        subject: input.subject,
        userId: 'u1',
      });
    findLoginUserByNormalizedUsernameMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(matchingSsoUser);
    insertUserMock.mockRejectedValueOnce(makeDbError('23505', 'users_username_unique'));

    const result = await resolveExternalIdentity(input);

    expect(withDbTransactionMock).toHaveBeenCalledTimes(2);
    expect(result.id).toBe('u1');
    expect(result.wasCreated).toBe(false);
    expect(result.wasBound).toBe(true);
    expect(insertUserMock).toHaveBeenCalledTimes(1);
    expect(upsertForUserMock).not.toHaveBeenCalled();
    expect(insertIdentityMock).toHaveBeenCalledTimes(1);
  });

  test('does not retry unrelated unique violations', async () => {
    findByIdentityMock.mockResolvedValueOnce(null);
    findLoginUserByNormalizedUsernameMock.mockResolvedValueOnce(null);
    insertUserMock.mockRejectedValueOnce(makeDbError('23505', 'users_pkey'));

    await expect(resolveExternalIdentity(input)).rejects.toThrow('boom');

    expect(withDbTransactionMock).toHaveBeenCalledTimes(1);
    expect(insertIdentityMock).not.toHaveBeenCalled();
  });

  test('rejects existing username when provider does not match', async () => {
    findByIdentityMock.mockResolvedValue(null);
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({
      ...matchingSsoUser,
      authProviderId: 'sso-other',
    });

    await expect(resolveExternalIdentity(input)).rejects.toThrow(
      'External identity is not allowed for this Praetor user',
    );
    expect(insertIdentityMock).not.toHaveBeenCalled();
  });

  test('rejects existing username when the matching Praetor row is not an app user', async () => {
    findByIdentityMock.mockResolvedValue(null);
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({
      ...matchingSsoUser,
      employeeType: 'internal',
    });

    await expect(resolveExternalIdentity(input)).rejects.toThrow(
      'External identity is not allowed for this Praetor user',
    );
    expect(insertIdentityMock).not.toHaveBeenCalled();
  });

  test('rejects existing external identity bound to a non-app user', async () => {
    findByIdentityMock.mockResolvedValue({
      id: 'eid-1',
      providerId: 'sso-1',
      protocol: 'oidc',
      issuer: input.issuer,
      subject: input.subject,
      userId: 'u1',
    });
    findLoginUserByIdMock.mockResolvedValue({
      ...matchingSsoUser,
      employeeType: 'external',
    });

    await expect(resolveExternalIdentity(input)).rejects.toThrow(
      'External identity is not allowed for this Praetor user',
    );
    expect(insertIdentityMock).not.toHaveBeenCalled();
  });
});

describe('resolveExternalIdentity role mapping — regression #596', () => {
  const adminUser = {
    ...matchingSsoUser,
    role: 'admin',
  };

  test('preserves admin role when no SAML group matches a mapping', async () => {
    findByIdentityMock.mockResolvedValue({
      id: 'eid-1',
      providerId: 'sso-1',
      protocol: 'oidc',
      issuer: input.issuer,
      subject: input.subject,
      userId: 'u1',
    });
    findLoginUserByIdMock.mockResolvedValue(adminUser);

    const result = await resolveExternalIdentity({
      ...input,
      groups: ['cn=guests,ou=groups,dc=example,dc=com'],
      roleMappings: [{ externalGroup: 'admins', role: 'admin' }],
    });

    expect(result.role).toBe('admin');
    expect(replaceUserRolesMock).not.toHaveBeenCalled();
    expect(setPrimaryRoleMock).not.toHaveBeenCalled();
    expect(syncTopManagerAssignmentsForUserMock).not.toHaveBeenCalled();
  });

  test('preserves admin role when matched mapping references a deleted role', async () => {
    findByIdentityMock.mockResolvedValue({
      id: 'eid-1',
      providerId: 'sso-1',
      protocol: 'oidc',
      issuer: input.issuer,
      subject: input.subject,
      userId: 'u1',
    });
    findLoginUserByIdMock.mockResolvedValue(adminUser);
    findExistingIdsMock.mockResolvedValue(new Set<string>());

    const result = await resolveExternalIdentity({
      ...input,
      groups: ['cn=ghosts,ou=groups,dc=example,dc=com'],
      roleMappings: [{ externalGroup: 'ghosts', role: 'deleted-role' }],
    });

    expect(result.role).toBe('admin');
    expect(replaceUserRolesMock).not.toHaveBeenCalled();
    expect(setPrimaryRoleMock).not.toHaveBeenCalled();
  });

  test('updates primary role when SAML group matches a mapping', async () => {
    findByIdentityMock.mockResolvedValue({
      id: 'eid-1',
      providerId: 'sso-1',
      protocol: 'oidc',
      issuer: input.issuer,
      subject: input.subject,
      userId: 'u1',
    });
    findLoginUserByIdMock.mockResolvedValue({ ...adminUser, role: 'user' });
    findExistingIdsMock.mockResolvedValue(new Set(['admin']));

    const result = await resolveExternalIdentity({
      ...input,
      groups: ['cn=admins,ou=groups,dc=example,dc=com'],
      roleMappings: [{ externalGroup: 'admins', role: 'admin' }],
    });

    expect(result.role).toBe('admin');
    expect(replaceUserRolesMock).toHaveBeenCalledWith('u1', ['admin'], expect.anything());
    expect(setPrimaryRoleMock).toHaveBeenCalledWith('u1', 'admin', expect.anything());
    expect(syncTopManagerAssignmentsForUserMock).toHaveBeenCalledWith('u1', expect.anything());
  });

  test('new SSO user with no matching group still gets DEFAULT_ROLE_ID assignment', async () => {
    let createdUserId: string | undefined;
    insertUserMock.mockImplementation(async (row: { id: string }) => {
      createdUserId = row.id;
    });
    // First findByIdentity: no prior binding. Second (post-insert): returns the row we just bound.
    findByIdentityMock
      .mockImplementationOnce(async () => null)
      .mockImplementationOnce(async () => ({
        id: 'eid-1',
        providerId: 'sso-1',
        protocol: 'oidc',
        issuer: input.issuer,
        subject: input.subject,
        userId: createdUserId,
      }));
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);

    const result = await resolveExternalIdentity({
      ...input,
      groups: ['cn=guests,ou=groups,dc=example,dc=com'],
      roleMappings: [{ externalGroup: 'admins', role: 'admin' }],
    });

    expect(result.wasCreated).toBe(true);
    expect(result.role).toBe('user');
    expect(insertUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user' }),
      expect.anything(),
    );
    expect(replaceUserRolesMock).toHaveBeenCalledWith(createdUserId, ['user'], expect.anything());
    expect(setPrimaryRoleMock).toHaveBeenCalledWith(createdUserId, 'user', expect.anything());
  });
});

describe('resolveExternalIdentity primary role preservation — regression #603', () => {
  const multiRoleInput = {
    ...input,
    groups: ['Managers', 'Admins'],
    roleMappings: [
      { externalGroup: 'Managers', role: 'manager' },
      { externalGroup: 'Admins', role: 'admin' },
    ],
  };

  const existingIdentity = {
    id: 'eid-1',
    providerId: 'sso-1',
    protocol: 'oidc' as const,
    issuer: multiRoleInput.issuer,
    subject: multiRoleInput.subject,
    userId: 'u1',
  };

  test('keeps existing primary role when still permitted by the current mapping', async () => {
    findExistingIdsMock.mockResolvedValue(new Set(['manager', 'admin']));
    findByIdentityMock.mockResolvedValue(existingIdentity);
    findLoginUserByIdMock.mockResolvedValue({ ...matchingSsoUser, role: 'admin' });

    const result = await resolveExternalIdentity(multiRoleInput);

    expect(result.role).toBe('admin');
    expect(setPrimaryRoleMock).toHaveBeenCalledWith('u1', 'admin', expect.anything());
    expect(replaceUserRolesMock).toHaveBeenCalledWith(
      'u1',
      ['manager', 'admin'],
      expect.anything(),
    );
  });

  test('falls back to first mapped role when existing primary is no longer permitted', async () => {
    findExistingIdsMock.mockResolvedValue(new Set(['manager']));
    findByIdentityMock.mockResolvedValue(existingIdentity);
    findLoginUserByIdMock.mockResolvedValue({ ...matchingSsoUser, role: 'admin' });

    const result = await resolveExternalIdentity({
      ...multiRoleInput,
      groups: ['Managers'],
    });

    expect(result.role).toBe('manager');
    expect(setPrimaryRoleMock).toHaveBeenCalledWith('u1', 'manager', expect.anything());
  });

  test('new users get the first mapped role as their primary', async () => {
    findExistingIdsMock.mockResolvedValue(new Set(['manager', 'admin']));
    let createdUserId: string | undefined;
    insertUserMock.mockImplementation(async (row: { id: string }) => {
      createdUserId = row.id;
    });
    findByIdentityMock
      .mockImplementationOnce(async () => null)
      .mockImplementationOnce(async () => ({ ...existingIdentity, userId: createdUserId }));
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);

    const result = await resolveExternalIdentity(multiRoleInput);

    expect(result.wasCreated).toBe(true);
    expect(result.role).toBe('manager');
    expect(insertUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'manager' }),
      expect.anything(),
    );
    expect(setPrimaryRoleMock).toHaveBeenCalledWith(createdUserId, 'manager', expect.anything());
  });
});
