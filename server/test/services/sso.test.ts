import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realDns from 'node:dns/promises';
import * as realSsoProvidersRepo from '../../repositories/ssoProvidersRepo.ts';
import * as realSsoStatesRepo from '../../repositories/ssoStatesRepo.ts';

const dnsSnap = { ...realDns };
const ssoProvidersRepoSnap = { ...realSsoProvidersRepo };
const ssoStatesRepoSnap = { ...realSsoStatesRepo };

const dnsLookupMock = mock();
const findBySlugMock = mock();
const findByIdMock = mock();
const statesConsumeMock = mock();
const statesGetForProviderMock = mock();
const statesInsertMock = mock();

let sso: typeof import('../../services/sso.ts');

beforeAll(async () => {
  mock.module('node:dns/promises', () => ({
    ...dnsSnap,
    default: { ...dnsSnap, lookup: dnsLookupMock },
    lookup: dnsLookupMock,
  }));
  mock.module('../../repositories/ssoProvidersRepo.ts', () => ({
    ...ssoProvidersRepoSnap,
    findBySlug: findBySlugMock,
    findById: findByIdMock,
  }));
  mock.module('../../repositories/ssoStatesRepo.ts', () => ({
    ...ssoStatesRepoSnap,
    consume: statesConsumeMock,
    getForProvider: statesGetForProviderMock,
    insert: statesInsertMock,
  }));

  sso = await import('../../services/sso.ts');
});

afterAll(() => {
  mock.module('node:dns/promises', () => dnsSnap);
  mock.module('../../repositories/ssoProvidersRepo.ts', () => ssoProvidersRepoSnap);
  mock.module('../../repositories/ssoStatesRepo.ts', () => ssoStatesRepoSnap);
});

beforeEach(() => {
  for (const m of [
    dnsLookupMock,
    findBySlugMock,
    findByIdMock,
    statesConsumeMock,
    statesGetForProviderMock,
    statesInsertMock,
  ])
    m.mockReset();
});

describe('isPrivateIp', () => {
  test('detects IPv4 loopback', () => {
    expect(sso.isPrivateIp('127.0.0.1')).toBe(true);
    expect(sso.isPrivateIp('127.255.255.254')).toBe(true);
  });

  test('detects RFC1918 private ranges', () => {
    expect(sso.isPrivateIp('10.0.0.1')).toBe(true);
    expect(sso.isPrivateIp('172.16.5.6')).toBe(true);
    expect(sso.isPrivateIp('172.31.255.255')).toBe(true);
    expect(sso.isPrivateIp('192.168.1.1')).toBe(true);
  });

  test('detects link-local (cloud metadata)', () => {
    expect(sso.isPrivateIp('169.254.169.254')).toBe(true);
  });

  test('detects IPv6 loopback and unique-local', () => {
    expect(sso.isPrivateIp('::1')).toBe(true);
    expect(sso.isPrivateIp('fc00::1')).toBe(true);
    expect(sso.isPrivateIp('fd12:3456:789a::1')).toBe(true);
    expect(sso.isPrivateIp('fe80::1')).toBe(true);
  });

  test('does NOT match public IPv4', () => {
    expect(sso.isPrivateIp('8.8.8.8')).toBe(false);
    expect(sso.isPrivateIp('172.32.0.1')).toBe(false); // 172.32 is public
    expect(sso.isPrivateIp('11.0.0.1')).toBe(false);
  });

  test('does NOT match public IPv6', () => {
    expect(sso.isPrivateIp('2606:4700:4700::1111')).toBe(false);
  });

  test('detects IPv4-mapped IPv6 loopback', () => {
    expect(sso.isPrivateIp('::ffff:127.0.0.1')).toBe(true);
    expect(sso.isPrivateIp('::ffff:10.0.0.1')).toBe(true);
  });

  test('detects 100.64.0.0/10 (carrier-grade NAT)', () => {
    expect(sso.isPrivateIp('100.64.0.1')).toBe(true);
    expect(sso.isPrivateIp('100.127.255.254')).toBe(true);
    // Just below and just above the CGN range stay public.
    expect(sso.isPrivateIp('100.63.255.255')).toBe(false);
    expect(sso.isPrivateIp('100.128.0.1')).toBe(false);
  });
});

