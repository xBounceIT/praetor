import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realSsoProvidersRepo from '../../repositories/ssoProvidersRepo.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';

const ssoProvidersRepoSnap = { ...realSsoProvidersRepo };

const findBySlugMock = mock();

let routePlugin: FastifyPluginAsync;

beforeAll(async () => {
  mock.module('../../repositories/ssoProvidersRepo.ts', () => ({
    ...ssoProvidersRepoSnap,
    findBySlug: findBySlugMock,
  }));

  routePlugin = (await import('../../routes/sso-auth.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  mock.module('../../repositories/ssoProvidersRepo.ts', () => ssoProvidersRepoSnap);
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
};

describe('GET /api/auth/sso/saml/:slug/metadata', () => {
  const originalSsoBase = process.env.SSO_CALLBACK_BASE_URL;
  let testApp: FastifyInstance;

  beforeEach(async () => {
    process.env.SSO_CALLBACK_BASE_URL = 'https://app.example.com';
    findBySlugMock.mockReset();
    testApp = await buildRouteTestApp(routePlugin, '/api/auth/sso');
  });

  afterEach(async () => {
    await testApp.close();
  });

  afterAll(() => {
    if (originalSsoBase === undefined) delete process.env.SSO_CALLBACK_BASE_URL;
    else process.env.SSO_CALLBACK_BASE_URL = originalSsoBase;
  });

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
