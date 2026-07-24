import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import realLdap from 'ldapjs';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realLdapRepo from '../../repositories/ldapRepo.ts';
import * as realSettingsRepo from '../../repositories/settingsRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realExternalAuth from '../../services/external-auth.ts';
import ldapService from '../../services/ldap.ts';
import * as realInitials from '../../utils/initials.ts';
import * as realLogger from '../../utils/logger.ts';
import * as realOrderIds from '../../utils/order-ids.ts';
import { TX_SENTINEL } from '../helpers/txSentinel.ts';
import { makeWithDbTransactionMock } from '../helpers/withDbTransactionMock.ts';

// Snapshot real exports BEFORE the beforeAll fires (mock.module inside beforeAll is not hoisted).
const ldapjsSnapshot = realLdap;
const drizzleSnapshot = { ...realDrizzle };
const ldapRepoSnapshot = { ...realLdapRepo };
const settingsRepoSnapshot = { ...realSettingsRepo };
const usersRepoSnapshot = { ...realUsersRepo };
const externalAuthSnapshot = { ...realExternalAuth };
const initialsSnapshot = { ...realInitials };
const loggerSnapshot = { ...realLogger };
const orderIdsSnapshot = { ...realOrderIds };

const ldapRepoGetMock = mock();
const findLoginUserByNormalizedUsernameMock = mock();
const updateNameByUsernameMock = mock();
const updateDirectoryProfileMock = mock();
const settingsUpsertForUserMock = mock();
const createUserMock = mock();
const addUserRoleMock = mock();
const applyExternalRolesForUserMock = mock();
const applyExternalRolesForUserIfMatchedMock = mock();
const externalGroupsYieldNoKnownRoleMock = mock();
const filterExistingRoleIdsMock = mock();
const { withDbTransactionMock, resetWithDbTransactionMock } = makeWithDbTransactionMock();

