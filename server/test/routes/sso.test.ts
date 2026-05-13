import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realSsoProvidersRepo from '../../repositories/ssoProvidersRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realAudit from '../../utils/audit.ts';
import { MASKED_SECRET } from '../../utils/crypto.ts';
import * as realPermissions from '../../utils/permissions.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';
import { signToken } from '../helpers/jwt.ts';

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const ssoProvidersRepoSnap = { ...realSsoProvidersRepo };
const auditSnap = { ...realAudit };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const findExistingIdsMock = mock();
const listMock = mock();
const findByIdMock = mock();
const updateMock = mock();
const logAuditMock = mock(async () => undefined);

let routePlugin: FastifyPluginAsync;

// Required by utils/crypto.ts for the encrypt path exercised when a non-masked secret is PUT.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-32-bytes-long!!';

beforeAll(async () => {
  installAuthMiddlewareMock();

  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findAuthUserById: findAuthUserByIdMock,
  }));
  mock.module('../../repositories/rolesRepo.ts', () => ({
    ...rolesRepoSnap,
    findExistingIds: findExistingIdsMock,
    userHasRole: userHasRoleMock,
  }));
  mock.module('../../utils/permissions.ts', () => ({
    ...permissionsSnap,
    getRolePermissions: getRolePermissionsMock,
  }));
  mock.module('../../repositories/ssoProvidersRepo.ts', () => ({
    ...ssoProvidersRepoSnap,
    list: listMock,
    findById: findByIdMock,
    update: updateMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));

  routePlugin = (await import('../../routes/sso.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/ssoProvidersRepo.ts', () => ssoProvidersRepoSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
});

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'admin',
  avatarInitials: 'AL',
  isDisabled: false,
};

const baseProvider: realSsoProvidersRepo.SsoProvider = {
  id: 'sso-1',
  protocol: 'oidc',
  slug: 'google',
  name: 'Google',
  enabled: true,
  issuerUrl: 'https://accounts.google.com',
  clientId: 'client-123',
  // Stored ciphertext — not the plaintext. The masking logic only cares whether non-empty.
  clientSecret: 'iv:tag:ciphertext',
  scopes: 'openid profile email',
  metadataUrl: '',
  metadataXml: '',
  entryPoint: '',
  idpIssuer: '',
  idpCert: '',
  spIssuer: '',
  privateKey: 'iv:tag:pkcipher',
  publicCert: '',
  usernameAttribute: 'preferred_username',
  nameAttribute: 'name',
  emailAttribute: 'email',
  groupsAttribute: 'groups',
  roleMappings: [],
};

let testApp: FastifyInstance;

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  findExistingIdsMock,
  listMock,
  findByIdMock,
  updateMock,
  logAuditMock,
];

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue([
    'administration.authentication.view',
    'administration.authentication.update',
  ]);
  findExistingIdsMock.mockResolvedValue(new Set<string>());
  logAuditMock.mockImplementation(async () => undefined);
  testApp = await buildRouteTestApp(routePlugin, '/api/sso');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('GET /api/sso/providers — secret masking', () => {
  test('clientSecret and privateKey are returned as MASKED_SECRET when set', async () => {
    listMock.mockResolvedValue([baseProvider]);
    const response = await testApp.inject({
      method: 'GET',
      url: '/api/sso/providers',
      headers: authHeader(),
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveLength(1);
    expect(body[0].clientSecret).toBe(MASKED_SECRET);
    expect(body[0].privateKey).toBe(MASKED_SECRET);
  });

  test('empty secrets stay empty (no spurious mask)', async () => {
    listMock.mockResolvedValue([{ ...baseProvider, clientSecret: '', privateKey: '' }]);
    const response = await testApp.inject({
      method: 'GET',
      url: '/api/sso/providers',
      headers: authHeader(),
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body[0].clientSecret).toBe('');
    expect(body[0].privateKey).toBe('');
  });

  test('metadataXml and idpCert are masked when set', async () => {
    listMock.mockResolvedValue([
      {
        ...baseProvider,
        protocol: 'saml',
        metadataXml: '<EntityDescriptor>...</EntityDescriptor>',
        idpCert: 'MIIDxx...',
      },
    ]);
    const response = await testApp.inject({
      method: 'GET',
      url: '/api/sso/providers',
      headers: authHeader(),
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body[0].metadataXml).toBe(MASKED_SECRET);
    expect(body[0].idpCert).toBe(MASKED_SECRET);
  });
});

describe('PUT /api/sso/providers/:id — masked sentinel preserves existing secrets', () => {
  test('clientSecret === MASKED_SECRET is dropped from patch (existing value preserved)', async () => {
    findByIdMock.mockResolvedValue(baseProvider);
    updateMock.mockImplementation(
      async (_id: string, patch: realSsoProvidersRepo.SsoProviderPatch) => ({
        ...baseProvider,
        ...patch,
      }),
    );
    const response = await testApp.inject({
      method: 'PUT',
      url: '/api/sso/providers/sso-1',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: {
        clientSecret: MASKED_SECRET,
        privateKey: MASKED_SECRET,
        name: 'Google (renamed)',
      },
    });
    expect(response.statusCode).toBe(200);
    const [, patch] = updateMock.mock.calls[0];
    expect(patch).not.toHaveProperty('clientSecret');
    expect(patch).not.toHaveProperty('privateKey');
    expect(patch.name).toBe('Google (renamed)');
  });

  test('a new (non-masked) clientSecret IS encrypted and persisted', async () => {
    findByIdMock.mockResolvedValue(baseProvider);
    updateMock.mockImplementation(
      async (_id: string, patch: realSsoProvidersRepo.SsoProviderPatch) => ({
        ...baseProvider,
        ...patch,
      }),
    );
    const response = await testApp.inject({
      method: 'PUT',
      url: '/api/sso/providers/sso-1',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: { clientSecret: 'a-real-new-secret' },
    });
    expect(response.statusCode).toBe(200);
    const [, patch] = updateMock.mock.calls[0];
    expect(typeof patch.clientSecret).toBe('string');
    // Should be encrypted ciphertext, not the raw plaintext.
    expect(patch.clientSecret).not.toBe('a-real-new-secret');
    expect(patch.clientSecret).not.toBe('');
  });

  test('metadataXml === MASKED_SECRET is dropped from patch', async () => {
    findByIdMock.mockResolvedValue({ ...baseProvider, protocol: 'saml' });
    updateMock.mockImplementation(
      async (_id: string, patch: realSsoProvidersRepo.SsoProviderPatch) => ({
        ...baseProvider,
        ...patch,
      }),
    );
    const response = await testApp.inject({
      method: 'PUT',
      url: '/api/sso/providers/sso-1',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: { metadataXml: MASKED_SECRET, idpCert: MASKED_SECRET },
    });
    expect(response.statusCode).toBe(200);
    const [, patch] = updateMock.mock.calls[0];
    expect(patch).not.toHaveProperty('metadataXml');
    expect(patch).not.toHaveProperty('idpCert');
  });
});
