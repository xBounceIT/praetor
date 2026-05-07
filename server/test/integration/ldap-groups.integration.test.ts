import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import ldap from 'ldapjs';
import {
  ALICE_DN,
  SHOULD_SKIP,
  TEST_BIND_DN,
  TEST_BIND_PASSWORD,
  TEST_GROUPS_OU,
} from './helpers/ldapTestEnv.ts';

type LdapClient = ReturnType<typeof ldap.createClient>;

describe.skipIf(SHOULD_SKIP)('LDAP integration: group filter wire format', () => {
  let client: LdapClient;

  beforeAll(async () => {
    client = ldap.createClient({ url: process.env.LDAP_TEST_URL as string });
    await new Promise<void>((resolve, reject) => {
      client.bind(TEST_BIND_DN, TEST_BIND_PASSWORD, (err) => (err ? reject(err) : resolve()));
    });
  });

  afterAll(() => {
    if (client) client.unbind(() => {});
  });

  test('groupFilter (member={DN}) returns expected groups for alice', async () => {
    const filter = `(member=${ALICE_DN})`;

    const found = await new Promise<string[]>((resolve, reject) => {
      const results: string[] = [];
      client.search(TEST_GROUPS_OU, { scope: 'sub', filter }, (err, res) => {
        if (err) return reject(err);
        res.on('searchEntry', (entry) => results.push(entry.objectName?.toString() ?? ''));
        res.on('error', reject);
        res.on('end', () => resolve(results));
      });
    });

    expect(found).toContain(`cn=praetor-admins,${TEST_GROUPS_OU}`);
    expect(found).toContain(`cn=praetor-users,${TEST_GROUPS_OU}`);
  });
});