describe('resolvePublicBaseUrl', () => {
  const originalSsoBase = process.env.SSO_CALLBACK_BASE_URL;
  const originalFrontend = process.env.FRONTEND_URL;

  beforeEach(() => {
    process.env.SSO_CALLBACK_BASE_URL = '';
    process.env.FRONTEND_URL = '';
  });

  afterAll(() => {
    if (originalSsoBase === undefined) delete process.env.SSO_CALLBACK_BASE_URL;
    else process.env.SSO_CALLBACK_BASE_URL = originalSsoBase;
    if (originalFrontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontend;
  });

  test('throws when both env vars are unset', () => {
    expect(() => sso.resolvePublicBaseUrl()).toThrow(
      'SSO_CALLBACK_BASE_URL or FRONTEND_URL must be configured for SSO',
    );
  });

  test('prefers SSO_CALLBACK_BASE_URL over FRONTEND_URL', () => {
    process.env.SSO_CALLBACK_BASE_URL = 'https://sso.example.com';
    process.env.FRONTEND_URL = 'https://app.example.com';
    expect(sso.resolvePublicBaseUrl()).toBe('https://sso.example.com');
  });

  test('falls back to FRONTEND_URL', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    expect(sso.resolvePublicBaseUrl()).toBe('https://app.example.com');
  });

  test('rejects an unparseable URL', () => {
    process.env.SSO_CALLBACK_BASE_URL = 'not a url';
    expect(() => sso.resolvePublicBaseUrl()).toThrow(/not a valid URL/);
  });

  test('rejects non-http(s) schemes', () => {
    process.env.SSO_CALLBACK_BASE_URL = 'javascript:alert(1)';
    expect(() => sso.resolvePublicBaseUrl()).toThrow(/must use http/);
  });

  test('allows http:// for localhost (dev mode)', () => {
    process.env.SSO_CALLBACK_BASE_URL = 'http://localhost:3001';
    expect(sso.resolvePublicBaseUrl()).toBe('http://localhost:3001');
    process.env.SSO_CALLBACK_BASE_URL = 'http://127.0.0.1:3001';
    expect(sso.resolvePublicBaseUrl()).toBe('http://127.0.0.1:3001');
  });

  test('rejects http:// for non-loopback hosts', () => {
    process.env.SSO_CALLBACK_BASE_URL = 'http://praetor.example.com';
    expect(() => sso.resolvePublicBaseUrl()).toThrow(/https:\/\/ for non-loopback/);
  });
});

const SAML_PROVIDER: realSsoProvidersRepo.SsoProvider = {
  id: 'sso-1',
  protocol: 'saml',
  slug: 'okta',
  name: 'Okta',
  enabled: true,
  issuerUrl: '',
  clientId: '',
  clientSecret: '',
  scopes: '',
  metadataUrl: 'http://10.0.0.1/metadata', // intentionally non-HTTPS + private
  metadataXml: '',
  entryPoint: '',
  idpIssuer: '',
  idpCert: '',
  spIssuer: '',
  privateKey: '',
  publicCert: '',
  usernameAttribute: 'nameID',
  nameAttribute: 'name',
  emailAttribute: 'email',
  groupsAttribute: 'groups',
  roleMappings: [],
};

describe('startSamlLogin SSRF protections', () => {
  const originalSsoBase = process.env.SSO_CALLBACK_BASE_URL;
  beforeEach(() => {
    process.env.SSO_CALLBACK_BASE_URL = 'https://app.example.com';
  });
  afterAll(() => {
    if (originalSsoBase === undefined) delete process.env.SSO_CALLBACK_BASE_URL;
    else process.env.SSO_CALLBACK_BASE_URL = originalSsoBase;
  });

  test('rejects http:// metadataUrl', async () => {
    findBySlugMock.mockResolvedValue({
      ...SAML_PROVIDER,
      metadataUrl: 'http://idp.example.com/metadata',
    });
    await expect(sso.startSamlLogin('okta')).rejects.toThrow(/non-HTTPS/);
  });

  test('rejects metadataUrl that resolves to a private IP', async () => {
    findBySlugMock.mockResolvedValue({
      ...SAML_PROVIDER,
      metadataUrl: 'https://internal.example.com/metadata',
    });
    dnsLookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    await expect(sso.startSamlLogin('okta')).rejects.toThrow(/private\/loopback/);
  });

  test('rejects metadataUrl host that resolves to 169.254.169.254 (cloud metadata)', async () => {
    findBySlugMock.mockResolvedValue({
      ...SAML_PROVIDER,
      metadataUrl: 'https://metadata.example.com/metadata',
    });
    dnsLookupMock.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(sso.startSamlLogin('okta')).rejects.toThrow(/private\/loopback/);
  });
});

