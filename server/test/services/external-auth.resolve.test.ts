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
const hasOtherSubjectForUserAndProviderMock = mock();
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
    hasOtherSubjectForUserAndProvider: hasOtherSubjectForUserAndProviderMock,
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
    hasOtherSubjectForUserAndProviderMock,
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
  hasOtherSubjectForUserAndProviderMock.mockResolvedValue(false);
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

  // Regression for #640 (codex P1): the LOWER(username) functional index in migration
  // 0054 fires under its own constraint name, not users_username_unique. The retry
  // detector must recognize it or concurrent first-time SSO logins surface as 500s.
  test('retries after a concurrent insert violating the LOWER(username) unique index', async () => {
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
    insertUserMock.mockRejectedValueOnce(makeDbError('23505', 'idx_users_username_lower_unique'));

    const result = await resolveExternalIdentity(input);

    expect(withDbTransactionMock).toHaveBeenCalledTimes(2);
    expect(result.id).toBe('u1');
    expect(insertUserMock).toHaveBeenCalledTimes(1);
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

describe('resolveExternalIdentity username-bind safety — regression #606', () => {
  test('refuses to bind a new subject to a user that already has an identity on the same provider', async () => {
    findByIdentityMock.mockResolvedValue(null);
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(matchingSsoUser);
    hasOtherSubjectForUserAndProviderMock.mockResolvedValue(true);

    await expect(
      resolveExternalIdentity({ ...input, subject: 'sub-from-recycled-account' }),
    ).rejects.toThrow('External identity is not allowed for this Praetor user');

    expect(hasOtherSubjectForUserAndProviderMock).toHaveBeenCalledWith(
      'u1',
      'sso-1',
      'oidc',
      'sub-from-recycled-account',
      expect.anything(),
    );
    expect(insertIdentityMock).not.toHaveBeenCalled();
    expect(replaceUserRolesMock).not.toHaveBeenCalled();
  });

  test('still binds when the username-matched user has no identity yet for this provider', async () => {
    findByIdentityMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'eid-1',
      providerId: 'sso-1',
      protocol: 'oidc',
      issuer: input.issuer,
      subject: input.subject,
      userId: 'u1',
    });
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(matchingSsoUser);
    hasOtherSubjectForUserAndProviderMock.mockResolvedValue(false);

    const result = await resolveExternalIdentity(input);

    expect(result.wasBound).toBe(true);
    expect(insertIdentityMock).toHaveBeenCalled();
  });

  // The previous behavior threw `identity_conflict` for any prior identity row on the
  // same `(providerId, protocol)`. That over-rejected the legitimate "issuer string
  // changed but the IdP sub is identical" case (e.g., admin re-normalized the issuer
  // URL): findByIdentity misses on the new issuer, the username path matches, and the
  // user gets locked out of an account they still control. The helper now keys on
  // `subject != input.subject`, so the same subject under a new issuer binds a fresh
  // row instead of refusing.
  test('binds a fresh row when an existing identity has the same subject under a different issuer', async () => {
    findByIdentityMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'eid-new-issuer',
      providerId: 'sso-1',
      protocol: 'oidc',
      issuer: 'https://idp.example.com/renamed',
      subject: input.subject,
      userId: 'u1',
    });
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(matchingSsoUser);
    // Same subject, only the issuer differs → helper returns false (no *other* subject).
    hasOtherSubjectForUserAndProviderMock.mockResolvedValue(false);

    const result = await resolveExternalIdentity({
      ...input,
      issuer: 'https://idp.example.com/renamed',
    });

    expect(result.wasBound).toBe(true);
    expect(insertIdentityMock).toHaveBeenCalled();
    expect(hasOtherSubjectForUserAndProviderMock).toHaveBeenCalledWith(
      'u1',
      'sso-1',
      'oidc',
      input.subject,
      expect.anything(),
    );
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

  test('preserves stored role for an existing SSO user even when a SAML group matches', async () => {
    // Bootstrap-only role mapping: even though the user's groups still resolve to
    // [admin], we must NOT overwrite the user's stored role (here: 'user') because the
    // user already exists and may have been re-assigned by an admin in Praetor.
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

    expect(result.role).toBe('user');
    expect(replaceUserRolesMock).not.toHaveBeenCalled();
    expect(setPrimaryRoleMock).not.toHaveBeenCalled();
    expect(syncTopManagerAssignmentsForUserMock).not.toHaveBeenCalled();
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

describe('resolveExternalIdentity bootstrap-only role mapping (existing users untouched)', () => {
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

  test('existing-user login never rewrites user_roles or primary role even when groups match', async () => {
    // Pre-fix: this path called replaceUserRoles + setPrimaryRole every login, wiping
    // any roles an admin had added in Praetor. Post-fix: role mapping is bootstrap-only.
    findExistingIdsMock.mockResolvedValue(new Set(['manager', 'admin']));
    findByIdentityMock.mockResolvedValue(existingIdentity);
    findLoginUserByIdMock.mockResolvedValue({ ...matchingSsoUser, role: 'admin' });

    const result = await resolveExternalIdentity(multiRoleInput);

    expect(result.role).toBe('admin');
    expect(setPrimaryRoleMock).not.toHaveBeenCalled();
    expect(replaceUserRolesMock).not.toHaveBeenCalled();
    expect(syncTopManagerAssignmentsForUserMock).not.toHaveBeenCalled();
  });

  test('existing-user login preserves the stored primary even when the current mapping would assign a different one', async () => {
    findExistingIdsMock.mockResolvedValue(new Set(['manager']));
    findByIdentityMock.mockResolvedValue(existingIdentity);
    findLoginUserByIdMock.mockResolvedValue({ ...matchingSsoUser, role: 'admin' });

    const result = await resolveExternalIdentity({
      ...multiRoleInput,
      groups: ['Managers'],
    });

    expect(result.role).toBe('admin');
    expect(setPrimaryRoleMock).not.toHaveBeenCalled();
    expect(replaceUserRolesMock).not.toHaveBeenCalled();
  });

  test('new users get the first mapped role as their primary (first provisioning still applies mapping)', async () => {
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
    expect(replaceUserRolesMock).toHaveBeenCalledWith(
      createdUserId,
      ['manager', 'admin'],
      expect.anything(),
    );
  });

  test('SSO bind path (existing local user binding a new identity) does NOT rewrite roles', async () => {
    // wasBound=true but wasCreated=false: the Praetor user already existed — first
    // provisioning of the user happened earlier (via local creation or another login),
    // so role mapping should not write here.
    findByIdentityMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      ...existingIdentity,
      userId: 'u1',
    });
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({
      ...matchingSsoUser,
      role: 'admin',
    });
    findExistingIdsMock.mockResolvedValue(new Set(['manager', 'admin']));

    const result = await resolveExternalIdentity(multiRoleInput);

    expect(result.wasCreated).toBe(false);
    expect(result.wasBound).toBe(true);
    expect(result.role).toBe('admin');
    expect(replaceUserRolesMock).not.toHaveBeenCalled();
    expect(setPrimaryRoleMock).not.toHaveBeenCalled();
  });
});
