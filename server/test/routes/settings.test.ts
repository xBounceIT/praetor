import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realBcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realMcpTokensRepo from '../../repositories/mcpTokensRepo.ts';
import * as realNotificationsRepo from '../../repositories/notificationsRepo.ts';
import * as realPersonalAccessTokensRepo from '../../repositories/personalAccessTokensRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realSettingsRepo from '../../repositories/settingsRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realPermissions from '../../utils/permissions.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';
import { decodeForAssertion, signToken } from '../helpers/jwt.ts';

// hashPersonalAccessToken (HMAC-keyed, exercised via the settings routes) requires
// ENCRYPTION_KEY at call time.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-32-bytes-long!!';

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const settingsRepoSnap = { ...realSettingsRepo };
const notificationsRepoSnap = { ...realNotificationsRepo };
const mcpTokensRepoSnap = { ...realMcpTokensRepo };
const personalAccessTokensRepoSnap = { ...realPersonalAccessTokensRepo };
const bcryptSnap = { ...(realBcrypt as Record<string, unknown>) };

const findAuthUserByIdMock = mock();
const findCoreByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const getOrCreateForUserMock = mock();
const upsertForUserMock = mock();
const getPasswordHashMock = mock();
const rotatePasswordAndBumpSessionMock = mock();
const upsertAdminPasswordWarningMock = mock();
const deleteAdminPasswordWarningMock = mock();
const listMcpTokensForUserMock = mock();
const generateRawMcpTokenMock = mock();
const createMcpTokenForUserMock = mock();
const revokeMcpTokenForUserMock = mock();
const findPersonalAccessTokenByUserIdMock = mock();
const createPersonalAccessTokenIfMissingMock = mock();
const renewPersonalAccessTokenForUserMock = mock();
const bcryptCompareMock = mock();
const bcryptHashMock = mock();

let routePlugin: FastifyPluginAsync;

beforeAll(async () => {
  installAuthMiddlewareMock();

  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findAuthUserById: findAuthUserByIdMock,
    findCoreById: findCoreByIdMock,
    getPasswordHash: getPasswordHashMock,
    rotatePasswordAndBumpSession: rotatePasswordAndBumpSessionMock,
  }));
  mock.module('../../repositories/rolesRepo.ts', () => ({
    ...rolesRepoSnap,
    userHasRole: userHasRoleMock,
  }));
  mock.module('../../utils/permissions.ts', () => ({
    ...permissionsSnap,
    getRolePermissions: getRolePermissionsMock,
  }));
  mock.module('../../repositories/settingsRepo.ts', () => ({
    ...settingsRepoSnap,
    getOrCreateForUser: getOrCreateForUserMock,
    upsertForUser: upsertForUserMock,
  }));
  mock.module('../../repositories/notificationsRepo.ts', () => ({
    ...notificationsRepoSnap,
    upsertAdminPasswordWarning: upsertAdminPasswordWarningMock,
    deleteAdminPasswordWarning: deleteAdminPasswordWarningMock,
  }));
  mock.module('../../repositories/mcpTokensRepo.ts', () => ({
    ...mcpTokensRepoSnap,
    listForUser: listMcpTokensForUserMock,
    generateRawToken: generateRawMcpTokenMock,
    createForUser: createMcpTokenForUserMock,
    revokeForUser: revokeMcpTokenForUserMock,
  }));
  mock.module('../../repositories/personalAccessTokensRepo.ts', () => ({
    ...personalAccessTokensRepoSnap,
    findByUserId: findPersonalAccessTokenByUserIdMock,
    createForUserIfMissing: createPersonalAccessTokenIfMissingMock,
    renewForUser: renewPersonalAccessTokenForUserMock,
  }));
  mock.module('bcryptjs', () => ({
    default: { compare: bcryptCompareMock, hash: bcryptHashMock },
    compare: bcryptCompareMock,
    hash: bcryptHashMock,
  }));

  routePlugin = (await import('../../routes/settings.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/settingsRepo.ts', () => settingsRepoSnap);
  mock.module('../../repositories/notificationsRepo.ts', () => notificationsRepoSnap);
  mock.module('../../repositories/mcpTokensRepo.ts', () => mcpTokensRepoSnap);
  mock.module('../../repositories/personalAccessTokensRepo.ts', () => ({
    ...personalAccessTokensRepoSnap,
  }));
  mock.module('bcryptjs', () => bcryptSnap);
});

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'user',
  avatarInitials: 'AL',
  isDisabled: false,
  sessionVersion: 1,
};

