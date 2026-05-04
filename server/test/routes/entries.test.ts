import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realEntriesRepo from '../../repositories/entriesRepo.ts';
import * as realGeneralSettingsRepo from '../../repositories/generalSettingsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realTasksRepo from '../../repositories/tasksRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realWorkUnitsRepo from '../../repositories/workUnitsRepo.ts';
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
const entriesRepoSnap = { ...realEntriesRepo };
const generalSettingsRepoSnap = { ...realGeneralSettingsRepo };
const tasksRepoSnap = { ...realTasksRepo };
const workUnitsRepoSnap = { ...realWorkUnitsRepo };

// Auth-middleware deps (real authenticateToken runs)
const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

// Route deps
const findCostPerHourMock = mock();
const findIdByProjectAndNameMock = mock();
const isUserManagedByMock = mock();
const generalSettingsGetMock = mock();
const entriesListAllMock = mock();
const entriesListForUserMock = mock();
const entriesListForManagerViewMock = mock();
const entriesCreateMock = mock();
const entriesUpdateMock = mock();
const entriesDeleteByIdMock = mock();
const entriesBulkDeleteMock = mock();
const entriesFindContextMock = mock();
const entriesFindOwnerMock = mock();
const entriesDecodeCursorMock = mock();
const entriesEncodeCursorMock = mock((c: unknown) => `enc:${JSON.stringify(c)}`);

let entriesRoutePlugin: FastifyPluginAsync;

beforeAll(async () => {
  installAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findAuthUserById: findAuthUserByIdMock,
    findCostPerHour: findCostPerHourMock,
  }));
  mock.module('../../repositories/rolesRepo.ts', () => ({
    ...rolesRepoSnap,
    userHasRole: userHasRoleMock,
  }));
  mock.module('../../utils/permissions.ts', () => ({
    ...permissionsSnap,
    getRolePermissions: getRolePermissionsMock,
  }));
  mock.module('../../repositories/entriesRepo.ts', () => ({
    ...entriesRepoSnap,
    listAll: entriesListAllMock,
    listForUser: entriesListForUserMock,
    listForManagerView: entriesListForManagerViewMock,
    create: entriesCreateMock,
    update: entriesUpdateMock,
    deleteById: entriesDeleteByIdMock,
    bulkDelete: entriesBulkDeleteMock,
    findContext: entriesFindContextMock,
    findOwner: entriesFindOwnerMock,
    decodeCursor: entriesDecodeCursorMock,
    encodeCursor: entriesEncodeCursorMock,
  }));
  mock.module('../../repositories/generalSettingsRepo.ts', () => ({
    ...generalSettingsRepoSnap,
    get: generalSettingsGetMock,
  }));
  mock.module('../../repositories/tasksRepo.ts', () => ({
    ...tasksRepoSnap,
    findIdByProjectAndName: findIdByProjectAndNameMock,
  }));
  mock.module('../../repositories/workUnitsRepo.ts', () => ({
    ...workUnitsRepoSnap,
    isUserManagedBy: isUserManagedByMock,
  }));

  entriesRoutePlugin = (await import('../../routes/entries.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/entriesRepo.ts', () => entriesRepoSnap);
  mock.module('../../repositories/generalSettingsRepo.ts', () => generalSettingsRepoSnap);
  mock.module('../../repositories/tasksRepo.ts', () => tasksRepoSnap);
  mock.module('../../repositories/workUnitsRepo.ts', () => workUnitsRepoSnap);
});

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'manager',
  avatarInitials: 'AL',
  isDisabled: false,
};

const TRACKER_PERMS = [
  'timesheets.tracker.view',
  'timesheets.tracker.create',
  'timesheets.tracker.update',
  'timesheets.tracker.delete',
];

const TRACKER_ALL_PERMS = [...TRACKER_PERMS, 'timesheets.tracker_all.view'];

