import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realClientsRepo from '../../repositories/clientsRepo.ts';
import * as realEntriesRepo from '../../repositories/entriesRepo.ts';
import * as realGeneralSettingsRepo from '../../repositories/generalSettingsRepo.ts';
import * as realProjectsRepo from '../../repositories/projectsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realTasksRepo from '../../repositories/tasksRepo.ts';
import * as realUserAssignmentsRepo from '../../repositories/userAssignmentsRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realWorkUnitsRepo from '../../repositories/workUnitsRepo.ts';
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
const entriesRepoSnap = { ...realEntriesRepo };
const generalSettingsRepoSnap = { ...realGeneralSettingsRepo };
const tasksRepoSnap = { ...realTasksRepo };
const projectsRepoSnap = { ...realProjectsRepo };
const clientsRepoSnap = { ...realClientsRepo };
const userAssignmentsRepoSnap = { ...realUserAssignmentsRepo };
const workUnitsRepoSnap = { ...realWorkUnitsRepo };
const drizzleSnap = { ...realDrizzle };

// Auth-middleware deps (real authenticateToken runs)
const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

// Route deps
const findCostPerHourMock = mock();
const findIdByProjectAndNameMock = mock();
const listRecurringForUserMock = mock();
const isUserManagedByMock = mock();
const generalSettingsGetMock = mock();
const entriesListAllMock = mock();
const entriesListForUserMock = mock();
const entriesListForManagerViewMock = mock();
const entriesCreateMock = mock();
const entriesCreateManyMock = mock();
const entriesUpdateMock = mock();
const entriesDeleteByIdMock = mock();
const entriesBulkDeleteMock = mock();
const entriesFindContextMock = mock();
const entriesFindOwnerMock = mock();
const entriesFindExistingRecurringKeysMock = mock();
const entriesDecodeCursorMock = mock();
const entriesEncodeCursorMock = mock((c: unknown) => `enc:${JSON.stringify(c)}`);
const projectsFindClientIdMock = mock();
const projectsFindClientIdAndNameMock = mock();
const projectsListNamesByIdsMock = mock();
const clientsFindNameMock = mock();
const isClientAssignedToUserMock = mock();
const isProjectAssignedToUserMock = mock();
const isTaskAssignedToUserMock = mock();
const filterAssignedClientIdsMock = mock();
const filterAssignedProjectIdsMock = mock();
const filterAssignedTaskIdsMock = mock();
const { withDbTransactionMock, resetWithDbTransactionMock } = makeWithDbTransactionMock();

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
    createMany: entriesCreateManyMock,
    update: entriesUpdateMock,
    deleteById: entriesDeleteByIdMock,
    bulkDelete: entriesBulkDeleteMock,
    findContext: entriesFindContextMock,
    findOwner: entriesFindOwnerMock,
    findExistingRecurringKeys: entriesFindExistingRecurringKeysMock,
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
    listRecurringForUser: listRecurringForUserMock,
  }));
  mock.module('../../repositories/projectsRepo.ts', () => ({
    ...projectsRepoSnap,
    findClientId: projectsFindClientIdMock,
    findClientIdAndName: projectsFindClientIdAndNameMock,
    listNamesByIds: projectsListNamesByIdsMock,
  }));
  mock.module('../../repositories/clientsRepo.ts', () => ({
    ...clientsRepoSnap,
    findName: clientsFindNameMock,
  }));
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));
  mock.module('../../repositories/userAssignmentsRepo.ts', () => ({
    ...userAssignmentsRepoSnap,
    isClientAssignedToUser: isClientAssignedToUserMock,
    isProjectAssignedToUser: isProjectAssignedToUserMock,
    isTaskAssignedToUser: isTaskAssignedToUserMock,
    filterAssignedClientIds: filterAssignedClientIdsMock,
    filterAssignedProjectIds: filterAssignedProjectIdsMock,
    filterAssignedTaskIds: filterAssignedTaskIdsMock,
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
  mock.module('../../repositories/projectsRepo.ts', () => projectsRepoSnap);
  mock.module('../../repositories/clientsRepo.ts', () => clientsRepoSnap);
  mock.module('../../repositories/userAssignmentsRepo.ts', () => userAssignmentsRepoSnap);
  mock.module('../../repositories/workUnitsRepo.ts', () => workUnitsRepoSnap);
  mock.module('../../db/drizzle.ts', () => drizzleSnap);
});

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'manager',
  avatarInitials: 'AL',
  isDisabled: false,
  sessionVersion: 1,
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
  date: '2025-06-02', // Monday - not a weekend
  clientId: 'c1',
  clientName: 'Client',
  projectId: 'p1',
  projectName: 'Project',
  task: 'Dev',
  taskId: 't1',
  notes: null,
  duration: 4,
  hourlyCost: 50,
  cost: 200, // mapBuilderRow surfaces duration * hourlyCost
  isPlaceholder: false,
  location: 'remote',
  createdAt: 1_700_000_000_000,
  version: 1,
};

