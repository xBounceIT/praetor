import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realProjectsRepo from '../../repositories/projectsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realTasksRepo from '../../repositories/tasksRepo.ts';
import * as realUserAssignmentsRepo from '../../repositories/userAssignmentsRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realAudit from '../../utils/audit.ts';
import { formatLocalDateOnly } from '../../utils/date.ts';
import { ForeignKeyError } from '../../utils/http-errors.ts';
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
const tasksRepoSnap = { ...realTasksRepo };
const projectsRepoSnap = { ...realProjectsRepo };
const userAssignmentsRepoSnap = { ...realUserAssignmentsRepo };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

// Auth-middleware deps
const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

// tasksRepo mocks
const listAllMock = mock();
const listForUserMock = mock();
const createMock = mock();
const updateMock = mock();
const deleteByIdMock = mock();
const findAssignedUserIdsMock = mock();
const findNameAndProjectIdMock = mock();
const clearUserAssignmentsMock = mock();
const addUserAssignmentsMock = mock();
const sumHoursByProjectsMock = mock();

// projectsRepo
const findClientIdMock = mock();
const findBillingByIdMock = mock();

// userAssignmentsRepo mocks
const assignClientToUserMock = mock(async () => undefined);
const assignProjectToUserMock = mock(async () => undefined);
const assignTaskToUserMock = mock(async () => undefined);
const assignClientToTopManagersMock = mock(async () => undefined);
const assignProjectToTopManagersMock = mock(async () => undefined);
const assignTaskToTopManagersMock = mock(async () => undefined);
const isProjectAssignedToUserMock = mock();
const isTaskAssignedToUserMock = mock();

