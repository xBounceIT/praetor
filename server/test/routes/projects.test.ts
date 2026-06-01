import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realClientOffersRepo from '../../repositories/clientOffersRepo.ts';
import * as realClientsOrdersRepo from '../../repositories/clientsOrdersRepo.ts';
import * as realProjectsRepo from '../../repositories/projectsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUserAssignmentsRepo from '../../repositories/userAssignmentsRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realWorkUnitsRepo from '../../repositories/workUnitsRepo.ts';
import * as realAudit from '../../utils/audit.ts';
import { ForeignKeyError } from '../../utils/http-errors.ts';
import * as realPermissions from '../../utils/permissions.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';
import { signToken } from '../helpers/jwt.ts';
import { TX_SENTINEL } from '../helpers/txSentinel.ts';
import { makeWithDbTransactionMock } from '../helpers/withDbTransactionMock.ts';

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const projectsRepoSnap = { ...realProjectsRepo };
const clientsOrdersRepoSnap = { ...realClientsOrdersRepo };
const clientOffersRepoSnap = { ...realClientOffersRepo };
const userAssignmentsRepoSnap = { ...realUserAssignmentsRepo };
const auditSnap = { ...realAudit };
const workUnitsRepoSnap = { ...realWorkUnitsRepo };
const drizzleSnap = { ...realDrizzle };

// Auth-middleware deps
const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

// projectsRepo mocks
const listAllMock = mock();
const listForUserMock = mock();
const createMock = mock();
const updateMock = mock();
const findByIdMock = mock();
const findDateRangeByIdMock = mock();
const findClientLinksByIdMock = mock();
const deleteByIdMock = mock();
const lockClientIdByIdMock = mock();
const lockNameAndClientByIdMock = mock();
const findAssignedUserIdsMock = mock();
const findNonTopManagerUserIdsMock = mock();
const clearNonTopManagerAssignmentsMock = mock();
const addManualAssignmentsMock = mock();
const ensureClientCascadeAssignmentsMock = mock();
const removeClientCascadeForUsersIfUnusedMock = mock();

// clientsOrdersRepo mocks
const findOrderClientIdByIdMock = mock();

// clientOffersRepo mocks
const findOfferClientIdByIdMock = mock();

// userAssignmentsRepo mocks
const assignClientToUserMock = mock(async () => undefined);
const assignProjectToUserMock = mock(async () => undefined);
const assignClientToTopManagersMock = mock(async () => undefined);
const assignProjectToTopManagersMock = mock(async () => undefined);
const isClientAssignedToUserMock = mock();
const isProjectAssignedToUserMock = mock();
const isUserManagedByMock = mock();

// audit + db
const logAuditMock = mock(async () => undefined);
const { withDbTransactionMock, resetWithDbTransactionMock } = makeWithDbTransactionMock();

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
  mock.module('../../repositories/projectsRepo.ts', () => ({
    ...projectsRepoSnap,
    listAll: listAllMock,
    listForUser: listForUserMock,
    create: createMock,
    update: updateMock,
    findById: findByIdMock,
    findDateRangeById: findDateRangeByIdMock,
    findClientLinksById: findClientLinksByIdMock,
    deleteById: deleteByIdMock,
    lockClientIdById: lockClientIdByIdMock,
    lockNameAndClientById: lockNameAndClientByIdMock,
    findAssignedUserIds: findAssignedUserIdsMock,
    findNonTopManagerUserIds: findNonTopManagerUserIdsMock,
    clearNonTopManagerAssignments: clearNonTopManagerAssignmentsMock,
    addManualAssignments: addManualAssignmentsMock,
    ensureClientCascadeAssignments: ensureClientCascadeAssignmentsMock,
    removeClientCascadeForUsersIfUnused: removeClientCascadeForUsersIfUnusedMock,
  }));
  mock.module('../../repositories/clientsOrdersRepo.ts', () => ({
    ...clientsOrdersRepoSnap,
    findClientIdById: findOrderClientIdByIdMock,
  }));
  mock.module('../../repositories/clientOffersRepo.ts', () => ({
    ...clientOffersRepoSnap,
    findClientIdById: findOfferClientIdByIdMock,
  }));
  mock.module('../../repositories/userAssignmentsRepo.ts', () => ({
    ...userAssignmentsRepoSnap,
    assignClientToUser: assignClientToUserMock,
    assignProjectToUser: assignProjectToUserMock,
    assignClientToTopManagers: assignClientToTopManagersMock,
    assignProjectToTopManagers: assignProjectToTopManagersMock,
    isClientAssignedToUser: isClientAssignedToUserMock,
    isProjectAssignedToUser: isProjectAssignedToUserMock,
  }));
  mock.module('../../repositories/workUnitsRepo.ts', () => ({
    ...workUnitsRepoSnap,
    isUserManagedBy: isUserManagedByMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));

  routePlugin = (await import('../../routes/projects.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/projectsRepo.ts', () => projectsRepoSnap);
  mock.module('../../repositories/clientsOrdersRepo.ts', () => clientsOrdersRepoSnap);
  mock.module('../../repositories/clientOffersRepo.ts', () => clientOffersRepoSnap);
  mock.module('../../repositories/userAssignmentsRepo.ts', () => userAssignmentsRepoSnap);
  mock.module('../../repositories/workUnitsRepo.ts', () => workUnitsRepoSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
  mock.module('../../db/drizzle.ts', () => drizzleSnap);
});

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'top_manager',
  avatarInitials: 'AL',
  isDisabled: false,
  sessionVersion: 1,
};

