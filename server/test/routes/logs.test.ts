import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realAuditLogsRepo from '../../repositories/auditLogsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realSiemRepo from '../../repositories/siemRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import realSiemService from '../../services/siem.ts';
import * as realAuditUtils from '../../utils/audit.ts';
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
const siemRepoSnap = { ...realSiemRepo };
const auditUtilsSnap = { ...realAuditUtils };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const listMock = mock();
const findLoginUserByNormalizedUsernameMock = mock();
const getSiemStatusMock = mock();
const getSiemConfigMock = mock();
const saveSiemConfigMock = mock();
const testSiemMock = mock();
const enableSiemMock = mock();
const disableSiemMock = mock();
const logAuditMock = mock();

const siemServiceMock = {
  getConfig: getSiemConfigMock,
  saveConfig: saveSiemConfigMock,
  test: testSiemMock,
  enable: enableSiemMock,
  disable: disableSiemMock,
};

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
  mock.module('../../repositories/siemRepo.ts', () => ({
    ...siemRepoSnap,
    getStatus: getSiemStatusMock,
  }));
  mock.module('../../services/siem.ts', () => ({ default: siemServiceMock }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditUtilsSnap,
    logAudit: logAuditMock,
  }));

  routePlugin = (await import('../../routes/logs.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/auditLogsRepo.ts', () => auditLogsRepoSnap);
  mock.module('../../repositories/siemRepo.ts', () => siemRepoSnap);
  mock.module('../../services/siem.ts', () => ({ default: realSiemService }));
  mock.module('../../utils/audit.ts', () => auditUtilsSnap);
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

const FULL_PERMS = ['administration.logs.view', 'administration.logs.update'];

const SAMPLE_SIEM_CONFIG = {
  ...realSiemRepo.DEFAULT_SIEM_CONFIG,
  host: 'siem.example.test',
  clientKey: 'encrypted-key',
  updatedAt: new Date('2026-07-14T10:00:00.000Z'),
};

const SAMPLE_SIEM_STATUS = {
  enabled: false,
  revision: 1,
  testedRevision: null,
  lastTestAt: null,
  lastTestSuccess: null,
  lastDeliveryAt: null,
  lastErrorAt: null,
  lastError: null,
  droppedRetention: 0,
  droppedCapacity: 0,
  pendingCount: 3,
  oldestPendingAt: new Date('2026-07-14T09:00:00.000Z'),
};

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
  getSiemStatusMock,
  getSiemConfigMock,
  saveSiemConfigMock,
  testSiemMock,
  enableSiemMock,
  disableSiemMock,
  logAuditMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(FULL_PERMS);
  getSiemConfigMock.mockResolvedValue(SAMPLE_SIEM_CONFIG);
  saveSiemConfigMock.mockResolvedValue(SAMPLE_SIEM_CONFIG);
  getSiemStatusMock.mockResolvedValue(SAMPLE_SIEM_STATUS);
  testSiemMock.mockResolvedValue({ success: true });
  enableSiemMock.mockResolvedValue({ ...SAMPLE_SIEM_CONFIG, enabled: true });
  disableSiemMock.mockResolvedValue(SAMPLE_SIEM_CONFIG);
  logAuditMock.mockResolvedValue(undefined);

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

describe('SIEM log streaming routes', () => {
  test('GET config masks the encrypted client key', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/logs/siem/config',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.host).toBe('siem.example.test');
    expect(body.clientKey).toBe('********');
    expect(body.updatedAt).toBe('2026-07-14T10:00:00.000Z');
  });

  test('GET status returns pending and oldest event information', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/logs/siem/status',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(
      expect.objectContaining({
        pendingCount: 3,
        oldestPendingAt: '2026-07-14T09:00:00.000Z',
      }),
    );
  });

  test('PUT config validates and audits non-secret changed fields', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/logs/siem/config',
      headers: authHeader(),
      payload: {
        host: 'collector.internal',
        port: 6514,
        protocol: 'tls',
        clientKey: '********',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(saveSiemConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'collector.internal', protocol: 'tls' }),
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'siem_config.updated', entityType: 'siem_config' }),
    );
  });

  test('PUT config rejects an empty update', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/logs/siem/config',
      headers: authHeader(),
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(saveSiemConfigMock).not.toHaveBeenCalled();
  });

  test('POST test sends the saved revision and records an audit', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/logs/siem/test',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true });
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'siem_config.tested' }),
    );
  });

  test('POST enable returns SIEM_TEST_REQUIRED until the saved revision is tested', async () => {
    enableSiemMock.mockRejectedValueOnce(
      Object.assign(new Error('SIEM_TEST_REQUIRED'), { code: 'SIEM_TEST_REQUIRED' }),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/logs/siem/enable',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'SIEM_TEST_REQUIRED',
      errorCode: 'SIEM_TEST_REQUIRED',
    });
  });

  test('view-only users cannot update SIEM configuration', async () => {
    getRolePermissionsMock.mockResolvedValue(['administration.logs.view']);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/logs/siem/config',
      headers: authHeader(),
      payload: { host: 'denied.example.test' },
    });

    expect(res.statusCode).toBe(403);
    expect(saveSiemConfigMock).not.toHaveBeenCalled();
  });
});
