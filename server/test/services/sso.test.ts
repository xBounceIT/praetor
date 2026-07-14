import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { LookupAddress } from 'node:dns';
import * as realDns from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import * as realHttps from 'node:https';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import * as realNodeSaml from '@node-saml/node-saml';
import * as realOidc from 'openid-client';
import * as realSsoLoginTicketsRepo from '../../repositories/ssoLoginTicketsRepo.ts';
import * as realSsoProvidersRepo from '../../repositories/ssoProvidersRepo.ts';
import * as realSsoStatesRepo from '../../repositories/ssoStatesRepo.ts';
import * as realSsoUserSessionsRepo from '../../repositories/ssoUserSessionsRepo.ts';
import * as realExternalAuth from '../../services/external-auth.ts';

const dnsSnap = { ...realDns };
const httpsSnap = { ...realHttps };
const nodeSamlSnap = { ...realNodeSaml };
const oidcSnap = { ...realOidc };
const externalAuthSnap = { ...realExternalAuth };
const ssoProvidersRepoSnap = { ...realSsoProvidersRepo };
const ssoStatesRepoSnap = { ...realSsoStatesRepo };
const ssoUserSessionsRepoSnap = { ...realSsoUserSessionsRepo };
const ssoLoginTicketsRepoSnap = { ...realSsoLoginTicketsRepo };

const dnsLookupMock = mock();
const pinnedFetchResponseMock = mock();
type AutoSelectingRequestOptions = RequestOptions & { autoSelectFamily?: boolean };
const httpsRequestMock = mock(
  (options: AutoSelectingRequestOptions, onResponse: (response: IncomingMessage) => void) => {
    const outbound = new EventEmitter() as EventEmitter & {
      destroy: (error?: Error) => void;
      end: (body?: Uint8Array) => void;
    };
    outbound.destroy = (error) => {
      if (error) queueMicrotask(() => outbound.emit('error', error));
    };
    outbound.end = (body) => {
      void Promise.resolve(pinnedFetchResponseMock(options, body)).then(
        async (result) => {
          if (!(result instanceof Response)) {
            onResponse(result as IncomingMessage);
            return;
          }
          const response = result as Response;
          const bytes = response.body ? Buffer.from(await response.arrayBuffer()) : Buffer.alloc(0);
          const incoming = Readable.from(bytes.length > 0 ? [bytes] : []) as IncomingMessage;
          const rawHeaders: string[] = [];
          response.headers.forEach((value, name) => {
            rawHeaders.push(name, value);
          });
          incoming.statusCode = response.status;
          incoming.statusMessage = response.statusText;
          incoming.rawHeaders = rawHeaders;
          onResponse(incoming);
        },
        (error) => outbound.emit('error', error),
      );
    };
    return outbound as unknown as ReturnType<typeof realHttps.request>;
  },
);
const findBySlugMock = mock();
const findByIdMock = mock();
const insertMock = mock();
const updateMock = mock();
const statesConsumeMock = mock();
const samlValidatePostMock = mock();
const resolveExternalIdentityMock = mock();
const statesGetForProviderMock = mock();
const statesInsertMock = mock();
const statesRemoveForProviderMock = mock();
const userSessionsFindActiveOidcByUserIdMock = mock();
const userSessionsUpsertMock = mock();
const userSessionsDeleteByUserIdMock = mock();
const oidcDiscoveryMock = mock();
const oidcBuildEndSessionUrlMock = mock();
const oidcAuthorizationCodeGrantMock = mock();
const oidcFetchUserInfoMock = mock();
const oidcBuildAuthorizationUrlMock = mock();
const loginTicketsInsertMock = mock();

let lastSamlOptions: Record<string, unknown> | null = null;

class StubSaml {
  constructor(options: Record<string, unknown>) {
    lastSamlOptions = options;
  }

  getAuthorizeUrlAsync() {
    return Promise.resolve(String(lastSamlOptions?.entryPoint ?? 'https://idp.example.com/sso'));
  }

  validatePostResponseAsync(formBody: Record<string, string>) {
    return samlValidatePostMock(formBody);
  }
}

let sso: typeof import('../../services/sso.ts');

beforeAll(async () => {
  mock.module('node:dns/promises', () => ({
    ...dnsSnap,
    default: { ...dnsSnap, lookup: dnsLookupMock },
    lookup: dnsLookupMock,
  }));
  mock.module('node:https', () => ({
    ...httpsSnap,
    default: { ...httpsSnap, request: httpsRequestMock },
    request: httpsRequestMock,
  }));
  mock.module('@node-saml/node-saml', () => ({
    ...nodeSamlSnap,
    SAML: StubSaml,
  }));
  mock.module('../../services/external-auth.ts', () => ({
    ...externalAuthSnap,
    resolveExternalIdentity: resolveExternalIdentityMock,
  }));
  mock.module('../../repositories/ssoProvidersRepo.ts', () => ({
    ...ssoProvidersRepoSnap,
    findBySlug: findBySlugMock,
    findById: findByIdMock,
    insert: insertMock,
    update: updateMock,
  }));
  mock.module('../../repositories/ssoStatesRepo.ts', () => ({
    ...ssoStatesRepoSnap,
    consume: statesConsumeMock,
    getForProvider: statesGetForProviderMock,
    insert: statesInsertMock,
    removeForProvider: statesRemoveForProviderMock,
  }));
  mock.module('../../repositories/ssoUserSessionsRepo.ts', () => ({
    ...ssoUserSessionsRepoSnap,
    findActiveOidcByUserId: userSessionsFindActiveOidcByUserIdMock,
    upsert: userSessionsUpsertMock,
    deleteByUserId: userSessionsDeleteByUserIdMock,
  }));
  mock.module('../../repositories/ssoLoginTicketsRepo.ts', () => ({
    ...ssoLoginTicketsRepoSnap,
    insert: loginTicketsInsertMock,
  }));
  mock.module('openid-client', () => ({
    ...oidcSnap,
    discovery: oidcDiscoveryMock,
    buildEndSessionUrl: oidcBuildEndSessionUrlMock,
    authorizationCodeGrant: oidcAuthorizationCodeGrantMock,
    fetchUserInfo: oidcFetchUserInfoMock,
    buildAuthorizationUrl: oidcBuildAuthorizationUrlMock,
  }));

  sso = await import('../../services/sso.ts');
});

afterAll(() => {
  mock.module('node:dns/promises', () => dnsSnap);
  mock.module('node:https', () => httpsSnap);
  mock.module('@node-saml/node-saml', () => nodeSamlSnap);
  mock.module('../../services/external-auth.ts', () => externalAuthSnap);
  mock.module('../../repositories/ssoProvidersRepo.ts', () => ssoProvidersRepoSnap);
  mock.module('../../repositories/ssoStatesRepo.ts', () => ssoStatesRepoSnap);
  mock.module('../../repositories/ssoUserSessionsRepo.ts', () => ssoUserSessionsRepoSnap);
  mock.module('../../repositories/ssoLoginTicketsRepo.ts', () => ssoLoginTicketsRepoSnap);
  mock.module('openid-client', () => oidcSnap);
});

