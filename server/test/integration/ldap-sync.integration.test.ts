import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realLdapRepo from '../../repositories/ldapRepo.ts';
import * as realSettingsRepo from '../../repositories/settingsRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import { makeWithDbTransactionMock } from '../helpers/withDbTransactionMock.ts';
import { buildTestConfig, SHOULD_SKIP } from './helpers/ldapTestEnv.ts';

type LdapServiceShape = {
  syncUsers: () => Promise<{
    skipped?: boolean;
    reason?: string;
    synced?: number;
    created?: number;
  }>;
  invalidateConfig: () => void;
};

describe.skipIf(SHOULD_SKIP)('LDAP integration: syncUsers()', () => {
  const ldapRepoSnap = { ...realLdapRepo };
  const drizzleSnap = { ...realDrizzle };
  const settingsRepoSnap = { ...realSettingsRepo };
  const usersRepoSnap = { ...realUsersRepo };

  const ldapRepoGetMock = mock();
  const findLoginUserByNormalizedUsernameMock = mock();
  const updateNameByUsernameMock = mock();
  const updateDirectoryProfileMock = mock();
  const settingsUpsertForUserMock = mock();
  const createUserMock = mock();
  const addUserRoleMock = mock();
  const { withDbTransactionMock, resetWithDbTransactionMock } = makeWithDbTransactionMock();

  let ldapService: LdapServiceShape;

  beforeAll(async () => {
    mock.module('../../repositories/ldapRepo.ts', () => ({
      ...ldapRepoSnap,
      get: ldapRepoGetMock,
    }));
    mock.module('../../db/drizzle.ts', () => ({
      ...drizzleSnap,
      withDbTransaction: withDbTransactionMock,
    }));
    mock.module('../../repositories/settingsRepo.ts', () => ({
      ...settingsRepoSnap,
      upsertForUser: settingsUpsertForUserMock,
    }));
    mock.module('../../repositories/usersRepo.ts', () => ({
      ...usersRepoSnap,
      findLoginUserByNormalizedUsername: findLoginUserByNormalizedUsernameMock,
      updateNameByUsername: updateNameByUsernameMock,
      updateDirectoryProfile: updateDirectoryProfileMock,
      createUser: createUserMock,
      addUserRole: addUserRoleMock,
    }));
    ldapService = (await import('../../services/ldap.ts')).default as unknown as LdapServiceShape;
  });

  afterAll(() => {
    mock.module('../../db/drizzle.ts', () => drizzleSnap);
    mock.module('../../repositories/ldapRepo.ts', () => ldapRepoSnap);
    mock.module('../../repositories/settingsRepo.ts', () => settingsRepoSnap);
    mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  });

  beforeEach(() => {
    ldapRepoGetMock.mockReset();
    resetWithDbTransactionMock();
    findLoginUserByNormalizedUsernameMock.mockReset();
    updateNameByUsernameMock.mockReset();
    updateDirectoryProfileMock.mockReset();
    settingsUpsertForUserMock.mockReset();
    createUserMock.mockReset();
    addUserRoleMock.mockReset();

    ldapRepoGetMock.mockResolvedValue(buildTestConfig({ autoProvisionAll: true }));
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);
    addUserRoleMock.mockResolvedValue(undefined);
    ldapService.invalidateConfig();
  });

  test('discovers alice and bob and creates both with placeholder hash', async () => {
    const result = await ldapService.syncUsers();

    expect(result).toEqual({ synced: 0, created: 2 });
    expect(createUserMock).toHaveBeenCalledTimes(2);
    expect(updateDirectoryProfileMock).not.toHaveBeenCalled();

    const usernames = createUserMock.mock.calls
      .map((args) => (args[0] as { username: string }).username)
      .sort();
    expect(usernames).toEqual(['alice', 'bob']);

    for (const args of createUserMock.mock.calls) {
      const user = args[0] as {
        username: string;
        name: string;
        passwordHash: string;
        role: string;
      };
      expect(user.passwordHash).toBe(realUsersRepo.LDAP_PLACEHOLDER_PASSWORD_HASH);
      expect(user.role).toBe('user');
      expect(user.name).toMatch(/Example$/);
    }
  });

  test('existing user: refreshes provider profile instead of createUser', async () => {
    findLoginUserByNormalizedUsernameMock.mockImplementation(async (username: string) =>
      username === 'alice'
        ? { id: 'u1', username, name: 'Old Name', role: 'user', authMethod: 'ldap' }
        : null,
    );

    const result = await ldapService.syncUsers();

    expect(result).toEqual({ synced: 1, created: 1 });
    expect(addUserRoleMock).toHaveBeenCalledWith('u1', 'user', expect.anything());
    expect(updateDirectoryProfileMock).toHaveBeenCalledTimes(1);
    expect(updateDirectoryProfileMock).toHaveBeenCalledWith(
      'u1',
      { name: 'Alice Example', avatarInitials: 'AE' },
      expect.anything(),
    );
    expect(createUserMock).toHaveBeenCalledTimes(1);
    expect((createUserMock.mock.calls[0][0] as { username: string }).username).toBe('bob');
  });

  test('narrowed userFilter syncs only alice', async () => {
    // After buildUserSyncFilter substitutes {0} with *, this becomes
    // (&(uid=*)(givenName=Alice)) which matches only alice in the fixture.
    ldapRepoGetMock.mockResolvedValue(
      buildTestConfig({
        userFilter: '(&(uid={0})(givenName=Alice))',
        autoProvisionAll: true,
      }),
    );
    ldapService.invalidateConfig();

    const result = await ldapService.syncUsers();

    expect(result).toEqual({ synced: 0, created: 1 });
    expect(createUserMock).toHaveBeenCalledTimes(1);
    expect((createUserMock.mock.calls[0][0] as { username: string }).username).toBe('alice');
  });

  test('autoProvisionAll=false: existing users are updated but new entries are NOT created', async () => {
    ldapRepoGetMock.mockResolvedValue(buildTestConfig({ autoProvisionAll: false }));
    findLoginUserByNormalizedUsernameMock.mockImplementation(async (username: string) =>
      username === 'alice' ? { id: 'u1', username, name: 'Old Name' } : null,
    );
    ldapService.invalidateConfig();

    const result = await ldapService.syncUsers();

    expect(result).toEqual({ synced: 1, created: 0 });
    expect(updateDirectoryProfileMock).toHaveBeenCalledTimes(1);
    expect(updateDirectoryProfileMock).toHaveBeenCalledWith(
      'u1',
      { name: 'Alice Example', avatarInitials: 'AE' },
      expect.anything(),
    );
    expect(createUserMock).not.toHaveBeenCalled();
  });

  test('LDAP disabled in config: short-circuits with skipped:true', async () => {
    ldapRepoGetMock.mockResolvedValue(buildTestConfig({ enabled: false }));
    ldapService.invalidateConfig();

    const result = await ldapService.syncUsers();

    expect(result.skipped).toBe(true);
    expect(createUserMock).not.toHaveBeenCalled();
    expect(updateDirectoryProfileMock).not.toHaveBeenCalled();
  });

  test('returned counts match mock invocations exactly', async () => {
    findLoginUserByNormalizedUsernameMock.mockResolvedValueOnce({
      id: 'u1',
      username: 'alice',
      name: 'Alice Example',
    });

    const result = await ldapService.syncUsers();

    expect(result.synced).toBe(updateDirectoryProfileMock.mock.calls.length);
    expect(result.created).toBe(createUserMock.mock.calls.length);
    expect((result.synced ?? 0) + (result.created ?? 0)).toBe(2);
  });
});
