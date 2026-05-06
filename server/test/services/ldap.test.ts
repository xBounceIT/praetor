import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import realLdap from 'ldapjs';
import * as realLdapRepo from '../../repositories/ldapRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import ldapService from '../../services/ldap.ts';
import * as realInitials from '../../utils/initials.ts';
import * as realLogger from '../../utils/logger.ts';
import * as realOrderIds from '../../utils/order-ids.ts';

// Snapshot real exports BEFORE the beforeAll fires (mock.module inside beforeAll is not hoisted).
const ldapjsSnapshot = realLdap;
const ldapRepoSnapshot = { ...realLdapRepo };
const usersRepoSnapshot = { ...realUsersRepo };
const initialsSnapshot = { ...realInitials };
const loggerSnapshot = { ...realLogger };
const orderIdsSnapshot = { ...realOrderIds };

const ldapRepoGetMock = mock();
const findLoginUserByUsernameMock = mock();
const updateNameByUsernameMock = mock();
const createUserMock = mock();

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
    findLoginUserByUsername: findLoginUserByUsernameMock,
    updateNameByUsername: updateNameByUsernameMock,
    createUser: createUserMock,
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
  mock.module('../../utils/initials.ts', () => initialsSnapshot);
  mock.module('../../utils/logger.ts', () => loggerSnapshot);
  mock.module('../../utils/order-ids.ts', () => orderIdsSnapshot);
});

const ENABLED_LDAP_CONFIG = {
  enabled: true,
  serverUrl: 'ldap://ldap.test:389',
  baseDn: 'dc=test,dc=com',
  bindDn: 'cn=admin,dc=test,dc=com',
  bindPassword: 'admin-pw',
  userFilter: '(uid={0})',
  groupBaseDn: 'ou=groups,dc=test,dc=com',
  groupFilter: '(member={0})',
  roleMappings: [],
  tlsCaCertificate: '',
};

const resetService = () => {
  (ldapService as unknown as { config: unknown }).config = null;
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
  findLoginUserByUsernameMock.mockReset();
  updateNameByUsernameMock.mockReset();
  createUserMock.mockReset();
  createClientMock.mockClear();

  ldapRepoGetMock.mockResolvedValue(ENABLED_LDAP_CONFIG);
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
});

describe('authenticate', () => {
  test('returns false when getClient returns null (LDAP disabled)', async () => {
    ldapRepoGetMock.mockResolvedValue({ ...ENABLED_LDAP_CONFIG, enabled: false });
    const ok = await ldapService.authenticate('alice', 'pw');
    expect(ok).toBe(false);
  });

  test('returns false when service-account bind errors; unbind still called', async () => {
    nextFixture = { bindResponses: [new Error('bad creds')] };
    const ok = await ldapService.authenticate('alice', 'pw');
    expect(ok).toBe(false);
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

  test('returns true on bind→search→re-bind happy path; unbind still called', async () => {
    nextFixture = {
      bindResponses: [null, null],
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
});

describe('findUserDn (direct, with config preloaded)', () => {
  beforeEach(() => {
    (ldapService as unknown as { config: unknown }).config = ENABLED_LDAP_CONFIG;
  });

  const buildClient = (response: SearchResponse) => {
    nextFixture = { searchResponses: [response] };
    return createClientMock({ url: ENABLED_LDAP_CONFIG.serverUrl, tlsOptions: {} });
  };

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
    findLoginUserByUsernameMock.mockResolvedValue(null);
    const result = await ldapService.syncUsers();
    expect(createUserMock).toHaveBeenCalledWith({
      id: 'u_test_id',
      name: 'Carol',
      username: 'carol',
      passwordHash: realUsersRepo.LDAP_PLACEHOLDER_PASSWORD_HASH,
      role: 'user',
      avatarInitials: 'CA',
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
    findLoginUserByUsernameMock.mockResolvedValue(null);
    await ldapService.syncUsers();
    const names = createUserMock.mock.calls.map((call) => (call[0] as { name: string }).name);
    expect(names).toEqual(['CN Name', 'DN Name', 'c']);
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
    findLoginUserByUsernameMock.mockResolvedValue(null);
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
    findLoginUserByUsernameMock.mockResolvedValue({ id: 'u-old' });
    const result = await ldapService.syncUsers();
    expect(updateNameByUsernameMock).toHaveBeenCalledWith('alice', 'Alice New');
    expect(createUserMock).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 1, created: 0 });
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
    findLoginUserByUsernameMock.mockResolvedValue(null);
    const result = await ldapService.syncUsers();
    expect(result).toEqual({ synced: 0, created: 1 });
    expect(createUserMock).toHaveBeenCalledTimes(1);
  });

  test('rethrows on outer error after unbind', async () => {
    nextFixture = { bindResponses: [new Error('bind failed in sync')] };
    await expect(ldapService.syncUsers()).rejects.toThrow('bind failed in sync');
    expect(lastClientStats?.unbindCalls).toBe(1);
  });
});
