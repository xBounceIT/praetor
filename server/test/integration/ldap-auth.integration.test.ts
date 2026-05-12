import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realLdapRepo from '../../repositories/ldapRepo.ts';
import { ALICE_PASSWORD, buildTestConfig, SHOULD_SKIP } from './helpers/ldapTestEnv.ts';

type LdapServiceShape = {
  authenticate: (username: string, password: string) => Promise<boolean>;
  invalidateConfig: () => void;
};

describe.skipIf(SHOULD_SKIP)('LDAP integration: authenticate()', () => {
  const ldapRepoSnap = { ...realLdapRepo };
  const ldapRepoGetMock = mock();
  let ldapService: LdapServiceShape;

  beforeAll(async () => {
    mock.module('../../repositories/ldapRepo.ts', () => ({
      ...ldapRepoSnap,
      get: ldapRepoGetMock,
    }));
    ldapService = (await import('../../services/ldap.ts')).default as unknown as LdapServiceShape;
  });

  afterAll(() => {
    mock.module('../../repositories/ldapRepo.ts', () => ldapRepoSnap);
  });

  beforeEach(() => {
    ldapRepoGetMock.mockReset();
    ldapRepoGetMock.mockResolvedValue(buildTestConfig());
    ldapService.invalidateConfig();
  });

  test('alice/alicepass succeeds', async () => {
    const result = await ldapService.authenticate('alice', ALICE_PASSWORD);
    expect(result).toBe(true);
  });

  test('alice/wrongpass returns false (user-bind rejects)', async () => {
    const result = await ldapService.authenticate('alice', 'definitely-wrong');
    expect(result).toBe(false);
  });

  test('nosuchuser returns false (search produces no DN)', async () => {
    const result = await ldapService.authenticate('nosuchuser', 'whatever');
    expect(result).toBe(false);
  });

  test('unreachable server returns false (connection refused)', async () => {
    ldapRepoGetMock.mockResolvedValue(buildTestConfig({ serverUrl: 'ldap://127.0.0.1:1' }));
    ldapService.invalidateConfig();
    const result = await ldapService.authenticate('alice', ALICE_PASSWORD);
    expect(result).toBe(false);
  });

  test('service-account bad password returns false (initial bind fails)', async () => {
    ldapRepoGetMock.mockResolvedValue(buildTestConfig({ bindPassword: 'wrong-service-pass' }));
    ldapService.invalidateConfig();
    const result = await ldapService.authenticate('alice', ALICE_PASSWORD);
    expect(result).toBe(false);
  });
});
