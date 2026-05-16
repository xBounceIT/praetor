import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import realLdap from 'ldapjs';
import * as realLdapRepo from '../../repositories/ldapRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realExternalAuth from '../../services/external-auth.ts';
import ldapService from '../../services/ldap.ts';
import * as realInitials from '../../utils/initials.ts';
import * as realLogger from '../../utils/logger.ts';
import * as realOrderIds from '../../utils/order-ids.ts';

// Snapshot real exports BEFORE the beforeAll fires (mock.module inside beforeAll is not hoisted).
const ldapjsSnapshot = realLdap;
const ldapRepoSnapshot = { ...realLdapRepo };
const usersRepoSnapshot = { ...realUsersRepo };
const externalAuthSnapshot = { ...realExternalAuth };
const initialsSnapshot = { ...realInitials };
const loggerSnapshot = { ...realLogger };
const orderIdsSnapshot = { ...realOrderIds };

const ldapRepoGetMock = mock();
const findLoginUserByNormalizedUsernameMock = mock();
const updateNameByUsernameMock = mock();
const createUserMock = mock();
const applyExternalRolesForUserMock = mock();
const applyExternalRolesForUserIfMatchedMock = mock();
const filterExistingRoleIdsMock = mock();

// ─── ldapjs harness ───────────────────────────────────────────────────────────
type SearchResponse = {
  err?: Error;
  entries?: { objectName: string; object?: Record<string, unknown> }[];
  errorEvent?: Error;
  status?: number;
};

type ClientFixture = {
  bindResponses?: (Error | null)[];
  searchResponses?: SearchResponse[];
};

type ClientStats = {
  options: unknown;
  bindCalls: { dn: string; password: string }[];
  searchCalls: { base: string; options: Record<string, unknown> }[];
  unbindCalls: number;
};

let nextFixture: ClientFixture = {};
let lastClientStats: ClientStats | null = null;

const createClientMock = mock((opts: unknown) => {
  const fixture = nextFixture;
  let bindIdx = 0;
  let searchIdx = 0;

  const stats: ClientStats = {
    options: opts,
    bindCalls: [],
    searchCalls: [],
    unbindCalls: 0,
  };
  lastClientStats = stats;

  return {
    bind(dn: string, password: string, cb: (err: Error | null) => void) {
      stats.bindCalls.push({ dn, password });
      const response = fixture.bindResponses?.[bindIdx++] ?? null;
      cb(response);
    },
    search(
      base: string,
      options: Record<string, unknown>,
      cb: (err: Error | null, res: unknown) => void,
    ) {
      stats.searchCalls.push({ base, options });
      const response = fixture.searchResponses?.[searchIdx++];
      if (response?.err) {
        cb(response.err, null);
        return;
      }
      const handlers: Record<string, ((arg: unknown) => void)[]> = {};
      const res = {
        on(event: string, handler: (arg: unknown) => void) {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(handler);
        },
      };
      cb(null, res);
      for (const entry of response?.entries ?? []) {
        for (const h of handlers.searchEntry ?? []) h(entry);
      }
      if (response?.errorEvent) {
        const err = response.errorEvent as unknown as Error;
        for (const h of handlers.error ?? []) h(err);
      }
      const endArg = { status: response?.status ?? 0 };
      for (const h of handlers.end ?? []) h(endArg);
    },
    unbind(cb: (err?: Error) => void) {
      stats.unbindCalls += 1;
      cb();
    },
  };
});

const noop = () => {};
const silentLogger = {
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
  fatal: noop,
  trace: noop,
  child: () => silentLogger,
};

beforeAll(() => {
  // Mock only `createClient` of ldapjs; preserve the real `parseFilter` so the
  // util/ldap-filter tests (which exercise parseFilter) still pass once we restore.
  mock.module('ldapjs', () => ({
    default: {
      ...ldapjsSnapshot,
      createClient: createClientMock,
    },
  }));
  mock.module('../../repositories/ldapRepo.ts', () => ({
    ...ldapRepoSnapshot,
    get: ldapRepoGetMock,
  }));
  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnapshot,
    findLoginUserByNormalizedUsername: findLoginUserByNormalizedUsernameMock,
    updateNameByUsername: updateNameByUsernameMock,
    createUser: createUserMock,
  }));
  mock.module('../../services/external-auth.ts', () => ({
    ...externalAuthSnapshot,
    applyExternalRolesForUser: applyExternalRolesForUserMock,
    applyExternalRolesForUserIfMatched: applyExternalRolesForUserIfMatchedMock,
    filterExistingRoleIds: filterExistingRoleIdsMock,
  }));
  mock.module('../../utils/initials.ts', () => ({
    ...initialsSnapshot,
    computeAvatarInitials: (name: string) => name.slice(0, 2).toUpperCase(),
  }));
  mock.module('../../utils/logger.ts', () => ({
    ...loggerSnapshot,
    createChildLogger: () => silentLogger,
    serializeError: (e: unknown) => (e instanceof Error ? { message: e.message } : { error: e }),
    logger: silentLogger,
  }));
  mock.module('../../utils/order-ids.ts', () => ({
    ...orderIdsSnapshot,
    generatePrefixedId: (prefix: string) => `${prefix}_test_id`,
  }));
});

afterAll(() => {
  mock.module('ldapjs', () => ({ default: ldapjsSnapshot }));
  mock.module('../../repositories/ldapRepo.ts', () => ldapRepoSnapshot);
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnapshot);
  mock.module('../../services/external-auth.ts', () => externalAuthSnapshot);
  mock.module('../../utils/initials.ts', () => initialsSnapshot);
  mock.module('../../utils/logger.ts', () => loggerSnapshot);
  mock.module('../../utils/order-ids.ts', () => orderIdsSnapshot);
});

const ENABLED_LDAP_CONFIG: realLdapRepo.LdapConfig = {
  ...realLdapRepo.DEFAULT_CONFIG,
  enabled: true,
  serverUrl: 'ldap://ldap.test:389',
  baseDn: 'dc=test,dc=com',
  bindDn: 'cn=admin,dc=test,dc=com',
  bindPassword: 'admin-pw',
  groupBaseDn: 'ou=groups,dc=test,dc=com',
  autoProvisionAll: true,
};

const LDAP_LOGIN_USER = {
  id: 'u-old',
  name: 'Alice Old',
  username: 'alice',
  role: 'user',
  passwordHash: realUsersRepo.LDAP_PLACEHOLDER_PASSWORD_HASH,
  avatarInitials: 'AO',
  isDisabled: false,
  employeeType: 'app_user' as const,
  authMethod: 'ldap' as const,
  authProviderId: null,
};