type SampleContextOverrides = Partial<{
  userId: string;
  date: string;
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  task: string;
  taskId: string | null;
}>;

const sampleContext = (overrides: SampleContextOverrides = {}) => ({
  userId: SAMPLE_ENTRY.userId,
  date: SAMPLE_ENTRY.date,
  clientId: SAMPLE_ENTRY.clientId,
  clientName: SAMPLE_ENTRY.clientName,
  projectId: SAMPLE_ENTRY.projectId,
  projectName: SAMPLE_ENTRY.projectName,
  task: SAMPLE_ENTRY.task,
  taskId: SAMPLE_ENTRY.taskId as string | null,
  ...overrides,
});

const versionedPatch = <T extends Record<string, unknown>>(patch: T): T & { version: number } => ({
  version: SAMPLE_ENTRY.version,
  ...patch,
});

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  findCostPerHourMock,
  findIdByProjectAndNameMock,
  listRecurringForUserMock,
  isUserManagedByMock,
  generalSettingsGetMock,
  entriesListAllMock,
  entriesListForUserMock,
  entriesListForManagerViewMock,
  entriesCreateMock,
  entriesCreateManyMock,
  entriesUpdateMock,
  entriesDeleteByIdMock,
  entriesBulkDeleteMock,
  entriesFindContextMock,
  entriesFindOwnerMock,
  entriesFindExistingRecurringKeysMock,
  entriesDecodeCursorMock,
  projectsFindClientIdMock,
  projectsFindClientIdAndNameMock,
  projectsListNamesByIdsMock,
  clientsFindNameMock,
  isClientAssignedToUserMock,
  isProjectAssignedToUserMock,
  isTaskAssignedToUserMock,
  filterAssignedClientIdsMock,
  filterAssignedProjectIdsMock,
  filterAssignedTaskIdsMock,
  withDbTransactionMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  // encodeCursor remains stable across tests
  entriesEncodeCursorMock.mockImplementation((c: unknown) => `enc:${JSON.stringify(c)}`);
  // Pass-through transaction by default so service-level `withDbTransaction` invocations
  // forward to the (mocked) repo without trying to open a real DB connection. The default
  // implementation hands `TX_SENTINEL` to the cb so transactional repo calls land with
  // a distinguishable last-arg in tests; see helpers/txSentinel.ts.
  resetWithDbTransactionMock();

  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(TRACKER_PERMS);
  projectsFindClientIdMock.mockResolvedValue('c1');
  projectsFindClientIdAndNameMock.mockResolvedValue({ clientId: 'c1', name: 'Project' });
  clientsFindNameMock.mockResolvedValue('Client');
  isClientAssignedToUserMock.mockResolvedValue(true);
  isProjectAssignedToUserMock.mockResolvedValue(true);
  isTaskAssignedToUserMock.mockResolvedValue(true);
  // Bulk filters default to "everything is assigned" so happy-path recurring tests pass.
  filterAssignedClientIdsMock.mockImplementation(
    async (_userId: string, ids: string[]) => new Set(ids),
  );
  filterAssignedProjectIdsMock.mockImplementation(
    async (_userId: string, ids: string[]) => new Set(ids),
  );
  filterAssignedTaskIdsMock.mockImplementation(
    async (_userId: string, ids: string[]) => new Set(ids),
  );

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
      version: 1,
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
      version: 1,
    }));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries',
      headers: authHeader(),
      payload: validBody,
    });

    expect(res.statusCode).toBe(201);
    expect(entriesCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 0, taskId: null, isPlaceholder: false }),
    );
  });

  test('400 invalid isPlaceholder value does not create entry', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries',
      headers: authHeader(),
      payload: { ...validBody, isPlaceholder: 'ture' } as unknown as Record<string, unknown>,
    });

    expect(res.statusCode).toBe(400);
    expect(entriesCreateMock).not.toHaveBeenCalled();
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
      version: 1,
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

  test('201 manager creating for managed user uses target user cost', async () => {
    isUserManagedByMock.mockResolvedValue(true);
    findCostPerHourMock.mockResolvedValue(60);
    findIdByProjectAndNameMock.mockResolvedValue('t1');
    entriesCreateMock.mockImplementation(async (entry: Record<string, unknown>) => ({
      ...entry,
      createdAt: 1_700_000_000_000,
      version: 1,
    }));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries',
      headers: authHeader(),
      payload: { ...validBody, userId: 'u2', hourlyCost: 999 },
    });

    expect(res.statusCode).toBe(201);
    expect(findCostPerHourMock).toHaveBeenCalledWith('u2');
    expect(entriesCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u2', hourlyCost: 60 }),
    );
  });

  test('400 when project belongs to a different client', async () => {
    projectsFindClientIdMock.mockResolvedValue('other-client');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries',
      headers: authHeader(),
      payload: validBody,
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Project does not belong to the selected client',
    });
    expect(entriesCreateMock).not.toHaveBeenCalled();
  });

  test('400 when project does not exist', async () => {
    projectsFindClientIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries',
      headers: authHeader(),
      payload: validBody,
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Project not found' });
    expect(entriesCreateMock).not.toHaveBeenCalled();
  });

  test('403 when target user is not assigned to submitted project scope', async () => {
    isProjectAssignedToUserMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries',
      headers: authHeader(),
      payload: validBody,
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Not authorized to create entries for this client, project, or task',
    });
    expect(entriesCreateMock).not.toHaveBeenCalled();
  });
});