const MANAGE_PERMS = [
  'projects.manage.view',
  'projects.manage.create',
  'projects.manage.update',
  'projects.manage.delete',
  'projects.manage_all.view',
  'projects.tasks.view',
  'projects.assignments.update',
];

const USER_PERMS = ['projects.manage.view', 'projects.tasks.view'];

const SAMPLE_PROJECT = {
  id: 'p-1',
  name: 'Website',
  clientId: 'c-1',
  description: null,
  isDisabled: false,
  createdAt: 1_700_000_000_000,
  orderId: null,
  offerId: null,
  startDate: null,
  endDate: null,
  revenue: null,
  billingType: 'time_and_materials',
  billingFrequency: 'monthly',
};

const VALID_CREATE_PAYLOAD = {
  name: 'Site',
  clientId: 'c-1',
  offerId: 'of-1',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  listAllMock,
  listForUserMock,
  createMock,
  updateMock,
  findByIdMock,
  findDateRangeByIdMock,
  findClientLinksByIdMock,
  deleteByIdMock,
  lockClientIdByIdMock,
  lockNameAndClientByIdMock,
  findAssignedUserIdsMock,
  findNonTopManagerUserIdsMock,
  clearNonTopManagerAssignmentsMock,
  addManualAssignmentsMock,
  ensureClientCascadeAssignmentsMock,
  removeClientCascadeForUsersIfUnusedMock,
  findOrderClientIdByIdMock,
  findOfferClientIdByIdMock,
  assignClientToUserMock,
  assignProjectToUserMock,
  assignClientToTopManagersMock,
  assignProjectToTopManagersMock,
  isClientAssignedToUserMock,
  isProjectAssignedToUserMock,
  isUserManagedByMock,
  logAuditMock,
  withDbTransactionMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(MANAGE_PERMS);
  resetWithDbTransactionMock();
  logAuditMock.mockImplementation(async () => undefined);
  assignClientToUserMock.mockImplementation(async () => undefined);
  assignProjectToUserMock.mockImplementation(async () => undefined);
  assignClientToTopManagersMock.mockImplementation(async () => undefined);
  assignProjectToTopManagersMock.mockImplementation(async () => undefined);
  isClientAssignedToUserMock.mockResolvedValue(true);
  isProjectAssignedToUserMock.mockResolvedValue(true);
  isUserManagedByMock.mockResolvedValue(true);
  // Default: order/offer lookups return null (not in DB) so the consistency check is a no-op
  // and the real FK violation surfaces from the repo path under test.
  findOrderClientIdByIdMock.mockResolvedValue(null);
  findOfferClientIdByIdMock.mockResolvedValue(null);

  testApp = await buildRouteTestApp(routePlugin, '/api/projects');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('GET /api/projects', () => {
  test('200: with manage_all.view → listAll', async () => {
    listAllMock.mockResolvedValue([SAMPLE_PROJECT]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/projects',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(listAllMock).toHaveBeenCalledTimes(1);
    expect(listForUserMock).not.toHaveBeenCalled();
  });

  test('200: without manage_all → listForUser(viewer.id)', async () => {
    getRolePermissionsMock.mockResolvedValue(USER_PERMS);
    listForUserMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/projects',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(listForUserMock).toHaveBeenCalledWith('u1');
    expect(listAllMock).not.toHaveBeenCalled();
  });

  test('200: RIL viewer can list scoped projects for RIL order codes', async () => {
    getRolePermissionsMock.mockResolvedValue(['timesheets.ril.view']);
    listForUserMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/projects',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(listForUserMock).toHaveBeenCalledWith('u1');
    expect(listAllMock).not.toHaveBeenCalled();
  });

  test('200: RIL viewer can list projects for an explicitly selected managed user', async () => {
    getRolePermissionsMock.mockResolvedValue(['timesheets.ril.view']);
    listForUserMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/projects?userId=u2',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(isUserManagedByMock).toHaveBeenCalledWith('u1', 'u2');
    expect(listForUserMock).toHaveBeenCalledWith('u2');
    expect(listAllMock).not.toHaveBeenCalled();
  });

  test('403: RIL viewer cannot list projects for an unmanaged user', async () => {
    getRolePermissionsMock.mockResolvedValue(['timesheets.ril.view']);
    isUserManagedByMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/projects?userId=u2',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(403);
    expect(listForUserMock).not.toHaveBeenCalled();
    expect(listAllMock).not.toHaveBeenCalled();
  });

  test('401: missing token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(401);
  });

  test('403: missing required permissions', async () => {
    getRolePermissionsMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/projects',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/projects', () => {
  test('201: creates project, assigns user/top managers, audits', async () => {
    createMock.mockResolvedValue(SAMPLE_PROJECT);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: {
        ...VALID_CREATE_PAYLOAD,
        name: 'Website',
        description: 'A new site',
        orderId: 'o-1',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Website',
        clientId: 'c-1',
        description: 'A new site',
        orderId: 'o-1',
        offerId: 'of-1',
        isDisabled: false,
      }),
      TX_SENTINEL,
    );
    expect(assignClientToUserMock).toHaveBeenCalledWith('u1', 'c-1', undefined, TX_SENTINEL);
    expect(assignProjectToUserMock).toHaveBeenCalled();
    expect(assignClientToTopManagersMock).toHaveBeenCalledWith('c-1', TX_SENTINEL);
    expect(assignProjectToTopManagersMock).toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project.created', entityType: 'project' }),
    );
  });

  test('201: color is no longer part of the project model (create)', async () => {
    createMock.mockResolvedValue(SAMPLE_PROJECT);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      // A client that still sends `color` must be ignored, not honored.
      payload: { ...VALID_CREATE_PAYLOAD, color: '#abcdef' },
    });

    expect(res.statusCode).toBe(201);
    // The repo is called without a color field...
    expect(createMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ color: expect.anything() }),
      TX_SENTINEL,
    );
    // ...and the serialized project never exposes one.
    expect(JSON.parse(res.body)).not.toHaveProperty('color');
  });

  test('201: persists startDate, endDate, offerId, revenue', async () => {
    createMock.mockResolvedValue({
      ...SAMPLE_PROJECT,
      offerId: 'of-1',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      revenue: 12345.5,
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: {
        name: 'Website',
        clientId: 'c-1',
        offerId: 'of-1',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        revenue: 12345.5,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        offerId: 'of-1',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        revenue: 12345.5,
      }),
      TX_SENTINEL,
    );
    expect(JSON.parse(res.body)).toMatchObject({
      offerId: 'of-1',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      revenue: 12345.5,
    });
  });

  test('400: orderId belonging to a different client is rejected', async () => {
    findOrderClientIdByIdMock.mockResolvedValue('c-other');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { ...VALID_CREATE_PAYLOAD, orderId: 'co-foreign' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'orderId does not belong to the specified clientId',
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  test('201: orderId belonging to the same client is allowed', async () => {
    findOrderClientIdByIdMock.mockResolvedValue('c-1');
    createMock.mockResolvedValue(SAMPLE_PROJECT);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { ...VALID_CREATE_PAYLOAD, orderId: 'co-same' },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'co-same' }),
      TX_SENTINEL,
    );
  });

  test('201: empty-string orderId is treated as null (no consistency lookup)', async () => {
    createMock.mockResolvedValue(SAMPLE_PROJECT);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { ...VALID_CREATE_PAYLOAD, orderId: '' },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: null }),
      TX_SENTINEL,
    );
    expect(findOrderClientIdByIdMock).not.toHaveBeenCalled();
  });

  test('201: creates project with orderId omitted (orderId stored as null)', async () => {
    createMock.mockResolvedValue(SAMPLE_PROJECT);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { ...VALID_CREATE_PAYLOAD, name: 'Orderless' },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: null }),
      TX_SENTINEL,
    );
  });

  test('400: offerId belonging to a different client is rejected', async () => {
    findOfferClientIdByIdMock.mockResolvedValue('c-other');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { ...VALID_CREATE_PAYLOAD, offerId: 'of-foreign' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'offerId does not belong to the specified clientId',
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  test('201: offerId belonging to the same client is allowed', async () => {
    findOfferClientIdByIdMock.mockResolvedValue('c-1');
    createMock.mockResolvedValue(SAMPLE_PROJECT);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { ...VALID_CREATE_PAYLOAD, offerId: 'of-same' },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ offerId: 'of-same' }),
      TX_SENTINEL,
    );
  });

  test('400: missing name', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { ...VALID_CREATE_PAYLOAD, name: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'name is required' });
  });

  test('400: missing clientId', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { ...VALID_CREATE_PAYLOAD, clientId: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'clientId is required' });
  });

  test('400: missing offerId', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { ...VALID_CREATE_PAYLOAD, offerId: undefined },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Bad Request');
  });

  test('400: missing startDate', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { ...VALID_CREATE_PAYLOAD, startDate: undefined },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Bad Request');
    expect(createMock).not.toHaveBeenCalled();
  });

  test('400: missing endDate', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { ...VALID_CREATE_PAYLOAD, endDate: undefined },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Bad Request');
    expect(createMock).not.toHaveBeenCalled();
  });

  test('400: startDate after endDate', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { ...VALID_CREATE_PAYLOAD, startDate: '2026-12-31', endDate: '2026-01-01' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'startDate must be on or before endDate',
    });
  });

  test('400: invalid startDate format', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { ...VALID_CREATE_PAYLOAD, startDate: '01/01/2026' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/startDate must be in YYYY-MM-DD format/);
  });

  test('400: negative revenue', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { ...VALID_CREATE_PAYLOAD, revenue: -10 },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/revenue must be zero or positive/);
  });

  test('400: invalid billing type', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { ...VALID_CREATE_PAYLOAD, billingType: 'mixed' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Bad Request');
  });

  test('400: ForeignKeyError mapped to 400', async () => {
    createMock.mockImplementation(async () => {
      throw new ForeignKeyError('Client');
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { ...VALID_CREATE_PAYLOAD, clientId: 'c-missing' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Client not found' });
  });

  test('400: ForeignKeyError Linked offer mapped to 400', async () => {
    createMock.mockImplementation(async () => {
      throw new ForeignKeyError('Linked offer');
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { ...VALID_CREATE_PAYLOAD, offerId: 'of-missing' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Linked offer not found' });
  });

  test('401: missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { ...VALID_CREATE_PAYLOAD },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403: missing manage.create permission', async () => {
    getRolePermissionsMock.mockResolvedValue(USER_PERMS);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { ...VALID_CREATE_PAYLOAD },
    });

    expect(res.statusCode).toBe(403);
  });

  test('403: scoped creator cannot create under unassigned client', async () => {
    getRolePermissionsMock.mockResolvedValue(['projects.manage.create']);
    isClientAssignedToUserMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { ...VALID_CREATE_PAYLOAD },
    });

    expect(res.statusCode).toBe(403);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('500: failing auto-assignment rolls back project insert (atomic)', async () => {
    // Simulate a real transaction: if the callback rejects, nothing is committed.
    // The fake `withDbTransaction` here runs the callback and lets the rejection
    // propagate — that's the same shape `db.transaction` exposes for callers, so
    // the route's behavior on rollback is what we're asserting.
    let createInvoked = false;
    createMock.mockImplementation(async () => {
      createInvoked = true;
      return SAMPLE_PROJECT;
    });
    assignProjectToTopManagersMock.mockImplementation(async () => {
      throw new Error('boom');
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { ...VALID_CREATE_PAYLOAD },
    });

    // The handler propagates the error → Fastify returns 500.
    expect(res.statusCode).toBe(500);
    // The whole create + assignments block ran inside `withDbTransaction`, so a
    // real DB would have rolled back the project insert. We assert the wrapper
    // was used (proves atomicity is in place) and the audit log did NOT run
    // (it's outside the txn but after the awaited block, so a failed txn skips it).
    expect(withDbTransactionMock).toHaveBeenCalledTimes(1);
    expect(createInvoked).toBe(true);
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/projects/:id', () => {
  test('200: happy delete with audit', async () => {
    lockNameAndClientByIdMock.mockResolvedValue({ name: 'Website', clientId: 'c-1' });
    findNonTopManagerUserIdsMock.mockResolvedValue(['u2']);
    deleteByIdMock.mockResolvedValue(undefined);
    removeClientCascadeForUsersIfUnusedMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/projects/p-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(deleteByIdMock).toHaveBeenCalledWith('p-1', TX_SENTINEL);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project.deleted', entityId: 'p-1' }),
    );
  });

  test('404: project not found', async () => {
    lockNameAndClientByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/projects/missing',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Project not found' });
  });

  test('401: missing token', async () => {
    const res = await testApp.inject({ method: 'DELETE', url: '/api/projects/p-1' });
    expect(res.statusCode).toBe(401);
  });

  test('403: missing delete permission', async () => {
    getRolePermissionsMock.mockResolvedValue(USER_PERMS);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/projects/p-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(403);
  });

  test('403: scoped deleter cannot delete unassigned project', async () => {
    getRolePermissionsMock.mockResolvedValue(['projects.manage.delete']);
    isProjectAssignedToUserMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/projects/p-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(403);
    expect(lockNameAndClientByIdMock).not.toHaveBeenCalled();
    expect(deleteByIdMock).not.toHaveBeenCalled();
  });
});

describe('PUT /api/projects/:id', () => {
  test('200: updates project (no client change) → audits project.updated', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-1');
    updateMock.mockResolvedValue({ ...SAMPLE_PROJECT, name: 'Renamed' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { name: 'Renamed' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalled();
    expect(ensureClientCascadeAssignmentsMock).not.toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project.updated' }),
    );
  });

  test('200: color is no longer part of the project model (update)', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-1');
    updateMock.mockResolvedValue({ ...SAMPLE_PROJECT, name: 'Renamed' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      // A client that still sends `color` must be ignored, not forwarded to the repo.
      payload: { name: 'Renamed', color: '#abcdef' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      'p-1',
      expect.not.objectContaining({ color: expect.anything() }),
      TX_SENTINEL,
    );
    expect(JSON.parse(res.body)).not.toHaveProperty('color');
  });

  test('200: client change triggers cascade assignments + removal', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-old');
    findNonTopManagerUserIdsMock.mockResolvedValue(['u2', 'u3']);
    updateMock.mockResolvedValue({ ...SAMPLE_PROJECT, clientId: 'c-new' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { clientId: 'c-new' },
    });

    expect(res.statusCode).toBe(200);
    expect(ensureClientCascadeAssignmentsMock).toHaveBeenCalledWith(
      ['u2', 'u3'],
      'c-new',
      TX_SENTINEL,
    );
    expect(removeClientCascadeForUsersIfUnusedMock).toHaveBeenCalledWith(
      ['u2', 'u3'],
      'c-old',
      TX_SENTINEL,
    );
  });

  test('200: sets orderId when provided (consistent client)', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-1');
    findOrderClientIdByIdMock.mockResolvedValue('c-1');
    updateMock.mockResolvedValue({ ...SAMPLE_PROJECT, orderId: 'co-9' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { orderId: 'co-9' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ orderId: 'co-9' }),
      TX_SENTINEL,
    );
  });

  test('400: orderId belonging to a different client is rejected on update', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-1');
    findOrderClientIdByIdMock.mockResolvedValue('c-other');

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { orderId: 'co-foreign' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'orderId does not belong to the specified clientId',
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('400: offerId belonging to a different client is rejected on update', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-1');
    findOfferClientIdByIdMock.mockResolvedValue('c-other');

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { offerId: 'of-foreign' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'offerId does not belong to the specified clientId',
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('200: clearing offerId (null) skips the consistency lookup', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-1');
    updateMock.mockResolvedValue({ ...SAMPLE_PROJECT, offerId: null });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { offerId: null },
    });

    expect(res.statusCode).toBe(200);
    expect(findOfferClientIdByIdMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ offerId: null }),
      TX_SENTINEL,
    );
  });

  test('200: client change paired with matching orderId is accepted', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-old');
    findOrderClientIdByIdMock.mockResolvedValue('c-new');
    findNonTopManagerUserIdsMock.mockResolvedValue([]);
    updateMock.mockResolvedValue({ ...SAMPLE_PROJECT, clientId: 'c-new', orderId: 'co-9' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { clientId: 'c-new', orderId: 'co-9' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ clientId: 'c-new', orderId: 'co-9' }),
      TX_SENTINEL,
    );
  });

  test('400: client change rejected when the still-attached existing offerId is for a different client', async () => {
    // Only `clientId` is patched; the existing offerId points at the old client and is now
    // inconsistent. The PUT must re-validate the existing link, not just patch values.
    lockClientIdByIdMock.mockResolvedValue('c-old');
    findNonTopManagerUserIdsMock.mockResolvedValue([]);
    findClientLinksByIdMock.mockResolvedValue({ orderId: null, offerId: 'of-old' });
    findOfferClientIdByIdMock.mockResolvedValue('c-old');

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { clientId: 'c-new' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'offerId does not belong to the specified clientId',
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('400: client change rejected when the still-attached existing orderId is for a different client', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-old');
    findNonTopManagerUserIdsMock.mockResolvedValue([]);
    findClientLinksByIdMock.mockResolvedValue({ orderId: 'co-old', offerId: null });
    findOrderClientIdByIdMock.mockResolvedValue('c-old');

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { clientId: 'c-new' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'orderId does not belong to the specified clientId',
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('200: client change with no existing links skips the consistency lookups', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-old');
    findNonTopManagerUserIdsMock.mockResolvedValue([]);
    findClientLinksByIdMock.mockResolvedValue({ orderId: null, offerId: null });
    updateMock.mockResolvedValue({ ...SAMPLE_PROJECT, clientId: 'c-new' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { clientId: 'c-new' },
    });

    expect(res.statusCode).toBe(200);
    expect(findOrderClientIdByIdMock).not.toHaveBeenCalled();
    expect(findOfferClientIdByIdMock).not.toHaveBeenCalled();
  });

  test('200: empty-string orderId is normalized to null on update', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-1');
    updateMock.mockResolvedValue({ ...SAMPLE_PROJECT, orderId: null });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { orderId: '' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ orderId: null }),
      TX_SENTINEL,
    );
    // No order lookup should fire when normalized to null.
    expect(findOrderClientIdByIdMock).not.toHaveBeenCalled();
  });

  test('200: clears orderId when null is sent', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-1');
    updateMock.mockResolvedValue({ ...SAMPLE_PROJECT, orderId: null });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { orderId: null },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ orderId: null }),
      TX_SENTINEL,
    );
  });

  test('200: leaves orderId unchanged when not provided', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-1');
    updateMock.mockResolvedValue({ ...SAMPLE_PROJECT, name: 'Renamed' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { name: 'Renamed' },
    });

    expect(res.statusCode).toBe(200);
    // Guard the optional-chained access below: without this, a missing call would make
    // `updateArgs?.orderId` collapse to `undefined` and the assertion would pass vacuously.
    expect(updateMock).toHaveBeenCalled();
    const updateArgs = updateMock.mock.calls.at(-1)?.[1] as Record<string, unknown> | undefined;
    expect(updateArgs?.orderId).toBeUndefined();
  });

  test('400: ForeignKeyError(Linked order) on bad orderId mapped to 400', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-1');
    updateMock.mockImplementation(async () => {
      throw new ForeignKeyError('Linked order');
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { orderId: 'co-missing' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Linked order not found' });
  });

  test('200: isDisabled=true alone audits as project.disabled', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-1');
    updateMock.mockResolvedValue({ ...SAMPLE_PROJECT, isDisabled: true });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { isDisabled: true },
    });

    expect(res.statusCode).toBe(200);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project.disabled' }),
    );
  });

  test('200: isDisabled=false alone audits as project.enabled', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-1');
    updateMock.mockResolvedValue({ ...SAMPLE_PROJECT, isDisabled: false });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { isDisabled: false },
    });

    expect(res.statusCode).toBe(200);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project.enabled' }),
    );
  });

  test('200: patches offerId, startDate, endDate, revenue', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-1');
    findDateRangeByIdMock.mockResolvedValue({ startDate: null, endDate: null });
    updateMock.mockResolvedValue({
      ...SAMPLE_PROJECT,
      offerId: 'of-2',
      startDate: '2026-02-01',
      endDate: '2026-11-30',
      revenue: 9999,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: {
        offerId: 'of-2',
        startDate: '2026-02-01',
        endDate: '2026-11-30',
        revenue: 9999,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({
        offerId: 'of-2',
        startDate: '2026-02-01',
        endDate: '2026-11-30',
        revenue: 9999,
      }),
      TX_SENTINEL,
    );
  });

  test('200: clearing revenue with null is forwarded', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-1');
    updateMock.mockResolvedValue({ ...SAMPLE_PROJECT, revenue: null });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { revenue: null },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ revenue: null }),
      TX_SENTINEL,
    );
  });

  test('400: startDate after endDate', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-1');
    findDateRangeByIdMock.mockResolvedValue({ startDate: null, endDate: null });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { startDate: '2026-12-31', endDate: '2026-01-01' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'startDate must be on or before endDate',
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('400: ForeignKeyError Linked offer mapped to 400 on update', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-1');
    updateMock.mockImplementation(async () => {
      throw new ForeignKeyError('Linked offer');
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { offerId: 'of-missing' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Linked offer not found' });
  });

  test('404: project not found (lock returns null)', async () => {
    lockClientIdByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/missing',
      headers: authHeader(),
      payload: { name: 'New' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Project not found' });
  });

  test('404: update returns null inside tx', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-1');
    updateMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { name: 'New' },
    });

    expect(res.statusCode).toBe(404);
  });

  test('400: ForeignKeyError mapped to 400', async () => {
    lockClientIdByIdMock.mockResolvedValue('c-1');
    updateMock.mockImplementation(async () => {
      throw new ForeignKeyError('Client');
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { clientId: 'c-bad' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Client not found' });
  });

  test('500: unexpected error rethrown', async () => {
    withDbTransactionMock.mockImplementation(async () => {
      throw new Error('boom');
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { name: 'New' },
    });

    expect(res.statusCode).toBe(500);
  });

  test('401: missing token', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      payload: { name: 'New' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403: missing update permission', async () => {
    getRolePermissionsMock.mockResolvedValue(USER_PERMS);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { name: 'New' },
    });

    expect(res.statusCode).toBe(403);
  });

  test('403: scoped updater cannot move project under unassigned client', async () => {
    getRolePermissionsMock.mockResolvedValue([
      'projects.manage.update',
      'projects.manage_all.view',
    ]);
    isClientAssignedToUserMock.mockResolvedValue(false);
    lockClientIdByIdMock.mockResolvedValue('c-old');

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { clientId: 'c-new' },
    });

    expect(res.statusCode).toBe(403);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/projects/:id/users', () => {
  test('200: returns assigned user IDs', async () => {
    findAssignedUserIdsMock.mockResolvedValue(['u1', 'u2']);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/projects/p-1/users',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(['u1', 'u2']);
    expect(findAssignedUserIdsMock).toHaveBeenCalledWith('p-1');
  });

  test('401: missing token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/projects/p-1/users' });
    expect(res.statusCode).toBe(401);
  });

  test('403: missing assignments.update permission', async () => {
    getRolePermissionsMock.mockResolvedValue(USER_PERMS);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/projects/p-1/users',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(403);
  });

  test('403: scoped assignment editor cannot edit unassigned project', async () => {
    getRolePermissionsMock.mockResolvedValue(['projects.assignments.update']);
    isProjectAssignedToUserMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects/p-1/users',
      headers: authHeader(),
      payload: { userIds: ['u1'] },
    });

    expect(res.statusCode).toBe(403);
    expect(lockNameAndClientByIdMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/projects/:id/users', () => {
  test('200: clear+replace flow with cascade', async () => {
    lockNameAndClientByIdMock.mockResolvedValue({ name: 'Website', clientId: 'c-1' });
    findNonTopManagerUserIdsMock.mockResolvedValue(['u2', 'u3']);
    clearNonTopManagerAssignmentsMock.mockResolvedValue(undefined);
    addManualAssignmentsMock.mockResolvedValue(undefined);
    ensureClientCascadeAssignmentsMock.mockResolvedValue(undefined);
    removeClientCascadeForUsersIfUnusedMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects/p-1/users',
      headers: authHeader(),
      payload: { userIds: ['u2', 'u4'] },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ message: 'Project assignments updated' });
    expect(clearNonTopManagerAssignmentsMock).toHaveBeenCalledWith('p-1', TX_SENTINEL);
    expect(addManualAssignmentsMock).toHaveBeenCalledWith('p-1', ['u2', 'u4'], TX_SENTINEL);
    expect(ensureClientCascadeAssignmentsMock).toHaveBeenCalledWith(
      ['u2', 'u4'],
      'c-1',
      TX_SENTINEL,
    );
    // u3 is removed (was previously assigned but not in new list)
    expect(removeClientCascadeForUsersIfUnusedMock).toHaveBeenCalledWith(
      ['u3'],
      'c-1',
      TX_SENTINEL,
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project.users_assigned' }),
    );
  });

  test('200: empty userIds is allowed (clears all)', async () => {
    lockNameAndClientByIdMock.mockResolvedValue({ name: 'Website', clientId: 'c-1' });
    findNonTopManagerUserIdsMock.mockResolvedValue([]);
    clearNonTopManagerAssignmentsMock.mockResolvedValue(undefined);
    addManualAssignmentsMock.mockResolvedValue(undefined);
    ensureClientCascadeAssignmentsMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects/p-1/users',
      headers: authHeader(),
      payload: { userIds: [] },
    });

    expect(res.statusCode).toBe(200);
  });

  // The assignments view+update markers bypass membership consistently with the task endpoints.
  test('200: assignments view+update saves even when not a member', async () => {
    getRolePermissionsMock.mockResolvedValue([
      'projects.assignments.view',
      'projects.assignments.update',
    ]);
    isProjectAssignedToUserMock.mockResolvedValue(false);
    lockNameAndClientByIdMock.mockResolvedValue({ name: 'Website', clientId: 'c-1' });
    findNonTopManagerUserIdsMock.mockResolvedValue([]);
    clearNonTopManagerAssignmentsMock.mockResolvedValue(undefined);
    addManualAssignmentsMock.mockResolvedValue(undefined);
    ensureClientCascadeAssignmentsMock.mockResolvedValue(undefined);
    removeClientCascadeForUsersIfUnusedMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects/p-1/users',
      headers: authHeader(),
      payload: { userIds: ['u2'] },
    });

    expect(res.statusCode).toBe(200);
    expect(clearNonTopManagerAssignmentsMock).toHaveBeenCalledWith('p-1', TX_SENTINEL);
  });

  test('404: project not found', async () => {
    lockNameAndClientByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects/missing/users',
      headers: authHeader(),
      payload: { userIds: ['u1'] },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Project not found' });
  });

  test('401: missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects/p-1/users',
      payload: { userIds: [] },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403: missing assignments.update permission', async () => {
    getRolePermissionsMock.mockResolvedValue(USER_PERMS);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects/p-1/users',
      headers: authHeader(),
      payload: { userIds: ['u1'] },
    });

    expect(res.statusCode).toBe(403);
  });
});