const SAMPLE_ENTRY = {
  id: 'te-1',
  userId: 'u1',
  date: '2025-06-02', // Monday — not a weekend
  clientId: 'c1',
  clientName: 'Client',
  projectId: 'p1',
  projectName: 'Project',
  task: 'Dev',
  taskId: 't1',
  notes: null,
  duration: 4,
  hourlyCost: 50,
  isPlaceholder: false,
  location: 'remote',
  createdAt: 1_700_000_000_000,
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  findCostPerHourMock,
  findIdByProjectAndNameMock,
  isUserManagedByMock,
  generalSettingsGetMock,
  entriesListAllMock,
  entriesListForUserMock,
  entriesListForManagerViewMock,
  entriesCreateMock,
  entriesUpdateMock,
  entriesDeleteByIdMock,
  entriesBulkDeleteMock,
  entriesFindContextMock,
  entriesFindOwnerMock,
  entriesDecodeCursorMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  // encodeCursor remains stable across tests
  entriesEncodeCursorMock.mockImplementation((c: unknown) => `enc:${JSON.stringify(c)}`);

  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(TRACKER_PERMS);

  testApp = await buildRouteTestApp(entriesRoutePlugin, '/api/entries');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = (userId = 'u1') => ({ authorization: `Bearer ${signToken({ userId })}` });

describe('GET /api/entries', () => {
  test('200: viewer without tracker_all gets manager-scoped list', async () => {
    entriesListForManagerViewMock.mockResolvedValue({
      entries: [SAMPLE_ENTRY],
      nextCursor: null,
    });

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/entries',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.entries).toHaveLength(1);
    expect(body.nextCursor).toBeNull();
    expect(entriesListForManagerViewMock).toHaveBeenCalledWith('u1', expect.any(Object));
    expect(entriesListAllMock).not.toHaveBeenCalled();
  });

  test('200: viewer with tracker_all.view gets listAll', async () => {
    getRolePermissionsMock.mockResolvedValue(TRACKER_ALL_PERMS);
    entriesListAllMock.mockResolvedValue({ entries: [], nextCursor: null });

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/entries',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(entriesListAllMock).toHaveBeenCalledTimes(1);
    expect(entriesListForManagerViewMock).not.toHaveBeenCalled();
  });

  test('200: explicit userId routes to listForUser', async () => {
    getRolePermissionsMock.mockResolvedValue(TRACKER_ALL_PERMS);
    entriesListForUserMock.mockResolvedValue({ entries: [], nextCursor: null });

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/entries?userId=u2',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(entriesListForUserMock).toHaveBeenCalledWith('u2', expect.any(Object));
  });

  test('200: nextCursor encoded when present', async () => {
    entriesListForManagerViewMock.mockResolvedValue({
      entries: [],
      nextCursor: { lastDate: '2025-01-01', lastId: 'te-1' },
    });

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/entries',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.nextCursor).toMatch(/^enc:/);
  });

  test('403: cross-user without tracker_all and no manager link', async () => {
    isUserManagedByMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/entries?userId=u2',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Not authorized to view entries for this user',
    });
    expect(isUserManagedByMock).toHaveBeenCalledWith('u1', 'u2');
  });

  test('400: invalid cursor', async () => {
    entriesDecodeCursorMock.mockReturnValue(null);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/entries?cursor=garbage',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'cursor is invalid' });
  });

  test('401: missing token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/entries' });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'Access token required' });
  });

  test('403: missing tracker.view permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]); // no tracker.view

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/entries',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'Insufficient permissions' });
  });
});

