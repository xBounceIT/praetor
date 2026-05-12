import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realLdapRepo from '../../repositories/ldapRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
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
  const usersRepoSnap = { ...realUsersRepo };

  const ldapRepoGetMock = mock();
  const findLoginUserByUsernameMock = mock();
  const updateNameByUsernameMock = mock();
  const createUserMock = mock();

  let ldapService: LdapServiceShape;

  beforeAll(async () => {
    mock.module('../../repositories/ldapRepo.ts', () => ({
      ...ldapRepoSnap,
      get: ldapRepoGetMock,
    }));
    mock.module('../../repositories/usersRepo.ts', () => ({
      ...usersRepoSnap,
      findLoginUserByUsername: findLoginUserByUsernameMock,
      updateNameByUsername: updateNameByUsernameMock,
      createUser: createUserMock,
    }));
    ldapService = (await import('../../services/ldap.ts')).default as unknown as LdapServiceShape;
  });

  afterAll(() => {
    mock.module('../../repositories/ldapRepo.ts', () => ldapRepoSnap);
    mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  });

  beforeEach(() => {
    ldapRepoGetMock.mockReset();
    findLoginUserByUsernameMock.mockReset();
    updateNameByUsernameMock.mockReset();
    createUserMock.mockReset();

    ldapRepoGetMock.mockResolvedValue(buildTestConfig());
    findLoginUserByUsernameMock.mockResolvedValue(null);
    ldapService.invalidateConfig();
  });

  test('discovers alice and bob and creates both with placeholder hash', async () => {
    const result = await ldapService.syncUsers();

    expect(result).toEqual({ synced: 0, created: 2 });
    expect(createUserMock).toHaveBeenCalledTimes(2);
    expect(updateNameByUsernameMock).not.toHaveBeenCalled();

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

  test('existing user: calls updateNameByUsername instead of createUser', async () => {
    findLoginUserByUsernameMock.mockImplementation(async (username: string) =>
      username === 'alice' ? { id: 'u1', username, name: 'Old Name' } : null,
    );

    const result = await ldapService.syncUsers();

    expect(result).toEqual({ synced: 1, created: 1 });
    expect(updateNameByUsernameMock).toHaveBeenCalledTimes(1);
    expect(updateNameByUsernameMock).toHaveBeenCalledWith('alice', 'Alice Example');
    expect(createUserMock).toHaveBeenCalledTimes(1);
    expect((createUserMock.mock.calls[0][0] as { username: string }).username).toBe('bob');
  });

  test('narrowed userFilter syncs only alice', async () => {
    // After buildUserSyncFilter substitutes {0} with *, this becomes
    // (&(uid=*)(givenName=Alice)) which matches only alice in the fixture.
    ldapRepoGetMock.mockResolvedValue(
      buildTestConfig({ userFilter: '(&(uid={0})(givenName=Alice))' }),
    );
    ldapService.invalidateConfig();

    const result = await ldapService.syncUsers();

    expect(result).toEqual({ synced: 0, created: 1 });
    expect(createUserMock).toHaveBeenCalledTimes(1);
    expect((createUserMock.mock.calls[0][0] as { username: string }).username).toBe('alice');
  });

  test('LDAP disabled in config: short-circuits with skipped:true', async () => {
    ldapRepoGetMock.mockResolvedValue(buildTestConfig({ enabled: false }));
    ldapService.invalidateConfig();

    const result = await ldapService.syncUsers();

    expect(result.skipped).toBe(true);
    expect(createUserMock).not.toHaveBeenCalled();
    expect(updateNameByUsernameMock).not.toHaveBeenCalled();
  });

  test('returned counts match mock invocations exactly', async () => {
    findLoginUserByUsernameMock.mockResolvedValueOnce({
      id: 'u1',
      username: 'alice',
      name: 'Alice Example',
    });

    const result = await ldapService.syncUsers();

    expect(result.synced).toBe(updateNameByUsernameMock.mock.calls.length);
    expect(result.created).toBe(createUserMock.mock.calls.length);
    expect((result.synced ?? 0) + (result.created ?? 0)).toBe(2);
  });
});
