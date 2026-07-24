import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
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
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const isSupplierOrderLinkedToClientOrderMock = mock();
const existsByOrderPairMock = mock();
const createMock = mock();
const createActivityMock = mock();
const findByIdMock = mock();
const existsCategoryByNameMock = mock();
const createCategoryMock = mock();
const updateCategoryMock = mock();
const txExecutor = {};
const withDbTransactionMock = mock(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback(txExecutor),
);
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

const SAMPLE_ACTIVITY_INPUT = {
  name: 'Setup rivendita',
  billingFrequency: 'one_time',
  categoryId: 'rvc-hardware',
  cost: 100,
  revenue: 150,
  released: false,
  dueDate: null,
  notes: null,
};

const SAMPLE_ACTIVITY = {
  id: 'rva-1',
  resaleId: 'rv-1',
  categoryName: 'Hardware',
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  ...SAMPLE_ACTIVITY_INPUT,
};

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
  startDate: '2026-06-01',
  dueDate: '2026-06-30',
  notes: null,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  activities: [SAMPLE_ACTIVITY],
};

const SAMPLE_CATEGORY = {
  id: 'rvc-1',
  name: 'Hardware',
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  activityCount: 0,
  hasLinkedActivities: false,
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
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));
  mock.module('../../repositories/resalesRepo.ts', () => ({
    ...resalesRepoSnap,
    isSupplierOrderLinkedToClientOrder: isSupplierOrderLinkedToClientOrderMock,
    existsByOrderPair: existsByOrderPairMock,
    create: createMock,
    createActivity: createActivityMock,
    findById: findByIdMock,
    existsCategoryByName: existsCategoryByNameMock,
    createCategory: createCategoryMock,
    updateCategory: updateCategoryMock,
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
  mock.module('../../db/drizzle.ts', () => drizzleSnap);
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
    createActivityMock,
    findByIdMock,
    existsCategoryByNameMock,
    createCategoryMock,
    updateCategoryMock,
    withDbTransactionMock,
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
  createActivityMock.mockResolvedValue(SAMPLE_ACTIVITY);
  findByIdMock.mockResolvedValue(SAMPLE_RESALE);
  existsCategoryByNameMock.mockResolvedValue(false);
  createCategoryMock.mockResolvedValue(SAMPLE_CATEGORY);
  updateCategoryMock.mockResolvedValue({ ...SAMPLE_CATEGORY, name: 'Licenza' });
  withDbTransactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback(txExecutor),
  );
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
      payload: {
        clientOrderId: 'ord-1',
        supplierOrderId: 'so-1',
        activities: [SAMPLE_ACTIVITY_INPUT],
      },
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
      payload: {
        clientOrderId: 'ord-1',
        supplierOrderId: 'so-1',
        startDate: '2026-06-01',
        dueDate: '2026-06-30',
        activities: [SAMPLE_ACTIVITY_INPUT],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe(
      'supplierOrderId must belong to the selected clientOrderId',
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  test('POST requires startDate and dueDate', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/resales',
      headers: authHeaders(),
      payload: {
        clientOrderId: 'ord-1',
        supplierOrderId: 'so-1',
        activities: [SAMPLE_ACTIVITY_INPUT],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('POST requires at least one initial activity', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/resales',
      headers: authHeaders(),
      payload: {
        clientOrderId: 'ord-1',
        supplierOrderId: 'so-1',
        startDate: '2026-06-01',
        dueDate: '2026-06-30',
        activities: [],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('POST creates a resale and returns derived economic totals', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/resales',
      headers: authHeaders(),
      payload: {
        clientOrderId: 'ord-1',
        supplierOrderId: 'so-1',
        startDate: '2026-06-01',
        dueDate: '2026-06-30',
        notes: 'Manual lines',
        activities: [SAMPLE_ACTIVITY_INPUT],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        clientOrderId: 'ord-1',
        supplierOrderId: 'so-1',
        startDate: '2026-06-01',
        dueDate: '2026-06-30',
        notes: 'Manual lines',
      }),
    );
    expect(createActivityMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        resaleId: expect.any(String),
        name: 'Setup rivendita',
        categoryId: 'rvc-hardware',
        cost: 100,
        revenue: 150,
      }),
    );
    expect(findByIdMock).toHaveBeenCalledWith(expect.any(String), txExecutor);
    expect(JSON.parse(res.body)).toMatchObject({
      supplierOrderCost: 120,
      activityCostTotal: 100,
      resaleRevenue: 150,
      costVariance: -20,
      startDate: '2026-06-01',
      dueDate: '2026-06-30',
      activities: [expect.objectContaining({ name: 'Setup rivendita' })],
    });
  });
});

describe('resale category routes', () => {
  test('POST creates a category', async () => {
    currentPermissions = ['projects.resales.create'];

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/resales/categories',
      headers: authHeaders(),
      payload: { name: 'Hardware' },
    });

    expect(res.statusCode).toBe(201);
    expect(existsCategoryByNameMock).toHaveBeenCalledWith('Hardware');
    expect(createCategoryMock).toHaveBeenCalledWith(expect.stringMatching(/^rvc-/), 'Hardware');
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'resale_category.created' }),
    );
  });

  test('POST rejects duplicate names before insert', async () => {
    currentPermissions = ['projects.resales.create'];
    existsCategoryByNameMock.mockResolvedValue(true);

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/resales/categories',
      headers: authHeaders(),
      payload: { name: 'Hardware' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Category name must be unique' });
    expect(createCategoryMock).not.toHaveBeenCalled();
  });

  test('POST returns 400 when a concurrent case-insensitive duplicate wins the insert race', async () => {
    currentPermissions = ['projects.resales.create'];
    existsCategoryByNameMock.mockResolvedValue(false);
    createCategoryMock.mockRejectedValue(
      Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'idx_resale_categories_name_unique',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/resales/categories',
      headers: authHeaders(),
      payload: { name: 'hardware' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Category name must be unique' });
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  test('PUT returns 400 when a concurrent case-insensitive rename wins the update race', async () => {
    currentPermissions = ['projects.resales.update'];
    existsCategoryByNameMock.mockResolvedValue(false);
    updateCategoryMock.mockRejectedValue(
      Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'idx_resale_categories_name_unique',
      }),
    );

    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/resales/categories/rvc-1',
      headers: authHeaders(),
      payload: { name: 'LICENZA' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Category name must be unique' });
    expect(existsCategoryByNameMock).toHaveBeenCalledWith('LICENZA', 'rvc-1');
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
