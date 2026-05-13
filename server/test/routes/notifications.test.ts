import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realNotificationsRepo from '../../repositories/notificationsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
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
const notificationsRepoSnap = { ...realNotificationsRepo };

// Auth-middleware mocks (real authenticateToken still runs; these supply the dependencies)
const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

// Notifications repo mocks
const listForUserMock = mock();
const countUnreadForUserMock = mock();
const markReadForUserMock = mock();
const markAllReadForUserMock = mock();
const deleteForUserMock = mock();

let routePlugin: FastifyPluginAsync;

beforeAll(async () => {
  installAuthMiddlewareMock();

  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findAuthUserById: findAuthUserByIdMock,
  }));
  mock.module('../../repositories/rolesRepo.ts', () => ({
    ...rolesRepoSnap,
    userHasRole: userHasRoleMock,
  }));
  mock.module('../../utils/permissions.ts', () => ({
    ...permissionsSnap,
    getRolePermissions: getRolePermissionsMock,
  }));
  mock.module('../../repositories/notificationsRepo.ts', () => ({
    ...notificationsRepoSnap,
    listForUser: listForUserMock,
    countUnreadForUser: countUnreadForUserMock,
    markReadForUser: markReadForUserMock,
    markAllReadForUser: markAllReadForUserMock,
    deleteForUser: deleteForUserMock,
  }));

  routePlugin = (await import('../../routes/notifications.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/notificationsRepo.ts', () => notificationsRepoSnap);
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

// notifications permissions are always granted in real `getRolePermissions`, but here we mock
// it explicitly so each test can opt out for the 403 branch.
const NOTIF_PERMS = ['notifications.view', 'notifications.update', 'notifications.delete'];

const SAMPLE_NOTIFICATION = {
  id: 'n-1',
  userId: 'u1',
  type: 'mention',
  title: 'Hello',
  message: 'Body',
  data: null,
  isRead: false,
  createdAt: 1_700_000_000_000,
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  listForUserMock,
  countUnreadForUserMock,
  markReadForUserMock,
  markAllReadForUserMock,
  deleteForUserMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(NOTIF_PERMS);

  testApp = await buildRouteTestApp(routePlugin, '/api/notifications');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('GET /api/notifications', () => {
  test('200 returns notifications + unreadCount', async () => {
    listForUserMock.mockResolvedValue([SAMPLE_NOTIFICATION]);
    countUnreadForUserMock.mockResolvedValue(1);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/notifications',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      notifications: [SAMPLE_NOTIFICATION],
      unreadCount: 1,
    });
    expect(listForUserMock).toHaveBeenCalledWith('u1');
    expect(countUnreadForUserMock).toHaveBeenCalledWith('u1');
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/notifications' });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'Access token required' });
  });

  test('403 missing notifications.view permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/notifications',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'Insufficient permissions' });
  });
});

describe('PUT /api/notifications/:id/read', () => {
  test('200 marks as read', async () => {
    markReadForUserMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/notifications/n-1/read',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true });
    expect(markReadForUserMock).toHaveBeenCalledWith('n-1', 'u1');
  });

  test('404 when notification not found', async () => {
    markReadForUserMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/notifications/missing/read',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Notification not found' });
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/notifications/n-1/read',
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing notifications.update permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['notifications.view']);
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/notifications/n-1/read',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /api/notifications/read-all', () => {
  test('200 marks all as read', async () => {
    markAllReadForUserMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/notifications/read-all',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true });
    expect(markAllReadForUserMock).toHaveBeenCalledWith('u1');
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/notifications/read-all',
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing notifications.update permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['notifications.view']);
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/notifications/read-all',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /api/notifications/:id', () => {
  test('204 deletes notification', async () => {
    deleteForUserMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/notifications/n-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(deleteForUserMock).toHaveBeenCalledWith('n-1', 'u1');
  });

  test('404 when notification not found', async () => {
    deleteForUserMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/notifications/missing',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Notification not found' });
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/notifications/n-1',
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing notifications.delete permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['notifications.view', 'notifications.update']);
    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/notifications/n-1',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});
