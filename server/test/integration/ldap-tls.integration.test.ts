import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import fs from 'node:fs';
import * as realLdapRepo from '../../repositories/ldapRepo.ts';
import { ALICE_PASSWORD, buildTestConfig, SHOULD_SKIP } from './helpers/ldapTestEnv.ts';

const TLS_URL = process.env.LDAP_TEST_TLS_URL;
const CA_FILE = process.env.LDAP_TLS_CA_FILE;
const SHOULD_SKIP_TLS = SHOULD_SKIP || !TLS_URL || !CA_FILE;

type LdapServiceShape = {
  authenticate: (username: string, password: string) => Promise<boolean>;
  invalidateConfig: () => void;
};

describe.skipIf(SHOULD_SKIP_TLS)('LDAP integration: LDAPS / TLS', () => {
  // SHOULD_SKIP_TLS guarantees these are defined when the suite runs.
  const tlsUrl = TLS_URL as string;
  const caFile = CA_FILE as string;

  const ldapRepoSnap = { ...realLdapRepo };
  const ldapRepoGetMock = mock();
  let ldapService: LdapServiceShape;

  const ENV_KEYS = ['LDAP_REJECT_UNAUTHORIZED', 'LDAP_TLS_CA_FILE'] as const;
  const envBackup: Record<(typeof ENV_KEYS)[number], string | undefined> = {
    LDAP_REJECT_UNAUTHORIZED: undefined,
    LDAP_TLS_CA_FILE: undefined,
  };

  beforeAll(async () => {
    for (const key of ENV_KEYS) envBackup[key] = process.env[key];
    mock.module('../../repositories/ldapRepo.ts', () => ({
      ...ldapRepoSnap,
      get: ldapRepoGetMock,
    }));
    ldapService = (await import('../../services/ldap.ts')).default as unknown as LdapServiceShape;
  });

  afterAll(() => {
    mock.module('../../repositories/ldapRepo.ts', () => ldapRepoSnap);
    for (const key of ENV_KEYS) {
      if (envBackup[key] === undefined) delete process.env[key];
      else process.env[key] = envBackup[key];
    }
  });

  beforeEach(() => {
    ldapRepoGetMock.mockReset();
    process.env.LDAP_REJECT_UNAUTHORIZED = 'true';
    process.env.LDAP_TLS_CA_FILE = caFile;
    ldapRepoGetMock.mockResolvedValue(buildTestConfig({ serverUrl: tlsUrl }));
    ldapService.invalidateConfig();
  });

  test('LDAPS with LDAP_TLS_CA_FILE env: alice authenticates', async () => {
    expect(await ldapService.authenticate('alice', ALICE_PASSWORD)).toBe(true);
  });

  test('LDAPS with PEM in DB config (tlsCaCertificate): alice authenticates', async () => {
    const pem = fs.readFileSync(caFile, 'utf8');
    delete process.env.LDAP_TLS_CA_FILE;
    ldapRepoGetMock.mockResolvedValue(
      buildTestConfig({ serverUrl: tlsUrl, tlsCaCertificate: pem }),
    );
    ldapService.invalidateConfig();

    expect(await ldapService.authenticate('alice', ALICE_PASSWORD)).toBe(true);
  });

  test('LDAPS with rejectUnauthorized=true and no CA: auth fails', async () => {
    delete process.env.LDAP_TLS_CA_FILE;
    process.env.LDAP_REJECT_UNAUTHORIZED = 'true';
    ldapRepoGetMock.mockResolvedValue(buildTestConfig({ serverUrl: tlsUrl }));
    ldapService.invalidateConfig();

    expect(await ldapService.authenticate('alice', ALICE_PASSWORD)).toBe(false);
  });

  test('LDAPS with LDAP_REJECT_UNAUTHORIZED=false and no CA: auth succeeds', async () => {
    delete process.env.LDAP_TLS_CA_FILE;
    process.env.LDAP_REJECT_UNAUTHORIZED = 'false';
    ldapRepoGetMock.mockResolvedValue(buildTestConfig({ serverUrl: tlsUrl }));
    ldapService.invalidateConfig();

    expect(await ldapService.authenticate('alice', ALICE_PASSWORD)).toBe(true);
  });
});