describe('PUT /api/entries/:id', () => {
  test('200 update own entry', async () => {
    entriesFindContextMock.mockResolvedValue(sampleContext());
    entriesUpdateMock.mockResolvedValue({ ...SAMPLE_ENTRY, duration: 6 });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: versionedPatch({ duration: 6 }),
    });

    expect(res.statusCode).toBe(200);
    expect(entriesUpdateMock).toHaveBeenCalledWith(
      'te-1',
      expect.objectContaining({ duration: 6 }),
    );
  });

  test('400 when update omits the optimistic-lock version', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: { duration: 6 },
    });

    expect(res.statusCode).toBe(400);
    expect(entriesFindContextMock).not.toHaveBeenCalled();
    expect(entriesUpdateMock).not.toHaveBeenCalled();
  });

  test('200 backfills taskId when context.taskId is null', async () => {
    entriesFindContextMock.mockResolvedValue(sampleContext({ taskId: null }));
    findIdByProjectAndNameMock.mockResolvedValue('t-resolved');
    entriesUpdateMock.mockResolvedValue(SAMPLE_ENTRY);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: versionedPatch({ duration: 5 }),
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
      payload: versionedPatch({ duration: 5 }),
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Entry not found' });
  });

  test('409 when the row version no longer matches', async () => {
    entriesFindContextMock.mockResolvedValue(sampleContext());
    entriesUpdateMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: versionedPatch({ duration: 5 }),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Entry has changed since it was loaded; reload and retry',
    });
  });

  test('403 cross-user update without manager link', async () => {
    entriesFindContextMock.mockResolvedValue(sampleContext({ userId: 'u2' }));
    isUserManagedByMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: versionedPatch({ duration: 5 }),
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'Not authorized to update this entry' });
  });

  test('400 invalid duration', async () => {
    entriesFindContextMock.mockResolvedValue(sampleContext());

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: versionedPatch({ duration: -3 }),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/duration must be zero or positive/);
  });

  test('400 invalid isPlaceholder value does not update entry', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: versionedPatch({ isPlaceholder: 'ture' } as unknown as Record<string, unknown>),
    });

    expect(res.statusCode).toBe(400);
    expect(entriesUpdateMock).not.toHaveBeenCalled();
  });

  test('200 empty-string location does not pass through to repo (would violate CHECK)', async () => {
    entriesFindContextMock.mockResolvedValue(sampleContext());
    entriesUpdateMock.mockResolvedValue(SAMPLE_ENTRY);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: versionedPatch({ location: '' }),
    });

    expect(res.statusCode).toBe(200);
    expect(entriesUpdateMock).toHaveBeenCalledTimes(1);
    const patch = entriesUpdateMock.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.location).toBeUndefined();
  });

  test('200 whitespace-only location is treated as untouched', async () => {
    entriesFindContextMock.mockResolvedValue(sampleContext());
    entriesUpdateMock.mockResolvedValue(SAMPLE_ENTRY);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: versionedPatch({ location: '   ' }),
    });

    expect(res.statusCode).toBe(200);
    expect(entriesUpdateMock).toHaveBeenCalledTimes(1);
    const patch = entriesUpdateMock.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.location).toBeUndefined();
  });

  test('200 valid location string is forwarded to repo', async () => {
    entriesFindContextMock.mockResolvedValue(sampleContext());
    entriesUpdateMock.mockResolvedValue(SAMPLE_ENTRY);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: versionedPatch({ location: 'office' }),
    });

    expect(res.statusCode).toBe(200);
    expect(entriesUpdateMock).toHaveBeenCalledTimes(1);
    const patch = entriesUpdateMock.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.location).toBe('office');
  });

  test('400 unknown location value (rejected before repo call)', async () => {
    // Previously a non-empty invalid value passed through to the repo and
    // bubbled up as a 500 from the DB CHECK constraint. Now caught at the
    // service layer.
    entriesFindContextMock.mockResolvedValue(sampleContext());

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: versionedPatch({ location: 'foo' }),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('Invalid location');
    expect(entriesUpdateMock).not.toHaveBeenCalled();
  });

  test('200 reassigns client/project/task and derives names server-side, resolves new taskId', async () => {
    entriesFindContextMock.mockResolvedValue(sampleContext());
    projectsFindClientIdAndNameMock.mockResolvedValue({ clientId: 'c2', name: 'Beta (resolved)' });
    clientsFindNameMock.mockResolvedValue('Other (resolved)');
    findIdByProjectAndNameMock.mockResolvedValue('t2');
    entriesUpdateMock.mockResolvedValue({
      ...SAMPLE_ENTRY,
      clientId: 'c2',
      clientName: 'Other (resolved)',
      projectId: 'p2',
      projectName: 'Beta (resolved)',
      task: 'QA',
      taskId: 't2',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      // Send caller-supplied names that the service must IGNORE and replace with repo lookups.
      payload: {
        version: SAMPLE_ENTRY.version,
        clientId: 'c2',
        clientName: 'stale-from-client',
        projectId: 'p2',
        projectName: 'stale-from-client',
        task: 'QA',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(projectsFindClientIdAndNameMock).toHaveBeenCalledWith('p2');
    expect(clientsFindNameMock).toHaveBeenCalledWith('c2');
    expect(findIdByProjectAndNameMock).toHaveBeenCalledWith('p2', 'QA');
    const patch = entriesUpdateMock.mock.calls[0][1] as Record<string, unknown>;
    expect(patch).toMatchObject({
      clientId: 'c2',
      clientName: 'Other (resolved)',
      projectId: 'p2',
      projectName: 'Beta (resolved)',
      task: 'QA',
      taskId: 't2',
    });
  });

  test('400 when new project does not belong to the new client', async () => {
    entriesFindContextMock.mockResolvedValue(sampleContext());
    projectsFindClientIdAndNameMock.mockResolvedValue({ clientId: 'c-other', name: 'Beta' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: {
        version: SAMPLE_ENTRY.version,
        clientId: 'c2',
        projectId: 'p2',
        task: 'QA',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Project does not belong/);
    expect(entriesUpdateMock).not.toHaveBeenCalled();
  });

  test('403 reassigning to project the owner is not assigned to', async () => {
    entriesFindContextMock.mockResolvedValue(sampleContext());
    projectsFindClientIdAndNameMock.mockResolvedValue({ clientId: 'c2', name: 'Beta' });
    clientsFindNameMock.mockResolvedValue('Other');
    findIdByProjectAndNameMock.mockResolvedValue('t2');
    isProjectAssignedToUserMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: {
        version: SAMPLE_ENTRY.version,
        clientId: 'c2',
        projectId: 'p2',
        task: 'QA',
      },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/Not authorized to assign/);
    expect(entriesUpdateMock).not.toHaveBeenCalled();
  });

  test('400 partial catalog patch (projectId without task) is rejected', async () => {
    entriesFindContextMock.mockResolvedValue(sampleContext());

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: versionedPatch({ projectId: 'p2', projectName: 'Beta' }),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/must be updated together/);
    expect(entriesUpdateMock).not.toHaveBeenCalled();
  });

  test('200 updating only duration leaves catalog fields untouched (no client/project/task lookup)', async () => {
    entriesFindContextMock.mockResolvedValue(sampleContext());
    entriesUpdateMock.mockResolvedValue({ ...SAMPLE_ENTRY, duration: 7 });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: versionedPatch({ duration: 7 }),
    });

    expect(res.statusCode).toBe(200);
    expect(projectsFindClientIdAndNameMock).not.toHaveBeenCalled();
    expect(clientsFindNameMock).not.toHaveBeenCalled();
    const patch = entriesUpdateMock.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.clientId).toBeUndefined();
    expect(patch.projectId).toBeUndefined();
    expect(patch.task).toBeUndefined();
    expect(patch.duration).toBe(7);
  });

  test.each([
    ['task without projectId/clientId', { task: 'QA' }],
    ['clientId without projectId/task', { clientId: 'c2', clientName: 'Other' }],
    ['clientId + task without projectId', { clientId: 'c2', clientName: 'Other', task: 'QA' }],
  ])('400 partial catalog patch (%s) is rejected', async (_label, payload) => {
    entriesFindContextMock.mockResolvedValue(sampleContext());

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: versionedPatch(payload),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/must be updated together/);
    expect(entriesUpdateMock).not.toHaveBeenCalled();
  });

  test('200 updating date alone forwards the new value to the repo', async () => {
    entriesFindContextMock.mockResolvedValue(sampleContext());
    entriesUpdateMock.mockResolvedValue({ ...SAMPLE_ENTRY, date: '2025-06-03' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      payload: versionedPatch({ date: '2025-06-03' }),
    });

    expect(res.statusCode).toBe(200);
    expect(projectsFindClientIdAndNameMock).not.toHaveBeenCalled();
    const patch = entriesUpdateMock.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.date).toBe('2025-06-03');
  });

  test('400 updating date to a weekend when allowWeekendSelection is false', async () => {
    entriesFindContextMock.mockResolvedValue(sampleContext());
    generalSettingsGetMock.mockResolvedValue({ allowWeekendSelection: false } as never);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/entries/te-1',
      headers: authHeader(),
      // 2025-06-07 is a Saturday.
      payload: versionedPatch({ date: '2025-06-07' }),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/weekend/i);
    expect(entriesUpdateMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/entries/:id', () => {
  test('204 own entry', async () => {
    entriesFindOwnerMock.mockResolvedValue('u1');
    entriesDeleteByIdMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/entries/te-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
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

describe('POST /api/entries/recurring/generate', () => {
  const RECURRING_PERMS = [
    'timesheets.tracker.view',
    'timesheets.recurring.view',
    'timesheets.recurring.create',
  ];

  // Sample template: a daily recurring task assigned to u1 with no end date.
  const dailyTask = {
    id: 't1',
    name: 'Daily standup',
    projectId: 'p1',
    description: null,
    isRecurring: true,
    recurrencePattern: 'daily',
    recurrenceStart: '2025-06-02', // Monday
    recurrenceEnd: undefined,
    recurrenceDuration: 0.5,
    expectedEffort: undefined,
    monthlyEffort: undefined,
    revenue: undefined,
    notes: undefined,
    isDisabled: false,
    createdAt: 1_700_000_000_000,
    billingType: 'time_and_materials',
    billingFrequency: 'monthly',
  };

  const weeklyTask = {
    ...dailyTask,
    id: 't2',
    name: 'Weekly review',
    recurrencePattern: 'weekly',
    recurrenceStart: '2025-06-02', // Monday -> only Mondays match
  };

  const monthlyFirstMondayTask = {
    ...dailyTask,
    id: 't3',
    name: 'Monthly kickoff',
    recurrencePattern: 'monthly:first:1', // first Monday of the month
    recurrenceStart: '2025-06-01',
  };

  const monthlyMonthEndTask = {
    ...dailyTask,
    id: 't5',
    name: 'Month-end close',
    recurrencePattern: 'monthly',
    recurrenceStart: '2025-01-31',
  };

  const endedTask = {
    ...dailyTask,
    id: 't4',
    name: 'Sunsetting task',
    recurrencePattern: 'daily',
    recurrenceStart: '2025-06-02',
    recurrenceEnd: '2025-06-04', // Mon..Wed only
  };

  const happyProjectsMap = new Map([
    ['p1', { projectName: 'Project One', clientId: 'c1', clientName: 'Client One' }],
  ]);

  const setupHappyPath = () => {
    getRolePermissionsMock.mockResolvedValue(RECURRING_PERMS);
    findCostPerHourMock.mockResolvedValue(40);
    generalSettingsGetMock.mockResolvedValue({
      treatSaturdayAsHoliday: true,
      defaultLocation: 'remote',
    });
    listRecurringForUserMock.mockResolvedValue([dailyTask]);
    projectsListNamesByIdsMock.mockResolvedValue(happyProjectsMap);
    entriesFindExistingRecurringKeysMock.mockResolvedValue(new Set<string>());
    entriesCreateManyMock.mockImplementation(async (rows: Array<Record<string, unknown>>) =>
      rows.map((r) => ({ ...r, createdAt: 1_700_000_000_000, version: 1 })),
    );
  };

  test('200: generates a daily template across a Mon-Fri window', async () => {
    setupHappyPath();

    // Use 2025-06-09..2025-06-13 (Mon..Fri, no Italian holidays in this range).
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries/recurring/generate',
      headers: authHeader(),
      payload: { fromDate: '2025-06-09', toDate: '2025-06-13' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.generatedCount).toBe(5);
    expect(body.skippedExistingCount).toBe(0);
    expect(body.range).toEqual({ fromDate: '2025-06-09', toDate: '2025-06-13' });
    expect(entriesCreateManyMock).toHaveBeenCalledTimes(1);
    expect(withDbTransactionMock.mock.calls[0][1]).toEqual({
      isolationLevel: 'serializable',
      accessMode: 'read write',
    });
    expect(entriesFindExistingRecurringKeysMock).toHaveBeenCalledWith(
      'u1',
      '2025-06-09',
      '2025-06-13',
      TX_SENTINEL,
    );

    const inserted = entriesCreateManyMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(entriesCreateManyMock.mock.calls[0][1]).toBe(TX_SENTINEL);
    expect(inserted.map((e) => e.date)).toEqual([
      '2025-06-09',
      '2025-06-10',
      '2025-06-11',
      '2025-06-12',
      '2025-06-13',
    ]);
    for (const entry of inserted) {
      expect(entry).toMatchObject({
        userId: 'u1',
        clientId: 'c1',
        clientName: 'Client One',
        projectId: 'p1',
        projectName: 'Project One',
        task: 'Daily standup',
        taskId: 't1',
        duration: 0.5,
        hourlyCost: 40,
        isPlaceholder: true,
        location: 'remote',
      });
    }
  });

  test('200: skips Saturdays/Sundays and Italian holidays', async () => {
    setupHappyPath();
    // 2025-06-02 (Mon, Festa della Repubblica - Italian holiday) is skipped.
    // 2025-06-07 (Sat) and 2025-06-08 (Sun) are skipped.

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries/recurring/generate',
      headers: authHeader(),
      payload: { fromDate: '2025-06-02', toDate: '2025-06-08' },
    });

    expect(res.statusCode).toBe(200);
    const inserted = entriesCreateManyMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    // Holiday on 06-02 (Repubblica), then Tue-Fri (06-03..06-06) = 4 days
    expect(inserted.map((e) => e.date)).toEqual([
      '2025-06-03',
      '2025-06-04',
      '2025-06-05',
      '2025-06-06',
    ]);
  });

  test('200: is idempotent - existing keys are skipped', async () => {
    setupHappyPath();
    // Pretend 06-10 and 06-11 already exist.
    entriesFindExistingRecurringKeysMock.mockResolvedValue(
      new Set(['2025-06-10|p1|Daily standup', '2025-06-11|p1|Daily standup']),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries/recurring/generate',
      headers: authHeader(),
      payload: { fromDate: '2025-06-09', toDate: '2025-06-13' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // 5 weekdays total, 2 existing -> 3 new
    expect(body.generatedCount).toBe(3);
    expect(body.skippedExistingCount).toBe(2);
    const inserted = entriesCreateManyMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(inserted.map((e) => e.date)).toEqual(['2025-06-09', '2025-06-12', '2025-06-13']);
  });

  test('200: weekly pattern only matches the start weekday', async () => {
    setupHappyPath();
    listRecurringForUserMock.mockResolvedValue([weeklyTask]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries/recurring/generate',
      headers: authHeader(),
      payload: { fromDate: '2025-06-02', toDate: '2025-06-15' }, // 2 Mondays
    });

    expect(res.statusCode).toBe(200);
    const inserted = entriesCreateManyMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    // Mondays in window: 06-02 (holiday, skipped), 06-09. 06-15 is Sunday.
    expect(inserted.map((e) => e.date)).toEqual(['2025-06-09']);
  });

  test('200: monthly:first:1 only matches the first Monday', async () => {
    setupHappyPath();
    listRecurringForUserMock.mockResolvedValue([monthlyFirstMondayTask]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries/recurring/generate',
      headers: authHeader(),
      payload: { fromDate: '2025-06-01', toDate: '2025-08-31' },
    });

    expect(res.statusCode).toBe(200);
    const inserted = entriesCreateManyMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    // First Mondays of Jun/Jul/Aug 2025: 06-02 (Repubblica holiday -> skipped), 07-07, 08-04.
    expect(inserted.map((e) => e.date)).toEqual(['2025-07-07', '2025-08-04']);
  });

  test('200: monthly pattern clamps start days beyond the end of shorter months', async () => {
    setupHappyPath();
    listRecurringForUserMock.mockResolvedValue([monthlyMonthEndTask]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries/recurring/generate',
      headers: authHeader(),
      payload: { fromDate: '2025-01-01', toDate: '2025-04-30' },
    });

    expect(res.statusCode).toBe(200);
    const inserted = entriesCreateManyMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(inserted.map((e) => e.date)).toEqual([
      '2025-01-31',
      '2025-02-28',
      '2025-03-31',
      '2025-04-30',
    ]);
  });

  test('200: respects recurrenceEnd', async () => {
    setupHappyPath();
    listRecurringForUserMock.mockResolvedValue([endedTask]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries/recurring/generate',
      headers: authHeader(),
      payload: { fromDate: '2025-06-02', toDate: '2025-06-10' },
    });

    expect(res.statusCode).toBe(200);
    const inserted = entriesCreateManyMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    // recurrenceEnd is 2025-06-04. 06-02 is a holiday, so only 06-03 and 06-04 remain.
    expect(inserted.map((e) => e.date)).toEqual(['2025-06-03', '2025-06-04']);
  });

  test('200: empty when no recurring templates exist', async () => {
    setupHappyPath();
    listRecurringForUserMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries/recurring/generate',
      headers: authHeader(),
      payload: { fromDate: '2025-06-02', toDate: '2025-06-06' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      generated: [],
      generatedCount: 0,
      skippedExistingCount: 0,
      range: { fromDate: '2025-06-02', toDate: '2025-06-06' },
    });
    expect(entriesCreateManyMock).not.toHaveBeenCalled();
  });

  test('400: fromDate after toDate', async () => {
    setupHappyPath();

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries/recurring/generate',
      headers: authHeader(),
      payload: { fromDate: '2025-06-10', toDate: '2025-06-02' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'fromDate must be on or before toDate' });
    expect(entriesCreateManyMock).not.toHaveBeenCalled();
  });

  test('400: rejects an oversized window', async () => {
    setupHappyPath();

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries/recurring/generate',
      headers: authHeader(),
      payload: { fromDate: '2024-01-01', toDate: '2026-12-31' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Date range too large/);
  });

  test('403: missing timesheets.recurring.create permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['timesheets.tracker.view']);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries/recurring/generate',
      headers: authHeader(),
      payload: { fromDate: '2025-06-02', toDate: '2025-06-06' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'Insufficient permissions' });
    expect(listRecurringForUserMock).not.toHaveBeenCalled();
  });

  test('403: cross-user generation without manager link or tracker_all.create', async () => {
    getRolePermissionsMock.mockResolvedValue(RECURRING_PERMS);
    isUserManagedByMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries/recurring/generate',
      headers: authHeader(),
      payload: { fromDate: '2025-06-02', toDate: '2025-06-06', userId: 'u2' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Not authorized to generate entries for this user',
    });
    expect(listRecurringForUserMock).not.toHaveBeenCalled();
  });

  test('200: cross-user generation as manager of the target', async () => {
    setupHappyPath();
    isUserManagedByMock.mockResolvedValue(true);
    listRecurringForUserMock.mockResolvedValue([dailyTask]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries/recurring/generate',
      headers: authHeader(),
      payload: { fromDate: '2025-06-03', toDate: '2025-06-03', userId: 'u2' },
    });

    expect(res.statusCode).toBe(200);
    expect(listRecurringForUserMock).toHaveBeenCalledWith('u2');
    expect(findCostPerHourMock).toHaveBeenCalledWith('u2');
    const inserted = entriesCreateManyMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(inserted[0].userId).toBe('u2');
  });

  test('400: invalid YYYY-MM-DD body is rejected by the schema layer', async () => {
    setupHappyPath();

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries/recurring/generate',
      headers: authHeader(),
      payload: { fromDate: 'not-a-date', toDate: '2025-06-06' },
    });

    expect(res.statusCode).toBe(400);
    expect(entriesCreateManyMock).not.toHaveBeenCalled();
  });

  test('200: re-running the same window is a no-op (idempotent end-to-end)', async () => {
    setupHappyPath();

    // First call - generate 5 entries.
    const first = await testApp.inject({
      method: 'POST',
      url: '/api/entries/recurring/generate',
      headers: authHeader(),
      payload: { fromDate: '2025-06-09', toDate: '2025-06-13' }, // Mon..Fri (no holidays)
    });
    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.body).generatedCount).toBe(5);

    // Second call - the keys repo now returns the previously inserted set.
    entriesCreateManyMock.mockReset();
    entriesCreateManyMock.mockImplementation(async (rows: Array<Record<string, unknown>>) =>
      rows.map((r) => ({ ...r, createdAt: 1_700_000_000_000, version: 1 })),
    );
    entriesFindExistingRecurringKeysMock.mockResolvedValue(
      new Set([
        '2025-06-09|p1|Daily standup',
        '2025-06-10|p1|Daily standup',
        '2025-06-11|p1|Daily standup',
        '2025-06-12|p1|Daily standup',
        '2025-06-13|p1|Daily standup',
      ]),
    );

    const second = await testApp.inject({
      method: 'POST',
      url: '/api/entries/recurring/generate',
      headers: authHeader(),
      payload: { fromDate: '2025-06-09', toDate: '2025-06-13' },
    });
    expect(second.statusCode).toBe(200);
    const body = JSON.parse(second.body);
    expect(body.generatedCount).toBe(0);
    expect(body.skippedExistingCount).toBe(5);
    expect(entriesCreateManyMock).not.toHaveBeenCalled();
  });

  test('200: retries a serializable transaction conflict before reporting committed state', async () => {
    setupHappyPath();
    const generatedKeys = [
      '2025-06-09|p1|Daily standup',
      '2025-06-10|p1|Daily standup',
      '2025-06-11|p1|Daily standup',
      '2025-06-12|p1|Daily standup',
      '2025-06-13|p1|Daily standup',
    ];
    entriesFindExistingRecurringKeysMock.mockReset();
    entriesFindExistingRecurringKeysMock
      .mockResolvedValueOnce(new Set<string>())
      .mockResolvedValueOnce(new Set(generatedKeys));
    withDbTransactionMock.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => {
      await cb(TX_SENTINEL);
      throw Object.assign(new Error('could not serialize access'), { code: '40001' });
    });
    withDbTransactionMock.mockImplementationOnce(async (cb: (tx: unknown) => unknown) =>
      cb(TX_SENTINEL),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries/recurring/generate',
      headers: authHeader(),
      payload: { fromDate: '2025-06-09', toDate: '2025-06-13' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.generatedCount).toBe(0);
    expect(body.skippedExistingCount).toBe(5);
    expect(withDbTransactionMock).toHaveBeenCalledTimes(2);
    expect(entriesFindExistingRecurringKeysMock).toHaveBeenCalledTimes(2);
    expect(entriesCreateManyMock).toHaveBeenCalledTimes(1);
  });

  test('200: filters out a recurring task whose client assignment was revoked', async () => {
    setupHappyPath();
    // `listRecurringForUser` still returns the task (stale user_tasks row), but the
    // user no longer has the client assignment - the recurring path must re-apply the
    // same checks `createTimeEntry` runs and skip this template.
    filterAssignedClientIdsMock.mockResolvedValue(new Set<string>());

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries/recurring/generate',
      headers: authHeader(),
      payload: { fromDate: '2025-06-09', toDate: '2025-06-13' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.generatedCount).toBe(0);
    expect(body.skippedExistingCount).toBe(0);
    expect(entriesCreateManyMock).not.toHaveBeenCalled();
    expect(filterAssignedClientIdsMock).toHaveBeenCalledWith('u1', ['c1']);
    expect(filterAssignedProjectIdsMock).toHaveBeenCalledWith('u1', ['p1']);
    expect(filterAssignedTaskIdsMock).toHaveBeenCalledWith('u1', ['t1']);
  });

  test('200: filters out a recurring task whose project assignment was revoked', async () => {
    setupHappyPath();
    filterAssignedProjectIdsMock.mockResolvedValue(new Set<string>());

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries/recurring/generate',
      headers: authHeader(),
      payload: { fromDate: '2025-06-09', toDate: '2025-06-13' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).generatedCount).toBe(0);
    expect(entriesCreateManyMock).not.toHaveBeenCalled();
  });

  test('200: tracker_all.create bypasses the per-assignment filter', async () => {
    setupHappyPath();
    getRolePermissionsMock.mockResolvedValue([...RECURRING_PERMS, 'timesheets.tracker_all.create']);
    // Even with all bulk filters returning empty, an admin-scope actor should still
    // generate entries because the filter step is skipped.
    filterAssignedClientIdsMock.mockResolvedValue(new Set<string>());
    filterAssignedProjectIdsMock.mockResolvedValue(new Set<string>());
    filterAssignedTaskIdsMock.mockResolvedValue(new Set<string>());

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/entries/recurring/generate',
      headers: authHeader(),
      payload: { fromDate: '2025-06-09', toDate: '2025-06-13' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).generatedCount).toBe(5);
    expect(entriesCreateManyMock).toHaveBeenCalledTimes(1);
    expect(filterAssignedClientIdsMock).not.toHaveBeenCalled();
    expect(filterAssignedProjectIdsMock).not.toHaveBeenCalled();
    expect(filterAssignedTaskIdsMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/entries (bulk)', () => {
  test('204 manager-scoped restricts to viewer', async () => {
    entriesBulkDeleteMock.mockResolvedValue(3);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/entries?projectId=p1&task=Dev',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(entriesBulkDeleteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        task: 'Dev',
        restrictToManagerScopeOf: 'u1',
        placeholderOnly: false,
      }),
    );
  });

  test('204 admin scope deletes across all users', async () => {
    getRolePermissionsMock.mockResolvedValue([
      ...TRACKER_ALL_PERMS,
      'timesheets.tracker_all.delete',
    ]);
    entriesBulkDeleteMock.mockResolvedValue(7);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/entries?projectId=p1&task=Dev',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(entriesBulkDeleteMock).toHaveBeenCalledWith(
      expect.objectContaining({ restrictToManagerScopeOf: undefined }),
    );
  });

  test('204 futureOnly=true sets fromDate to today', async () => {
    entriesBulkDeleteMock.mockResolvedValue(1);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/entries?projectId=p1&task=Dev&futureOnly=true',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(entriesBulkDeleteMock).toHaveBeenCalledTimes(1);
    const callArgs = entriesBulkDeleteMock.mock.calls[0][0];
    expect(callArgs.fromDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('204 futureOnly=false leaves fromDate unset', async () => {
    entriesBulkDeleteMock.mockResolvedValue(1);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/entries?projectId=p1&task=Dev&futureOnly=false',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(entriesBulkDeleteMock).toHaveBeenCalledTimes(1);
    const callArgs = entriesBulkDeleteMock.mock.calls[0][0];
    expect(callArgs.fromDate).toBeUndefined();
  });

  test('204 placeholderOnly=true restricts tracker deletes to placeholders', async () => {
    entriesBulkDeleteMock.mockResolvedValue(1);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/entries?projectId=p1&task=Dev&placeholderOnly=true',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(entriesBulkDeleteMock).toHaveBeenCalledWith(
      expect.objectContaining({ placeholderOnly: true }),
    );
  });

  test('400 invalid boolean query value does not delete', async () => {
    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/entries?projectId=p1&task=Dev&futureOnly=1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(400);
    expect(entriesBulkDeleteMock).not.toHaveBeenCalled();
  });

  test('400 repeated boolean query value does not delete', async () => {
    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/entries?projectId=p1&task=Dev&placeholderOnly=true&placeholderOnly=false',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(400);
    expect(entriesBulkDeleteMock).not.toHaveBeenCalled();
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

  test('204 with only timesheets.tracker_all.delete widens scope across users', async () => {
    getRolePermissionsMock.mockResolvedValue(['timesheets.tracker_all.delete']);
    entriesBulkDeleteMock.mockResolvedValue(5);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/entries?projectId=p1&task=Dev',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(entriesBulkDeleteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        task: 'Dev',
        restrictToManagerScopeOf: undefined,
      }),
    );
  });

  test('204 with only timesheets.recurring.delete is restricted to actor placeholders', async () => {
    getRolePermissionsMock.mockResolvedValue(['timesheets.recurring.delete']);
    entriesBulkDeleteMock.mockResolvedValue(2);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/entries?projectId=p1&task=Dev&placeholderOnly=false',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(entriesBulkDeleteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        task: 'Dev',
        restrictToManagerScopeOf: 'u1',
        placeholderOnly: true,
      }),
    );
  });
});