// audit + db
const logAuditMock = mock(async () => undefined);
const withDbTransactionMock = mock(async (cb: (tx: unknown) => unknown) => cb(undefined));

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
  mock.module('../../repositories/tasksRepo.ts', () => ({
    ...tasksRepoSnap,
    listAll: listAllMock,
    listForUser: listForUserMock,
    create: createMock,
    update: updateMock,
    deleteById: deleteByIdMock,
    findAssignedUserIds: findAssignedUserIdsMock,
    findNameAndProjectId: findNameAndProjectIdMock,
    clearUserAssignments: clearUserAssignmentsMock,
    addUserAssignments: addUserAssignmentsMock,
    sumHoursByProjects: sumHoursByProjectsMock,
  }));
  mock.module('../../repositories/projectsRepo.ts', () => ({
    ...projectsRepoSnap,
    findClientId: findClientIdMock,
    findBillingById: findBillingByIdMock,
  }));
  mock.module('../../repositories/userAssignmentsRepo.ts', () => ({
    ...userAssignmentsRepoSnap,
    assignClientToUser: assignClientToUserMock,
    assignProjectToUser: assignProjectToUserMock,
    assignTaskToUser: assignTaskToUserMock,
    assignClientToTopManagers: assignClientToTopManagersMock,
    assignProjectToTopManagers: assignProjectToTopManagersMock,
    assignTaskToTopManagers: assignTaskToTopManagersMock,
    isProjectAssignedToUser: isProjectAssignedToUserMock,
    isTaskAssignedToUser: isTaskAssignedToUserMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));

  routePlugin = (await import('../../routes/tasks.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/tasksRepo.ts', () => tasksRepoSnap);
  mock.module('../../repositories/projectsRepo.ts', () => projectsRepoSnap);
  mock.module('../../repositories/userAssignmentsRepo.ts', () => userAssignmentsRepoSnap);
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
};

const TASKS_PERMS = [
  'projects.tasks.view',
  'projects.tasks.create',
  'projects.tasks.update',
  'projects.tasks.delete',
  'projects.tasks_all.view',
  'projects.manage.view',
];

const USER_PERMS = ['projects.tasks.view'];

const SAMPLE_TASK = {
  id: 't-1',
  name: 'Implement feature',
  projectId: 'p-1',
  description: null,
  isRecurring: false,
  recurrencePattern: null,
  recurrenceStart: null,
  recurrenceEnd: null,
  recurrenceDuration: 0,
  expectedEffort: 0,
  revenue: 0,
  notes: null,
  isDisabled: false,
  createdAt: 1_700_000_000_000,
  billingType: 'time_and_materials',
  billingFrequency: 'monthly',
  monthlyEffort: 0,
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  listAllMock,
  listForUserMock,
  createMock,
  updateMock,
  deleteByIdMock,
  findAssignedUserIdsMock,
  findNameAndProjectIdMock,
  clearUserAssignmentsMock,
  addUserAssignmentsMock,
  sumHoursByProjectsMock,
  findClientIdMock,
  findBillingByIdMock,
  assignClientToUserMock,
  assignProjectToUserMock,
  assignTaskToUserMock,
  assignClientToTopManagersMock,
  assignProjectToTopManagersMock,
  assignTaskToTopManagersMock,
  isProjectAssignedToUserMock,
  isTaskAssignedToUserMock,
  logAuditMock,
  withDbTransactionMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(TASKS_PERMS);
  withDbTransactionMock.mockImplementation(async (cb) => cb(undefined));
  logAuditMock.mockImplementation(async () => undefined);
  assignClientToUserMock.mockImplementation(async () => undefined);
  assignProjectToUserMock.mockImplementation(async () => undefined);
  assignTaskToUserMock.mockImplementation(async () => undefined);
  assignClientToTopManagersMock.mockImplementation(async () => undefined);
  assignProjectToTopManagersMock.mockImplementation(async () => undefined);
  assignTaskToTopManagersMock.mockImplementation(async () => undefined);
  isProjectAssignedToUserMock.mockResolvedValue(true);
  isTaskAssignedToUserMock.mockResolvedValue(true);
  findBillingByIdMock.mockResolvedValue({
    billingType: 'time_and_materials',
    billingFrequency: 'monthly',
  });

  testApp = await buildRouteTestApp(routePlugin, '/api/tasks');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('GET /api/tasks', () => {
  test('200: tasks_all.view → listAll', async () => {
    listAllMock.mockResolvedValue([SAMPLE_TASK]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(listAllMock).toHaveBeenCalledTimes(1);
    expect(listForUserMock).not.toHaveBeenCalled();
  });

  test('200: without tasks_all → listForUser(viewer.id)', async () => {
    getRolePermissionsMock.mockResolvedValue(USER_PERMS);
    listForUserMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(listForUserMock).toHaveBeenCalledWith('u1');
  });

  test('401: missing token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/tasks' });
    expect(res.statusCode).toBe(401);
  });

  test('403: missing required permissions', async () => {
    getRolePermissionsMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/tasks', () => {
  test('201: creates non-recurring task with cascade assignments + audit', async () => {
    createMock.mockResolvedValue(SAMPLE_TASK);
    findClientIdMock.mockResolvedValue('c-1');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: authHeader(),
      payload: {
        name: 'Implement feature',
        projectId: 'p-1',
        description: 'desc',
        notes: 'n',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Implement feature',
        projectId: 'p-1',
        description: 'desc',
        notes: 'n',
        isRecurring: false,
        isDisabled: false,
        recurrencePattern: null,
        recurrenceStart: null,
        recurrenceDuration: 0,
        expectedEffort: 0,
        monthlyEffort: 0,
        revenue: 0,
        billingType: 'time_and_materials',
        billingFrequency: 'monthly',
      }),
      undefined,
    );
    expect(assignClientToUserMock).toHaveBeenCalledWith('u1', 'c-1', undefined, undefined);
    expect(assignProjectToUserMock).toHaveBeenCalledWith('u1', 'p-1', undefined, undefined);
    expect(assignTaskToUserMock).toHaveBeenCalled();
    expect(assignClientToTopManagersMock).toHaveBeenCalledWith('c-1', undefined);
    expect(assignProjectToTopManagersMock).toHaveBeenCalledWith('p-1', undefined);
    expect(assignTaskToTopManagersMock).toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'task.created', entityType: 'task' }),
    );
  });

  test('201: creates recurring task with explicit recurrenceStart', async () => {
    createMock.mockResolvedValue({ ...SAMPLE_TASK, isRecurring: true });
    findClientIdMock.mockResolvedValue('c-1');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: authHeader(),
      payload: {
        name: 'Daily standup',
        projectId: 'p-1',
        isRecurring: true,
        recurrencePattern: 'daily',
        recurrenceStart: '2025-06-01',
        recurrenceDuration: 1,
        expectedEffort: 10,
        monthlyEffort: 4,
        revenue: 100,
        billingType: 'retainer',
        billingFrequency: 'one_time',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isRecurring: true,
        recurrencePattern: 'daily',
        recurrenceStart: '2025-06-01',
        recurrenceDuration: 1,
        expectedEffort: 10,
        monthlyEffort: 4,
        revenue: 100,
        billingType: 'retainer',
        billingFrequency: 'one_time',
      }),
      undefined,
    );
  });

  test('201: recurring task without recurrenceStart defaults to today', async () => {
    createMock.mockResolvedValue({ ...SAMPLE_TASK, isRecurring: true });
    findClientIdMock.mockResolvedValue(null);

    const expectedToday = formatLocalDateOnly(new Date());
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: authHeader(),
      payload: {
        name: 'Weekly check',
        projectId: 'p-1',
        isRecurring: true,
        recurrencePattern: 'weekly',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0][0] as { recurrenceStart: string };
    expect(call.recurrenceStart).toBe(expectedToday);
    // No client → no client cascades
    expect(assignClientToUserMock).not.toHaveBeenCalled();
    expect(assignClientToTopManagersMock).not.toHaveBeenCalled();
  });

  test('400: missing name', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: authHeader(),
      payload: { name: '   ', projectId: 'p-1' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'name is required' });
  });

  test('400: missing projectId', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: authHeader(),
      payload: { name: 'X', projectId: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'projectId is required' });
  });

  test('400: recurring task missing recurrencePattern', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: authHeader(),
      payload: { name: 'X', projectId: 'p-1', isRecurring: true },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'recurrencePattern is required' });
  });

  test('400: recurring task with invalid recurrenceStart format', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: authHeader(),
      payload: {
        name: 'X',
        projectId: 'p-1',
        isRecurring: true,
        recurrencePattern: 'daily',
        recurrenceStart: 'not-a-date',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/recurrenceStart must be in YYYY-MM-DD format/);
  });

  test('400: invalid billing type', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: authHeader(),
      payload: { name: 'X', projectId: 'p-1', billingType: 'mixed' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Bad Request');
  });

  test('400: negative monthly effort', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: authHeader(),
      payload: { name: 'X', projectId: 'p-1', monthlyEffort: -1 },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/monthlyEffort must be zero or positive/);
  });

  test('400: ForeignKeyError mapped to 400', async () => {
    createMock.mockImplementation(async () => {
      throw new ForeignKeyError('Project');
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: authHeader(),
      payload: { name: 'X', projectId: 'p-missing' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Project not found' });
  });

  test('401: missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { name: 'X', projectId: 'p-1' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403: missing tasks.create permission', async () => {
    getRolePermissionsMock.mockResolvedValue(USER_PERMS);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: authHeader(),
      payload: { name: 'X', projectId: 'p-1' },
    });

    expect(res.statusCode).toBe(403);
  });

  test('403: scoped creator cannot create under unassigned project', async () => {
    getRolePermissionsMock.mockResolvedValue(['projects.tasks.create']);
    isProjectAssignedToUserMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: authHeader(),
      payload: { name: 'X', projectId: 'p-1' },
    });

    expect(res.statusCode).toBe(403);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('500: failing auto-assignment rolls back task insert (atomic)', async () => {
    // Simulate a real transaction: if the callback rejects, nothing is committed.
    // The fake `withDbTransaction` here runs the callback and lets the rejection
    // propagate — that's the same shape `db.transaction` exposes for callers, so
    // the route's behavior on rollback is what we're asserting.
    let createInvoked = false;
    createMock.mockImplementation(async () => {
      createInvoked = true;
      return SAMPLE_TASK;
    });
    findClientIdMock.mockResolvedValue('c-1');
    assignTaskToTopManagersMock.mockImplementation(async () => {
      throw new Error('boom');
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: authHeader(),
      payload: { name: 'Implement feature', projectId: 'p-1' },
    });

    // Failing assignment propagates → 500. The whole block was inside
    // `withDbTransaction`, so a real DB would have rolled back the task insert.
    expect(res.statusCode).toBe(500);
    expect(withDbTransactionMock).toHaveBeenCalledTimes(1);
    expect(createInvoked).toBe(true);
    // Audit log lives after the awaited transaction, so a failed txn must skip it.
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/tasks/hours/batch', () => {
  test('200: returns hours by project + task (with tasks_all.view → no userId filter)', async () => {
    sumHoursByProjectsMock.mockResolvedValue([
      { projectId: 'p-1', task: 'Dev', total: 4 },
      { projectId: 'p-1', task: 'QA', total: 2 },
      { projectId: 'p-2', task: 'Dev', total: 1 },
    ]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/tasks/hours/batch?projectIds=p-1,p-2',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      'p-1': { Dev: 4, QA: 2 },
      'p-2': { Dev: 1 },
    });
    expect(sumHoursByProjectsMock).toHaveBeenCalledWith(['p-1', 'p-2'], undefined);
  });

  test('200: without tasks_all.view → scoped by user.id', async () => {
    getRolePermissionsMock.mockResolvedValue(USER_PERMS);
    sumHoursByProjectsMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/tasks/hours/batch?projectIds=p-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(sumHoursByProjectsMock).toHaveBeenCalledWith(['p-1'], 'u1');
  });

  test('400: empty projectIds query', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/tasks/hours/batch?projectIds=',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(400);
  });

  test('400: too many ids (> 200)', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `p${i}`).join(',');
    const res = await testApp.inject({
      method: 'GET',
      url: `/api/tasks/hours/batch?projectIds=${ids}`,
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/cannot exceed 200 IDs/);
  });

  test('401: missing token', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/tasks/hours/batch?projectIds=p-1',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/tasks/hours', () => {
  test('200: returns hours for a single project', async () => {
    sumHoursByProjectsMock.mockResolvedValue([
      { projectId: 'p-1', task: 'Dev', total: 4 },
      { projectId: 'p-1', task: 'QA', total: 2 },
    ]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/tasks/hours?projectId=p-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ Dev: 4, QA: 2 });
    expect(sumHoursByProjectsMock).toHaveBeenCalledWith(['p-1'], undefined);
  });

  test('200: scoped by user without tasks_all', async () => {
    getRolePermissionsMock.mockResolvedValue(USER_PERMS);
    sumHoursByProjectsMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/tasks/hours?projectId=p-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(sumHoursByProjectsMock).toHaveBeenCalledWith(['p-1'], 'u1');
  });

  test('401: missing token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/tasks/hours?projectId=p-1' });
    expect(res.statusCode).toBe(401);
  });
});