describe('safeFetchRemoteUrl behavior (exercised via SAML metadata fetch)', () => {
  const realFetch = globalThis.fetch;
  const originalSsoBase = process.env.SSO_CALLBACK_BASE_URL;
  const fetchMock = mock();

  beforeEach(() => {
    process.env.SSO_CALLBACK_BASE_URL = 'https://app.example.com';
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    findBySlugMock.mockResolvedValue({
      ...SAML_PROVIDER,
      metadataUrl: 'https://idp.example.com/metadata',
    });
    // Default: every DNS lookup resolves to a benign public IP.
    dnsLookupMock.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  afterAll(() => {
    if (originalSsoBase === undefined) delete process.env.SSO_CALLBACK_BASE_URL;
    else process.env.SSO_CALLBACK_BASE_URL = originalSsoBase;
  });

  test('follows a single 302 redirect and re-validates the target', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://idp2.example.com/metadata' },
        }),
      )
      .mockResolvedValueOnce(new Response('<EntityDescriptor entityID="x"/>', { status: 200 }));
    // The redirect should be followed all the way through to SAML client construction; that
    // construction then fails with a domain-specific error proving safeFetchRemoteUrl returned
    // the post-redirect response successfully.
    await expect(sso.startSamlLogin('okta')).rejects.toThrow(/missing entry point/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // assertSafeRemoteUrl runs dns.lookup once per hop.
    expect(dnsLookupMock).toHaveBeenCalledTimes(2);
  });

  test('throws when a redirect response is missing the Location header', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }));
    await expect(sso.startSamlLogin('okta')).rejects.toThrow(/Location header/);
  });

  test('rejects when a redirect target resolves to a private IP (per-hop revalidation)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'https://internal.example/m' },
      }),
    );
    dnsLookupMock
      .mockResolvedValueOnce([{ address: '203.0.113.10', family: 4 }])
      .mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }]);
    await expect(sso.startSamlLogin('okta')).rejects.toThrow(/private\/loopback/);
  });

  test('rejects after exceeding the redirect limit', async () => {
    // Same Location each time — drives the loop to its bound.
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://idp.example.com/metadata' },
      }),
    );
    await expect(sso.startSamlLogin('okta')).rejects.toThrow(/redirect limit/);
  });

  test('rejects when Content-Length declares a body larger than the cap', async () => {
    // No body, but the declared content-length is enough to fail the pre-stream check.
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { 'content-length': String(2 * 1024 * 1024) },
      }),
    );
    await expect(sso.startSamlLogin('okta')).rejects.toThrow(/too large/);
  });

  test('rejects when the streamed body exceeds the cap', async () => {
    // Build a Response with a streaming body bigger than the cap, without a Content-Length so
    // the size check happens during the read loop.
    const oneMb = new Uint8Array(1024 * 1024).fill(65); // 1 MiB of 'A'
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(oneMb);
        controller.enqueue(oneMb); // 2 MiB total — over the cap
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));
    await expect(sso.startSamlLogin('okta')).rejects.toThrow(/exceeded/);
  });
});

