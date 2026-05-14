import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
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
const insertMock = mock();
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
    insert: insertMock,
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
  sessionVersion: 1,
};

const FULL_PERMS = ['administration.authentication.view', 'administration.authentication.update'];

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

const samlProvider = (
  patch: Partial<realSsoProvidersRepo.SsoProvider> = {},
): realSsoProvidersRepo.SsoProvider => ({
  ...baseProvider,
  protocol: 'saml',
  issuerUrl: '',
  clientId: '',
  clientSecret: '',
  metadataUrl: '',
  metadataXml: '',
  entryPoint: '',
  idpIssuer: '',
  idpCert: '',
  spIssuer: '',
  ...patch,
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

// Snapshots are populated from preHandler/onResponse hooks. We rebuild the app each test so
// the snapshots are fresh and the hooks can be registered before `.ready()` is called.
type BodySnapshots = { before: unknown; after: unknown };

const buildAppWithSnapshots = async (snapshots: BodySnapshots): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false });
  app.decorate('rateLimit', () => async () => {});
  app.addHook('preHandler', async (request) => {
    snapshots.before = JSON.parse(JSON.stringify(request.body ?? null));
  });
  app.addHook('onResponse', async (request) => {
    snapshots.after = JSON.parse(JSON.stringify(request.body ?? null));
  });
  await app.register(routePlugin, { prefix: '/api/sso' });
  await app.ready();
  return app;
};

let testApp: FastifyInstance;
let bodySnapshots: BodySnapshots;

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  findExistingIdsMock,
  listMock,
  findByIdMock,
  insertMock,
  updateMock,
  logAuditMock,
];

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(FULL_PERMS);
  findExistingIdsMock.mockImplementation(async () => new Set<string>(['user', 'manager', 'admin']));
  logAuditMock.mockImplementation(async () => undefined);

  bodySnapshots = { before: null, after: null };
  testApp = await buildAppWithSnapshots(bodySnapshots);
});

afterEach(async () => {
  await testApp.close();
});

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
    const existing = samlProvider({
      enabled: true,
      metadataXml: '<EntityDescriptor />',
      idpCert: 'MIIDstoredcert',
    });
    findByIdMock.mockResolvedValue(existing);
    updateMock.mockImplementation(
      async (_id: string, patch: realSsoProvidersRepo.SsoProviderPatch) => ({
        ...existing,
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

describe('PUT /api/sso/providers/:id — enabled SAML configuration validation', () => {
  test('rejects enabling a SAML provider without metadata or manual IdP config', async () => {
    findByIdMock.mockResolvedValue(samlProvider({ enabled: false }));

    const response = await testApp.inject({
      method: 'PUT',
      url: '/api/sso/providers/sso-1',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: { enabled: true },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: 'SAML requires metadata URL/XML or manual entryPoint and idpCert',
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('rejects clearing the only config source on an enabled SAML provider', async () => {
    const existing = samlProvider({
      enabled: true,
      metadataUrl: 'https://idp.example.com/metadata',
    });
    findByIdMock.mockResolvedValue(existing);

    const response = await testApp.inject({
      method: 'PUT',
      url: '/api/sso/providers/sso-1',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: { metadataUrl: '' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: 'SAML requires metadata URL/XML or manual entryPoint and idpCert',
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('allows enabling a manual SAML provider when masked idpCert preserves the stored cert', async () => {
    const existing = samlProvider({
      enabled: false,
      entryPoint: 'https://idp.example.com/sso',
      idpCert: 'MIIDstoredcert',
    });
    findByIdMock.mockResolvedValue(existing);
    updateMock.mockImplementation(
      async (_id: string, patch: realSsoProvidersRepo.SsoProviderPatch) => ({
        ...existing,
        ...patch,
      }),
    );

    const response = await testApp.inject({
      method: 'PUT',
      url: '/api/sso/providers/sso-1',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: {
        enabled: true,
        entryPoint: 'https://idp.example.com/sso',
        idpCert: MASKED_SECRET,
      },
    });

    expect(response.statusCode).toBe(200);
    const [, patch] = updateMock.mock.calls[0];
    expect(patch.enabled).toBe(true);
    expect(patch).not.toHaveProperty('idpCert');
  });
});

describe('PUT /api/sso/providers/:id — enabled OIDC configuration validation', () => {
  test('rejects enabling an OIDC provider without required stored config', async () => {
    findByIdMock.mockResolvedValue({
      ...baseProvider,
      enabled: false,
      issuerUrl: '',
      clientId: '',
      usernameAttribute: '',
    });

    const response = await testApp.inject({
      method: 'PUT',
      url: '/api/sso/providers/sso-1',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: { enabled: true },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: 'issuerUrl is required' });
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('allows a partial enable update when stored OIDC config is already complete', async () => {
    const existing = { ...baseProvider, enabled: false };
    findByIdMock.mockResolvedValue(existing);
    updateMock.mockImplementation(
      async (_id: string, patch: realSsoProvidersRepo.SsoProviderPatch) => ({
        ...existing,
        ...patch,
      }),
    );

    const response = await testApp.inject({
      method: 'PUT',
      url: '/api/sso/providers/sso-1',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: { protocol: 'oidc', enabled: true },
    });

    expect(response.statusCode).toBe(200);
    const [, patch] = updateMock.mock.calls[0];
    expect(patch.protocol).toBe('oidc');
    expect(patch.enabled).toBe(true);
  });
});

describe('POST /api/sso/providers — validateProviderBody', () => {
  test('passes a validated, decoupled object downstream (request.body is not mutated)', async () => {
    insertMock.mockImplementation(async (row: realSsoProvidersRepo.SsoProvider) => row);

    // Body uses an untrimmed name; if the validator mutated request.body in place, the
    // post-handler snapshot would show 'My IdP' rather than '  My IdP  '.
    const payload = {
      protocol: 'oidc',
      slug: 'my-idp',
      name: '  My IdP  ',
      enabled: true,
      issuerUrl: 'https://idp.example.com',
      clientId: 'praetor',
      usernameAttribute: 'preferred_username',
      roleMappings: [],
    };

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sso/providers',
      headers: authHeader(),
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(insertMock).toHaveBeenCalledTimes(1);

    // request.body identity check via JSON snapshots: before/after must match.
    expect(bodySnapshots.before).toEqual(payload);
    expect(bodySnapshots.after).toEqual(payload);

    // The repo must have received the normalized name — proving validation ran on a
    // separate object, not the raw body.
    const inserted = insertMock.mock.calls[0]?.[0] as { name: string };
    expect(inserted.name).toBe('My IdP');
  });

  test('returns 400 without mutating body when roleMappings contains an unknown role', async () => {
    findExistingIdsMock.mockImplementationOnce(async () => new Set<string>(['admin']));

    const payload = {
      protocol: 'oidc',
      slug: 'idp-2',
      name: 'IdP Two',
      enabled: false,
      roleMappings: [{ externalGroup: 'devs', role: 'developer' }],
    };

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sso/providers',
      headers: authHeader(),
      payload,
    });

    expect(res.statusCode).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
    expect(bodySnapshots.before).toEqual(payload);
    expect(bodySnapshots.after).toEqual(payload);
  });
});
