import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import rateLimit from 'fastify-rate-limit';
import * as realAuth from '../../middleware/auth.ts';
import * as realSsoProvidersRepo from '../../repositories/ssoProvidersRepo.ts';
import * as realFirstLogin from '../../services/firstLogin.ts';
import * as realSsoService from '../../services/sso.ts';
import * as realAudit from '../../utils/audit.ts';
import * as realRateLimit from '../../utils/rate-limit.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';

// Mix of two concerns sharing the same route plugin:
//  1. Metadata + start endpoints surface disabled/missing providers as 404 (#600, #635).
//  2. Callback handlers redirect with a stable `sso_error` CODE — never the raw library
//     `err.message` (#604).

const ssoProvidersRepoSnap = { ...realSsoProvidersRepo };
const ssoServiceSnap = { ...realSsoService };
const authSnap = { ...realAuth };
const firstLoginSnap = { ...realFirstLogin };
const auditSnap = { ...realAudit };
const rateLimitSnap = { ...realRateLimit };

const findBySlugMock = mock();
const completeOidcLoginMock = mock();
const completeSamlLoginMock = mock();
const consumeLoginTicketMock = mock();
const buildAuthUserResponseMock = mock();
const generateTokenWithCurrentIdleTimeoutMock = mock();
const recordFirstInteractiveLoginMock = mock();
const logAuditMock = mock();
const routeMocks = [
  findBySlugMock,
  completeOidcLoginMock,
  completeSamlLoginMock,
  consumeLoginTicketMock,
  buildAuthUserResponseMock,
  generateTokenWithCurrentIdleTimeoutMock,
  recordFirstInteractiveLoginMock,
  logAuditMock,
];

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
    consumeLoginTicket: consumeLoginTicketMock,
    buildAuthUserResponse: buildAuthUserResponseMock,
  }));
  mock.module('../../middleware/auth.ts', () => ({
    ...authSnap,
    generateTokenWithCurrentIdleTimeout: generateTokenWithCurrentIdleTimeoutMock,
  }));
  mock.module('../../services/firstLogin.ts', () => ({
    ...firstLoginSnap,
    recordFirstInteractiveLogin: recordFirstInteractiveLoginMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));
  mock.module('../../utils/rate-limit.ts', () => ({
    ...rateLimitSnap,
    LOGIN_RATE_LIMIT: { max: 2, timeWindow: '1 minute' },
  }));

  routePlugin = (await import('../../routes/sso-auth.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  mock.module('../../repositories/ssoProvidersRepo.ts', () => ssoProvidersRepoSnap);
  mock.module('../../services/sso.ts', () => ssoServiceSnap);
  mock.module('../../middleware/auth.ts', () => authSnap);
  mock.module('../../services/firstLogin.ts', () => firstLoginSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
  mock.module('../../utils/rate-limit.ts', () => rateLimitSnap);
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
  for (const routeMock of routeMocks) routeMock.mockReset();
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

describe('POST /api/auth/sso/consume', () => {
  test.each([
    ['with RIL access', ['timesheets.ril.view'], true],
    ['without RIL access', [], false],
  ])('records the first interactive login %s', async (_label, permissions, createTip) => {
    const tokenUser = {
      id: 'u1',
      name: 'Alice',
      username: 'alice',
      role: 'user',
      avatarInitials: 'AL',
      authMethod: 'oidc' as const,
      isDisabled: false,
      sessionVersion: 4,
      tokenVersion: 2,
    };
    const responseUser = {
      ...tokenUser,
      permissions,
      availableRoles: [{ id: 'user', name: 'User', isSystem: true, isAdmin: false }],
    };
    consumeLoginTicketMock.mockResolvedValue({ tokenUser, activeRole: 'user' });
    buildAuthUserResponseMock.mockResolvedValue(responseUser);
    generateTokenWithCurrentIdleTimeoutMock.mockResolvedValue('signed-token');
    recordFirstInteractiveLoginMock.mockResolvedValue(true);
    logAuditMock.mockResolvedValue(undefined);

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/auth/sso/consume',
      payload: { ticket: 'one-time-ticket' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      token: 'signed-token',
      user: {
        id: 'u1',
        name: 'Alice',
        username: 'alice',
        role: 'user',
        avatarInitials: 'AL',
        authMethod: 'oidc',
        permissions,
        availableRoles: responseUser.availableRoles,
      },
    });
    expect(recordFirstInteractiveLoginMock).toHaveBeenCalledWith('u1', {
      createRilPreferencesTip: createTip,
    });
  });
});

const ssoErrorParam = (location: string): string =>
  new URL(location).searchParams.get('sso_error') ?? '';

describe('POST /api/auth/sso/saml/:slug/callback rate limiting', () => {
  test('applies LOGIN_RATE_LIMIT before SAML response processing', async () => {
    completeSamlLoginMock.mockResolvedValue('https://app.example.com');
    const app = Fastify({ logger: false });

    await app.register(rateLimit, {
      ...rateLimitSnap.GLOBAL_RATE_LIMIT,
      global: true,
      hook: 'onRequest',
    });
    await app.register(routePlugin, { prefix: '/api/auth/sso' });
    await app.ready();

    try {
      const request = {
        method: 'POST' as const,
        url: '/api/auth/sso/saml/okta/callback',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'SAMLResponse=fake',
      };
      const first = await app.inject(request);
      const second = await app.inject(request);
      const third = await app.inject(request);

      expect(first.statusCode).toBe(302);
      expect(second.statusCode).toBe(302);
      expect(third.statusCode).toBe(429);
      expect(completeSamlLoginMock).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });
});

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