describe('POST /api/entries', () => {
  const validBody = {
    date: '2025-06-02', // Monday
    clientId: 'c1',
    clientName: 'Client',
    projectId: 'p1',
    projectName: 'Project',
    task: 'Dev',
  };

  test('201 happy path', async () => {
    findCostPerHourMock.mockResolvedValue(75);
    findIdByProjectAndNameMock.mockResolvedValue('t1');
    entriesCreateMock.mockImplementation(async (entry: Record<string, unknown>) => ({
      ...entry,
      createdAt: 1_700_000_000_000,
    }));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries',
      headers: authHeader(),
      payload: { ...validBody, duration: 5, notes: 'hello', isPlaceholder: false },
    });

    expect(res.statusCode).toBe(201);
    expect(entriesCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        clientId: 'c1',
        projectId: 'p1',
        task: 'Dev',
        taskId: 't1',
        duration: 5,
        hourlyCost: 75,
        location: 'remote',
        notes: 'hello',
        isPlaceholder: false,
      }),
    );
  });

  test('201: duration defaults to 0 when omitted', async () => {
    findCostPerHourMock.mockResolvedValue(50);
    findIdByProjectAndNameMock.mockResolvedValue(null);
    entriesCreateMock.mockImplementation(async (entry: Record<string, unknown>) => ({
      ...entry,
      createdAt: 1_700_000_000_000,
    }));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries',
      headers: authHeader(),
      payload: validBody,
    });

    expect(res.statusCode).toBe(201);
    expect(entriesCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 0, taskId: null }),
    );
  });

  test('400 weekend date when allowWeekendSelection=false', async () => {
    generalSettingsGetMock.mockResolvedValue({ allowWeekendSelection: false });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries',
      headers: authHeader(),
      payload: { ...validBody, date: '2025-06-07' }, // Saturday
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Time entries on weekends are not allowed',
    });
    expect(entriesCreateMock).not.toHaveBeenCalled();
  });

  test('201 weekend date when allowWeekendSelection=true', async () => {
    generalSettingsGetMock.mockResolvedValue({ allowWeekendSelection: true });
    findCostPerHourMock.mockResolvedValue(50);
    findIdByProjectAndNameMock.mockResolvedValue(null);
    entriesCreateMock.mockImplementation(async (entry: Record<string, unknown>) => ({
      ...entry,
      createdAt: 1_700_000_000_000,
    }));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries',
      headers: authHeader(),
      payload: { ...validBody, date: '2025-06-07' }, // Saturday
    });

    expect(res.statusCode).toBe(201);
  });

  test('400 invalid date format (Fastify schema rejection)', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries',
      headers: authHeader(),
      payload: { ...validBody, date: 'June 2nd' },
    });

    expect(res.statusCode).toBe(400);
    // AJV's `format: 'date'` rejects this before the in-handler `parseDateString` runs.
    // The reply shape is Fastify's default `{ statusCode, code, error: 'Bad Request', message }`.
    expect(JSON.parse(res.body).error).toBe('Bad Request');
  });

  test('400 whitespace-only clientId', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries',
      headers: authHeader(),
      payload: { ...validBody, clientId: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'clientId is required' });
  });

  test('403 cross-user create without manager link', async () => {
    isUserManagedByMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries',
      headers: authHeader(),
      payload: { ...validBody, userId: 'u2' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Not authorized to create entries for this user',
    });
    expect(entriesCreateMock).not.toHaveBeenCalled();
  });

  test('201 manager creating for managed user', async () => {
    isUserManagedByMock.mockResolvedValue(true);
    findCostPerHourMock.mockResolvedValue(60);
    findIdByProjectAndNameMock.mockResolvedValue('t1');
    entriesCreateMock.mockImplementation(async (entry: Record<string, unknown>) => ({
      ...entry,
      createdAt: 1_700_000_000_000,
    }));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries',
      headers: authHeader(),
      payload: { ...validBody, userId: 'u2' },
    });

    expect(res.statusCode).toBe(201);
    expect(findCostPerHourMock).toHaveBeenCalledWith('u2');
    expect(entriesCreateMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u2' }));
  });
});