describe('PUT /api/tasks/:id', () => {
  test('200: updates task fields and audits task.updated', async () => {
    updateMock.mockResolvedValue({ ...SAMPLE_TASK, name: 'Renamed' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/tasks/t-1',
      headers: authHeader(),
      payload: {
        name: 'Renamed',
        expectedEffort: 5,
        monthlyEffort: 2,
        revenue: 10,
        billingType: 'retainer',
        billingFrequency: 'one_time',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({
        name: 'Renamed',
        expectedEffort: 5,
        monthlyEffort: 2,
        revenue: 10,
        billingType: 'retainer',
        billingFrequency: 'one_time',
      }),
    );
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'task.updated' }));
  });

  test('200: setting recurring + recurrenceStart/end passes through', async () => {
    updateMock.mockResolvedValue({ ...SAMPLE_TASK, isRecurring: true });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/tasks/t-1',
      headers: authHeader(),
      payload: {
        isRecurring: true,
        recurrencePattern: 'daily',
        recurrenceStart: '2025-01-01',
        recurrenceEnd: '2025-12-31',
        recurrenceDuration: 2,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({
        isRecurring: true,
        recurrencePattern: 'daily',
        recurrenceStart: '2025-01-01',
        recurrenceEnd: '2025-12-31',
        recurrenceDuration: 2,
      }),
    );
  });

  test('200: isDisabled=true → task.disabled audit', async () => {
    updateMock.mockResolvedValue({ ...SAMPLE_TASK, isDisabled: true });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/tasks/t-1',
      headers: authHeader(),
      payload: { isDisabled: true },
    });

    expect(res.statusCode).toBe(200);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'task.disabled' }));
  });

  test('200: isDisabled=false → task.enabled audit', async () => {
    updateMock.mockResolvedValue({ ...SAMPLE_TASK, isDisabled: false });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/tasks/t-1',
      headers: authHeader(),
      payload: { isDisabled: false },
    });

    expect(res.statusCode).toBe(200);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'task.enabled' }));
  });

  test('400: invalid recurrenceStart format', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/tasks/t-1',
      headers: authHeader(),
      payload: { recurrenceStart: 'bogus' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/recurrenceStart must be in YYYY-MM-DD format/);
  });

  test('400: invalid recurrenceEnd format', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/tasks/t-1',
      headers: authHeader(),
      payload: { recurrenceEnd: 'bogus' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/recurrenceEnd must be in YYYY-MM-DD format/);
  });

  test('400: invalid recurrenceDuration', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/tasks/t-1',
      headers: authHeader(),
      payload: { recurrenceDuration: -1 },
    });

    expect(res.statusCode).toBe(400);
  });

  test('404: task not found', async () => {
    updateMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/tasks/missing',
      headers: authHeader(),
      payload: { name: 'New' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Task not found' });
  });

  test('401: missing token', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/tasks/t-1',
      payload: { name: 'New' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403: missing tasks.update permission', async () => {
    getRolePermissionsMock.mockResolvedValue(USER_PERMS);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/tasks/t-1',
      headers: authHeader(),
      payload: { name: 'New' },
    });

    expect(res.statusCode).toBe(403);
  });

  test('403: scoped updater cannot update unassigned task', async () => {
    getRolePermissionsMock.mockResolvedValue(['projects.tasks.update']);
    isTaskAssignedToUserMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/tasks/t-1',
      headers: authHeader(),
      payload: { name: 'New' },
    });

    expect(res.statusCode).toBe(403);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/tasks/:id', () => {
  test('204: happy delete with audit', async () => {
    deleteByIdMock.mockResolvedValue({ name: 'Implement feature', projectId: 'p-1' });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/tasks/t-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'task.deleted', entityId: 't-1' }),
    );
  });

  test('404: task not found', async () => {
    deleteByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/tasks/missing',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Task not found' });
  });

  test('401: missing token', async () => {
    const res = await testApp.inject({ method: 'DELETE', url: '/api/tasks/t-1' });
    expect(res.statusCode).toBe(401);
  });

  test('403: missing tasks.delete permission', async () => {
    getRolePermissionsMock.mockResolvedValue(USER_PERMS);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/tasks/t-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/tasks/:id/users', () => {
  test('200: returns assigned user IDs', async () => {
    findAssignedUserIdsMock.mockResolvedValue(['u1', 'u2']);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/tasks/t-1/users',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(['u1', 'u2']);
    expect(findAssignedUserIdsMock).toHaveBeenCalledWith('t-1');
  });

  test('401: missing token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/tasks/t-1/users' });
    expect(res.statusCode).toBe(401);
  });

  test('403: missing tasks.update permission', async () => {
    getRolePermissionsMock.mockResolvedValue(USER_PERMS);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/tasks/t-1/users',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/tasks/:id/users', () => {
  test('200: clear+add flow with audit', async () => {
    findNameAndProjectIdMock.mockResolvedValue({ name: 'Implement feature', projectId: 'p-1' });
    clearUserAssignmentsMock.mockResolvedValue(undefined);
    addUserAssignmentsMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/tasks/t-1/users',
      headers: authHeader(),
      payload: { userIds: ['u1', 'u2'] },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ message: 'Task assignments updated' });
    expect(clearUserAssignmentsMock).toHaveBeenCalledWith('t-1', undefined);
    expect(addUserAssignmentsMock).toHaveBeenCalledWith('t-1', ['u1', 'u2'], undefined);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'task.users_assigned', entityId: 't-1' }),
    );
  });

  test('400: empty userIds array', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/tasks/t-1/users',
      headers: authHeader(),
      payload: { userIds: [] },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/userIds must contain at least one item/);
  });

  test('404: task not found', async () => {
    findNameAndProjectIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/tasks/missing/users',
      headers: authHeader(),
      payload: { userIds: ['u1'] },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Task not found' });
  });

  test('401: missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/tasks/t-1/users',
      payload: { userIds: ['u1'] },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403: missing tasks.update permission', async () => {
    getRolePermissionsMock.mockResolvedValue(USER_PERMS);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/tasks/t-1/users',
      headers: authHeader(),
      payload: { userIds: ['u1'] },
    });

    expect(res.statusCode).toBe(403);
  });
});
