import type { LdapConfig } from '../../../repositories/ldapRepo.ts';

export const SHOULD_SKIP = !process.env.LDAP_TEST_URL;

export const TEST_BASE_DN = 'dc=praetor,dc=test';
export const TEST_BIND_DN = `cn=admin,${TEST_BASE_DN}`;
export const TEST_BIND_PASSWORD = 'adminpass';
export const TEST_PEOPLE_OU = `ou=people,${TEST_BASE_DN}`;
export const TEST_GROUPS_OU = `ou=groups,${TEST_BASE_DN}`;

export const ALICE_DN = `uid=alice,${TEST_PEOPLE_OU}`;
export const BOB_DN = `uid=bob,${TEST_PEOPLE_OU}`;
export const ALICE_PASSWORD = 'alicepass';
export const BOB_PASSWORD = 'bobpass';

export const buildTestConfig = (overrides: Partial<LdapConfig> = {}): LdapConfig => ({
  enabled: true,
  serverUrl: process.env.LDAP_TEST_URL ?? 'ldap://localhost:1389',
  baseDn: TEST_BASE_DN,
  bindDn: TEST_BIND_DN,
  bindPassword: TEST_BIND_PASSWORD,
  userFilter: '(uid={0})',
  groupBaseDn: TEST_GROUPS_OU,
  groupFilter: '(member={0})',
  roleMappings: [],
  tlsCaCertificate: '',
  ...overrides,
});
