import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realAuditLogsRepo from '../../repositories/auditLogsRepo.ts';
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
const auditLogsRepoSnap = { ...realAuditLogsRepo };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const listMock = mock();
const findLoginUserByNormalizedUsernameMock = mock();

let routePlugin: FastifyPluginAsync;

beforeAll(async () => {
  installAuthMiddlewareMock();

  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findAuthUserById: findAuthUserByIdMock,
    findLoginUserByNormalizedUsername: findLoginUserByNormalizedUsernameMock,
  }));
  mock.module('../../repositories/rolesRepo.ts', () => ({
    ...rolesRepoSnap,
    userHasRole: userHasRoleMock,
  }));
  mock.module('../../utils/permissions.ts', () => ({
    ...permissionsSnap,
    getRolePermissions: getRolePermissionsMock,
  }));
  mock.module('../../repositories/auditLogsRepo.ts', () => ({
    ...auditLogsRepoSnap,
    list: listMock,
  }));

  routePlugin = (await import('../../routes/logs.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/auditLogsRepo.ts', () => auditLogsRepoSnap);
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

const FULL_PERMS = ['administration.logs.view'];

const SAMPLE_LOG = {
  id: 'audit-1',
  userId: 'u1',
  userName: 'Alice',
  username: 'alice',
  action: 'user.login',
  entityType: 'user',
  entityId: 'u1',
  ipAddress: '127.0.0.1',
  createdAt: 1_700_000_000_000,
  details: null,
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  listMock,
  findLoginUserByNormalizedUsernameMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(FULL_PERMS);

  testApp = await buildRouteTestApp(routePlugin, '/api/logs');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('GET /api/logs/audit', () => {
  test('200 returns logs with no filter', async () => {
    listMock.mockResolvedValue([SAMPLE_LOG]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/logs/audit',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([SAMPLE_LOG]);
    expect(listMock).toHaveBeenCalledWith({
      startDate: undefined,
      endDate: undefined,
      userId: undefined,
      action: undefined,
      entityType: undefined,
    });
  });

  test('200 forwards startDate/endDate filters', async () => {
    listMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/logs/audit?startDate=2025-01-01T00:00:00Z&endDate=2025-12-31T23:59:59Z',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(listMock).toHaveBeenCalledWith({
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2025-12-31T23:59:59Z',
      userId: undefined,
      action: undefined,
      entityType: undefined,
    });
  });

  test('200 forwards userId, action, and entityType filters verbatim', async () => {
    listMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/logs/audit?userId=u-7&action=client_offer&entityType=client_offer',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(listMock).toHaveBeenCalledWith({
      startDate: undefined,
      endDate: undefined,
      userId: 'u-7',
      action: 'client_offer',
      entityType: 'client_offer',
    });
  });

  test('200 resolves username → userId via usersRepo', async () => {
    findLoginUserByNormalizedUsernameMock.mockResolvedValue({ id: 'u-77' });
    listMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/logs/audit?username=alice',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(findLoginUserByNormalizedUsernameMock).toHaveBeenCalledWith('alice');
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-77' }));
  });

  test('200 with empty array when username does not resolve to a user', async () => {
    findLoginUserByNormalizedUsernameMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/logs/audit?username=ghost',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
    expect(listMock).not.toHaveBeenCalled();
  });

  test('200 prefers explicit userId over username when both are present', async () => {
    listMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/logs/audit?userId=u-1&username=ignored',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(findLoginUserByNormalizedUsernameMock).not.toHaveBeenCalled();
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-1' }));
  });

  test('200 with details object passes through', async () => {
    listMock.mockResolvedValue([
      {
        ...SAMPLE_LOG,
        action: 'work_unit.updated',
        details: { targetLabel: 'Engineering', changedFields: ['name'] },
      },
    ]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/logs/audit',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body[0].details).toEqual({
      targetLabel: 'Engineering',
      changedFields: ['name'],
    });
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/logs/audit' });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing administration.logs.view permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/logs/audit',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });

  test('400 on invalid startDate format (not date-time)', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/logs/audit?startDate=not-a-date',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });
});
