import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realBcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realNotificationsRepo from '../../repositories/notificationsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realSettingsRepo from '../../repositories/settingsRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
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
const settingsRepoSnap = { ...realSettingsRepo };
const notificationsRepoSnap = { ...realNotificationsRepo };
const bcryptSnap = { ...(realBcrypt as Record<string, unknown>) };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const getOrCreateForUserMock = mock();
const upsertForUserMock = mock();
const getPasswordHashMock = mock();
const updatePasswordHashMock = mock();
const upsertAdminPasswordWarningMock = mock();
const deleteAdminPasswordWarningMock = mock();
const bcryptCompareMock = mock();
const bcryptHashMock = mock();

let routePlugin: FastifyPluginAsync;

beforeAll(async () => {
  installAuthMiddlewareMock();

  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findAuthUserById: findAuthUserByIdMock,
    getPasswordHash: getPasswordHashMock,
    updatePasswordHash: updatePasswordHashMock,
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
  mock.module('bcryptjs', () => bcryptSnap);
});

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'user',
  avatarInitials: 'AL',
  isDisabled: false,
};

const HAPPY_SETTINGS = {
  fullName: 'Alice',
  email: 'alice@example.com',
  language: 'en',
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  getOrCreateForUserMock,
  upsertForUserMock,
  getPasswordHashMock,
  updatePasswordHashMock,
  upsertAdminPasswordWarningMock,
  deleteAdminPasswordWarningMock,
  bcryptCompareMock,
  bcryptHashMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue([]);
  upsertAdminPasswordWarningMock.mockResolvedValue(undefined);
  deleteAdminPasswordWarningMock.mockResolvedValue(undefined);

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
});

describe('PUT /api/settings/password', () => {
  test('200 happy password change', async () => {
    getPasswordHashMock.mockResolvedValue('$2a$existing');
    bcryptCompareMock.mockResolvedValue(true);
    bcryptHashMock.mockResolvedValue('$2a$newhash');
    updatePasswordHashMock.mockResolvedValue(undefined);

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
    expect(updatePasswordHashMock).toHaveBeenCalledWith('u1', '$2a$newhash');
    expect(upsertAdminPasswordWarningMock).not.toHaveBeenCalled();
    expect(deleteAdminPasswordWarningMock).not.toHaveBeenCalled();
  });

  test('200 admin changing away from default password removes warning', async () => {
    findAuthUserByIdMock.mockResolvedValue({ ...HAPPY_USER, username: 'admin' });
    getPasswordHashMock.mockResolvedValue('$2a$existing');
    bcryptCompareMock.mockResolvedValue(true);
    bcryptHashMock.mockResolvedValue('$2a$newhash');
    updatePasswordHashMock.mockResolvedValue(undefined);

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
    updatePasswordHashMock.mockResolvedValue(undefined);

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
    expect(updatePasswordHashMock).not.toHaveBeenCalled();
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/settings/password',
      payload: { currentPassword: 'a', newPassword: 'b' },
    });
    expect(res.statusCode).toBe(401);
  });
});
