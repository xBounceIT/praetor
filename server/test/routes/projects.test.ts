import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realProjectsRepo from '../../repositories/projectsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUserAssignmentsRepo from '../../repositories/userAssignmentsRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realAudit from '../../utils/audit.ts';
import { ForeignKeyError, NotFoundError } from '../../utils/http-errors.ts';
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
const projectsRepoSnap = { ...realProjectsRepo };
const userAssignmentsRepoSnap = { ...realUserAssignmentsRepo };
const auditSnap = { ...realAudit };
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
const deleteByIdMock = mock();
const lockClientIdByIdMock = mock();
const lockNameAndClientByIdMock = mock();
const findAssignedUserIdsMock = mock();
const findNonTopManagerUserIdsMock = mock();
const clearNonTopManagerAssignmentsMock = mock();
const addManualAssignmentsMock = mock();
const ensureClientCascadeAssignmentsMock = mock();
const removeClientCascadeForUsersIfUnusedMock = mock();

// userAssignmentsRepo mocks
const assignClientToUserMock = mock(async () => undefined);
const assignProjectToUserMock = mock(async () => undefined);
const assignClientToTopManagersMock = mock(async () => undefined);
const assignProjectToTopManagersMock = mock(async () => undefined);

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
  mock.module('../../repositories/projectsRepo.ts', () => ({
    ...projectsRepoSnap,
    listAll: listAllMock,
    listForUser: listForUserMock,
    create: createMock,
    update: updateMock,
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
  mock.module('../../repositories/userAssignmentsRepo.ts', () => ({
    ...userAssignmentsRepoSnap,
    assignClientToUser: assignClientToUserMock,
    assignProjectToUser: assignProjectToUserMock,
    assignClientToTopManagers: assignClientToTopManagersMock,
    assignProjectToTopManagers: assignProjectToTopManagersMock,
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
  color: '#3b82f6',
  description: null,
  isDisabled: false,
  createdAt: 1_700_000_000_000,
  orderId: null,
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
  lockClientIdByIdMock,
  lockNameAndClientByIdMock,
  findAssignedUserIdsMock,
  findNonTopManagerUserIdsMock,
  clearNonTopManagerAssignmentsMock,
  addManualAssignmentsMock,
  ensureClientCascadeAssignmentsMock,
  removeClientCascadeForUsersIfUnusedMock,
  assignClientToUserMock,
  assignProjectToUserMock,
  assignClientToTopManagersMock,
  assignProjectToTopManagersMock,
  logAuditMock,
  withDbTransactionMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(MANAGE_PERMS);
  withDbTransactionMock.mockImplementation(async (cb) => cb(undefined));
  logAuditMock.mockImplementation(async () => undefined);
  assignClientToUserMock.mockImplementation(async () => undefined);
  assignProjectToUserMock.mockImplementation(async () => undefined);
  assignClientToTopManagersMock.mockImplementation(async () => undefined);
  assignProjectToTopManagersMock.mockImplementation(async () => undefined);

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
        name: 'Website',
        clientId: 'c-1',
        description: 'A new site',
        color: '#abcdef',
        orderId: 'o-1',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Website',
        clientId: 'c-1',
        color: '#abcdef',
        description: 'A new site',
        orderId: 'o-1',
        isDisabled: false,
      }),
    );
    expect(assignClientToUserMock).toHaveBeenCalledWith('u1', 'c-1');
    expect(assignProjectToUserMock).toHaveBeenCalled();
    expect(assignClientToTopManagersMock).toHaveBeenCalledWith('c-1');
    expect(assignProjectToTopManagersMock).toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project.created', entityType: 'project' }),
    );
  });

  test('201: defaults color when omitted', async () => {
    createMock.mockResolvedValue(SAMPLE_PROJECT);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { name: 'Site', clientId: 'c-1' },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ color: '#3b82f6', orderId: null, description: null }),
    );
  });

  test('400: missing name', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { name: '   ', clientId: 'c-1' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'name is required' });
  });

  test('400: missing clientId', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { name: 'Website', clientId: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'clientId is required' });
  });

  test('400: invalid hex color', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { name: 'X', clientId: 'c-1', color: 'not-a-hex' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/color must be a valid hex color/);
  });

  test('400: ForeignKeyError mapped to 400', async () => {
    createMock.mockImplementation(async () => {
      throw new ForeignKeyError('Client');
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { name: 'Site', clientId: 'c-missing' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Client not found' });
  });

  test('401: missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'X', clientId: 'c-1' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403: missing manage.create permission', async () => {
    getRolePermissionsMock.mockResolvedValue(USER_PERMS);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { name: 'X', clientId: 'c-1' },
    });

    expect(res.statusCode).toBe(403);
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

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ message: 'Project deleted' });
    expect(deleteByIdMock).toHaveBeenCalledWith('p-1', undefined);
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
      undefined,
    );
    expect(removeClientCascadeForUsersIfUnusedMock).toHaveBeenCalledWith(
      ['u2', 'u3'],
      'c-old',
      undefined,
    );
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

  test('400: invalid hex color', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/projects/p-1',
      headers: authHeader(),
      payload: { color: 'bogus' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/color must be a valid hex color/);
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
    expect(clearNonTopManagerAssignmentsMock).toHaveBeenCalledWith('p-1', undefined);
    expect(addManualAssignmentsMock).toHaveBeenCalledWith('p-1', ['u2', 'u4'], undefined);
    expect(ensureClientCascadeAssignmentsMock).toHaveBeenCalledWith(['u2', 'u4'], 'c-1', undefined);
    // u3 is removed (was previously assigned but not in new list)
    expect(removeClientCascadeForUsersIfUnusedMock).toHaveBeenCalledWith(['u3'], 'c-1', undefined);
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