const resetService = () => {
  // Use the public cache-invalidation hook rather than reaching into the private field.
  ldapService.invalidateConfig();
};

const ENV_KEYS = [
  'LDAP_REJECT_UNAUTHORIZED',
  'LDAP_TLS_CA_FILE',
  'LDAP_TLS_CERT_FILE',
  'LDAP_TLS_KEY_FILE',
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  resetService();
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }

  ldapRepoGetMock.mockReset();
  findLoginUserByNormalizedUsernameMock.mockReset();
  updateNameByUsernameMock.mockReset();
  createUserMock.mockReset();
  applyExternalRolesForUserMock.mockReset();
  applyExternalRolesForUserIfMatchedMock.mockReset();
  filterExistingRoleIdsMock.mockReset();
  filterExistingRoleIdsMock.mockImplementation(async (ids: string[]) =>
    ids.length > 0 ? ids : ['user'],
  );
  createClientMock.mockClear();

  ldapRepoGetMock.mockResolvedValue(ENABLED_LDAP_CONFIG);
  applyExternalRolesForUserMock.mockResolvedValue(['user']);
  applyExternalRolesForUserIfMatchedMock.mockResolvedValue({ applied: false, roleIds: [] });
  nextFixture = {};
  lastClientStats = null;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('getClient', () => {
  test('returns null when config.enabled is false', async () => {
    ldapRepoGetMock.mockResolvedValue({ ...ENABLED_LDAP_CONFIG, enabled: false });
    const client = await ldapService.getClient();
    expect(client).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  test('can create a diagnostic client when config.enabled is false', async () => {
    ldapRepoGetMock.mockResolvedValue({ ...ENABLED_LDAP_CONFIG, enabled: false });
    const client = await ldapService.getClient({ allowDisabledConfig: true });
    expect(client).not.toBeNull();
    expect(createClientMock).toHaveBeenCalledTimes(1);
  });

  test('calls loadConfig when cache is empty', async () => {
    await ldapService.getClient();
    expect(ldapRepoGetMock).toHaveBeenCalledTimes(1);
  });

  test('default tlsOptions.rejectUnauthorized is true', async () => {
    await ldapService.getClient();
    const opts = createClientMock.mock.calls[0]?.[0] as {
      tlsOptions: { rejectUnauthorized: boolean };
    };
    expect(opts.tlsOptions.rejectUnauthorized).toBe(true);
  });

  test('LDAP_REJECT_UNAUTHORIZED="false" → rejectUnauthorized:false', async () => {
    process.env.LDAP_REJECT_UNAUTHORIZED = 'false';
    await ldapService.getClient();
    const opts = createClientMock.mock.calls[0]?.[0] as {
      tlsOptions: { rejectUnauthorized: boolean };
    };
    expect(opts.tlsOptions.rejectUnauthorized).toBe(false);
  });

  test('passes config.serverUrl to ldapjs.createClient', async () => {
    await ldapService.getClient();
    const opts = createClientMock.mock.calls[0]?.[0] as { url: string };
    expect(opts.url).toBe('ldap://ldap.test:389');
  });

  test('LDAP_TLS_CA_FILE pointing to non-existent path → no ca attached', async () => {
    process.env.LDAP_TLS_CA_FILE = '/path/that/does/not/exist/ca.pem';
    await ldapService.getClient();
    const opts = createClientMock.mock.calls[0]?.[0] as {
      tlsOptions: { ca?: Buffer };
    };
    expect(opts.tlsOptions.ca).toBeUndefined();
  });

  test('LDAP_TLS_CA_FILE pointing to an existing file → ca buffer attached', async () => {
    // The test file itself is a stable, always-existing readable fixture for the existsSync gate.
    process.env.LDAP_TLS_CA_FILE = import.meta.path;
    await ldapService.getClient();
    const opts = createClientMock.mock.calls[0]?.[0] as {
      tlsOptions: { ca?: Buffer };
    };
    expect(opts.tlsOptions.ca).toBeInstanceOf(Buffer);
    expect((opts.tlsOptions.ca as Buffer).length).toBeGreaterThan(0);
  });

  test('config.tlsCaCertificate populates tlsOptions.ca as a UTF-8 buffer', async () => {
    const pem = '-----BEGIN CERTIFICATE-----\ndb-stored\n-----END CERTIFICATE-----\n';
    ldapRepoGetMock.mockResolvedValue({ ...ENABLED_LDAP_CONFIG, tlsCaCertificate: pem });
    await ldapService.getClient();
    const opts = createClientMock.mock.calls[0]?.[0] as { tlsOptions: { ca?: Buffer } };
    expect(opts.tlsOptions.ca).toBeInstanceOf(Buffer);
    expect((opts.tlsOptions.ca as Buffer).toString('utf8')).toBe(pem);
  });

  test('DB-stored tlsCaCertificate takes precedence over LDAP_TLS_CA_FILE', async () => {
    const pem = '-----BEGIN CERTIFICATE-----\nfrom-db\n-----END CERTIFICATE-----\n';
    process.env.LDAP_TLS_CA_FILE = import.meta.path;
    ldapRepoGetMock.mockResolvedValue({ ...ENABLED_LDAP_CONFIG, tlsCaCertificate: pem });
    await ldapService.getClient();
    const opts = createClientMock.mock.calls[0]?.[0] as { tlsOptions: { ca?: Buffer } };
    expect((opts.tlsOptions.ca as Buffer).toString('utf8')).toBe(pem);
  });

  test('empty config.tlsCaCertificate falls through to LDAP_TLS_CA_FILE', async () => {
    process.env.LDAP_TLS_CA_FILE = import.meta.path;
    ldapRepoGetMock.mockResolvedValue({ ...ENABLED_LDAP_CONFIG, tlsCaCertificate: '' });
    await ldapService.getClient();
    const opts = createClientMock.mock.calls[0]?.[0] as { tlsOptions: { ca?: Buffer } };
    // The fallback reads the test file itself; the buffer must be that file's contents
    // and is recognizable by an import statement (not present in any real PEM).
    expect(opts.tlsOptions.ca).toBeInstanceOf(Buffer);
    expect((opts.tlsOptions.ca as Buffer).toString('utf8')).toContain(
      "import realLdap from 'ldapjs'",
    );
  });
});

describe('invalidateConfig', () => {
  test('drops the cached config so the next getClient call re-reads from the repo', async () => {
    await ldapService.getClient();
    expect(ldapRepoGetMock).toHaveBeenCalledTimes(1);
    // Second call without invalidate uses the cache.
    await ldapService.getClient();
    expect(ldapRepoGetMock).toHaveBeenCalledTimes(1);
    // After invalidate, the next call re-reads.
    ldapService.invalidateConfig();
    await ldapService.getClient();
    expect(ldapRepoGetMock).toHaveBeenCalledTimes(2);
  });

  test('reloadConfig re-reads the saved config even when the cache is populated', async () => {
    await ldapService.getClient();
    ldapRepoGetMock.mockResolvedValue({
      ...ENABLED_LDAP_CONFIG,
      serverUrl: 'ldap://new-ldap.test:389',
    });

    await ldapService.getClient({ reloadConfig: true });

    expect(ldapRepoGetMock).toHaveBeenCalledTimes(2);
    const opts = createClientMock.mock.calls[1]?.[0] as { url: string };
    expect(opts.url).toBe('ldap://new-ldap.test:389');
  });
});

describe('authenticate', () => {
  test('returns false when getClient returns null (LDAP disabled)', async () => {
    ldapRepoGetMock.mockResolvedValue({ ...ENABLED_LDAP_CONFIG, enabled: false });
    const ok = await ldapService.authenticate('alice', 'pw');
    expect(ok).toBe(false);
  });

  test('rejects when service-account bind errors; unbind still called', async () => {
    nextFixture = { bindResponses: [new Error('bad creds')] };
    await expect(ldapService.authenticate('alice', 'pw')).rejects.toThrow('bad creds');
    expect(lastClientStats?.unbindCalls).toBe(1);
  });

  test('returns false when findUserDn yields null (no entries before end)', async () => {
    nextFixture = {
      bindResponses: [null],
      searchResponses: [{ entries: [], status: 0 }],
    };
    const ok = await ldapService.authenticate('alice', 'pw');
    expect(ok).toBe(false);
    expect(lastClientStats?.unbindCalls).toBe(1);
  });

  test('returns false when user re-bind errors (wrong password)', async () => {
    nextFixture = {
      bindResponses: [null, new Error('wrong password')],
      searchResponses: [
        {
          entries: [{ objectName: 'uid=alice,dc=test,dc=com', object: {} }],
          status: 0,
        },
      ],
    };
    const ok = await ldapService.authenticate('alice', 'pw');
    expect(ok).toBe(false);
    expect(lastClientStats?.unbindCalls).toBe(1);
  });

  test('returns true after user credential check and service-account rebind', async () => {
    nextFixture = {
      bindResponses: [null, null, null],
      searchResponses: [
        {
          entries: [{ objectName: 'uid=alice,dc=test,dc=com', object: {} }],
          status: 0,
        },
      ],
    };
    const ok = await ldapService.authenticate('alice', 'pw');
    expect(ok).toBe(true);
    expect(lastClientStats?.unbindCalls).toBe(1);
    expect(lastClientStats?.bindCalls).toEqual([
      { dn: 'cn=admin,dc=test,dc=com', password: 'admin-pw' },
      { dn: 'uid=alice,dc=test,dc=com', password: 'pw' },
      { dn: 'cn=admin,dc=test,dc=com', password: 'admin-pw' },
    ]);
  });

  test('rejects when service-account rebind before group lookup fails', async () => {
    nextFixture = {
      bindResponses: [null, null, new Error('service rebind failed')],
      searchResponses: [
        {
          entries: [{ objectName: 'uid=alice,dc=test,dc=com', object: {} }],
          status: 0,
        },
      ],
    };

    await expect(ldapService.authenticateWithProfile('alice', 'pw')).rejects.toThrow(
      'service rebind failed',
    );
    expect(lastClientStats?.searchCalls).toHaveLength(1);
    expect(lastClientStats?.unbindCalls).toBe(1);
  });

  test('authenticateWithProfile can use a disabled saved config for diagnostics', async () => {
    ldapRepoGetMock.mockResolvedValue({ ...ENABLED_LDAP_CONFIG, enabled: false });
    nextFixture = {
      bindResponses: [null, null, null],
      searchResponses: [
        {
          entries: [{ objectName: 'uid=alice,dc=test,dc=com', object: { uid: 'alice' } }],
          status: 0,
        },
        { entries: [], status: 0 },
        { entries: [], status: 0 },
      ],
    };

    const result = await ldapService.authenticateWithProfile('alice', 'pw', {
      allowDisabledConfig: true,
    });

    expect(result.authenticated).toBe(true);
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(lastClientStats?.bindCalls).toEqual([
      { dn: 'cn=admin,dc=test,dc=com', password: 'admin-pw' },
      { dn: 'uid=alice,dc=test,dc=com', password: 'pw' },
      { dn: 'cn=admin,dc=test,dc=com', password: 'admin-pw' },
    ]);
  });

  test('search receives the parsed userFilter with the escaped username', async () => {
    nextFixture = {
      bindResponses: [null, null],
      searchResponses: [
        {
          entries: [{ objectName: 'uid=alice,dc=test,dc=com', object: {} }],
          status: 0,
        },
      ],
    };
    await ldapService.authenticate('alice', 'pw');
    const search = lastClientStats?.searchCalls[0];
    expect(search?.base).toBe('dc=test,dc=com');
    expect(search?.options.scope).toBe('sub');
    // The real parseFilter (preserved via snapshot) returns a Filter instance whose
    // `toString()` renders the canonical filter text.
    expect(String(search?.options.filter)).toBe('(uid=alice)');
  });

  test('invalid stored group filter does not block a valid LDAP bind', async () => {
    ldapRepoGetMock.mockResolvedValue({
      ...ENABLED_LDAP_CONFIG,
      groupFilter: '(member=uid=alice,dc=test,dc=com)',
    });
    nextFixture = {
      bindResponses: [null, null, null],
      searchResponses: [
        {
          entries: [{ objectName: 'uid=alice,dc=test,dc=com', object: {} }],
          status: 0,
        },
      ],
    };

    const result = await ldapService.authenticateWithProfile('alice', 'pw');

    expect(result.authenticated).toBe(true);
    expect(result.groups).toEqual([]);
    expect(result.matchedRoleIds).toEqual([]);
  });

  test('maps AD groups from the configured group search base and filter', async () => {
    const syncSecAdmins = 'CN=SyncSecAdmins,OU=Internal Groups,OU=Accounts,DC=syncsec,DC=coll';
    ldapRepoGetMock.mockResolvedValue({
      ...ENABLED_LDAP_CONFIG,
      baseDn: 'OU=Internal Accounts,OU=Accounts,DC=syncsec,DC=coll',
      groupBaseDn: 'OU=Internal Groups,OU=Accounts,DC=syncsec,DC=coll',
      groupFilter: '(member={0})',
      roleMappings: [{ ldapGroup: syncSecAdmins, role: 'admin' }],
    });
    nextFixture = {
      bindResponses: [null, null, null],
      searchResponses: [
        {
          entries: [
            {
              objectName: "CN=Daniel D'Angeli,OU=Internal Accounts,OU=Accounts,DC=syncsec,DC=coll",
              object: {
                sAMAccountName: 'daniel.dangeli',
                cn: "Daniel D'Angeli",
              },
            },
          ],
          status: 0,
        },
        {
          entries: [
            {
              objectName: syncSecAdmins,
              object: { cn: 'SyncSecAdmins', distinguishedName: syncSecAdmins },
            },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };

    const result = await ldapService.authenticateWithProfile('daniel.dangeli', 'pw');

    expect(result.authenticated).toBe(true);
    expect(result.groups).toContain(syncSecAdmins);
    expect(result.matchedRoleIds).toEqual(['admin']);
    expect(lastClientStats?.searchCalls[1]?.base).toBe(
      'OU=Internal Groups,OU=Accounts,DC=syncsec,DC=coll',
    );
    expect(String(lastClientStats?.searchCalls[1]?.options.filter)).toContain('(member=');
    expect(lastClientStats?.bindCalls).toEqual([
      { dn: 'cn=admin,dc=test,dc=com', password: 'admin-pw' },
      {
        dn: "CN=Daniel D'Angeli,OU=Internal Accounts,OU=Accounts,DC=syncsec,DC=coll",
        password: 'pw',
      },
      { dn: 'cn=admin,dc=test,dc=com', password: 'admin-pw' },
    ]);
  });

  test('keeps groups found before a later non-strict fallback search fails', async () => {
    const syncSecAdmins = 'CN=SyncSecAdmins,OU=Internal Groups,OU=Accounts,DC=syncsec,DC=coll';
    ldapRepoGetMock.mockResolvedValue({
      ...ENABLED_LDAP_CONFIG,
      groupFilter: '(member={0})',
      roleMappings: [{ ldapGroup: syncSecAdmins, role: 'admin' }],
    });
    nextFixture = {
      bindResponses: [null, null, null],
      searchResponses: [
        {
          entries: [
            {
              objectName: "CN=Daniel D'Angeli,OU=Internal Accounts,OU=Accounts,DC=syncsec,DC=coll",
              object: { sAMAccountName: 'daniel.dangeli' },
            },
          ],
          status: 0,
        },
        {
          entries: [{ objectName: syncSecAdmins, object: { distinguishedName: syncSecAdmins } }],
          status: 0,
        },
        { err: new Error('fallback group search failed') },
      ],
    };

    const result = await ldapService.authenticateWithProfile('daniel.dangeli', 'pw');

    expect(result.authenticated).toBe(true);
    expect(result.groups).toContain(syncSecAdmins);
    expect(result.matchedRoleIds).toEqual(['admin']);
  });

  test('rejects when the user-search stream emits an error (LDAP outage during search)', async () => {
    nextFixture = {
      bindResponses: [null],
      searchResponses: [{ errorEvent: new Error('connection reset') }],
    };
    await expect(ldapService.authenticateWithProfile('alice', 'pw')).rejects.toThrow(
      'connection reset',
    );
    expect(lastClientStats?.unbindCalls).toBe(1);
  });

  test('skips findUserGroups when user-bind fails (regression: avoid N+1 on wrong password)', async () => {
    nextFixture = {
      bindResponses: [null, new Error('invalid credentials')],
      searchResponses: [
        {
          entries: [{ objectName: 'uid=alice,dc=test,dc=com', object: { uid: 'alice' } }],
          status: 0,
        },
      ],
    };
    const result = await ldapService.authenticateWithProfile('alice', 'pw');
    expect(result.authenticated).toBe(false);
    // Only the user-lookup search runs; the group search must NOT have been issued.
    expect(lastClientStats?.searchCalls).toHaveLength(1);
  });
});

describe('findUserDn (direct, with config preloaded)', () => {
  beforeEach(() => {
    (ldapService as unknown as { config: unknown }).config = ENABLED_LDAP_CONFIG;
  });

  const buildClient = (response: SearchResponse) => {
    nextFixture = { searchResponses: [response] };
    return createClientMock({ url: ENABLED_LDAP_CONFIG.serverUrl, tlsOptions: {} });
  };

  test('requests canonical user attributes for username and display-name resolution', async () => {
    const client = buildClient({
      entries: [{ objectName: 'uid=alice,dc=test,dc=com', object: { uid: 'alice' } }],
      status: 0,
    });
    await ldapService.findUserDn(client as never, 'alice');
    const search = lastClientStats?.searchCalls[0];
    expect(search?.options.attributes).toEqual(['uid', 'sAMAccountName', 'cn', 'displayName']);
  });

  test('resolves to the last searchEntry.objectName when multiple entries fire (foundDn reassignment)', async () => {
    const client = buildClient({
      entries: [
        { objectName: 'uid=alice,dc=test,dc=com' },
        { objectName: 'uid=bob,dc=test,dc=com' },
      ],
      status: 0,
    });
    const dn = await ldapService.findUserDn(client as never, 'alice');
    expect(dn).toBe('uid=bob,dc=test,dc=com');
  });

  test('resolves to entry.objectName when a single searchEntry fires', async () => {
    const client = buildClient({
      entries: [{ objectName: 'uid=alice,dc=test,dc=com' }],
      status: 0,
    });
    const dn = await ldapService.findUserDn(client as never, 'alice');
    expect(dn).toBe('uid=alice,dc=test,dc=com');
  });

  test('resolves null when no searchEntry fires before end (status 0)', async () => {
    const client = buildClient({ entries: [], status: 0 });
    const dn = await ldapService.findUserDn(client as never, 'alice');
    expect(dn).toBeNull();
  });

  test('rejects when end fires with non-zero status', async () => {
    const client = buildClient({ entries: [], status: 32 });
    await expect(ldapService.findUserDn(client as never, 'alice')).rejects.toThrow(/status: 32/);
  });

  test('rejects when search callback returns err', async () => {
    const client = buildClient({ err: new Error('search blew up') });
    await expect(ldapService.findUserDn(client as never, 'alice')).rejects.toThrow(
      'search blew up',
    );
  });

  test('rejects when res.error event fires', async () => {
    const client = buildClient({
      entries: [],
      errorEvent: new Error('ldap protocol error'),
      status: 0,
    });
    await expect(ldapService.findUserDn(client as never, 'alice')).rejects.toThrow(
      'ldap protocol error',
    );
  });

  test('returns null when service config is unset', async () => {
    (ldapService as unknown as { config: unknown }).config = null;
    const dn = await ldapService.findUserDn({} as never, 'alice');
    expect(dn).toBeNull();
  });
});

describe('syncUsers', () => {
  test('returns { skipped: true, reason: "LDAP is disabled" } when getClient returns null', async () => {
    ldapRepoGetMock.mockResolvedValue({ ...ENABLED_LDAP_CONFIG, enabled: false });
    const result = await ldapService.syncUsers();
    expect(result).toEqual({ skipped: true, reason: 'LDAP is disabled' });
  });

  test('binds with service account and searches with buildUserSyncFilter (wildcard)', async () => {
    nextFixture = {
      bindResponses: [null],
      searchResponses: [{ entries: [], status: 0 }],
    };
    await ldapService.syncUsers();
    expect(lastClientStats?.bindCalls).toEqual([
      { dn: 'cn=admin,dc=test,dc=com', password: 'admin-pw' },
    ]);
    const search = lastClientStats?.searchCalls[0];
    expect(String(search?.options.filter)).toBe('(uid=*)');
    expect(search?.options.attributes).toEqual([
      'uid',
      'cn',
      'sn',
      'givenName',
      'mail',
      'displayName',
      'sAMAccountName',
    ]);
  });

  test('falls back to sAMAccountName when uid is missing (AD path)', async () => {
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [
            {
              objectName: 'cn=carol,dc=test,dc=com',
              object: { sAMAccountName: 'carol', cn: 'Carol' },
            },
          ],
          status: 0,
        },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);
    const result = await ldapService.syncUsers();
    expect(createUserMock).toHaveBeenCalledWith({
      id: 'u_test_id',
      name: 'Carol',
      username: 'carol',
      passwordHash: realUsersRepo.LDAP_PLACEHOLDER_PASSWORD_HASH,
      role: 'user',
      avatarInitials: 'CA',
      authMethod: 'ldap',
      authProviderId: null,
    });
    expect(result).toEqual({ synced: 0, created: 1 });
  });

  test('uses cn for name; falls back through displayName then username', async () => {
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [
            { objectName: 'uid=a,dc=x', object: { uid: 'a', cn: 'CN Name' } },
            { objectName: 'uid=b,dc=x', object: { uid: 'b', displayName: 'DN Name' } },
            { objectName: 'uid=c,dc=x', object: { uid: 'c' } },
          ],
          status: 0,
        },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);
    await ldapService.syncUsers();
    const names = createUserMock.mock.calls.map((call) => (call[0] as { name: string }).name);
    expect(names).toEqual(['CN Name', 'DN Name', 'c']);
  });

  test('matches an existing lowercase row when the directory returns mixed-case uid (#640)', async () => {
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [
            { objectName: 'uid=JDoe,dc=x', object: { uid: 'JDoe', cn: 'John Doe Updated' } },
          ],
          status: 0,
        },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockImplementation(async (username: string) =>
      username === 'jdoe' ? { ...LDAP_LOGIN_USER, id: 'u-jdoe', username: 'jdoe' } : null,
    );
    const result = await ldapService.syncUsers();
    expect(findLoginUserByNormalizedUsernameMock).toHaveBeenCalledWith('jdoe');
    // Updates the existing row (matched by lower-cased lookup) rather than creating a new one.
    expect(updateNameByUsernameMock).toHaveBeenCalledWith('jdoe', 'John Doe Updated');
    expect(createUserMock).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 1, created: 0 });

    // OpenLDAP's caseExactIA5Match memberUid attribute requires the directory-spelling
    // value, so we pass both the lowercased canonical and the raw uid to the group filter.
    const groupSearches = (lastClientStats?.searchCalls ?? []).filter(
      (c) => c.base === 'ou=groups,dc=test,dc=com',
    );
    const groupFilterTexts = groupSearches.map((c) => String(c.options.filter));
    expect(groupFilterTexts.some((f) => f.includes('member=jdoe'))).toBe(true);
    expect(groupFilterTexts.some((f) => f.includes('member=JDoe'))).toBe(true);
  });

  test('flattens single-element arrays for uid and name attributes', async () => {
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [{ objectName: 'uid=a,dc=x', object: { uid: ['flat-uid'], cn: ['Flat CN'] } }],
          status: 0,
        },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);
    await ldapService.syncUsers();
    const created = createUserMock.mock.calls[0]?.[0] as {
      username: string;
      name: string;
    };
    expect(created.username).toBe('flat-uid');
    expect(created.name).toBe('Flat CN');
  });

  test('updates existing user via updateNameByUsername instead of creating', async () => {
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [{ objectName: 'uid=alice,dc=x', object: { uid: 'alice', cn: 'Alice New' } }],
          status: 0,
        },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(LDAP_LOGIN_USER);
    const result = await ldapService.syncUsers();
    expect(updateNameByUsernameMock).toHaveBeenCalledWith('alice', 'Alice New');
    expect(createUserMock).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 1, created: 0 });
  });

  test('sync applies role mappings from the configured group search', async () => {
    const syncSecAdmins = 'CN=SyncSecAdmins,OU=Internal Groups,OU=Accounts,DC=syncsec,DC=coll';
    ldapRepoGetMock.mockResolvedValue({
      ...ENABLED_LDAP_CONFIG,
      groupFilter: '(member={0})',
      roleMappings: [{ ldapGroup: syncSecAdmins, role: 'admin' }],
    });
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [
            {
              objectName: "CN=Daniel D'Angeli,OU=Internal Accounts,OU=Accounts,DC=syncsec,DC=coll",
              object: {
                sAMAccountName: 'daniel.dangeli',
                cn: "Daniel D'Angeli",
              },
            },
          ],
          status: 0,
        },
        {
          entries: [
            {
              objectName: syncSecAdmins,
              object: { cn: 'SyncSecAdmins', distinguishedName: syncSecAdmins },
            },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({
      ...LDAP_LOGIN_USER,
      username: 'daniel.dangeli',
    });
    applyExternalRolesForUserIfMatchedMock.mockResolvedValue({ applied: true, roleIds: ['admin'] });

    const result = await ldapService.syncUsers();

    expect(result).toEqual({ synced: 1, created: 0 });
    expect(applyExternalRolesForUserIfMatchedMock).toHaveBeenCalledWith(
      LDAP_LOGIN_USER.id,
      expect.arrayContaining([syncSecAdmins]),
      [{ externalGroup: syncSecAdmins, role: 'admin' }],
    );
  });

  test('autoProvisionAll=false: existing users update, new entries are NOT created', async () => {
    ldapRepoGetMock.mockResolvedValue({ ...ENABLED_LDAP_CONFIG, autoProvisionAll: false });
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [
            { objectName: 'uid=alice,dc=x', object: { uid: 'alice', cn: 'Alice New' } },
            { objectName: 'uid=newcomer,dc=x', object: { uid: 'newcomer', cn: 'New Comer' } },
          ],
          status: 0,
        },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockImplementation(async (username: string) =>
      username === 'alice' ? LDAP_LOGIN_USER : null,
    );
    const result = await ldapService.syncUsers();
    expect(updateNameByUsernameMock).toHaveBeenCalledWith('alice', 'Alice New');
    expect(createUserMock).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 1, created: 0 });
  });

  test('does not mutate an existing app user until it is bound to LDAP', async () => {
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [{ objectName: 'uid=alice,dc=x', object: { uid: 'alice', cn: 'Alice LDAP' } }],
          status: 0,
        },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({
      ...LDAP_LOGIN_USER,
      authMethod: 'local',
      passwordHash: '$2a$local',
    });

    const result = await ldapService.syncUsers();

    expect(updateNameByUsernameMock).not.toHaveBeenCalled();
    expect(applyExternalRolesForUserMock).not.toHaveBeenCalled();
    expect(createUserMock).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 0, created: 0 });
  });

  test('does not mutate an existing non-app user with a matching LDAP username', async () => {
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [{ objectName: 'uid=alice,dc=x', object: { uid: 'alice', cn: 'Alice LDAP' } }],
          status: 0,
        },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({
      ...LDAP_LOGIN_USER,
      employeeType: 'internal',
    });

    const result = await ldapService.syncUsers();

    expect(updateNameByUsernameMock).not.toHaveBeenCalled();
    expect(applyExternalRolesForUserMock).not.toHaveBeenCalled();
    expect(createUserMock).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 0, created: 0 });
  });

  test('skips entries without a username (no uid and no sAMAccountName)', async () => {
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [
            { objectName: 'cn=stub,dc=x', object: { cn: 'No Username Here' } },
            { objectName: 'uid=ok,dc=x', object: { uid: 'ok', cn: 'Ok' } },
          ],
          status: 0,
        },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);
    const result = await ldapService.syncUsers();
    expect(result).toEqual({ synced: 0, created: 1 });
    expect(createUserMock).toHaveBeenCalledTimes(1);
  });

  test('rethrows on outer error after unbind', async () => {
    nextFixture = { bindResponses: [new Error('bind failed in sync')] };
    await expect(ldapService.syncUsers()).rejects.toThrow('bind failed in sync');
    expect(lastClientStats?.unbindCalls).toBe(1);
  });

  test('rejects when the search stream emits an error (no silent partial sync)', async () => {
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [{ objectName: 'uid=alice,dc=x', object: { uid: 'alice', cn: 'Alice' } }],
          errorEvent: new Error('search aborted by server'),
          status: 0,
        },
      ],
    };
    await expect(ldapService.syncUsers()).rejects.toThrow('search aborted by server');
    expect(lastClientStats?.unbindCalls).toBe(1);
    expect(createUserMock).not.toHaveBeenCalled();
    expect(updateNameByUsernameMock).not.toHaveBeenCalled();
  });

  test('rejects when search end yields a non-zero status', async () => {
    nextFixture = {
      bindResponses: [null],
      searchResponses: [{ entries: [], status: 1 }],
    };
    await expect(ldapService.syncUsers()).rejects.toThrow('LDAP search failed status: 1');
    expect(lastClientStats?.unbindCalls).toBe(1);
  });
});

