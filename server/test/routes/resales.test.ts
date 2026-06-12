import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realResalesRepo from '../../repositories/resalesRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realAudit from '../../utils/audit.ts';
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
const resalesRepoSnap = { ...realResalesRepo };
const auditSnap = { ...realAudit };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const isSupplierOrderLinkedToClientOrderMock = mock();
const existsByOrderPairMock = mock();
const createMock = mock();
const logAuditMock = mock(async () => undefined);

let routePlugin: FastifyPluginAsync;
let app: FastifyInstance;
let currentPermissions: string[];

const USER = {
  id: 'u1',
  name: 'Manager',
  username: 'manager',
  role: 'manager',
  avatarInitials: 'MG',
  isDisabled: false,
  sessionVersion: 1,
  tokenVersion: 1,
};

const authHeaders = () => ({ authorization: `Bearer ${signToken({ userId: USER.id })}` });

const SAMPLE_RESALE = {
  id: 'rv-1',
  clientOrderId: 'ord-1',
  supplierOrderId: 'so-1',
  clientName: 'Acme',
  supplierName: 'Supplier',
  supplierOrderCost: 120,
  activityCostTotal: 100,
  resaleRevenue: 150,
  costVariance: -20,
  dueDate: null,
  notes: null,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  activities: [],
};

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
  mock.module('../../repositories/resalesRepo.ts', () => ({
    ...resalesRepoSnap,
    isSupplierOrderLinkedToClientOrder: isSupplierOrderLinkedToClientOrderMock,
    existsByOrderPair: existsByOrderPairMock,
    create: createMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));

  routePlugin = (await import('../../routes/resales.ts')).default;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/resalesRepo.ts', () => resalesRepoSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
});

beforeEach(async () => {
  for (const fn of [
    findAuthUserByIdMock,
    userHasRoleMock,
    getRolePermissionsMock,
    isSupplierOrderLinkedToClientOrderMock,
    existsByOrderPairMock,
    createMock,
    logAuditMock,
  ]) {
    fn.mockReset();
  }
  currentPermissions = ['projects.resales.create'];
  findAuthUserByIdMock.mockResolvedValue(USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockImplementation(async () => currentPermissions);
  isSupplierOrderLinkedToClientOrderMock.mockResolvedValue(true);
  existsByOrderPairMock.mockResolvedValue(false);
  createMock.mockResolvedValue(SAMPLE_RESALE);
  app = await buildRouteTestApp(routePlugin, '/api/projects/resales');
});

afterEach(async () => {
  await app.close();
});

describe('resale routes', () => {
  test('POST requires the dedicated create permission', async () => {
    currentPermissions = [];

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/resales',
      headers: authHeaders(),
      payload: { clientOrderId: 'ord-1', supplierOrderId: 'so-1' },
    });

    expect(res.statusCode).toBe(403);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('POST requires both clientOrderId and supplierOrderId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/resales',
      headers: authHeaders(),
      payload: { clientOrderId: 'ord-1' },
    });

    expect(res.statusCode).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('POST rejects supplier orders not linked from the selected client order', async () => {
    isSupplierOrderLinkedToClientOrderMock.mockResolvedValue(false);

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/resales',
      headers: authHeaders(),
      payload: { clientOrderId: 'ord-1', supplierOrderId: 'so-1' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe(
      'supplierOrderId must belong to the selected clientOrderId',
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  test('POST creates a resale and returns derived economic totals', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/resales',
      headers: authHeaders(),
      payload: { clientOrderId: 'ord-1', supplierOrderId: 'so-1', notes: 'Manual lines' },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientOrderId: 'ord-1',
        supplierOrderId: 'so-1',
        notes: 'Manual lines',
      }),
    );
    expect(JSON.parse(res.body)).toMatchObject({
      supplierOrderCost: 120,
      activityCostTotal: 100,
      resaleRevenue: 150,
      costVariance: -20,
    });
  });
});