beforeEach(() => {
  httpsRequestMock.mockClear();
  for (const m of [
    dnsLookupMock,
    pinnedFetchResponseMock,
    findBySlugMock,
    findByIdMock,
    insertMock,
    updateMock,
    statesConsumeMock,
    samlValidatePostMock,
    resolveExternalIdentityMock,
    statesGetForProviderMock,
    statesInsertMock,
    statesRemoveForProviderMock,
    userSessionsFindActiveOidcByUserIdMock,
    userSessionsUpsertMock,
    userSessionsDeleteByUserIdMock,
    oidcDiscoveryMock,
    oidcBuildEndSessionUrlMock,
    oidcAuthorizationCodeGrantMock,
    oidcFetchUserInfoMock,
    oidcBuildAuthorizationUrlMock,
    loginTicketsInsertMock,
  ])
    m.mockReset();
  lastSamlOptions = null;
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

  test('detects hex-form IPv4-mapped IPv6 private ranges', () => {
    expect(sso.isPrivateIp('::ffff:7f00:1')).toBe(true);
    expect(sso.isPrivateIp('::ffff:0a00:1')).toBe(true);
    expect(sso.isPrivateIp('0:0:0:0:0:ffff:a9fe:a9fe')).toBe(true);
    expect(sso.isPrivateIp('::ffff:0808:0808')).toBe(false);
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

describe('getSamlAcsUrlInfo', () => {
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

  // Issue #602: the admin UI used to build the ACS URL from the frontend's API base, which in
  // split-host deployments doesn't match the backend's resolved SSO callback origin. The
  // template returned here must be anchored to the backend's resolved base URL.
  test('returns a template anchored to SSO_CALLBACK_BASE_URL, not the frontend origin', () => {
    process.env.SSO_CALLBACK_BASE_URL = 'https://api.example.com';
    process.env.FRONTEND_URL = 'https://app.example.com';
    expect(sso.getSamlAcsUrlInfo()).toEqual({
      acsUrlTemplate: 'https://api.example.com/api/auth/sso/saml/{slug}/callback',
    });
  });

  test('falls back to FRONTEND_URL when SSO_CALLBACK_BASE_URL is unset', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    expect(sso.getSamlAcsUrlInfo().acsUrlTemplate).toBe(
      'https://app.example.com/api/auth/sso/saml/{slug}/callback',
    );
  });

  test('throws when no base URL is configured (callers should map to 503)', () => {
    expect(() => sso.getSamlAcsUrlInfo()).toThrow(/SSO_CALLBACK_BASE_URL or FRONTEND_URL/);
  });

  test('template leaves `{slug}` literal so the client can interpolate', () => {
    process.env.SSO_CALLBACK_BASE_URL = 'https://api.example.com';
    const { acsUrlTemplate } = sso.getSamlAcsUrlInfo();
    expect(acsUrlTemplate).toContain('{slug}');
    expect(acsUrlTemplate).not.toContain('%7B');
    expect(acsUrlTemplate).not.toContain('placeholder');
  });

  // PR #649 review: a naive replace() on the full URL would rewrite the first sentinel
  // occurrence anywhere, including the host. Splice the LAST occurrence (the one we injected
  // into the path) so a host coincidentally containing the sentinel stays intact.
  test('preserves the base URL host even when it contains the placeholder sentinel', () => {
    process.env.SSO_CALLBACK_BASE_URL = 'https://praetor-slug-placeholder.example.com';
    const { acsUrlTemplate } = sso.getSamlAcsUrlInfo();
    expect(acsUrlTemplate).toBe(
      'https://praetor-slug-placeholder.example.com/api/auth/sso/saml/{slug}/callback',
    );
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
  endSessionEnabled: false,
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
  const originalSsoBase = process.env.SSO_CALLBACK_BASE_URL;

  beforeEach(() => {
    process.env.SSO_CALLBACK_BASE_URL = 'https://app.example.com';
    findBySlugMock.mockResolvedValue({
      ...SAML_PROVIDER,
      metadataUrl: 'https://idp.example.com/metadata',
    });
    // Default: every DNS lookup resolves to a benign public IP.
    dnsLookupMock.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
  });

  afterAll(() => {
    if (originalSsoBase === undefined) delete process.env.SSO_CALLBACK_BASE_URL;
    else process.env.SSO_CALLBACK_BASE_URL = originalSsoBase;
  });

  test('follows a single 302 redirect and re-validates the target', async () => {
    pinnedFetchResponseMock
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
    expect(pinnedFetchResponseMock).toHaveBeenCalledTimes(2);
    // resolveSafeRemoteAddresses runs dns.lookup once per hop.
    expect(dnsLookupMock).toHaveBeenCalledTimes(2);
  });

  test('pins the HTTPS connection to the vetted DNS address while preserving TLS hostname', async () => {
    pinnedFetchResponseMock.mockResolvedValueOnce(
      new Response('<EntityDescriptor entityID="x"/>', { status: 200 }),
    );

    await expect(sso.startSamlLogin('okta')).rejects.toThrow(/missing entry point/);

    expect(dnsLookupMock).toHaveBeenCalledTimes(1);
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
    const requestOptions = httpsRequestMock.mock.calls[0][0];
    expect(requestOptions.hostname).toBe('idp.example.com');
    expect(requestOptions.servername).toBe('idp.example.com');
    expect(requestOptions.headers).toMatchObject({ host: 'idp.example.com' });
    expect(requestOptions.agent).toBe(false);
    expect(requestOptions.autoSelectFamily).toBe(true);
  });

  test('offers every vetted DNS address to connection family selection', async () => {
    const addresses: LookupAddress[] = [
      { address: '2606:4700:4700::1111', family: 6 },
      { address: '203.0.113.10', family: 4 },
    ];
    dnsLookupMock.mockResolvedValue(addresses);
    pinnedFetchResponseMock.mockResolvedValueOnce(
      new Response('<EntityDescriptor entityID="x"/>', { status: 200 }),
    );

    await expect(sso.startSamlLogin('okta')).rejects.toThrow(/missing entry point/);

    const requestOptions = httpsRequestMock.mock.calls[0][0];
    const lookup = requestOptions.lookup;
    if (!lookup) throw new Error('Expected a pinned HTTPS lookup');
    const resolved = await new Promise<LookupAddress[]>((resolve, reject) => {
      lookup('idp.example.com', { all: true }, (error, result) => {
        if (error) reject(error);
        else resolve(result as LookupAddress[]);
      });
    });
    expect(resolved).toEqual(addresses);
    expect(dnsLookupMock).toHaveBeenCalledTimes(1);
  });

  test('normalizes an IPv6 URL hostname for lookup and connects to the vetted literal', async () => {
    findBySlugMock.mockResolvedValue({
      ...SAML_PROVIDER,
      metadataUrl: 'https://[2606:4700:4700::1111]/metadata',
    });
    dnsLookupMock.mockResolvedValue([{ address: '2606:4700:4700::1111', family: 6 }]);
    pinnedFetchResponseMock.mockResolvedValueOnce(
      new Response('<EntityDescriptor entityID="x"/>', { status: 200 }),
    );

    await expect(sso.startSamlLogin('okta')).rejects.toThrow(/missing entry point/);

    expect(dnsLookupMock).toHaveBeenCalledWith('2606:4700:4700::1111', { all: true });
    expect(httpsRequestMock.mock.calls[0][0]).toMatchObject({
      hostname: '2606:4700:4700::1111',
      servername: undefined,
    });
  });

  test('throws when a redirect response is missing the Location header', async () => {
    pinnedFetchResponseMock.mockResolvedValueOnce(new Response(null, { status: 302 }));
    await expect(sso.startSamlLogin('okta')).rejects.toThrow(/Location header/);
  });

  test('closes a malformed redirect stream before throwing for a missing Location header', async () => {
    const incoming = new Readable({ read() {} }) as IncomingMessage;
    incoming.statusCode = 302;
    incoming.statusMessage = 'Found';
    incoming.rawHeaders = [];
    pinnedFetchResponseMock.mockResolvedValueOnce(incoming);

    await expect(sso.startSamlLogin('okta')).rejects.toThrow(/Location header/);

    expect(incoming.destroyed).toBe(true);
  });

  test('rejects when a redirect target resolves to a private IP (per-hop revalidation)', async () => {
    pinnedFetchResponseMock.mockResolvedValueOnce(
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

  test('closes a compressed redirect stream before following the next hop', async () => {
    const incoming = new Readable({ read() {} }) as IncomingMessage;
    incoming.statusCode = 302;
    incoming.statusMessage = 'Found';
    incoming.rawHeaders = [
      'content-encoding',
      'gzip',
      'location',
      'https://idp2.example.com/metadata',
    ];
    pinnedFetchResponseMock
      .mockResolvedValueOnce(incoming)
      .mockResolvedValueOnce(new Response('<EntityDescriptor entityID="x"/>', { status: 200 }));

    await expect(sso.startSamlLogin('okta')).rejects.toThrow(/missing entry point/);

    expect(incoming.destroyed).toBe(true);
  });

  test('rejects after exceeding the redirect limit', async () => {
    // Same Location each time — drives the loop to its bound.
    pinnedFetchResponseMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://idp.example.com/metadata' },
      }),
    );
    await expect(sso.startSamlLogin('okta')).rejects.toThrow(/redirect limit/);
  });

  test('rejects when Content-Length declares a body larger than the cap', async () => {
    // No body, but the declared content-length is enough to fail the pre-stream check.
    pinnedFetchResponseMock.mockResolvedValueOnce(
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
    pinnedFetchResponseMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));
    await expect(sso.startSamlLogin('okta')).rejects.toThrow(/exceeded/);
  });

  test('decompresses gzip metadata before parsing and size enforcement', async () => {
    const compressed = gzipSync('<EntityDescriptor entityID="x"/>');
    pinnedFetchResponseMock.mockResolvedValueOnce(
      new Response(compressed, {
        status: 200,
        headers: {
          'content-encoding': 'gzip',
          'content-length': String(compressed.byteLength),
        },
      }),
    );

    await expect(sso.startSamlLogin('okta')).rejects.toThrow(/missing entry point/);
  });

  test('applies the response cap to decompressed metadata bytes', async () => {
    const compressed = gzipSync(new Uint8Array(2 * 1024 * 1024).fill(65));
    pinnedFetchResponseMock.mockResolvedValueOnce(
      new Response(compressed, {
        status: 200,
        headers: { 'content-encoding': 'gzip' },
      }),
    );

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
      nonce: 'n',
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

describe('OIDC remote endpoint hardening', () => {
  const originalSsoBase = process.env.SSO_CALLBACK_BASE_URL;

  const OIDC_PROVIDER_ENDPOINTS: realSsoProvidersRepo.SsoProvider = {
    ...SAML_PROVIDER,
    id: 'sso-oidc-endpoints',
    protocol: 'oidc',
    slug: 'google',
    name: 'Google',
    issuerUrl: 'https://accounts.google.com',
    clientId: 'cid',
    clientSecret: '',
    scopes: 'openid email profile',
    metadataUrl: '',
    metadataXml: '',
  };

  beforeEach(() => {
    process.env.SSO_CALLBACK_BASE_URL = 'https://app.example.com';
    findBySlugMock.mockResolvedValue(OIDC_PROVIDER_ENDPOINTS);
    oidcBuildAuthorizationUrlMock.mockReturnValue(new URL('https://accounts.google.com/auth'));
  });

  afterAll(() => {
    if (originalSsoBase === undefined) delete process.env.SSO_CALLBACK_BASE_URL;
    else process.env.SSO_CALLBACK_BASE_URL = originalSsoBase;
  });

  test('wires openid-client through the same safe custom fetch and timeout used by discovery', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '142.251.32.46', family: 4 }]);
    oidcDiscoveryMock.mockResolvedValue({ serverMetadata: () => ({}) });

    await sso.startOidcLogin('google');

    const options = oidcDiscoveryMock.mock.calls[0][4];
    expect(options.timeout).toBe(5);
    expect(typeof options[realOidc.customFetch]).toBe('function');

    dnsLookupMock.mockReset();
    dnsLookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    await expect(
      options[realOidc.customFetch]('https://internal.example.com/token', {
        body: undefined,
        headers: {},
        method: 'POST',
        redirect: 'manual',
      }),
    ).rejects.toThrow(/private\/loopback/);
  });

  test('pins OIDC custom fetches to the address returned by their safety lookup', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '142.251.32.46', family: 4 }]);
    oidcDiscoveryMock.mockResolvedValue({ serverMetadata: () => ({}) });
    await sso.startOidcLogin('google');
    const options = oidcDiscoveryMock.mock.calls[0][4];

    dnsLookupMock.mockReset();
    dnsLookupMock.mockResolvedValue([{ address: '203.0.113.25', family: 4 }]);
    httpsRequestMock.mockClear();
    pinnedFetchResponseMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

    await options[realOidc.customFetch]('https://idp.example.com/token', {
      body: 'grant_type=client_credentials',
      headers: {},
      method: 'POST',
      redirect: 'manual',
    });

    expect(dnsLookupMock).toHaveBeenCalledTimes(1);
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
    expect(httpsRequestMock.mock.calls[0][0]).toMatchObject({
      agent: false,
      hostname: 'idp.example.com',
      servername: 'idp.example.com',
    });
    expect(Buffer.from(pinnedFetchResponseMock.mock.calls[0][1]).toString()).toBe(
      'grant_type=client_credentials',
    );
  });

  test('aborts an OIDC response body after headers when the request signal is cancelled', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '142.251.32.46', family: 4 }]);
    oidcDiscoveryMock.mockResolvedValue({ serverMetadata: () => ({}) });
    await sso.startOidcLogin('google');
    const options = oidcDiscoveryMock.mock.calls[0][4];

    const incoming = new Readable({ read() {} }) as IncomingMessage;
    incoming.statusCode = 200;
    incoming.statusMessage = 'OK';
    incoming.rawHeaders = [];
    pinnedFetchResponseMock.mockResolvedValueOnce(incoming);
    const controller = new AbortController();
    const response = await options[realOidc.customFetch]('https://idp.example.com/userinfo', {
      body: undefined,
      headers: {},
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });

    controller.abort();
    await expect(response.text()).rejects.toThrow(/abort/i);
  });

  test('rejects discovered OIDC endpoints that resolve to private addresses before redirecting', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);
    oidcDiscoveryMock.mockResolvedValue({
      serverMetadata: () => ({
        token_endpoint: 'https://internal.example.com/token',
      }),
    });

    await expect(sso.startOidcLogin('google')).rejects.toThrow(/private\/loopback/);
    expect(oidcBuildAuthorizationUrlMock).not.toHaveBeenCalled();
  });

  test('rejects OIDC responses whose Content-Length exceeds the remote response cap', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '142.251.32.46', family: 4 }]);
    oidcDiscoveryMock.mockResolvedValue({ serverMetadata: () => ({}) });
    await sso.startOidcLogin('google');
    const options = oidcDiscoveryMock.mock.calls[0][4];

    dnsLookupMock.mockReset();
    dnsLookupMock.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
    pinnedFetchResponseMock.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { 'content-length': String(2 * 1024 * 1024) },
      }),
    );

    await expect(
      options[realOidc.customFetch]('https://idp.example.com/token', {
        body: undefined,
        headers: {},
        method: 'POST',
        redirect: 'manual',
      }),
    ).rejects.toThrow(/too large/);
  });

  test('rejects streamed OIDC responses that exceed the remote response cap', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '142.251.32.46', family: 4 }]);
    oidcDiscoveryMock.mockResolvedValue({ serverMetadata: () => ({}) });
    await sso.startOidcLogin('google');
    const options = oidcDiscoveryMock.mock.calls[0][4];

    dnsLookupMock.mockReset();
    dnsLookupMock.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
    const oneMb = new Uint8Array(1024 * 1024).fill(65);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(oneMb);
        controller.enqueue(oneMb);
        controller.close();
      },
    });
    pinnedFetchResponseMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

    const response = await options[realOidc.customFetch]('https://idp.example.com/userinfo', {
      body: undefined,
      headers: {},
      method: 'GET',
      redirect: 'manual',
    });
    await expect(response.text()).rejects.toThrow(/exceeded/);
  });

  test('does not validate end_session_endpoint during login when OIDC logout is disabled', async () => {
    oidcDiscoveryMock.mockResolvedValue({
      serverMetadata: () => ({
        end_session_endpoint: 'https://internal.example.com/logout',
      }),
    });

    await sso.startOidcLogin('google');

    expect(dnsLookupMock).not.toHaveBeenCalled();
    expect(oidcBuildAuthorizationUrlMock).toHaveBeenCalledTimes(1);
  });

  test('rejects unsafe end_session_endpoint during login when OIDC logout is enabled', async () => {
    findBySlugMock.mockResolvedValue({ ...OIDC_PROVIDER_ENDPOINTS, endSessionEnabled: true });
    dnsLookupMock.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);
    oidcDiscoveryMock.mockResolvedValue({
      serverMetadata: () => ({
        end_session_endpoint: 'https://internal.example.com/logout',
      }),
    });

    await expect(sso.startOidcLogin('google')).rejects.toThrow(/private\/loopback/);
    expect(oidcBuildAuthorizationUrlMock).not.toHaveBeenCalled();
  });
});