describe('lookupUserGroups', () => {
  test('returns null when LDAP is disabled', async () => {
    ldapRepoGetMock.mockResolvedValue({ ...ENABLED_LDAP_CONFIG, enabled: false });
    const result = await ldapService.lookupUserGroups('alice');
    expect(result).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  test('returns null and logs when service-account bind fails; unbind still called', async () => {
    nextFixture = { bindResponses: [new Error('bad bind')] };
    const result = await ldapService.lookupUserGroups('alice');
    expect(result).toBeNull();
    expect(lastClientStats?.unbindCalls).toBe(1);
  });

  test('returns null when findUserDn yields no entries; unbind still called', async () => {
    nextFixture = {
      bindResponses: [null],
      searchResponses: [{ entries: [], status: 0 }],
    };
    const result = await ldapService.lookupUserGroups('alice');
    expect(result).toBeNull();
    expect(lastClientStats?.unbindCalls).toBe(1);
  });

  test('returns groups and roleMappings on happy path; binds service account only', async () => {
    ldapRepoGetMock.mockResolvedValue({
      ...ENABLED_LDAP_CONFIG,
      roleMappings: [{ ldapGroup: 'managers', role: 'manager' }],
    });
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [{ objectName: 'uid=alice,dc=test,dc=com', object: {} }],
          status: 0,
        },
        {
          entries: [
            {
              objectName: 'cn=managers,ou=groups,dc=test,dc=com',
              object: { cn: 'managers' },
            },
          ],
          status: 0,
        },
      ],
    };
    const result = await ldapService.lookupUserGroups('alice');
    expect(result).not.toBeNull();
    expect(result?.groups).toContain('cn=managers,ou=groups,dc=test,dc=com');
    expect(result?.groups).toContain('managers');
    expect(result?.roleMappings).toEqual([{ externalGroup: 'managers', role: 'manager' }]);
    expect(lastClientStats?.bindCalls).toEqual([
      { dn: 'cn=admin,dc=test,dc=com', password: 'admin-pw' },
    ]);
    expect(lastClientStats?.unbindCalls).toBe(1);
  });

  test('returns groups from the configured group search', async () => {
    const syncSecAdmins = 'CN=SyncSecAdmins,OU=Internal Groups,OU=Accounts,DC=syncsec,DC=coll';
    ldapRepoGetMock.mockResolvedValue({
      ...ENABLED_LDAP_CONFIG,
      groupFilter: '(member={0})',
      roleMappings: [{ ldapGroup: syncSecAdmins, role: 'admin' }],
    });
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [
            {
              objectName: "CN=Daniel D'Angeli,OU=Internal Accounts,OU=Accounts,DC=syncsec,DC=coll",
              object: { sAMAccountName: 'daniel.dangeli' },
            },
          ],
          status: 0,
        },
        {
          entries: [
            {
              objectName: syncSecAdmins,
              object: { cn: 'SyncSecAdmins', distinguishedName: syncSecAdmins },
            },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };

    const result = await ldapService.lookupUserGroups('daniel.dangeli');

    expect(result?.groups).toContain(syncSecAdmins);
    expect(result?.roleMappings).toEqual([{ externalGroup: syncSecAdmins, role: 'admin' }]);
    expect(lastClientStats?.bindCalls).toEqual([
      { dn: 'cn=admin,dc=test,dc=com', password: 'admin-pw' },
    ]);
  });

  test('returns null when group lookup throws; unbind still called', async () => {
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [{ objectName: 'uid=alice,dc=test,dc=com', object: {} }],
          status: 0,
        },
        { err: new Error('group search failed') },
      ],
    };
    const result = await ldapService.lookupUserGroups('alice');
    // Transient group-search failure must surface as null so the caller keeps the
    // existing role, instead of demoting the user to the default 'user' role on an
    // empty group list.
    expect(result).toBeNull();
    expect(lastClientStats?.unbindCalls).toBe(1);
  });

  test('returns null on fallback group-search errors in strict lookup mode', async () => {
    const syncSecAdmins = 'CN=SyncSecAdmins,OU=Internal Groups,OU=Accounts,DC=syncsec,DC=coll';
    ldapRepoGetMock.mockResolvedValue({
      ...ENABLED_LDAP_CONFIG,
      groupFilter: '(member={0})',
    });
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [
            {
              objectName: "CN=Daniel D'Angeli,OU=Internal Accounts,OU=Accounts,DC=syncsec,DC=coll",
              object: { sAMAccountName: 'daniel.dangeli' },
            },
          ],
          status: 0,
        },
        {
          entries: [{ objectName: syncSecAdmins, object: { distinguishedName: syncSecAdmins } }],
          status: 0,
        },
        { err: new Error('fallback group search failed') },
      ],
    };

    const result = await ldapService.lookupUserGroups('daniel.dangeli');

    expect(result).toBeNull();
    expect(lastClientStats?.unbindCalls).toBe(1);
  });
});