describe('PUT /api/entries/:id', () => {
  test('200 update own entry', async () => {
    entriesFindContextMock.mockResolvedValue({
      userId: 'u1',
      projectId: 'p1',
      task: 'Dev',
      taskId: 't1',
    });
    entriesUpdateMock.mockResolvedValue({ ...SAMPLE_ENTRY, duration: 6 });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: { duration: 6 },
    });

    expect(res.statusCode).toBe(200);
    expect(entriesUpdateMock).toHaveBeenCalledWith(
      'te-1',
      expect.objectContaining({ duration: 6 }),
    );
  });

  test('200 backfills taskId when context.taskId is null', async () => {
    entriesFindContextMock.mockResolvedValue({
      userId: 'u1',
      projectId: 'p1',
      task: 'Dev',
      taskId: null,
    });
    findIdByProjectAndNameMock.mockResolvedValue('t-resolved');
    entriesUpdateMock.mockResolvedValue(SAMPLE_ENTRY);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: { duration: 5 },
    });

    expect(res.statusCode).toBe(200);
    expect(findIdByProjectAndNameMock).toHaveBeenCalledWith('p1', 'Dev');
    expect(entriesUpdateMock).toHaveBeenCalledWith(
      'te-1',
      expect.objectContaining({ taskId: 't-resolved' }),
    );
  });

  test('404 when entry not found via findContext', async () => {
    entriesFindContextMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/missing',
      headers: authHeader(),
      payload: { duration: 5 },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Entry not found' });
  });

  test('404 when update returns null', async () => {
    entriesFindContextMock.mockResolvedValue({
      userId: 'u1',
      projectId: 'p1',
      task: 'Dev',
      taskId: 't1',
    });
    entriesUpdateMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: { duration: 5 },
    });

    expect(res.statusCode).toBe(404);
  });

  test('403 cross-user update without manager link', async () => {
    entriesFindContextMock.mockResolvedValue({
      userId: 'u2',
      projectId: 'p1',
      task: 'Dev',
      taskId: 't1',
    });
    isUserManagedByMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: { duration: 5 },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'Not authorized to update this entry' });
  });

  test('400 invalid duration', async () => {
    entriesFindContextMock.mockResolvedValue({
      userId: 'u1',
      projectId: 'p1',
      task: 'Dev',
      taskId: 't1',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: { duration: -3 },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/duration must be zero or positive/);
  });
});

describe('DELETE /api/entries/:id', () => {
  test('200 own entry', async () => {
    entriesFindOwnerMock.mockResolvedValue('u1');
    entriesDeleteByIdMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/entries/te-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ message: 'Entry deleted' });
    expect(entriesDeleteByIdMock).toHaveBeenCalledWith('te-1');
  });

  test('404 not found', async () => {
    entriesFindOwnerMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/entries/missing',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Entry not found' });
  });

  test('403 cross-user without manager link', async () => {
    entriesFindOwnerMock.mockResolvedValue('u2');
    isUserManagedByMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/entries/te-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'Not authorized to delete this entry' });
  });
});

describe('DELETE /api/entries (bulk)', () => {
  test('200 manager-scoped restricts to viewer', async () => {
    entriesBulkDeleteMock.mockResolvedValue(3);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/entries?projectId=p1&task=Dev',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ message: 'Deleted 3 entries' });
    expect(entriesBulkDeleteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        task: 'Dev',
        restrictToManagerScopeOf: 'u1',
        placeholderOnly: false,
      }),
    );
  });

  test('200 admin scope deletes across all users', async () => {
    getRolePermissionsMock.mockResolvedValue(TRACKER_ALL_PERMS);
    entriesBulkDeleteMock.mockResolvedValue(7);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/entries?projectId=p1&task=Dev',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(entriesBulkDeleteMock).toHaveBeenCalledWith(
      expect.objectContaining({ restrictToManagerScopeOf: undefined }),
    );
  });

  test('200 futureOnly=true sets fromDate to today', async () => {
    entriesBulkDeleteMock.mockResolvedValue(1);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/entries?projectId=p1&task=Dev&futureOnly=true',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const callArgs = entriesBulkDeleteMock.mock.calls[0][0];
    expect(callArgs.fromDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('400 missing projectId (Fastify schema)', async () => {
    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/entries?task=Dev',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(400);
  });

  test('403 missing both delete permissions', async () => {
    getRolePermissionsMock.mockResolvedValue(['timesheets.tracker.view']); // no delete perms

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/entries?projectId=p1&task=Dev',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'Insufficient permissions' });
  });
});
