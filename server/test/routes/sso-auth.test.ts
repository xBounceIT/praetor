import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import * as realSsoService from '../../services/sso.ts';

// Issue #604 — the SSO callback handlers must redirect with a stable error CODE in `sso_error`,
// never the raw library `err.message`. Anything else leaks library wording and bypasses i18n.

const ssoServiceSnap = { ...realSsoService };

const completeOidcLoginMock = mock();
const completeSamlLoginMock = mock();

let routePlugin: FastifyPluginAsync;

beforeAll(async () => {
  // Set FRONTEND_URL so `buildFrontendErrorUrl` produces a stable absolute URL we can assert on.
  process.env.FRONTEND_URL = 'https://app.example.com';

  mock.module('../../services/sso.ts', () => ({
    ...ssoServiceSnap,
    completeOidcLogin: completeOidcLoginMock,
    completeSamlLogin: completeSamlLoginMock,
  }));

  routePlugin = (await import('../../routes/sso-auth.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  mock.module('../../services/sso.ts', () => ssoServiceSnap);
});

let testApp: FastifyInstance;

beforeEach(async () => {
  completeOidcLoginMock.mockReset();
  completeSamlLoginMock.mockReset();
  testApp = Fastify({ logger: false });
  testApp.decorate('rateLimit', () => async () => {});
  await testApp.register(routePlugin, { prefix: '/api/auth/sso' });
  await testApp.ready();
});

afterEach(async () => {
  await testApp.close();
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
    // This protects against regressions where a contributor reverts to passing err.message:
    // any string in the allow-list set passes; arbitrary library messages would not.
    const KNOWN = new Set([
      'invalid_state',
      'invalid_response',
      'provider_disabled',
      'provider_misconfigured',
      'account_disabled',
      'identity_conflict',
      'generic',
    ]);

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
});