describe('authenticateAndProvision', () => {
  test('returns { authenticated: false } when LDAP rejects user credentials', async () => {
    // user-bind fails → authenticateWithProfile returns { authenticated: false } (wrong password)
    nextFixture = {
      bindResponses: [null, new Error('invalid credentials')],
      searchResponses: [
        {
          entries: [{ objectName: 'uid=alice,dc=test,dc=com', object: { uid: 'alice' } }],
          status: 0,
        },
      ],
    };
    const result = await ldapService.authenticateAndProvision('alice', 'pw');
    expect(result).toEqual({ authenticated: false });
    expect(createUserMock).not.toHaveBeenCalled();
  });

  test('rejects when LDAP service-account bind fails (system error, not wrong password)', async () => {
    nextFixture = { bindResponses: [new Error('bad creds')] };
    await expect(ldapService.authenticateAndProvision('alice', 'pw')).rejects.toThrow('bad creds');
    expect(createUserMock).not.toHaveBeenCalled();
  });

  test('creates a new app_user using the canonical uid (not the typed alias)', async () => {
    nextFixture = {
      bindResponses: [null, null],
      searchResponses: [
        {
          entries: [
            {
              objectName: 'uid=alice,dc=test,dc=com',
              object: { uid: 'alice', cn: 'Alice Real' },
            },
          ],
          status: 0,
        },
        // group search returns nothing
        { entries: [], status: 0 },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);

    const result = await ldapService.authenticateAndProvision('ALICE@example.com', 'pw');

    expect(result).toEqual({
      authenticated: true,
      userId: 'u_test_id',
      created: true,
      canonicalUsername: 'alice',
    });
    expect(createUserMock).toHaveBeenCalledWith({
      id: 'u_test_id',
      name: 'Alice Real',
      username: 'alice',
      passwordHash: realUsersRepo.EXTERNAL_PLACEHOLDER_PASSWORD_HASH,
      role: 'user',
      avatarInitials: 'AL',
      authMethod: 'ldap',
      authProviderId: null,
    });
    expect(applyExternalRolesForUserMock).toHaveBeenCalledWith('u_test_id', [], []);
  });

  test('falls back to sAMAccountName when uid is missing (AD)', async () => {
    nextFixture = {
      bindResponses: [null, null],
      searchResponses: [
        {
          entries: [
            {
              objectName: 'cn=carol,dc=test,dc=com',
              object: { sAMAccountName: 'carol', cn: 'Carol' },
            },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);

    const result = await ldapService.authenticateAndProvision('CAROL', 'pw');
    expect(result.canonicalUsername).toBe('carol');
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'carol', name: 'Carol' }),
    );
  });

  test('lowercases the canonical username before lookup and create (#640)', async () => {
    nextFixture = {
      bindResponses: [null, null],
      searchResponses: [
        {
          entries: [
            {
              objectName: 'cn=JDoe,dc=test,dc=com',
              object: { sAMAccountName: 'JDoe', cn: 'John Doe' },
            },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);

    const result = await ldapService.authenticateAndProvision('JDOE@corp.example', 'pw');

    expect(result.canonicalUsername).toBe('jdoe');
    expect(findLoginUserByNormalizedUsernameMock).toHaveBeenCalledWith('jdoe');
    expect(createUserMock).toHaveBeenCalledWith(expect.objectContaining({ username: 'jdoe' }));
  });

  test('reuses an existing LDAP-bound user under the canonical username (no creation)', async () => {
    nextFixture = {
      bindResponses: [null, null],
      searchResponses: [
        {
          entries: [
            { objectName: 'uid=alice,dc=test,dc=com', object: { uid: 'alice', cn: 'Alice' } },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(LDAP_LOGIN_USER);

    const result = await ldapService.authenticateAndProvision('alice@example.com', 'pw');

    expect(result).toEqual({
      authenticated: true,
      userId: LDAP_LOGIN_USER.id,
      created: false,
      canonicalUsername: 'alice',
    });
    expect(createUserMock).not.toHaveBeenCalled();
    expect(applyExternalRolesForUserIfMatchedMock).toHaveBeenCalledWith(LDAP_LOGIN_USER.id, [], []);
    // applyExternalRolesForUser is reserved for new-user-creation paths; existing users use the
    // IfMatched variant to preserve admin-assigned roles when LDAP groups don't map.
    expect(applyExternalRolesForUserMock).not.toHaveBeenCalled();
  });

  test('existing-user login with no matching group preserves current role (regression #318)', async () => {
    nextFixture = {
      bindResponses: [null, null],
      searchResponses: [
        {
          entries: [
            { objectName: 'uid=alice,dc=test,dc=com', object: { uid: 'alice', cn: 'Alice' } },
          ],
          status: 0,
        },
        // groupBaseDn search returns a group that doesn't map to any configured role.
        {
          entries: [{ objectName: 'cn=randoms,ou=groups,dc=test,dc=com', object: {} }],
          status: 0,
        },
      ],
    };
    // Default mock returns { applied: false } — simulating "no LDAP group matched a mapping".
    // Admin has assigned 'manager' to this LDAP user.
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({
      ...LDAP_LOGIN_USER,
      role: 'manager',
    });

    const result = await ldapService.authenticateAndProvision('alice', 'pw');

    expect(result).toEqual({
      authenticated: true,
      userId: LDAP_LOGIN_USER.id,
      created: false,
      canonicalUsername: 'alice',
    });
    expect(applyExternalRolesForUserIfMatchedMock).toHaveBeenCalledWith(
      LDAP_LOGIN_USER.id,
      ['cn=randoms,ou=groups,dc=test,dc=com'],
      [],
    );
  });

  test('refuses to bind LDAP login to an existing non-LDAP local user', async () => {
    nextFixture = {
      bindResponses: [null, null],
      searchResponses: [
        {
          entries: [
            { objectName: 'uid=alice,dc=test,dc=com', object: { uid: 'alice', cn: 'Alice' } },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({
      ...LDAP_LOGIN_USER,
      authMethod: 'local' as const,
    });

    const result = await ldapService.authenticateAndProvision('alice', 'pw');
    expect(result).toEqual({ authenticated: false });
    expect(createUserMock).not.toHaveBeenCalled();
    expect(applyExternalRolesForUserMock).not.toHaveBeenCalled();
  });

  test('races on unique constraint: re-fetches by canonical username after createUser throws 23505', async () => {
    nextFixture = {
      bindResponses: [null, null],
      searchResponses: [
        {
          entries: [
            { objectName: 'uid=alice,dc=test,dc=com', object: { uid: 'alice', cn: 'Alice' } },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };
    // First lookup: nothing (we'll try to create); second lookup (after race): the raced row
    findLoginUserByNormalizedUsernameMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(LDAP_LOGIN_USER);
    const uniqueErr = Object.assign(new Error('duplicate key'), { code: '23505' });
    createUserMock.mockRejectedValueOnce(uniqueErr);

    const result = await ldapService.authenticateAndProvision('alice', 'pw');

    expect(result).toEqual({
      authenticated: true,
      userId: LDAP_LOGIN_USER.id,
      created: false,
      canonicalUsername: 'alice',
    });
  });

  test('uses displayName when cn is absent', async () => {
    nextFixture = {
      bindResponses: [null, null],
      searchResponses: [
        {
          entries: [
            {
              objectName: 'uid=dave,dc=test,dc=com',
              object: { uid: 'dave', displayName: 'Dave Display' },
            },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);
    await ldapService.authenticateAndProvision('dave', 'pw');
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Dave Display', username: 'dave' }),
    );
  });

  test('searches groups using the canonical uid in addition to the typed alias', async () => {
    nextFixture = {
      bindResponses: [null, null],
      searchResponses: [
        {
          entries: [
            { objectName: 'uid=alice,dc=test,dc=com', object: { uid: 'alice', cn: 'Alice' } },
          ],
          status: 0,
        },
        { entries: [], status: 0 }, // group search by userDn
        { entries: [], status: 0 }, // group search by canonical
        { entries: [], status: 0 }, // group search by typed alias
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);

    await ldapService.authenticateAndProvision('ALICE@example.com', 'pw');

    const groupFilterTexts = (lastClientStats?.searchCalls ?? [])
      .filter((c) => c.base === 'ou=groups,dc=test,dc=com')
      .map((c) => String(c.options.filter));
    // Must include a search keyed on the canonical uid so configs like memberUid={0}
    // resolve groups even when the user typed an email/UPN alias.
    expect(groupFilterTexts.some((f) => f.includes('uid=alice,dc=test,dc=com'))).toBe(true);
    expect(groupFilterTexts.some((f) => f.includes('member=alice') && !f.includes('@'))).toBe(true);
  });

  test('filters role IDs against existing roles before createUser to avoid FK violation', async () => {
    ldapRepoGetMock.mockResolvedValue({
      ...ENABLED_LDAP_CONFIG,
      roleMappings: [
        { ldapGroup: 'deleted-role-group', role: 'role-deleted-12345' },
        { ldapGroup: 'managers', role: 'manager' },
      ],
    });
    nextFixture = {
      bindResponses: [null, null],
      searchResponses: [
        {
          entries: [{ objectName: 'uid=eve,dc=test,dc=com', object: { uid: 'eve', cn: 'Eve' } }],
          status: 0,
        },
        {
          entries: [
            {
              objectName: 'cn=deleted-role-group,dc=test,dc=com',
              object: { cn: 'deleted-role-group' },
            },
          ],
          status: 0,
        },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);
    // Simulate the deleted role being filtered out; only 'role-deleted-12345' would map.
    filterExistingRoleIdsMock.mockResolvedValueOnce(['user']);

    await ldapService.authenticateAndProvision('eve', 'pw');

    // filterExistingRoleIds must be called with the unfiltered mapped IDs before createUser fires
    expect(filterExistingRoleIdsMock).toHaveBeenCalledWith(['role-deleted-12345']);
    expect(createUserMock).toHaveBeenCalledWith(expect.objectContaining({ role: 'user' }));
  });
});
