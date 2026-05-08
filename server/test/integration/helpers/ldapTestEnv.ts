import { DEFAULT_CONFIG, type LdapConfig } from '../../../repositories/ldapRepo.ts';

export const SHOULD_SKIP = !process.env.LDAP_TEST_URL;

export const TEST_BASE_DN = 'dc=praetor,dc=test';
export const TEST_BIND_DN = `cn=admin,${TEST_BASE_DN}`;
export const TEST_BIND_PASSWORD = 'adminpass';
export const TEST_GROUPS_OU = `ou=groups,${TEST_BASE_DN}`;

export const ALICE_DN = `uid=alice,ou=people,${TEST_BASE_DN}`;
export const ALICE_PASSWORD = 'alicepass';

export const buildTestConfig = (overrides: Partial<LdapConfig> = {}): LdapConfig => ({
  ...DEFAULT_CONFIG,
  enabled: true,
  serverUrl: process.env.LDAP_TEST_URL ?? 'ldap://localhost:1389',
  baseDn: TEST_BASE_DN,
  bindDn: TEST_BIND_DN,
  bindPassword: TEST_BIND_PASSWORD,
  groupBaseDn: TEST_GROUPS_OU,
  ...overrides,
});