// ─── ldapjs harness ───────────────────────────────────────────────────────────
type SearchResponse = {
  err?: Error;
  entries?: {
    objectName: string;
    object?: Record<string, unknown>;
    attributes?: Array<{ type: string; values: string[] }>;
  }[];
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
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnapshot,
    withDbTransaction: withDbTransactionMock,
  }));
  mock.module('../../repositories/settingsRepo.ts', () => ({
    ...settingsRepoSnapshot,
    upsertForUser: settingsUpsertForUserMock,
  }));
  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnapshot,
    findLoginUserByNormalizedUsername: findLoginUserByNormalizedUsernameMock,
    updateNameByUsername: updateNameByUsernameMock,
    updateDirectoryProfile: updateDirectoryProfileMock,
    createUser: createUserMock,
    addUserRole: addUserRoleMock,
  }));
  mock.module('../../services/external-auth.ts', () => ({
    ...externalAuthSnapshot,
    applyExternalRolesForUser: applyExternalRolesForUserMock,
    applyExternalRolesForUserIfMatched: applyExternalRolesForUserIfMatchedMock,
    externalGroupsYieldNoKnownRole: externalGroupsYieldNoKnownRoleMock,
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
  mock.module('../../db/drizzle.ts', () => drizzleSnapshot);
  mock.module('../../repositories/ldapRepo.ts', () => ldapRepoSnapshot);
  mock.module('../../repositories/settingsRepo.ts', () => settingsRepoSnapshot);
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
  resetWithDbTransactionMock();
  findLoginUserByNormalizedUsernameMock.mockReset();
  updateNameByUsernameMock.mockReset();
  updateDirectoryProfileMock.mockReset();
  settingsUpsertForUserMock.mockReset();
  createUserMock.mockReset();
  addUserRoleMock.mockReset();
  applyExternalRolesForUserMock.mockReset();
  applyExternalRolesForUserIfMatchedMock.mockReset();
  externalGroupsYieldNoKnownRoleMock.mockReset();
  filterExistingRoleIdsMock.mockReset();
  // Default: groups yield a known role (no warn fires). Tests exercising the
  // "no matching mapping" or "deleted role" diagnostic override with mockResolvedValue(true).
  externalGroupsYieldNoKnownRoleMock.mockResolvedValue(false);
  filterExistingRoleIdsMock.mockImplementation(async (ids: string[]) =>
    ids.length > 0 ? ids : ['user'],
  );
  createClientMock.mockClear();

  ldapRepoGetMock.mockResolvedValue(ENABLED_LDAP_CONFIG);
  applyExternalRolesForUserMock.mockResolvedValue(['user']);
  applyExternalRolesForUserIfMatchedMock.mockResolvedValue({ applied: false, roleIds: [] });
  addUserRoleMock.mockResolvedValue(undefined);
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

  describe('TLS audit warning', () => {
    // ldap.ts's module-level `logger` is a pino child of `loggerSnapshot.logger` (the real
    // root, captured before mock.module replaces the export). Pino children inherit `warn`
    // from the root via the prototype chain, so spying on root.warn intercepts the child.
    let warnSpy: ReturnType<typeof spyOn<typeof loggerSnapshot.logger, 'warn'>>;
    beforeEach(() => {
      warnSpy = spyOn(loggerSnapshot.logger, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    test('LDAP_REJECT_UNAUTHORIZED="false" emits an audit warning about MITM exposure', async () => {
      process.env.LDAP_REJECT_UNAUTHORIZED = 'false';
      await ldapService.getClient();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/LDAP_REJECT_UNAUTHORIZED=false.*MITM/),
      );
    });

    test('default rejectUnauthorized=true does NOT emit the MITM warning', async () => {
      await ldapService.getClient();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    test('warning re-fires on every getClient() call (no stale-cache squelching)', async () => {
      // Audit signal must be loud — every connection attempt logs, so operators see it in
      // periodic sync runs and not only on first boot.
      process.env.LDAP_REJECT_UNAUTHORIZED = 'false';
      await ldapService.getClient();
      await ldapService.getClient();
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });
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

  test('rejects LDAP_TLS_CERT_FILE without LDAP_TLS_KEY_FILE', async () => {
    process.env.LDAP_TLS_CERT_FILE = import.meta.path;

    await expect(ldapService.getClient()).rejects.toThrow(
      'LDAP_TLS_CERT_FILE and LDAP_TLS_KEY_FILE must be set together',
    );
    expect(createClientMock).not.toHaveBeenCalled();
  });

  test('rejects LDAP_TLS_KEY_FILE without LDAP_TLS_CERT_FILE', async () => {
    process.env.LDAP_TLS_KEY_FILE = import.meta.path;

    await expect(ldapService.getClient()).rejects.toThrow(
      'LDAP_TLS_CERT_FILE and LDAP_TLS_KEY_FILE must be set together',
    );
    expect(createClientMock).not.toHaveBeenCalled();
  });

  test('rejects missing LDAP_TLS_CERT_FILE when mTLS env vars are paired', async () => {
    process.env.LDAP_TLS_CERT_FILE = '/path/that/does/not/exist/cert.pem';
    process.env.LDAP_TLS_KEY_FILE = import.meta.path;

    await expect(ldapService.getClient()).rejects.toThrow(
      'LDAP_TLS_CERT_FILE points to a file that does not exist',
    );
    expect(createClientMock).not.toHaveBeenCalled();
  });

  test('rejects missing LDAP_TLS_KEY_FILE when mTLS env vars are paired', async () => {
    process.env.LDAP_TLS_CERT_FILE = import.meta.path;
    process.env.LDAP_TLS_KEY_FILE = '/path/that/does/not/exist/key.pem';

    await expect(ldapService.getClient()).rejects.toThrow(
      'LDAP_TLS_KEY_FILE points to a file that does not exist',
    );
    expect(createClientMock).not.toHaveBeenCalled();
  });

  test('attaches cert and key buffers when LDAP mTLS env files are paired and readable', async () => {
    process.env.LDAP_TLS_CERT_FILE = import.meta.path;
    process.env.LDAP_TLS_KEY_FILE = import.meta.path;

    await ldapService.getClient();

    const opts = createClientMock.mock.calls[0]?.[0] as {
      tlsOptions: { cert?: Buffer; key?: Buffer };
    };
    expect(opts.tlsOptions.cert).toBeInstanceOf(Buffer);
    expect(opts.tlsOptions.key).toBeInstanceOf(Buffer);
    expect((opts.tlsOptions.cert as Buffer).length).toBeGreaterThan(0);
    expect((opts.tlsOptions.key as Buffer).length).toBeGreaterThan(0);
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

  test('returns false when findUserEntry yields null (no entries before end)', async () => {
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

  test('rejects ambiguous user lookup before binding as a matched user', async () => {
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [
            { objectName: 'uid=alice,ou=people,dc=test,dc=com', object: { uid: 'alice' } },
            { objectName: 'uid=alice,ou=admins,dc=test,dc=com', object: { uid: 'alice' } },
          ],
          status: 0,
        },
      ],
    };

    await expect(ldapService.authenticateWithProfile('alice', 'pw')).rejects.toThrow(/ambiguous/);
    expect(lastClientStats?.bindCalls).toEqual([
      { dn: 'cn=admin,dc=test,dc=com', password: 'admin-pw' },
    ]);
    expect(lastClientStats?.searchCalls).toHaveLength(1);
    expect(lastClientStats?.unbindCalls).toBe(1);
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

  test('rejects when stored group filter is invalid (no silent default-role demote)', async () => {
    // Strict-mode findUserGroups (post-#637) surfaces the build-filter error so the
    // /login route returns 503. The alternative — auth-with-empty-groups — would
    // silently create new admins as 'user' until the operator notices the bad config.
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

    await expect(ldapService.authenticateWithProfile('alice', 'pw')).rejects.toThrow(/groupFilter/);
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

  test('returns provider email from LDAP mail attributes without requiring it', async () => {
    nextFixture = {
      bindResponses: [null, null, null],
      searchResponses: [
        {
          entries: [
            {
              objectName: 'uid=alice,dc=test,dc=com',
              object: { uid: 'alice', cn: 'Alice Provider', mail: 'alice@example.com' },
            },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };

    const result = await ldapService.authenticateWithProfile('alice', 'pw');

    expect(result.authenticated).toBe(true);
    expect(result.displayName).toBe('Alice Provider');
    expect(result.email).toBe('alice@example.com');
    expect(lastClientStats?.searchCalls[0]?.options).toEqual(
      expect.objectContaining({ attributes: expect.arrayContaining(['mail']) }),
    );
  });

  test('does not treat the typed alias as canonical when LDAP omits canonical attributes', async () => {
    nextFixture = {
      bindResponses: [null, null, null],
      searchResponses: [
        {
          entries: [
            {
              objectName: 'cn=attacker,dc=test,dc=com',
              object: { cn: 'Attacker', mail: 'victim' },
            },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
        { entries: [], status: 0 },
      ],
    };

    const result = await ldapService.authenticateWithProfile('victim', 'attacker-password');

    expect(result.authenticated).toBe(true);
    expect(result.canonicalUsername).toBeUndefined();
  });

  test('rejects when any parallel group search fails (strict auth path, #637)', async () => {
    // Auth uses strict findUserGroups so a transient subtree failure surfaces as a 503
    // instead of returning [] and demoting new admins to the default role.
    ldapRepoGetMock.mockResolvedValue({
      ...ENABLED_LDAP_CONFIG,
      groupFilter: '(member={0})',
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
        { err: new Error('first group search failed') },
        { err: new Error('second group search failed') },
      ],
    };

    await expect(ldapService.authenticateWithProfile('daniel.dangeli', 'pw')).rejects.toThrow(
      /group search failed/,
    );
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

describe('attribute mapping (name / surname / email)', () => {
  test('composes display name from default givenName + sn and returns first/last/email', async () => {
    nextFixture = {
      bindResponses: [null, null, null],
      searchResponses: [
        {
          entries: [
            {
              objectName: 'uid=alice,dc=test,dc=com',
              object: {
                uid: 'alice',
                givenName: 'Alice',
                sn: 'Smith',
                cn: 'Alice the Admin',
                mail: 'alice@example.com',
              },
            },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };

    const result = await ldapService.authenticateWithProfile('alice', 'pw');

    expect(result.authenticated).toBe(true);
    expect(result.firstName).toBe('Alice');
    expect(result.lastName).toBe('Smith');
    expect(result.email).toBe('alice@example.com');
    // Structured first+last composition wins over cn for the display name.
    expect(result.displayName).toBe('Alice Smith');
  });

  test('honors custom configured attributes for first name, surname, and email', async () => {
    ldapRepoGetMock.mockResolvedValue({
      ...ENABLED_LDAP_CONFIG,
      firstNameAttribute: 'preferredName',
      lastNameAttribute: 'familyName',
      emailAttribute: 'userPrincipalName',
    });
    nextFixture = {
      bindResponses: [null, null, null],
      searchResponses: [
        {
          entries: [
            {
              objectName: 'uid=bob,dc=test,dc=com',
              object: {
                uid: 'bob',
                preferredName: 'Bobby',
                familyName: 'Jones',
                userPrincipalName: 'bob@corp.example',
                // Conventional attributes present but must be ignored in favor of the config.
                givenName: 'Robert',
                sn: 'WrongSurname',
                mail: 'wrong@example.com',
              },
            },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };

    const result = await ldapService.authenticateWithProfile('bob', 'pw');

    expect(result.firstName).toBe('Bobby');
    expect(result.lastName).toBe('Jones');
    expect(result.email).toBe('bob@corp.example');
    expect(result.displayName).toBe('Bobby Jones');
    // The configured attributes are requested from the directory.
    expect(lastClientStats?.searchCalls[0]?.options.attributes).toEqual(
      expect.arrayContaining(['preferredName', 'familyName', 'userPrincipalName']),
    );
  });

  test('falls back to cn for the display name when first/last attributes are absent', async () => {
    nextFixture = {
      bindResponses: [null, null, null],
      searchResponses: [
        {
          entries: [
            {
              objectName: 'uid=carol,dc=test,dc=com',
              object: { uid: 'carol', cn: 'Carol Common' },
            },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };

    const result = await ldapService.authenticateWithProfile('carol', 'pw');

    expect(result.firstName).toBeUndefined();
    expect(result.lastName).toBeUndefined();
    expect(result.displayName).toBe('Carol Common');
  });

  test('configured email attribute falls back to mail when the custom attribute is empty', async () => {
    ldapRepoGetMock.mockResolvedValue({
      ...ENABLED_LDAP_CONFIG,
      emailAttribute: 'userPrincipalName',
    });
    nextFixture = {
      bindResponses: [null, null, null],
      searchResponses: [
        {
          entries: [
            {
              objectName: 'uid=dan,dc=test,dc=com',
              object: { uid: 'dan', cn: 'Dan', mail: 'dan@example.com' },
            },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };

    const result = await ldapService.authenticateWithProfile('dan', 'pw');
    expect(result.email).toBe('dan@example.com');
  });

  test('provisioning persists resolved first and last name on the new user', async () => {
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);
    nextFixture = {
      bindResponses: [null, null, null],
      searchResponses: [
        {
          entries: [
            {
              objectName: 'uid=erin,dc=test,dc=com',
              object: { uid: 'erin', givenName: 'Erin', sn: 'Stone', mail: 'erin@example.com' },
            },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
        { entries: [], status: 0 },
      ],
    };

    const result = await ldapService.authenticateAndProvision('erin', 'pw');

    expect(result).toMatchObject({ authenticated: true, created: true });
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Erin Stone', firstName: 'Erin', lastName: 'Stone' }),
      TX_SENTINEL,
    );
  });

  test('sync writes first/last name to the directory profile of an existing user', async () => {
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(LDAP_LOGIN_USER);
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [
            {
              objectName: 'uid=alice,dc=test,dc=com',
              object: { uid: 'alice', givenName: 'Alice', sn: 'Smith' },
            },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
        { entries: [], status: 0 },
      ],
    };

    await ldapService.syncUsers();

    expect(updateDirectoryProfileMock).toHaveBeenCalledWith(
      LDAP_LOGIN_USER.id,
      expect.objectContaining({ name: 'Alice Smith', firstName: 'Alice', lastName: 'Smith' }),
      expect.anything(),
    );
  });
});

describe('findUserEntry (direct, with config preloaded)', () => {
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
    await ldapService.findUserEntry(client as never, 'alice');
    const search = lastClientStats?.searchCalls[0];
    expect(search?.options.attributes).toEqual([
      'uid',
      'sAMAccountName',
      'cn',
      'displayName',
      'mail',
      'email',
      'sn',
      'givenName',
    ]);
    expect(search?.options.sizeLimit).toBe(1);
  });

  test('rejects when multiple user search entries fire', async () => {
    const client = buildClient({
      entries: [
        { objectName: 'uid=alice,dc=test,dc=com' },
        { objectName: 'uid=bob,dc=test,dc=com' },
      ],
      status: 0,
    });
    await expect(ldapService.findUserEntry(client as never, 'alice')).rejects.toThrow(/ambiguous/);
  });

  test('rejects LDAP size-limit status as an ambiguous user lookup', async () => {
    const client = buildClient({
      entries: [{ objectName: 'uid=alice,dc=test,dc=com' }],
      status: 4,
    });
    await expect(ldapService.findUserEntry(client as never, 'alice')).rejects.toThrow(/ambiguous/);
  });

  test('rejects LDAP size-limit error event as an ambiguous user lookup', async () => {
    const client = buildClient({
      entries: [{ objectName: 'uid=alice,dc=test,dc=com' }],
      errorEvent: Object.assign(new Error('size limit exceeded'), {
        name: 'SizeLimitExceededError',
      }),
      status: 0,
    });
    await expect(ldapService.findUserEntry(client as never, 'alice')).rejects.toThrow(/ambiguous/);
  });

  test('resolves to entry.objectName when a single searchEntry fires', async () => {
    const client = buildClient({
      entries: [{ objectName: 'uid=alice,dc=test,dc=com' }],
      status: 0,
    });
    const entry = await ldapService.findUserEntry(client as never, 'alice');
    expect(entry?.dn).toBe('uid=alice,dc=test,dc=com');
  });

  test('resolves null when no searchEntry fires before end (status 0)', async () => {
    const client = buildClient({ entries: [], status: 0 });
    const entry = await ldapService.findUserEntry(client as never, 'alice');
    expect(entry).toBeNull();
  });

  test('rejects when end fires with non-zero status', async () => {
    const client = buildClient({ entries: [], status: 32 });
    await expect(ldapService.findUserEntry(client as never, 'alice')).rejects.toThrow(/status: 32/);
  });

  test('rejects when search callback returns err', async () => {
    const client = buildClient({ err: new Error('search blew up') });
    await expect(ldapService.findUserEntry(client as never, 'alice')).rejects.toThrow(
      'search blew up',
    );
  });

  test('rejects when res.error event fires', async () => {
    const client = buildClient({
      entries: [],
      errorEvent: new Error('ldap protocol error'),
      status: 0,
    });
    await expect(ldapService.findUserEntry(client as never, 'alice')).rejects.toThrow(
      'ldap protocol error',
    );
  });

  test('returns null when service config is unset', async () => {
    (ldapService as unknown as { config: unknown }).config = null;
    const entry = await ldapService.findUserEntry({} as never, 'alice');
    expect(entry).toBeNull();
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
      'sAMAccountName',
      'cn',
      'displayName',
      'mail',
      'email',
      'sn',
      'givenName',
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
    expect(createUserMock).toHaveBeenCalledWith(
      {
        id: 'u_test_id',
        name: 'Carol',
        firstName: null,
        lastName: null,
        username: 'carol',
        passwordHash: realUsersRepo.LDAP_PLACEHOLDER_PASSWORD_HASH,
        role: 'user',
        avatarInitials: 'CA',
        authMethod: 'ldap',
        authProviderId: null,
      },
      TX_SENTINEL,
    );
    expect(result).toEqual({ synced: 0, created: 1 });
  });

  test('reads lowercase LDAP attribute names during sync (#694)', async () => {
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [
            {
              objectName: 'cn=carol,dc=test,dc=com',
              object: { samaccountname: 'carol', displayname: 'Carol Display' },
            },
          ],
          status: 0,
        },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);
    const result = await ldapService.syncUsers();
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'carol', name: 'Carol Display' }),
      TX_SENTINEL,
    );
    expect(result).toEqual({ synced: 0, created: 1 });
  });

  test('reads LDAP attribute-option suffixes during sync (#694)', async () => {
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [
            {
              objectName: 'uid=dave,dc=test,dc=com',
              attributes: [
                { type: 'uid;lang-en', values: ['dave'] },
                { type: 'displayName;lang-en', values: ['Dave Display'] },
              ],
            },
          ],
          status: 0,
        },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);
    await ldapService.syncUsers();
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'dave', name: 'Dave Display' }),
      TX_SENTINEL,
    );
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
    expect(updateDirectoryProfileMock).toHaveBeenCalledWith(
      'u-jdoe',
      { name: 'John Doe Updated', avatarInitials: 'JO' },
      expect.anything(),
    );
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

  test('updates existing user profile instead of creating', async () => {
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
    expect(updateDirectoryProfileMock).toHaveBeenCalledWith(
      LDAP_LOGIN_USER.id,
      { name: 'Alice New', avatarInitials: 'AL' },
      expect.anything(),
    );
    expect(createUserMock).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 1, created: 0 });
  });

  test('sync does NOT re-apply role mappings to existing users (bootstrap-only)', async () => {
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

    const result = await ldapService.syncUsers();

    expect(result).toEqual({ synced: 1, created: 0 });
    // Display name still refreshed from the directory, but roles are NEVER rewritten
    // for an existing user — they're owned by the app post-provisioning.
    expect(updateDirectoryProfileMock).toHaveBeenCalledWith(
      LDAP_LOGIN_USER.id,
      { name: "Daniel D'Angeli", avatarInitials: 'DA' },
      expect.anything(),
    );
    expect(applyExternalRolesForUserMock).not.toHaveBeenCalled();
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
    expect(updateDirectoryProfileMock).toHaveBeenCalledWith(
      LDAP_LOGIN_USER.id,
      { name: 'Alice New', avatarInitials: 'AL' },
      expect.anything(),
    );
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

    expect(updateDirectoryProfileMock).not.toHaveBeenCalled();
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

    expect(updateDirectoryProfileMock).not.toHaveBeenCalled();
    expect(applyExternalRolesForUserMock).not.toHaveBeenCalled();
    expect(createUserMock).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 0, created: 0 });
  });

  test('skips entries with an empty objectName instead of running username-only group search', async () => {
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [
            { objectName: '', object: { uid: 'ghost', cn: 'Ghost Entry' } },
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
    const created = createUserMock.mock.calls[0]?.[0] as { username: string };
    expect(created.username).toBe('ok');
    // The empty-objectName entry must NOT trigger a follow-up group search keyed on username only.
    const groupSearchCalls = lastClientStats?.searchCalls.filter(
      (call) => call.base === ENABLED_LDAP_CONFIG.groupBaseDn,
    );
    expect(groupSearchCalls?.some((call) => String(call.options.filter).includes('ghost'))).toBe(
      false,
    );
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
    expect(updateDirectoryProfileMock).not.toHaveBeenCalled();
  });

  test('rejects when search end yields a non-zero status', async () => {
    nextFixture = {
      bindResponses: [null],
      searchResponses: [{ entries: [], status: 1 }],
    };
    await expect(ldapService.syncUsers()).rejects.toThrow('LDAP search failed status: 1');
    expect(lastClientStats?.unbindCalls).toBe(1);
  });

  test('auto-provision skips users whose group search throws — sibling of #637', async () => {
    // Without the throw guard, alice would be created with mapExternalGroupsToRoleIds([])
    // → [DEFAULT_ROLE_ID], silently demoting a new admin. The sync continues with bob so
    // a single transient error doesn't abort the whole run. findUserGroups issues the
    // two identifier searches in parallel, so each user consumes two responses even when
    // Promise.all rejects fast.
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [
            { objectName: 'uid=alice,dc=x', object: { uid: 'alice', cn: 'Alice' } },
            { objectName: 'uid=bob,dc=x', object: { uid: 'bob', cn: 'Bob' } },
          ],
          status: 0,
        },
        { err: new Error('group subtree timeout') }, // alice userDn → throws
        { entries: [], status: 0 }, // alice username (parallel; result discarded)
        { entries: [], status: 0 }, // bob userDn
        { entries: [], status: 0 }, // bob username
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);

    const result = await ldapService.syncUsers();

    expect(result).toEqual({ synced: 0, created: 1 });
    expect(createUserMock).toHaveBeenCalledTimes(1);
    const created = createUserMock.mock.calls[0]?.[0] as { username: string };
    expect(created.username).toBe('bob');
    const createdUsernames = createUserMock.mock.calls.map(
      (call) => (call[0] as { username: string }).username,
    );
    expect(createdUsernames).not.toContain('alice');
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

  test('returns null when findUserEntry yields no entries; unbind still called', async () => {
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

  test('returns null when any parallel group-search errors (strict lookup)', async () => {
    // Strict-mode Promise.all rejects on any failure, so a fallback-identifier error
    // — even after another identifier search returned groups — surfaces as null.
    // The caller (admin auth-method toggle) then preserves the user's existing role
    // rather than overwriting it from partial data.
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

  test('issues identifier searches in parallel and unions groups across forms', async () => {
    // Mixed-filter config: one group lists the user by DN under `member`, the
    // other by uid under `memberUid`. Each identifier-form search matches only
    // one group; the result must contain both.
    const dnGroup = 'cn=dn-matched,ou=groups,dc=test,dc=com';
    const uidGroup = 'cn=uid-matched,ou=groups,dc=test,dc=com';
    ldapRepoGetMock.mockResolvedValue({
      ...ENABLED_LDAP_CONFIG,
      groupFilter: '(|(member={0})(memberUid={0}))',
    });
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [{ objectName: 'uid=alice,dc=test,dc=com', object: { uid: 'alice' } }],
          status: 0,
        },
        { entries: [{ objectName: dnGroup, object: { cn: 'dn-matched' } }], status: 0 },
        { entries: [{ objectName: uidGroup, object: { cn: 'uid-matched' } }], status: 0 },
      ],
    };

    const result = await ldapService.lookupUserGroups('alice');

    expect(result?.groups).toContain(dnGroup);
    expect(result?.groups).toContain(uidGroup);
    // One user lookup + two parallel group searches (DN form + uid form).
    expect(lastClientStats?.searchCalls).toHaveLength(3);
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

  test('rejects when group search throws — no silent demote on first login (#637)', async () => {
    // Without the throw, an empty group list would map to [DEFAULT_ROLE_ID], silently
    // demoting an admin/manager. The /login route turns this throw into a 503.
    nextFixture = {
      bindResponses: [null, null, null],
      searchResponses: [
        {
          entries: [
            { objectName: 'uid=alice,dc=test,dc=com', object: { uid: 'alice', cn: 'Alice' } },
          ],
          status: 0,
        },
        // First group search (by userDn) fails before any groups are collected → throw.
        { err: new Error('group subtree timeout') },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);

    await expect(ldapService.authenticateAndProvision('alice', 'pw')).rejects.toThrow(
      'group subtree timeout',
    );
    expect(createUserMock).not.toHaveBeenCalled();
    expect(applyExternalRolesForUserMock).not.toHaveBeenCalled();
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
    expect(createUserMock).toHaveBeenCalledWith(
      {
        id: 'u_test_id',
        name: 'Alice Real',
        firstName: null,
        lastName: null,
        username: 'alice',
        passwordHash: realUsersRepo.EXTERNAL_PLACEHOLDER_PASSWORD_HASH,
        role: 'user',
        avatarInitials: 'AL',
        authMethod: 'ldap',
        authProviderId: null,
      },
      TX_SENTINEL,
    );
    expect(applyExternalRolesForUserMock).toHaveBeenCalledWith('u_test_id', [], [], TX_SENTINEL);
  });

  test('auto-provision creates user, settings, and roles inside one transaction', async () => {
    nextFixture = {
      bindResponses: [null, null],
      searchResponses: [
        {
          entries: [
            {
              objectName: 'uid=alice,dc=test,dc=com',
              object: { uid: 'alice', cn: 'Alice', mail: 'alice@example.com' },
            },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);

    const result = await ldapService.authenticateAndProvision('alice', 'pw');

    expect(result).toEqual({
      authenticated: true,
      userId: 'u_test_id',
      created: true,
      canonicalUsername: 'alice',
    });
    expect(withDbTransactionMock).toHaveBeenCalled();
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u_test_id', username: 'alice' }),
      TX_SENTINEL,
    );
    expect(settingsUpsertForUserMock).toHaveBeenCalledWith(
      'u_test_id',
      { fullName: 'Alice', email: 'alice@example.com', language: null },
      TX_SENTINEL,
    );
    expect(applyExternalRolesForUserMock).toHaveBeenCalledWith('u_test_id', [], [], TX_SENTINEL);
    expect(createUserMock.mock.calls.every((call) => call[1] === TX_SENTINEL)).toBe(true);
  });

  test('rolls back auto-provision when role write fails inside the transaction', async () => {
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
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);
    applyExternalRolesForUserMock.mockRejectedValueOnce(new Error('role write failed'));

    await expect(ldapService.authenticateAndProvision('alice', 'pw')).rejects.toThrow(
      'role write failed',
    );
    expect(createUserMock).toHaveBeenCalled();
    expect(applyExternalRolesForUserMock).toHaveBeenCalled();
  });

  test('existing LDAP login repairs missing primary user_roles membership', async () => {
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
      role: 'manager',
    });

    const result = await ldapService.authenticateAndProvision('alice', 'pw');

    expect(result).toEqual({
      authenticated: true,
      userId: LDAP_LOGIN_USER.id,
      created: false,
      canonicalUsername: 'alice',
    });
    expect(addUserRoleMock).toHaveBeenCalledWith(LDAP_LOGIN_USER.id, 'manager', TX_SENTINEL);
    expect(applyExternalRolesForUserMock).not.toHaveBeenCalled();
  });

  test('sync auto-provision creates user, settings, and roles inside one transaction', async () => {
    nextFixture = {
      bindResponses: [null],
      searchResponses: [
        {
          entries: [
            {
              objectName: 'uid=alice,dc=test,dc=com',
              object: { uid: 'alice', cn: 'Alice', mail: 'alice@example.com' },
            },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);

    const result = await ldapService.syncUsers();

    expect(result).toEqual({ synced: 0, created: 1 });
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'alice' }),
      TX_SENTINEL,
    );
    expect(settingsUpsertForUserMock).toHaveBeenCalledWith(
      'u_test_id',
      { fullName: 'Alice', email: 'alice@example.com', language: null },
      TX_SENTINEL,
    );
    expect(applyExternalRolesForUserMock).toHaveBeenCalledWith('u_test_id', [], [], TX_SENTINEL);
  });

  test('sync repairs missing primary user_roles membership for existing users', async () => {
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({
      ...LDAP_LOGIN_USER,
      role: 'manager',
    });
    nextFixture = {
      bindResponses: [null],
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

    await ldapService.syncUsers();

    expect(addUserRoleMock).toHaveBeenCalledWith(LDAP_LOGIN_USER.id, 'manager', TX_SENTINEL);
    expect(applyExternalRolesForUserMock).not.toHaveBeenCalled();
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
      TX_SENTINEL,
    );
  });

  test('derives canonical username and display name from lowercase LDAP attributes (#694)', async () => {
    nextFixture = {
      bindResponses: [null, null],
      searchResponses: [
        {
          entries: [
            {
              objectName: 'cn=jdoe,dc=test,dc=com',
              object: { samaccountname: 'jdoe', displayname: 'John Doe' },
            },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);

    const result = await ldapService.authenticateAndProvision('john.doe@example.com', 'pw');

    expect(result.canonicalUsername).toBe('jdoe');
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'jdoe', name: 'John Doe' }),
      TX_SENTINEL,
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
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'jdoe' }),
      TX_SENTINEL,
    );
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
    // Existing-user login NEVER writes user_roles — role mapping is bootstrap-only.
    expect(applyExternalRolesForUserMock).not.toHaveBeenCalled();
  });

  test('refreshes existing LDAP user name and email from provider claims', async () => {
    nextFixture = {
      bindResponses: [null, null],
      searchResponses: [
        {
          entries: [
            {
              objectName: 'uid=alice,dc=test,dc=com',
              object: { uid: 'alice', cn: 'Alice Provider', mail: 'alice@example.com' },
            },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(LDAP_LOGIN_USER);

    const result = await ldapService.authenticateAndProvision('alice', 'pw');

    expect(result).toEqual({
      authenticated: true,
      userId: LDAP_LOGIN_USER.id,
      created: false,
      canonicalUsername: 'alice',
    });
    expect(updateDirectoryProfileMock).toHaveBeenCalledWith(
      LDAP_LOGIN_USER.id,
      { name: 'Alice Provider', avatarInitials: 'AL' },
      expect.anything(),
    );
    expect(settingsUpsertForUserMock).toHaveBeenCalledWith(
      LDAP_LOGIN_USER.id,
      { fullName: 'Alice Provider', email: 'alice@example.com', language: null },
      expect.anything(),
    );
  });

  test('does not clear profile values when LDAP omits name and email', async () => {
    nextFixture = {
      bindResponses: [null, null],
      searchResponses: [
        {
          entries: [{ objectName: 'uid=alice,dc=test,dc=com', object: { uid: 'alice' } }],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(LDAP_LOGIN_USER);

    await ldapService.authenticateAndProvision('alice', 'pw');

    expect(updateDirectoryProfileMock).not.toHaveBeenCalled();
    expect(settingsUpsertForUserMock).not.toHaveBeenCalled();
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
    // Admin has assigned 'manager' to this LDAP user. The user's LDAP groups don't match
    // any configured role mapping; nothing should be written to user_roles regardless.
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
    expect(applyExternalRolesForUserMock).not.toHaveBeenCalled();
  });

  test('existing-user login with matching group does NOT overwrite admin-assigned roles', async () => {
    // The bug: an admin adds `manager` to an LDAP user who was originally provisioned as
    // `admin` via group mapping. Pre-fix, the next LDAP login would wipe `manager` because
    // the group still maps to `[admin]`. Post-fix, role mapping is bootstrap-only and
    // never re-applies, so the admin-assigned role survives.
    const adminGroupDn = 'cn=admins,ou=groups,dc=test,dc=com';
    ldapRepoGetMock.mockResolvedValue({
      ...ENABLED_LDAP_CONFIG,
      roleMappings: [{ ldapGroup: adminGroupDn, role: 'admin' }],
    });
    nextFixture = {
      bindResponses: [null, null],
      searchResponses: [
        {
          entries: [
            { objectName: 'uid=alice,dc=test,dc=com', object: { uid: 'alice', cn: 'Alice' } },
          ],
          status: 0,
        },
        {
          entries: [{ objectName: adminGroupDn, object: { cn: 'admins' } }],
          status: 0,
        },
      ],
    };
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
    expect(applyExternalRolesForUserMock).not.toHaveBeenCalled();
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

  test('provisionOnLogin=false: refuses login for unknown LDAP users (no create)', async () => {
    ldapRepoGetMock.mockResolvedValue({ ...ENABLED_LDAP_CONFIG, provisionOnLogin: false });
    nextFixture = {
      bindResponses: [null, null],
      searchResponses: [
        {
          entries: [
            { objectName: 'uid=newbie,dc=test,dc=com', object: { uid: 'newbie', cn: 'Newbie' } },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);

    const result = await ldapService.authenticateAndProvision('newbie', 'pw');

    expect(result).toEqual({ authenticated: false });
    expect(createUserMock).not.toHaveBeenCalled();
    expect(applyExternalRolesForUserMock).not.toHaveBeenCalled();
  });

  test('provisionOnLogin=false: existing LDAP-bound user still logs in (roles preserved)', async () => {
    ldapRepoGetMock.mockResolvedValue({ ...ENABLED_LDAP_CONFIG, provisionOnLogin: false });
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

    const result = await ldapService.authenticateAndProvision('alice', 'pw');

    expect(result).toEqual({
      authenticated: true,
      userId: LDAP_LOGIN_USER.id,
      created: false,
      canonicalUsername: 'alice',
    });
    expect(createUserMock).not.toHaveBeenCalled();
    expect(applyExternalRolesForUserMock).not.toHaveBeenCalled();
  });

  test('provisionOnLogin=false: enforced even if config cache is invalidated mid-flight (race)', async () => {
    ldapRepoGetMock.mockResolvedValue({ ...ENABLED_LDAP_CONFIG, provisionOnLogin: false });
    nextFixture = {
      bindResponses: [null, null],
      searchResponses: [
        {
          entries: [
            { objectName: 'uid=newbie,dc=test,dc=com', object: { uid: 'newbie', cn: 'Newbie' } },
          ],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };
    // Simulate a concurrent /api/ldap/config save landing between authenticateWithProfile
    // (which loaded the cache) and the gate: invalidateConfig() nulls this.config. The gate
    // must reload from DB instead of falling back to default-true and bypassing policy.
    findLoginUserByNormalizedUsernameMock.mockImplementation(async () => {
      ldapService.invalidateConfig();
      return null;
    });

    const result = await ldapService.authenticateAndProvision('newbie', 'pw');

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

  test('race recovery applies roles via the IfMatched helper so the loser does not clobber the winner', async () => {
    nextFixture = {
      bindResponses: [null, null],
      searchResponses: [
        {
          entries: [
            { objectName: 'uid=alice,dc=test,dc=com', object: { uid: 'alice', cn: 'Alice' } },
          ],
          status: 0,
        },
        { entries: [], status: 0 }, // loser sees no groups
      ],
    };
    findLoginUserByNormalizedUsernameMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(LDAP_LOGIN_USER);
    const uniqueErr = Object.assign(new Error('duplicate key'), { code: '23505' });
    createUserMock.mockRejectedValueOnce(uniqueErr);

    await ldapService.authenticateAndProvision('alice', 'pw');

    // Race recovery uses the IfMatched helper so the loser does NOT overwrite the
    // winner's roles when the loser's bind returned no matched mapping. The winner
    // has already bootstrapped the user; the loser only writes when its own groups
    // genuinely map to a role.
    expect(applyExternalRolesForUserMock).not.toHaveBeenCalled();
    expect(applyExternalRolesForUserIfMatchedMock).toHaveBeenCalledWith(LDAP_LOGIN_USER.id, [], []);
  });

  test('race recovery does not overwrite provider-managed names when LDAP omits display name', async () => {
    nextFixture = {
      bindResponses: [null, null],
      searchResponses: [
        {
          entries: [{ objectName: 'uid=alice,dc=test,dc=com', object: { uid: 'alice' } }],
          status: 0,
        },
        { entries: [], status: 0 },
      ],
    };
    findLoginUserByNormalizedUsernameMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(LDAP_LOGIN_USER);
    const uniqueErr = Object.assign(new Error('duplicate key'), { code: '23505' });
    createUserMock.mockRejectedValueOnce(uniqueErr);

    await ldapService.authenticateAndProvision('alice', 'pw');

    expect(updateDirectoryProfileMock).not.toHaveBeenCalled();
    expect(settingsUpsertForUserMock).not.toHaveBeenCalled();
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
      TX_SENTINEL,
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
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user' }),
      TX_SENTINEL,
    );
  });
});
