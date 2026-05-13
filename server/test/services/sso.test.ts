import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
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
  }));

  sso = await import('../../services/sso.ts');
});

afterAll(() => {
  mock.module('node:dns/promises', () => dnsSnap);
  mock.module('../../repositories/ssoProvidersRepo.ts', () => ssoProvidersRepoSnap);
  mock.module('../../repositories/ssoStatesRepo.ts', () => ssoStatesRepoSnap);
});

beforeEach(() => {
  for (const m of [dnsLookupMock, findBySlugMock, findByIdMock, statesConsumeMock]) m.mockReset();
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