const HAPPY_SETTINGS = {
  fullName: 'Alice',
  email: 'alice@example.com',
  language: 'en',
};

const HAPPY_PERSONAL_ACCESS_TOKEN = {
  userId: 'u1',
  tokenHash: 'a'.repeat(64),
  tokenPrefix: 'praetor_pat_abc12345',
  createdAt: new Date('2026-05-11T08:00:00.000Z'),
  updatedAt: new Date('2026-05-11T09:00:00.000Z'),
  lastUsedAt: null,
};

const allMocks = [
  findAuthUserByIdMock,
  findCoreByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  getOrCreateForUserMock,
  upsertForUserMock,
  getPasswordHashMock,
  rotatePasswordAndBumpSessionMock,
  upsertAdminPasswordWarningMock,
  deleteAdminPasswordWarningMock,
  listMcpTokensForUserMock,
  generateRawMcpTokenMock,
  createMcpTokenForUserMock,
  revokeMcpTokenForUserMock,
  findPersonalAccessTokenByUserIdMock,
  createPersonalAccessTokenIfMissingMock,
  renewPersonalAccessTokenForUserMock,
  bcryptCompareMock,
  bcryptHashMock,
];

let testApp: FastifyInstance;

const LOCAL_CORE_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'user',
  employeeType: 'app_user',
  authMethod: 'local',
  authProviderId: null,
};

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  findCoreByIdMock.mockResolvedValue(LOCAL_CORE_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue([]);
  upsertAdminPasswordWarningMock.mockResolvedValue(undefined);
  deleteAdminPasswordWarningMock.mockResolvedValue(undefined);
  listMcpTokensForUserMock.mockResolvedValue([]);
  generateRawMcpTokenMock.mockReturnValue('praetor_mcp_raw');
  createMcpTokenForUserMock.mockResolvedValue({
    id: 'mcp-token-1',
    name: 'Agent',
    tokenPrefix: 'praetor_mcp_raw',
    createdAt: 1000,
    lastUsedAt: null,
  });
  revokeMcpTokenForUserMock.mockResolvedValue(true);
  findPersonalAccessTokenByUserIdMock.mockResolvedValue(HAPPY_PERSONAL_ACCESS_TOKEN);
  createPersonalAccessTokenIfMissingMock.mockResolvedValue({
    record: HAPPY_PERSONAL_ACCESS_TOKEN,
    created: false,
  });
  renewPersonalAccessTokenForUserMock.mockResolvedValue(HAPPY_PERSONAL_ACCESS_TOKEN);

  testApp = await buildRouteTestApp(routePlugin, '/api/settings');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('GET /api/settings', () => {
  test('200 returns settings via getOrCreateForUser with defaults', async () => {
    getOrCreateForUserMock.mockResolvedValue(HAPPY_SETTINGS);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/settings',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(HAPPY_SETTINGS);
    expect(getOrCreateForUserMock).toHaveBeenCalledWith('u1', {
      fullName: 'Alice',
      email: 'alice@example.com',
    });
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/settings' });
    expect(res.statusCode).toBe(401);
  });
});

describe('PUT /api/settings', () => {
  test('200 happy update', async () => {
    upsertForUserMock.mockResolvedValue({
      ...HAPPY_SETTINGS,
      fullName: 'Alice B',
      language: 'it',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: authHeader(),
      payload: { fullName: 'Alice B', email: 'alice@b.com', language: 'it' },
    });

    expect(res.statusCode).toBe(200);
    expect(upsertForUserMock).toHaveBeenCalledWith('u1', {
      fullName: 'Alice B',
      email: 'alice@b.com',
      language: 'it',
    });
  });

  test('200 with no fields → upsert with all nulls', async () => {
    upsertForUserMock.mockResolvedValue(HAPPY_SETTINGS);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: authHeader(),
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(upsertForUserMock).toHaveBeenCalledWith('u1', {
      fullName: null,
      email: null,
      language: null,
    });
  });

  test('400 fullName whitespace-only', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: authHeader(),
      payload: { fullName: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/fullName/);
  });

  test('400 invalid email format', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: authHeader(),
      payload: { email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/email/);
  });

  test('400 invalid language enum (rejected by Fastify schema)', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: authHeader(),
      payload: { language: 'fr' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { fullName: 'X' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 non-local user cannot update fullName', async () => {
    findCoreByIdMock.mockResolvedValue({ ...LOCAL_CORE_USER, authMethod: 'ldap' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: authHeader(),
      payload: { fullName: 'Alice B' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/identity provider/);
    expect(upsertForUserMock).not.toHaveBeenCalled();
  });

  test('403 non-local user cannot update email', async () => {
    findCoreByIdMock.mockResolvedValue({ ...LOCAL_CORE_USER, authMethod: 'oidc' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: authHeader(),
      payload: { email: 'alice@new.com' },
    });

    expect(res.statusCode).toBe(403);
    expect(upsertForUserMock).not.toHaveBeenCalled();
  });

  test('200 non-local user can still change language', async () => {
    findCoreByIdMock.mockResolvedValue({ ...LOCAL_CORE_USER, authMethod: 'saml' });
    upsertForUserMock.mockResolvedValue({ ...HAPPY_SETTINGS, language: 'it' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: authHeader(),
      payload: { language: 'it' },
    });

    expect(res.statusCode).toBe(200);
    expect(upsertForUserMock).toHaveBeenCalledWith('u1', {
      fullName: null,
      email: null,
      language: 'it',
    });
  });
});

describe('MCP token settings routes', () => {
  test('GET /api/settings/mcp-tokens returns current user tokens', async () => {
    listMcpTokensForUserMock.mockResolvedValue([
      {
        id: 'mcp-token-1',
        name: 'Agent',
        tokenPrefix: 'praetor_mcp_abcd',
        createdAt: 1000,
        lastUsedAt: null,
      },
    ]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/settings/mcp-tokens',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([
      {
        id: 'mcp-token-1',
        name: 'Agent',
        tokenPrefix: 'praetor_mcp_abcd',
        createdAt: 1000,
        lastUsedAt: null,
      },
    ]);
    expect(listMcpTokensForUserMock).toHaveBeenCalledWith('u1');
  });

  test('POST /api/settings/mcp-tokens creates token and returns raw token once', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/settings/mcp-tokens',
      headers: authHeader(),
      payload: { name: 'Agent' },
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual({
      token: {
        id: 'mcp-token-1',
        name: 'Agent',
        tokenPrefix: 'praetor_mcp_raw',
        createdAt: 1000,
        lastUsedAt: null,
      },
      rawToken: 'praetor_mcp_raw',
    });
    expect(createMcpTokenForUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        name: 'Agent',
        rawToken: 'praetor_mcp_raw',
      }),
    );
  });

  test('POST /api/settings/mcp-tokens rejects when current user has too many active tokens', async () => {
    listMcpTokensForUserMock.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        id: `mcp-token-${i}`,
        name: `Agent ${i}`,
        tokenPrefix: `praetor_mcp_${i}`,
        createdAt: 1000 + i,
        lastUsedAt: null,
      })),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/settings/mcp-tokens',
      headers: authHeader(),
      payload: { name: 'One too many' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Maximum active MCP token limit reached',
    });
    expect(createMcpTokenForUserMock).not.toHaveBeenCalled();
  });

  test('DELETE /api/settings/mcp-tokens/:id revokes only current user token', async () => {
    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/settings/mcp-tokens/mcp-token-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(revokeMcpTokenForUserMock).toHaveBeenCalledWith('mcp-token-1', 'u1');
  });

  test('DELETE /api/settings/mcp-tokens/:id returns 404 for missing token', async () => {
    revokeMcpTokenForUserMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/settings/mcp-tokens/missing',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /api/settings/password', () => {
  test('200 happy password change bumps sessionVersion and rotates x-auth-token', async () => {
    getPasswordHashMock.mockResolvedValue('$2a$existing');
    bcryptCompareMock.mockResolvedValue(true);
    bcryptHashMock.mockResolvedValue('$2a$newhash');
    rotatePasswordAndBumpSessionMock.mockResolvedValue(2);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings/password',
      headers: authHeader(),
      payload: { currentPassword: 'old-pw1', newPassword: 'new-secure-pw' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ message: 'Password updated successfully' });
    expect(bcryptCompareMock).toHaveBeenCalledWith('old-pw1', '$2a$existing');
    expect(bcryptHashMock).toHaveBeenCalledWith('new-secure-pw', 12);
    expect(rotatePasswordAndBumpSessionMock).toHaveBeenCalledWith('u1', '$2a$newhash');

    const rotated = res.headers['x-auth-token'];
    expect(typeof rotated).toBe('string');
    const decoded = decodeForAssertion(rotated as string);
    expect(decoded.sessionVersion).toBe(2);
    expect(decoded.userId).toBe('u1');

    expect(upsertAdminPasswordWarningMock).not.toHaveBeenCalled();
    expect(deleteAdminPasswordWarningMock).not.toHaveBeenCalled();
  });

  test('200 admin changing away from default password removes warning', async () => {
    findAuthUserByIdMock.mockResolvedValue({ ...HAPPY_USER, username: 'admin' });
    getPasswordHashMock.mockResolvedValue('$2a$existing');
    bcryptCompareMock.mockResolvedValue(true);
    bcryptHashMock.mockResolvedValue('$2a$newhash');
    rotatePasswordAndBumpSessionMock.mockResolvedValue(2);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings/password',
      headers: authHeader(),
      payload: { currentPassword: 'password', newPassword: 'new-secure-pw' },
    });

    expect(res.statusCode).toBe(200);
    expect(deleteAdminPasswordWarningMock).toHaveBeenCalledTimes(1);
    expect(upsertAdminPasswordWarningMock).not.toHaveBeenCalled();
  });

  test('200 admin setting password back to default recreates warning', async () => {
    findAuthUserByIdMock.mockResolvedValue({ ...HAPPY_USER, username: 'admin' });
    getPasswordHashMock.mockResolvedValue('$2a$existing');
    bcryptCompareMock.mockResolvedValue(true);
    bcryptHashMock.mockResolvedValue('$2a$newhash');
    rotatePasswordAndBumpSessionMock.mockResolvedValue(2);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings/password',
      headers: authHeader(),
      payload: { currentPassword: 'new-secure-pw', newPassword: 'password' },
    });

    expect(res.statusCode).toBe(200);
    expect(upsertAdminPasswordWarningMock).toHaveBeenCalledWith('u1');
    expect(deleteAdminPasswordWarningMock).not.toHaveBeenCalled();
  });

  test('500 when rotatePasswordAndBumpSession throws — no admin-warning side effects', async () => {
    getPasswordHashMock.mockResolvedValue('$2a$existing');
    bcryptCompareMock.mockResolvedValue(true);
    bcryptHashMock.mockResolvedValue('$2a$newhash');
    rotatePasswordAndBumpSessionMock.mockRejectedValue(new Error('db down'));

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings/password',
      headers: authHeader(),
      payload: { currentPassword: 'old-pw1', newPassword: 'new-secure-pw' },
    });

    expect(res.statusCode).toBe(500);
    expect(upsertAdminPasswordWarningMock).not.toHaveBeenCalled();
    expect(deleteAdminPasswordWarningMock).not.toHaveBeenCalled();
  });

  // Regression: rotate succeeded, so the rotated x-auth-token must be on the
  // response even when a downstream side effect fails — otherwise the admin's
  // own password change forcibly logs them out via stale sliding-window token.
  test('500 from admin warning still ships the rotated x-auth-token', async () => {
    findAuthUserByIdMock.mockResolvedValue({ ...HAPPY_USER, username: 'admin' });
    getPasswordHashMock.mockResolvedValue('$2a$existing');
    bcryptCompareMock.mockResolvedValue(true);
    bcryptHashMock.mockResolvedValue('$2a$newhash');
    rotatePasswordAndBumpSessionMock.mockResolvedValue(2);
    deleteAdminPasswordWarningMock.mockRejectedValue(new Error('notifications down'));

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings/password',
      headers: authHeader(),
      payload: { currentPassword: 'password', newPassword: 'new-secure-pw' },
    });

    expect(res.statusCode).toBe(500);
    const rotated = res.headers['x-auth-token'];
    expect(typeof rotated).toBe('string');
    expect(decodeForAssertion(rotated as string).sessionVersion).toBe(2);
  });

  test('400 missing currentPassword', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings/password',
      headers: authHeader(),
      payload: { currentPassword: '   ', newPassword: 'new-secure-pw' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/currentPassword/);
  });

  test('400 missing newPassword', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings/password',
      headers: authHeader(),
      payload: { currentPassword: 'old', newPassword: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 newPassword too short (<8)', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings/password',
      headers: authHeader(),
      payload: { currentPassword: 'old-pw', newPassword: 'short' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/at least 8/);
  });

  test('404 user not found (no password hash row)', async () => {
    getPasswordHashMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings/password',
      headers: authHeader(),
      payload: { currentPassword: 'old-pw', newPassword: 'new-secure-pw' },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'User not found' });
  });

  test('400 incorrect current password', async () => {
    getPasswordHashMock.mockResolvedValue('$2a$existing');
    bcryptCompareMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings/password',
      headers: authHeader(),
      payload: { currentPassword: 'wrong-pw', newPassword: 'new-secure-pw' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Incorrect current password/);
    expect(rotatePasswordAndBumpSessionMock).not.toHaveBeenCalled();
  });

  test('400 newPassword equals currentPassword', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings/password',
      headers: authHeader(),
      payload: { currentPassword: 'same-pw-123', newPassword: 'same-pw-123' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/different from the current password/i);
    expect(getPasswordHashMock).not.toHaveBeenCalled();
    expect(bcryptCompareMock).not.toHaveBeenCalled();
    expect(bcryptHashMock).not.toHaveBeenCalled();
    expect(rotatePasswordAndBumpSessionMock).not.toHaveBeenCalled();
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings/password',
      payload: { currentPassword: 'a', newPassword: 'b' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 non-local user cannot change password', async () => {
    findCoreByIdMock.mockResolvedValue({ ...LOCAL_CORE_USER, authMethod: 'ldap' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings/password',
      headers: authHeader(),
      payload: { currentPassword: 'old-pw1', newPassword: 'new-secure-pw' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/identity provider/);
    expect(getPasswordHashMock).not.toHaveBeenCalled();
    expect(bcryptCompareMock).not.toHaveBeenCalled();
    expect(rotatePasswordAndBumpSessionMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/settings/personal-access-token', () => {
  test('200 returns metadata and one-time token when auto-created', async () => {
    findPersonalAccessTokenByUserIdMock.mockResolvedValue(null);
    createPersonalAccessTokenIfMissingMock.mockResolvedValue({
      record: HAPPY_PERSONAL_ACCESS_TOKEN,
      created: true,
    });

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/settings/personal-access-token',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.tokenPrefix).toBe('praetor_pat_abc12345');
    expect(body.createdAt).toBe('2026-05-11T08:00:00.000Z');
    expect(body.updatedAt).toBe('2026-05-11T09:00:00.000Z');
    expect(body.lastUsedAt).toBeNull();
    expect(body.token).toMatch(/^praetor_pat_/);
    expect(findPersonalAccessTokenByUserIdMock).toHaveBeenCalledWith('u1');
    expect(createPersonalAccessTokenIfMissingMock).toHaveBeenCalledTimes(1);
    expect(createPersonalAccessTokenIfMissingMock.mock.calls[0][0]).toBe('u1');
    expect(createPersonalAccessTokenIfMissingMock.mock.calls[0][1]).toMatch(/^[a-f0-9]{64}$/);
    expect(createPersonalAccessTokenIfMissingMock.mock.calls[0][2]).toMatch(/^praetor_pat_/);
  });

  test('200 returns metadata only when token already exists', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/settings/personal-access-token',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.tokenPrefix).toBe('praetor_pat_abc12345');
    expect(body.token).toBeUndefined();
    expect(findPersonalAccessTokenByUserIdMock).toHaveBeenCalledWith('u1');
    expect(createPersonalAccessTokenIfMissingMock).not.toHaveBeenCalled();
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/settings/personal-access-token',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/settings/personal-access-token/renew', () => {
  test('200 renews the token and returns the new plaintext once', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/settings/personal-access-token/renew',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toMatch(/^praetor_pat_/);
    expect(renewPersonalAccessTokenForUserMock).toHaveBeenCalledTimes(1);
    expect(renewPersonalAccessTokenForUserMock.mock.calls[0][0]).toBe('u1');
    expect(renewPersonalAccessTokenForUserMock.mock.calls[0][1]).toMatch(/^[a-f0-9]{64}$/);
    expect(renewPersonalAccessTokenForUserMock.mock.calls[0][2]).toMatch(/^praetor_pat_/);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/settings/personal-access-token/renew',
    });
    expect(res.statusCode).toBe(401);
  });
});
