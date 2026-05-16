import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realSsoProvidersRepo from '../../repositories/ssoProvidersRepo.ts';
import * as realSsoService from '../../services/sso.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';

// Mix of two concerns sharing the same route plugin:
//  1. Metadata + start endpoints surface disabled/missing providers as 404 (#600, #635).
//  2. Callback handlers redirect with a stable `sso_error` CODE — never the raw library
//     `err.message` (#604).

const ssoProvidersRepoSnap = { ...realSsoProvidersRepo };
const ssoServiceSnap = { ...realSsoService };

const findBySlugMock = mock();
const completeOidcLoginMock = mock();
const completeSamlLoginMock = mock();

let routePlugin: FastifyPluginAsync;

beforeAll(async () => {
  // Set FRONTEND_URL so `handleSsoCallbackError` produces a stable absolute URL we can assert on.
  process.env.FRONTEND_URL = 'https://app.example.com';

  mock.module('../../repositories/ssoProvidersRepo.ts', () => ({
    ...ssoProvidersRepoSnap,
    findBySlug: findBySlugMock,
  }));
  mock.module('../../services/sso.ts', () => ({
    ...ssoServiceSnap,
    completeOidcLogin: completeOidcLoginMock,
    completeSamlLogin: completeSamlLoginMock,
  }));

  routePlugin = (await import('../../routes/sso-auth.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  mock.module('../../repositories/ssoProvidersRepo.ts', () => ssoProvidersRepoSnap);
  mock.module('../../services/sso.ts', () => ssoServiceSnap);
});

const samlProvider: realSsoProvidersRepo.SsoProvider = {
  id: 'sso-1',
  protocol: 'saml',
  slug: 'okta',
  name: 'Okta',
  enabled: true,
  issuerUrl: '',
  clientId: '',
  clientSecret: '',
  scopes: '',
  metadataUrl: '',
  metadataXml: '',
  entryPoint: 'https://idp.example.com/sso',
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

const oidcProvider: realSsoProvidersRepo.SsoProvider = {
  ...samlProvider,
  protocol: 'oidc',
  slug: 'google',
  issuerUrl: 'https://accounts.google.com',
  clientId: 'client-123',
  entryPoint: '',
};

const originalSsoBase = process.env.SSO_CALLBACK_BASE_URL;
let testApp: FastifyInstance;

beforeEach(async () => {
  process.env.SSO_CALLBACK_BASE_URL = 'https://app.example.com';
  findBySlugMock.mockReset();
  completeOidcLoginMock.mockReset();
  completeSamlLoginMock.mockReset();
  testApp = await buildRouteTestApp(routePlugin, '/api/auth/sso');
});

afterEach(async () => {
  await testApp.close();
});

afterAll(() => {
  if (originalSsoBase === undefined) delete process.env.SSO_CALLBACK_BASE_URL;
  else process.env.SSO_CALLBACK_BASE_URL = originalSsoBase;
});

describe('GET /api/auth/sso/saml/:slug/metadata', () => {
  test.each([
    ['disabled provider', { ...samlProvider, enabled: false }],
    ['missing provider', null],
    ['wrong-protocol provider', { ...samlProvider, protocol: 'oidc' as const }],
  ])('returns 404 for %s', async (_label, mocked) => {
    findBySlugMock.mockResolvedValue(mocked);
    const response = await testApp.inject({
      method: 'GET',
      url: '/api/auth/sso/saml/okta/metadata',
    });
    expect(response.statusCode).toBe(404);
  });

  test('returns 200 with SAML metadata XML for an enabled provider', async () => {
    findBySlugMock.mockResolvedValue(samlProvider);
    const response = await testApp.inject({
      method: 'GET',
      url: '/api/auth/sso/saml/okta/metadata',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/samlmetadata+xml');
    expect(response.body).toContain('EntityDescriptor');
  });
});

// Locks in the /start-route behaviour change introduced alongside #600: missing or disabled
// providers now surface as 404 via NotFoundError instead of the previous bare 500.
describe('GET /api/auth/sso/saml/:slug/start', () => {
  test.each([
    ['disabled provider', { ...samlProvider, enabled: false }],
    ['missing provider', null],
    ['wrong-protocol provider', { ...samlProvider, protocol: 'oidc' as const }],
  ])('returns 404 for %s', async (_label, mocked) => {
    findBySlugMock.mockResolvedValue(mocked);
    const response = await testApp.inject({
      method: 'GET',
      url: '/api/auth/sso/saml/okta/start',
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('GET /api/auth/sso/oidc/:slug/start', () => {
  test.each([
    ['disabled provider', { ...oidcProvider, enabled: false }],
    ['missing provider', null],
    ['wrong-protocol provider', { ...oidcProvider, protocol: 'saml' as const }],
  ])('returns 404 for %s', async (_label, mocked) => {
    findBySlugMock.mockResolvedValue(mocked);
    const response = await testApp.inject({
      method: 'GET',
      url: '/api/auth/sso/oidc/google/start',
    });
    expect(response.statusCode).toBe(404);
  });
});

const ssoErrorParam = (location: string): string =>
  new URL(location).searchParams.get('sso_error') ?? '';

describe('SSO callbacks — sso_error carries a stable code (issue #604)', () => {
  test('SAML callback redirects with the SsoLoginError.code, not err.message', async () => {
    completeSamlLoginMock.mockRejectedValue(
      new realSsoService.SsoLoginError(
        'SAML response did not include a subject',
        'invalid_response',
      ),
    );

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/auth/sso/saml/okta/callback',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'SAMLResponse=fake',
    });

    expect(response.statusCode).toBe(302);
    const location = response.headers.location ?? '';
    expect(ssoErrorParam(location)).toBe('invalid_response');
    // Negative assertion: the raw library wording must not leak through.
    expect(location).not.toContain('subject');
    expect(location).not.toContain('SAML+response');
  });

  test('OIDC callback redirects with the SsoLoginError.code for invalid state', async () => {
    completeOidcLoginMock.mockRejectedValue(
      new realSsoService.SsoLoginError('Invalid or expired SSO state', 'invalid_state'),
    );

    const response = await testApp.inject({
      method: 'GET',
      url: '/api/auth/sso/oidc/google/callback?state=x&code=y',
    });

    expect(response.statusCode).toBe(302);
    expect(ssoErrorParam(response.headers.location ?? '')).toBe('invalid_state');
  });

  test('a plain Error (not SsoLoginError) maps to the generic code, never raw text', async () => {
    completeOidcLoginMock.mockRejectedValue(new Error('unexpected library wording'));

    const response = await testApp.inject({
      method: 'GET',
      url: '/api/auth/sso/oidc/google/callback?state=x&code=y',
    });

    expect(response.statusCode).toBe(302);
    const location = response.headers.location ?? '';
    expect(ssoErrorParam(location)).toBe('generic');
    expect(location).not.toContain('library');
    expect(location).not.toContain('wording');
  });

  test('sso_error is always one of the known stable codes', async () => {
    // Regression guard: if a contributor reverts to passing err.message, the raw library
    // wording below would replace the code in the redirect URL and miss the allow-list.
    // Sourcing the allow-list from the service ensures any new code added there is
    // automatically covered.
    const KNOWN = new Set<string>(realSsoService.SSO_LOGIN_ERROR_CODES);

    completeSamlLoginMock.mockRejectedValue(
      new realSsoService.SsoLoginError(
        'SAML provider is missing entry point or IdP certificate',
        'provider_misconfigured',
      ),
    );

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/auth/sso/saml/okta/callback',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'SAMLResponse=fake',
    });

    expect(KNOWN.has(ssoErrorParam(response.headers.location ?? ''))).toBe(true);
  });

  test('NotFoundError from a disabled-provider callback maps to provider_disabled', async () => {
    // Disabled/missing providers throw NotFoundError from getEnabledProviderBySlug. On the
    // metadata + start routes that propagates to a 404; on the callback routes the catch
    // helper has to translate it so the login screen shows a translated message rather than
    // the generic fallback. The mocked `completeSamlLogin` raises NotFoundError directly so
    // the test exercises the handler's mapping rather than the upstream throw site.
    const { NotFoundError } = await import('../../utils/http-errors.ts');
    completeSamlLoginMock.mockRejectedValue(new NotFoundError('SSO provider'));

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/auth/sso/saml/okta/callback',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'SAMLResponse=fake',
    });

    expect(response.statusCode).toBe(302);
    expect(ssoErrorParam(response.headers.location ?? '')).toBe('provider_disabled');
  });
});