describe('SAML provider validation requires idpIssuer', () => {
  // node-saml does not enforce authn assertion issuer via idpIssuer (issue #597). The service
  // must refuse to save/enable a SAML provider without an expected issuer for Praetor's own
  // post-signature issuer check, and the runtime SAML client must refuse to be built in that
  // shape even when validation was bypassed via a stale DB row.
  const baseSamlInput = {
    protocol: 'saml' as const,
    slug: 'okta-test',
    name: 'Okta',
    enabled: true,
    entryPoint: 'https://idp.example.com/sso',
    idpCert: 'MIIBdummyCert',
  };

  test('createProvider rejects enabled manual SAML config with empty idpIssuer', async () => {
    await expect(sso.createProvider(baseSamlInput)).rejects.toThrow(sso.SsoProviderValidationError);
    await expect(sso.createProvider(baseSamlInput)).rejects.toThrow(/idpIssuer/);
    expect(insertMock).not.toHaveBeenCalled();
  });

  test('createProvider accepts manual SAML config when idpIssuer is set', async () => {
    insertMock.mockImplementation(async (provider: realSsoProvidersRepo.SsoProvider) => provider);
    const created = await sso.createProvider({
      ...baseSamlInput,
      idpIssuer: 'https://idp.example.com/',
    });
    expect(created.idpIssuer).toBe('https://idp.example.com/');
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  test('createProvider accepts metadataXml whose entityID supplies the issuer', async () => {
    insertMock.mockImplementation(async (provider: realSsoProvidersRepo.SsoProvider) => provider);
    const metadataXml = `<?xml version="1.0"?>
<EntityDescriptor entityID="https://idp.example.com/">
  <IDPSSODescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/sso"/>
    <KeyDescriptor><KeyInfo><X509Data><X509Certificate>MIIBcert</X509Certificate></X509Data></KeyInfo></KeyDescriptor>
  </IDPSSODescriptor>
</EntityDescriptor>`;
    const created = await sso.createProvider({
      protocol: 'saml',
      slug: 'okta-metadata',
      name: 'Okta',
      enabled: true,
      metadataXml,
    });
    expect(created.idpIssuer).toBe('');
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  test('createProvider rejects metadataXml that does not expose an entityID', async () => {
    const metadataXml = `<?xml version="1.0"?>
<EntityDescriptor>
  <IDPSSODescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/sso"/>
    <KeyDescriptor><KeyInfo><X509Data><X509Certificate>MIIBcert</X509Certificate></X509Data></KeyInfo></KeyDescriptor>
  </IDPSSODescriptor>
</EntityDescriptor>`;
    await expect(
      sso.createProvider({
        protocol: 'saml',
        slug: 'okta-no-issuer',
        name: 'Okta',
        enabled: true,
        metadataXml,
      }),
    ).rejects.toThrow(/idpIssuer/);
    expect(insertMock).not.toHaveBeenCalled();
  });

  test('createProvider rejects metadataXml with only an issuer when endpoint and cert cannot be resolved', async () => {
    const metadataXml = `<?xml version="1.0"?>
<EntityDescriptor entityID="https://idp.example.com/">
  <IDPSSODescriptor />
</EntityDescriptor>`;
    await expect(
      sso.createProvider({
        protocol: 'saml',
        slug: 'okta-incomplete-metadata',
        name: 'Okta',
        enabled: true,
        metadataXml,
      }),
    ).rejects.toThrow(/metadata URL\/XML or manual entryPoint and idpCert/);
    expect(insertMock).not.toHaveBeenCalled();
  });

  test('createProvider accepts inline metadata issuer with manual endpoint and cert fallback', async () => {
    insertMock.mockImplementation(async (provider: realSsoProvidersRepo.SsoProvider) => provider);
    const metadataXml = `<?xml version="1.0"?>
<EntityDescriptor entityID="https://idp.example.com/">
  <IDPSSODescriptor />
</EntityDescriptor>`;
    const created = await sso.createProvider({
      protocol: 'saml',
      slug: 'okta-metadata-manual',
      name: 'Okta',
      enabled: true,
      metadataXml,
      entryPoint: 'https://idp.example.com/sso',
      idpCert: 'MIIBdummyCert',
    });
    expect(created.idpIssuer).toBe('');
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  test('startSamlLogin refuses to build SAML client when resolved idpIssuer is empty', async () => {
    // Simulates a metadataUrl provider that slipped past save-time validation (e.g. enabled in
    // an older release before this fix). The runtime guard in createSamlClient must still
    // refuse to construct a SAML instance whose idpIssuer would be undefined.
    const originalBase = process.env.SSO_CALLBACK_BASE_URL;
    process.env.SSO_CALLBACK_BASE_URL = 'https://app.example.com';
    try {
      findBySlugMock.mockResolvedValue({
        ...SAML_PROVIDER,
        metadataUrl: '',
        metadataXml: '',
        entryPoint: 'https://idp.example.com/sso',
        idpCert: 'MIIBdummyCert',
        idpIssuer: '',
      });
      await expect(sso.startSamlLogin('okta')).rejects.toThrow(/IdP issuer/);
    } finally {
      if (originalBase === undefined) delete process.env.SSO_CALLBACK_BASE_URL;
      else process.env.SSO_CALLBACK_BASE_URL = originalBase;
    }
  });
});

describe('SAML metadata parsing', () => {
  const originalSsoBase = process.env.SSO_CALLBACK_BASE_URL;

  beforeEach(() => {
    process.env.SSO_CALLBACK_BASE_URL = 'https://app.example.com';
  });

  afterAll(() => {
    if (originalSsoBase === undefined) delete process.env.SSO_CALLBACK_BASE_URL;
    else process.env.SSO_CALLBACK_BASE_URL = originalSsoBase;
  });

  test('scopes issuer, SSO URL, and signing certificate to the same IdP descriptor', async () => {
    const metadataXml = `<?xml version="1.0"?>
<EntitiesDescriptor>
  <EntityDescriptor entityID="https://sp.example.com/">
    <SPSSODescriptor>
      <KeyDescriptor use="signing">
        <KeyInfo><X509Data><X509Certificate>SPCERT</X509Certificate></X509Data></KeyInfo>
      </KeyDescriptor>
    </SPSSODescriptor>
  </EntityDescriptor>
  <EntityDescriptor entityID="https://idp.example.com/">
    <IDPSSODescriptor>
      <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://idp.example.com/post"/>
      <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/sso"/>
      <KeyDescriptor use="encryption">
        <KeyInfo><X509Data><X509Certificate>ENCRYPTIONCERT</X509Certificate></X509Data></KeyInfo>
      </KeyDescriptor>
      <KeyDescriptor use="signing">
        <KeyInfo><X509Data><X509Certificate>IDPCERT</X509Certificate></X509Data></KeyInfo>
      </KeyDescriptor>
    </IDPSSODescriptor>
  </EntityDescriptor>
</EntitiesDescriptor>`;

    findBySlugMock.mockResolvedValue({
      ...SAML_PROVIDER,
      metadataUrl: '',
      metadataXml,
    });

    await expect(sso.startSamlLogin('okta')).resolves.toBe('https://idp.example.com/sso');
    expect(lastSamlOptions).toMatchObject({
      entryPoint: 'https://idp.example.com/sso',
      idpIssuer: 'https://idp.example.com/',
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: true,
    });
    expect(String(lastSamlOptions?.idpCert)).toContain('IDPCERT');
    expect(String(lastSamlOptions?.idpCert)).not.toContain('SPCERT');
    expect(String(lastSamlOptions?.idpCert)).not.toContain('ENCRYPTIONCERT');
  });

  test('prefers a complete IdP descriptor over an earlier incomplete descriptor', async () => {
    const metadataXml = `<?xml version="1.0"?>
<EntitiesDescriptor>
  <EntityDescriptor entityID="https://incomplete-idp.example.com/">
    <IDPSSODescriptor>
      <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://incomplete-idp.example.com/sso"/>
    </IDPSSODescriptor>
  </EntityDescriptor>
  <EntityDescriptor entityID="https://complete-idp.example.com/">
    <IDPSSODescriptor>
      <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://complete-idp.example.com/sso"/>
      <KeyDescriptor use="signing">
        <KeyInfo><X509Data><X509Certificate>COMPLETECERT</X509Certificate></X509Data></KeyInfo>
      </KeyDescriptor>
    </IDPSSODescriptor>
  </EntityDescriptor>
</EntitiesDescriptor>`;

    findBySlugMock.mockResolvedValue({
      ...SAML_PROVIDER,
      metadataUrl: '',
      metadataXml,
    });

    await expect(sso.startSamlLogin('okta')).resolves.toBe('https://complete-idp.example.com/sso');
    expect(lastSamlOptions).toMatchObject({
      entryPoint: 'https://complete-idp.example.com/sso',
      idpIssuer: 'https://complete-idp.example.com/',
    });
    expect(String(lastSamlOptions?.idpCert)).toContain('COMPLETECERT');
  });

  test('prefers an explicit configured issuer over metadata entityID', async () => {
    const metadataXml = `<?xml version="1.0"?>
<EntityDescriptor entityID="https://metadata-idp.example.com/">
  <IDPSSODescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/sso"/>
    <KeyDescriptor use="signing">
      <KeyInfo><X509Data><X509Certificate>IDPCERT</X509Certificate></X509Data></KeyInfo>
    </KeyDescriptor>
  </IDPSSODescriptor>
</EntityDescriptor>`;

    findBySlugMock.mockResolvedValue({
      ...SAML_PROVIDER,
      metadataUrl: '',
      metadataXml,
      idpIssuer: 'https://configured-idp.example.com/',
    });

    await expect(sso.startSamlLogin('okta')).resolves.toBe('https://idp.example.com/sso');
    expect(lastSamlOptions).toMatchObject({
      idpIssuer: 'https://configured-idp.example.com/',
    });
  });

  test('falls back to metadata values when stored manual SAML fields are whitespace', async () => {
    const metadataXml = `<?xml version="1.0"?>
<EntityDescriptor entityID="https://metadata-idp.example.com/">
  <IDPSSODescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/sso"/>
    <KeyDescriptor use="signing">
      <KeyInfo><X509Data><X509Certificate>IDPCERT</X509Certificate></X509Data></KeyInfo>
    </KeyDescriptor>
  </IDPSSODescriptor>
</EntityDescriptor>`;

    findBySlugMock.mockResolvedValue({
      ...SAML_PROVIDER,
      metadataUrl: '',
      metadataXml,
      entryPoint: '   ',
      idpCert: '   ',
      idpIssuer: '   ',
    });

    await expect(sso.startSamlLogin('okta')).resolves.toBe('https://idp.example.com/sso');
    expect(lastSamlOptions).toMatchObject({
      entryPoint: 'https://idp.example.com/sso',
      idpIssuer: 'https://metadata-idp.example.com/',
    });
    expect(String(lastSamlOptions?.idpCert)).toContain('IDPCERT');
  });
});

describe('completeSamlLogin issuer enforcement', () => {
  const originalSsoBase = process.env.SSO_CALLBACK_BASE_URL;

  const manualSamlProvider: realSsoProvidersRepo.SsoProvider = {
    ...SAML_PROVIDER,
    metadataUrl: '',
    entryPoint: 'https://idp.example.com/sso',
    idpCert: 'CERT',
    idpIssuer: '',
    spIssuer: 'https://app.example.com/sp/okta',
  };

  beforeEach(() => {
    process.env.SSO_CALLBACK_BASE_URL = 'https://app.example.com';
  });
  afterAll(() => {
    if (originalSsoBase === undefined) delete process.env.SSO_CALLBACK_BASE_URL;
    else process.env.SSO_CALLBACK_BASE_URL = originalSsoBase;
  });

  test('fails before validatePostResponseAsync when provider.idpIssuer is empty (does NOT fall back to spIssuer)', async () => {
    // Under PR #597, createSamlClient now refuses to construct the SAML instance when
    // idpIssuer is empty — Praetor's issuer comparison would otherwise have no target. The
    // older "SAML response did not include an issuer" path is therefore unreachable for
    // manual mode with empty idpIssuer; the spIssuer-not-a-fallback guarantee still holds.
    findBySlugMock.mockResolvedValue(manualSamlProvider);
    await expect(sso.completeSamlLogin('okta', { SAMLResponse: 'x' })).rejects.toThrow(
      /IdP issuer/,
    );
    expect(samlValidatePostMock).not.toHaveBeenCalled();
    expect(resolveExternalIdentityMock).not.toHaveBeenCalled();
  });

  test('rejects a signed assertion when the issuer is missing', async () => {
    findBySlugMock.mockResolvedValue({
      ...manualSamlProvider,
      idpIssuer: 'https://idp.example.com/realm',
    });
    samlValidatePostMock.mockResolvedValue({
      profile: { nameID: 'user@example.com', issuer: '' },
      loggedOut: false,
    });
    await expect(sso.completeSamlLogin('okta', { SAMLResponse: 'x' })).rejects.toThrow(
      /did not include an issuer/,
    );
    expect(resolveExternalIdentityMock).not.toHaveBeenCalled();
  });

  test('rejects a signed assertion whose issuer does not match the configured IdP issuer', async () => {
    findBySlugMock.mockResolvedValue({
      ...manualSamlProvider,
      idpIssuer: 'https://idp.example.com/configured',
    });
    samlValidatePostMock.mockResolvedValue({
      profile: { nameID: 'user@example.com', issuer: 'https://idp.example.com/from-response' },
      loggedOut: false,
    });
    await expect(sso.completeSamlLogin('okta', { SAMLResponse: 'x' })).rejects.toThrow(
      /issuer did not match/,
    );
    expect(resolveExternalIdentityMock).not.toHaveBeenCalled();
  });

  test('passes the assertion issuer to identity resolution after an exact issuer match', async () => {
    findBySlugMock.mockResolvedValue({
      ...manualSamlProvider,
      idpIssuer: 'https://idp.example.com/configured',
    });
    samlValidatePostMock.mockResolvedValue({
      profile: { nameID: 'user@example.com', issuer: 'https://idp.example.com/configured' },
      loggedOut: false,
    });
    resolveExternalIdentityMock.mockRejectedValue(new Error('stop here'));

    await expect(sso.completeSamlLogin('okta', { SAMLResponse: 'x' })).rejects.toThrow('stop here');
    expect(resolveExternalIdentityMock.mock.calls[0][0]).toMatchObject({
      issuer: 'https://idp.example.com/configured',
    });
  });
});

// Issue #609: structured group claims (Auth0/Okta `[{id, name}]`, Keycloak role-mapper
// `[{name}]`, AD-style `[{cn}]`) used to coerce to '' and silently drop every role mapping.
describe('groups claim coercion accepts structured group objects (issue #609)', () => {
  const originalSsoBase = process.env.SSO_CALLBACK_BASE_URL;

  const samlProvider: realSsoProvidersRepo.SsoProvider = {
    ...SAML_PROVIDER,
    metadataUrl: '',
    entryPoint: 'https://idp.example.com/sso',
    idpCert: 'CERT',
    idpIssuer: 'https://idp.example.com/realm',
  };

  beforeEach(() => {
    process.env.SSO_CALLBACK_BASE_URL = 'https://app.example.com';
    findBySlugMock.mockResolvedValue(samlProvider);
    // Reject at resolveExternalIdentity so the test stops with `groups` already passed in
    // and inspectable, without needing to mock the rest of the login pipeline.
    resolveExternalIdentityMock.mockRejectedValue(new Error('stop here'));
  });

  afterAll(() => {
    if (originalSsoBase === undefined) delete process.env.SSO_CALLBACK_BASE_URL;
    else process.env.SSO_CALLBACK_BASE_URL = originalSsoBase;
  });

  test('extracts group names from objects across every supported key', async () => {
    samlValidatePostMock.mockResolvedValue({
      profile: {
        nameID: 'u@example.com',
        issuer: samlProvider.idpIssuer,
        groups: [
          { id: 'g-1', name: 'admins' },
          { displayName: 'Domain Admins' },
          { cn: 'developers' },
          { groupName: 'auditors' },
        ],
      },
      loggedOut: false,
    });
    await expect(sso.completeSamlLogin('okta', { SAMLResponse: 'x' })).rejects.toThrow('stop here');
    expect(resolveExternalIdentityMock.mock.calls[0][0].groups).toEqual([
      'admins',
      'Domain Admins',
      'developers',
      'auditors',
    ]);
  });

  test('preserves plain-string groups alongside object groups in the same array', async () => {
    samlValidatePostMock.mockResolvedValue({
      profile: {
        nameID: 'u@example.com',
        issuer: samlProvider.idpIssuer,
        groups: ['plain-group', { name: 'object-group' }, 42],
      },
      loggedOut: false,
    });
    await expect(sso.completeSamlLogin('okta', { SAMLResponse: 'x' })).rejects.toThrow('stop here');
    expect(resolveExternalIdentityMock.mock.calls[0][0].groups).toEqual([
      'plain-group',
      'object-group',
      '42',
    ]);
  });

  test('groups whose objects lack a known name key resolve to an empty array (not undefined)', async () => {
    samlValidatePostMock.mockResolvedValue({
      profile: {
        nameID: 'u@example.com',
        issuer: samlProvider.idpIssuer,
        groups: [{ id: 'g-1' }, { id: 'g-2' }],
      },
      loggedOut: false,
    });
    await expect(sso.completeSamlLogin('okta', { SAMLResponse: 'x' })).rejects.toThrow('stop here');
    expect(resolveExternalIdentityMock.mock.calls[0][0].groups).toEqual([]);
  });
});

describe('DbSamlCacheProvider provider scoping', () => {
  const fakeRow = {
    state: 'in-response-to-1',
    providerId: 'sso-A',
    protocol: 'saml' as const,
    codeVerifier: '',
    nonce: '',
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

  test("removeAsync deletes only this provider's request id", async () => {
    statesRemoveForProviderMock.mockResolvedValue('created-at');
    const cache = new sso.DbSamlCacheProvider('sso-A');
    await expect(cache.removeAsync('in-response-to-1')).resolves.toBe('created-at');
    expect(statesRemoveForProviderMock).toHaveBeenCalledWith('in-response-to-1', 'sso-A', 'saml');
  });
});

describe('updateProvider config validation', () => {
  test('rejects enabling a SAML provider with empty usernameAttribute', async () => {
    findByIdMock.mockResolvedValue({
      ...SAML_PROVIDER,
      metadataUrl: 'https://idp.example.com/metadata',
    });
    await expect(
      sso.updateProvider('sso-1', { enabled: true, usernameAttribute: '' }),
    ).rejects.toThrow(sso.SsoProviderValidationError);
    await expect(
      sso.updateProvider('sso-1', { enabled: true, usernameAttribute: '' }),
    ).rejects.toThrow(/usernameAttribute/);
  });
});

// endOidcSession returns null for any case where there is nothing to redirect to (no row,
// provider disabled / opted-out / wrong protocol — all collapsed into the single-query
// JOIN filter — plus discovery doc without `end_session_endpoint`). Transient IdP failures
// throw so the caller (the logout route) catches and falls back to a Praetor-only logout.
describe('endOidcSession', () => {
  const originalSsoBase = process.env.SSO_CALLBACK_BASE_URL;
  const originalFrontend = process.env.FRONTEND_URL;
  const originalEncryptionKey = process.env.ENCRYPTION_KEY;

  const OIDC_PROVIDER: realSsoProvidersRepo.SsoProvider = {
    id: 'sso-oidc-1',
    protocol: 'oidc',
    slug: 'okta',
    name: 'Okta',
    enabled: true,
    issuerUrl: 'https://idp.example.com',
    clientId: 'praetor-client',
    clientSecret: '',
    scopes: 'openid profile email',
    metadataUrl: '',
    metadataXml: '',
    entryPoint: '',
    idpIssuer: '',
    idpCert: '',
    spIssuer: '',
    privateKey: '',
    publicCert: '',
    usernameAttribute: 'preferred_username',
    nameAttribute: 'name',
    emailAttribute: 'email',
    groupsAttribute: 'groups',
    roleMappings: [],
    endSessionEnabled: true,
  };

  let encryptedIdToken: string;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key-32-bytes-long!!';
    const { encrypt } = await import('../../utils/crypto.ts');
    encryptedIdToken = encrypt('eyJ.fake.idtoken');
  });

  beforeEach(() => {
    process.env.SSO_CALLBACK_BASE_URL = 'https://app.example.com';
    process.env.FRONTEND_URL = 'https://app.example.com';
    dnsLookupMock.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
  });

  afterAll(() => {
    if (originalSsoBase === undefined) delete process.env.SSO_CALLBACK_BASE_URL;
    else process.env.SSO_CALLBACK_BASE_URL = originalSsoBase;
    if (originalFrontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontend;
    if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalEncryptionKey;
  });

  const activeRow = (overrides: Partial<{ idToken: string }> = {}) => ({
    session: {
      userId: 'u1',
      providerId: 'sso-oidc-1',
      idToken: overrides.idToken ?? encryptedIdToken,
    },
    provider: OIDC_PROVIDER,
  });

  test('returns null when the JOIN finds no active OIDC session', async () => {
    userSessionsFindActiveOidcByUserIdMock.mockResolvedValue(null);
    expect(await sso.endOidcSession('u1')).toBeNull();
    expect(oidcDiscoveryMock).not.toHaveBeenCalled();
    expect(userSessionsDeleteByUserIdMock).not.toHaveBeenCalled();
  });

  test('returns null and drops the row when the discovery doc has no end_session_endpoint', async () => {
    userSessionsFindActiveOidcByUserIdMock.mockResolvedValue(activeRow());
    oidcDiscoveryMock.mockResolvedValue({ serverMetadata: () => ({}) });

    expect(await sso.endOidcSession('u1')).toBeNull();
    expect(userSessionsDeleteByUserIdMock).toHaveBeenCalledWith('u1');
    expect(oidcBuildEndSessionUrlMock).not.toHaveBeenCalled();
  });

  test('happy path: returns the IdP end-session URL and deletes the row', async () => {
    userSessionsFindActiveOidcByUserIdMock.mockResolvedValue(activeRow());
    oidcDiscoveryMock.mockResolvedValue({
      serverMetadata: () => ({ end_session_endpoint: 'https://idp.example.com/logout' }),
    });
    oidcBuildEndSessionUrlMock.mockReturnValue(
      new URL(
        'https://idp.example.com/logout?id_token_hint=eyJ.fake.idtoken&post_logout_redirect_uri=https%3A%2F%2Fapp.example.com%2F&client_id=praetor-client',
      ),
    );

    const url = await sso.endOidcSession('u1');
    expect(url).toBe(
      'https://idp.example.com/logout?id_token_hint=eyJ.fake.idtoken&post_logout_redirect_uri=https%3A%2F%2Fapp.example.com%2F&client_id=praetor-client',
    );
    // The id_token passed to the IdP must be the DECRYPTED form — passing the ciphertext
    // would not work as id_token_hint and is the regression this assertion guards.
    expect(oidcBuildEndSessionUrlMock).toHaveBeenCalledTimes(1);
    expect(oidcBuildEndSessionUrlMock.mock.calls[0][1]).toEqual({
      id_token_hint: 'eyJ.fake.idtoken',
      post_logout_redirect_uri: 'https://app.example.com/',
      client_id: 'praetor-client',
    });
    expect(userSessionsDeleteByUserIdMock).toHaveBeenCalledWith('u1');
  });

  test('returns null and drops the row when the stored ciphertext cannot be decrypted', async () => {
    userSessionsFindActiveOidcByUserIdMock.mockResolvedValue(
      activeRow({ idToken: 'not-actually-encrypted' }),
    );

    expect(await sso.endOidcSession('u1')).toBeNull();
    expect(userSessionsDeleteByUserIdMock).toHaveBeenCalledWith('u1');
    expect(oidcDiscoveryMock).not.toHaveBeenCalled();
  });

  test('throws (caller catches) but does NOT drop the row when discovery fails', async () => {
    // Transient IdP outage — the row must survive so the next attempt can succeed.
    userSessionsFindActiveOidcByUserIdMock.mockResolvedValue(activeRow());
    oidcDiscoveryMock.mockRejectedValue(new Error('connect ETIMEDOUT'));

    await expect(sso.endOidcSession('u1')).rejects.toThrow(/connect ETIMEDOUT/);
    expect(userSessionsDeleteByUserIdMock).not.toHaveBeenCalled();
  });
});

// Persistence side effects of completeOidcLogin and completeSamlLogin on sso_user_sessions.
// These guard the trade-off documented at completeExternalLogin: SAML / OIDC-without-id_token
// MUST clear any existing row (so a stale OIDC id_token can't drive a later end-session
// redirect for the wrong session), while OIDC-with-id_token writes the encrypted token.
describe('SSO login persists id_token only when one is present', () => {
  const originalSsoBase = process.env.SSO_CALLBACK_BASE_URL;
  const originalFrontend = process.env.FRONTEND_URL;
  const originalEncryptionKey = process.env.ENCRYPTION_KEY;

  const OIDC_PROVIDER_PERSIST: realSsoProvidersRepo.SsoProvider = {
    id: 'sso-oidc-1',
    protocol: 'oidc',
    slug: 'okta',
    name: 'Okta',
    enabled: true,
    issuerUrl: 'https://idp.example.com',
    clientId: 'praetor-client',
    clientSecret: '',
    scopes: 'openid profile email',
    metadataUrl: '',
    metadataXml: '',
    entryPoint: '',
    idpIssuer: '',
    idpCert: '',
    spIssuer: '',
    privateKey: '',
    publicCert: '',
    usernameAttribute: 'preferred_username',
    nameAttribute: 'name',
    emailAttribute: 'email',
    groupsAttribute: 'groups',
    roleMappings: [],
    endSessionEnabled: false,
  };

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key-32-bytes-long!!';
  });

  beforeEach(() => {
    process.env.SSO_CALLBACK_BASE_URL = 'https://app.example.com';
    process.env.FRONTEND_URL = 'https://app.example.com';
    dnsLookupMock.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
    loginTicketsInsertMock.mockResolvedValue(undefined);
    resolveExternalIdentityMock.mockResolvedValue({ id: 'u1', role: 'user' });
  });

  afterAll(() => {
    if (originalSsoBase === undefined) delete process.env.SSO_CALLBACK_BASE_URL;
    else process.env.SSO_CALLBACK_BASE_URL = originalSsoBase;
    if (originalFrontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontend;
    if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalEncryptionKey;
  });

  const setupOidcCallback = () => {
    statesConsumeMock.mockResolvedValue({
      state: 's',
      providerId: 'sso-oidc-1',
      protocol: 'oidc',
      codeVerifier: 'v',
      nonce: 'n',
      relayState: '',
      expiresAt: new Date(Date.now() + 60_000),
    });
    findByIdMock.mockResolvedValue(OIDC_PROVIDER_PERSIST);
    oidcDiscoveryMock.mockResolvedValue({ serverMetadata: () => ({}) });
  };

  test('OIDC login with id_token upserts the encrypted token, parallel with ticket creation', async () => {
    setupOidcCallback();
    oidcAuthorizationCodeGrantMock.mockResolvedValue({
      id_token: 'eyJ.fresh.idtoken',
      access_token: undefined,
      claims: () => ({ sub: 'subj-1', iss: 'https://idp.example.com' }),
    });

    await sso.completeOidcLogin(
      'okta',
      new URL('http://internal.invalid/api/auth/sso/oidc/okta/callback?state=s&code=abc'),
    );

    expect(userSessionsUpsertMock).toHaveBeenCalledTimes(1);
    expect(userSessionsDeleteByUserIdMock).not.toHaveBeenCalled();
    expect(loginTicketsInsertMock).toHaveBeenCalledTimes(1);

    const upsertArg = userSessionsUpsertMock.mock.calls[0][0];
    expect(upsertArg.userId).toBe('u1');
    expect(upsertArg.providerId).toBe('sso-oidc-1');
    // Stored ciphertext, not the plaintext — the regression guard.
    expect(upsertArg.idToken).not.toBe('eyJ.fresh.idtoken');
    const { decrypt } = await import('../../utils/crypto.ts');
    expect(decrypt(upsertArg.idToken)).toBe('eyJ.fresh.idtoken');
  });

  test('OIDC login WITHOUT id_token in the token response clears any prior row', async () => {
    // Some IdPs omit id_token on re-auth. We have no fresh hint, so we drop the stored one
    // rather than redirect later with a stale token that doesn't match the current session.
    setupOidcCallback();
    oidcAuthorizationCodeGrantMock.mockResolvedValue({
      id_token: undefined,
      access_token: undefined,
      claims: () => ({ sub: 'subj-1', iss: 'https://idp.example.com' }),
    });

    await sso.completeOidcLogin(
      'okta',
      new URL('http://internal.invalid/api/auth/sso/oidc/okta/callback?state=s&code=abc'),
    );

    expect(userSessionsUpsertMock).not.toHaveBeenCalled();
    expect(userSessionsDeleteByUserIdMock).toHaveBeenCalledWith('u1');
  });

  test('OIDC login skips UserInfo when discovery does not advertise a userinfo endpoint', async () => {
    setupOidcCallback();
    oidcFetchUserInfoMock.mockRejectedValue(new Error('userinfo should not be called'));
    oidcAuthorizationCodeGrantMock.mockResolvedValue({
      id_token: 'eyJ.fresh.idtoken',
      access_token: 'access-token',
      claims: () => ({
        sub: 'subj-1',
        iss: 'https://idp.example.com',
        preferred_username: 'alice',
        name: 'Alice Example',
        email: 'alice@example.com',
        groups: ['praetor-users'],
      }),
    });

    await sso.completeOidcLogin(
      'okta',
      new URL('http://internal.invalid/api/auth/sso/oidc/okta/callback?state=s&code=abc'),
    );

    expect(oidcFetchUserInfoMock).not.toHaveBeenCalled();
    expect(resolveExternalIdentityMock.mock.calls[0][0]).toMatchObject({
      issuer: 'https://idp.example.com',
      username: 'alice',
      groups: ['praetor-users'],
    });
  });

  test('OIDC identity issuer comes from the ID token, not an overlapping UserInfo claim', async () => {
    setupOidcCallback();
    oidcDiscoveryMock.mockResolvedValue({
      serverMetadata: () => ({ userinfo_endpoint: 'https://idp.example.com/userinfo' }),
    });
    oidcAuthorizationCodeGrantMock.mockResolvedValue({
      id_token: 'eyJ.fresh.idtoken',
      access_token: 'access-token',
      claims: () => ({
        sub: 'subj-1',
        iss: 'https://idp.example.com',
        preferred_username: 'alice-from-id-token',
      }),
    });
    oidcFetchUserInfoMock.mockResolvedValue({
      sub: 'subj-1',
      iss: 'https://conflicting.example.com',
      preferred_username: 'alice-from-userinfo',
    });

    await sso.completeOidcLogin(
      'okta',
      new URL('http://internal.invalid/api/auth/sso/oidc/okta/callback?state=s&code=abc'),
    );

    expect(oidcFetchUserInfoMock).toHaveBeenCalledTimes(1);
    expect(resolveExternalIdentityMock.mock.calls[0][0]).toMatchObject({
      issuer: 'https://idp.example.com',
      username: 'alice-from-userinfo',
    });
  });

  test('SAML login clears any stale OIDC row for the same user', async () => {
    const samlProvider = {
      ...OIDC_PROVIDER_PERSIST,
      protocol: 'saml' as const,
      idpIssuer: 'https://saml.example.com',
      entryPoint: 'https://saml.example.com/sso',
      idpCert: 'CERT',
    };
    findBySlugMock.mockResolvedValue(samlProvider);
    samlValidatePostMock.mockResolvedValue({
      profile: { nameID: 'subj-1', issuer: 'https://saml.example.com' },
      loggedOut: false,
    });

    await sso.completeSamlLogin('okta', { SAMLResponse: 'x' });

    expect(userSessionsDeleteByUserIdMock).toHaveBeenCalledWith('u1');
    expect(userSessionsUpsertMock).not.toHaveBeenCalled();
  });
});

describe('OIDC nonce wiring', () => {
  const originalSsoBase = process.env.SSO_CALLBACK_BASE_URL;

  const OIDC_PROVIDER_NONCE: realSsoProvidersRepo.SsoProvider = {
    ...SAML_PROVIDER,
    id: 'sso-oidc-1',
    protocol: 'oidc',
    slug: 'google',
    name: 'Google',
    issuerUrl: 'https://accounts.google.com',
    clientId: 'cid',
    // Empty clientSecret short-circuits decrypt() in getProviderSecrets, so we don't need a
    // real encrypted payload to exercise this path.
    clientSecret: '',
    scopes: 'openid email profile',
    metadataUrl: '',
    metadataXml: '',
  };

  beforeEach(() => {
    process.env.SSO_CALLBACK_BASE_URL = 'https://app.example.com';
    oidcDiscoveryMock.mockResolvedValue({ serverMetadata: () => ({}) });
  });
  afterAll(() => {
    if (originalSsoBase === undefined) delete process.env.SSO_CALLBACK_BASE_URL;
    else process.env.SSO_CALLBACK_BASE_URL = originalSsoBase;
  });

  test('startOidcLogin generates a nonce, persists it, and forwards it to buildAuthorizationUrl', async () => {
    findBySlugMock.mockResolvedValue(OIDC_PROVIDER_NONCE);
    statesInsertMock.mockResolvedValue(undefined);
    oidcBuildAuthorizationUrlMock.mockImplementation(
      (_config: unknown, parameters: Record<string, string>) => {
        const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        for (const [k, v] of Object.entries(parameters)) u.searchParams.set(k, v);
        return u;
      },
    );

    const urlString = await sso.startOidcLogin('google');

    expect(statesInsertMock).toHaveBeenCalledTimes(1);
    const inserted = statesInsertMock.mock.calls[0][0];
    expect(inserted.protocol).toBe('oidc');
    expect(inserted.providerId).toBe('sso-oidc-1');
    expect(typeof inserted.nonce).toBe('string');
    expect(inserted.nonce.length).toBeGreaterThan(0);

    expect(oidcBuildAuthorizationUrlMock).toHaveBeenCalledTimes(1);
    const params = oidcBuildAuthorizationUrlMock.mock.calls[0][1];
    expect(params.nonce).toBe(inserted.nonce);
    expect(params.state).toBe(inserted.state);
    expect(params.code_challenge_method).toBe('S256');

    expect(new URL(urlString).searchParams.get('nonce')).toBe(inserted.nonce);
  });

  test('completeOidcLogin forwards the persisted nonce as expectedNonce to authorizationCodeGrant', async () => {
    statesConsumeMock.mockResolvedValue({
      state: 'st',
      providerId: 'sso-oidc-1',
      protocol: 'oidc',
      codeVerifier: 'verifier',
      nonce: 'persisted-nonce',
      relayState: '',
      expiresAt: new Date(Date.now() + 60_000),
    });
    findByIdMock.mockResolvedValue(OIDC_PROVIDER_NONCE);
    // Throwing from the grant short-circuits the downstream user-lookup we don't need to
    // exercise here; the assertion we care about is the `expectedNonce` argument.
    oidcAuthorizationCodeGrantMock.mockRejectedValue(new Error('stop after grant'));

    const callbackUrl = new URL(
      'http://internal.invalid/api/auth/sso/oidc/google/callback?state=st&code=abc',
    );
    await expect(sso.completeOidcLogin('google', callbackUrl)).rejects.toThrow('stop after grant');

    expect(oidcAuthorizationCodeGrantMock).toHaveBeenCalledTimes(1);
    const checks = oidcAuthorizationCodeGrantMock.mock.calls[0][2];
    expect(checks).toMatchObject({
      expectedState: 'st',
      pkceCodeVerifier: 'verifier',
      expectedNonce: 'persisted-nonce',
      idTokenExpected: true,
    });
  });
});