describe('completeOidcLogin state-before-provider ordering', () => {
  const originalSsoBase = process.env.SSO_CALLBACK_BASE_URL;
  beforeEach(() => {
    process.env.SSO_CALLBACK_BASE_URL = 'https://app.example.com';
  });
  afterAll(() => {
    if (originalSsoBase === undefined) delete process.env.SSO_CALLBACK_BASE_URL;
    else process.env.SSO_CALLBACK_BASE_URL = originalSsoBase;
  });

  test('rejects when state cannot be consumed', async () => {
    statesConsumeMock.mockResolvedValue(null);
    const callbackUrl = new URL(
      'http://internal.invalid/api/auth/sso/oidc/google/callback?state=missing&code=abc',
    );
    await expect(sso.completeOidcLogin('google', callbackUrl)).rejects.toThrow(
      'Invalid or expired SSO state',
    );
    expect(findBySlugMock).not.toHaveBeenCalled();
    expect(findByIdMock).not.toHaveBeenCalled();
  });

  test('looks up the provider FROM state.providerId, not the URL slug', async () => {
    // The state was created for provider sso-1 ('google'); but the caller hits a
    // /oidc/<other>/callback path. The service must resolve the provider via the
    // state, then reject because the slugs do not match — never trade for a
    // different provider's tokens.
    statesConsumeMock.mockResolvedValue({
      state: 's',
      providerId: 'sso-1',
      protocol: 'oidc',
      codeVerifier: 'v',
      relayState: '',
      expiresAt: new Date(Date.now() + 60_000),
    });
    findByIdMock.mockResolvedValue({
      ...SAML_PROVIDER,
      id: 'sso-1',
      protocol: 'oidc',
      slug: 'google',
      issuerUrl: 'https://accounts.google.com',
      clientId: 'cid',
    });
    const callbackUrl = new URL(
      'http://internal.invalid/api/auth/sso/oidc/other/callback?state=s&code=abc',
    );
    await expect(sso.completeOidcLogin('other', callbackUrl)).rejects.toThrow(
      'Invalid or expired SSO state',
    );
    // Provider was fetched by id, not slug.
    expect(findByIdMock).toHaveBeenCalledWith('sso-1');
    expect(findBySlugMock).not.toHaveBeenCalled();
  });

  test('consume happens before any provider lookup', async () => {
    // Even when the state is invalid, we should consume the state (which atomically
    // burns it) before doing slug → provider lookups. This means a bogus state value
    // doesn't leak information about which providers are configured.
    statesConsumeMock.mockResolvedValue(null);
    findBySlugMock.mockResolvedValue(null);
    const callbackUrl = new URL(
      'http://internal.invalid/api/auth/sso/oidc/anything/callback?state=x',
    );
    await expect(sso.completeOidcLogin('anything', callbackUrl)).rejects.toThrow(
      'Invalid or expired SSO state',
    );
    expect(statesConsumeMock).toHaveBeenCalledTimes(1);
  });
});

describe('DbSamlCacheProvider provider scoping', () => {
  const fakeRow = {
    state: 'in-response-to-1',
    providerId: 'sso-A',
    protocol: 'saml' as const,
    codeVerifier: '',
    relayState: 'relay-A',
    expiresAt: new Date(Date.now() + 60_000),
  };

  beforeEach(() => {
    statesGetForProviderMock.mockImplementation(async (state: string, providerId: string) =>
      state === fakeRow.state && providerId === fakeRow.providerId ? fakeRow : null,
    );
  });

  test("returns the value when queried by the same provider's cache", async () => {
    const cache = new sso.DbSamlCacheProvider('sso-A');
    expect(await cache.getAsync('in-response-to-1')).toBe('relay-A');
    expect(statesGetForProviderMock).toHaveBeenCalledWith('in-response-to-1', 'sso-A');
  });

  test("returns null when a different provider's cache instance queries the same key", async () => {
    const cache = new sso.DbSamlCacheProvider('sso-B');
    expect(await cache.getAsync('in-response-to-1')).toBeNull();
    expect(statesGetForProviderMock).toHaveBeenCalledWith('in-response-to-1', 'sso-B');
  });

  test('saveAsync records the cache provider providerId', async () => {
    statesInsertMock.mockResolvedValue(undefined);
    const cache = new sso.DbSamlCacheProvider('sso-A');
    await cache.saveAsync('k', 'v');
    const inserted = statesInsertMock.mock.calls[0][0];
    expect(inserted.state).toBe('k');
    expect(inserted.providerId).toBe('sso-A');
    expect(inserted.protocol).toBe('saml');
    expect(inserted.relayState).toBe('v');
  });
});
