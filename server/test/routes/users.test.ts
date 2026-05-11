import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realClientsRepo from '../../repositories/clientsRepo.ts';
import * as realProjectsRepo from '../../repositories/projectsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realSettingsRepo from '../../repositories/settingsRepo.ts';
import * as realTasksRepo from '../../repositories/tasksRepo.ts';
import * as realUserAssignmentsRepo from '../../repositories/userAssignmentsRepo.ts';
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
const clientsRepoSnap = { ...realClientsRepo };
const projectsRepoSnap = { ...realProjectsRepo };
const tasksRepoSnap = { ...realTasksRepo };
const rolesRepoSnap = { ...realRolesRepo };
const settingsRepoSnap = { ...realSettingsRepo };
const userAssignmentsRepoSnap = { ...realUserAssignmentsRepo };
const permissionsSnap = { ...realPermissions };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

// Auth middleware
const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

// usersRepo
const listAllForAdminMock = mock();
const listScopedForManagerMock = mock();
const findCoreByIdMock = mock();
const findByIdMock = mock();
const existsByUsernameMock = mock();
const insertUserMock = mock();
const deleteByIdMock = mock();
const updateUserDynamicMock = mock();
const addUserRoleMock = mock();
const replaceUserRolesMock = mock();
const setPrimaryRoleMock = mock();
const getUserRoleIdsMock = mock();
const canManageUserMock = mock();
const getAssignmentsMock = mock();

// tracker catalog repos
const listClientsMock = mock();
const listProjectsForUserMock = mock();
const listTasksForUserMock = mock();

// rolesRepo
const rolesFindByIdMock = mock();
const rolesFindExistingIdsMock = mock();

// settingsRepo
const settingsUpsertForUserMock = mock();

// userAssignmentsRepo
const userHasTopManagerRoleMock = mock();
const syncTopManagerAssignmentsForUserMock = mock();
const replaceUserClientsMock = mock();
const replaceUserProjectsMock = mock();
const replaceUserTasksMock = mock();
const clearProjectCascadeAssignmentsMock = mock();
const applyProjectCascadeToClientsMock = mock();
const filterAssignedClientIdsMock = mock();
const filterAssignedProjectIdsMock = mock();
const filterAssignedTaskIdsMock = mock();

// audit / drizzle
const logAuditMock = mock(async () => undefined);
const withDbTransactionMock = mock(async (cb: (tx: unknown) => unknown) => cb(undefined));

let routePlugin: FastifyPluginAsync;

beforeAll(async () => {
  installAuthMiddlewareMock();

  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findAuthUserById: findAuthUserByIdMock,
    listAllForAdmin: listAllForAdminMock,
    listScopedForManager: listScopedForManagerMock,
    findCoreById: findCoreByIdMock,
    findById: findByIdMock,
    existsByUsername: existsByUsernameMock,
    insertUser: insertUserMock,
    deleteById: deleteByIdMock,
    updateUserDynamic: updateUserDynamicMock,
    addUserRole: addUserRoleMock,
    replaceUserRoles: replaceUserRolesMock,
    setPrimaryRole: setPrimaryRoleMock,
    getUserRoleIds: getUserRoleIdsMock,
    canManageUser: canManageUserMock,
    getAssignments: getAssignmentsMock,
  }));
  mock.module('../../repositories/clientsRepo.ts', () => ({
    ...clientsRepoSnap,
    list: listClientsMock,
  }));
  mock.module('../../repositories/projectsRepo.ts', () => ({
    ...projectsRepoSnap,
    listForUser: listProjectsForUserMock,
  }));
  mock.module('../../repositories/tasksRepo.ts', () => ({
    ...tasksRepoSnap,
    listForUser: listTasksForUserMock,
  }));
  mock.module('../../repositories/rolesRepo.ts', () => ({
    ...rolesRepoSnap,
    userHasRole: userHasRoleMock,
    findById: rolesFindByIdMock,
    findExistingIds: rolesFindExistingIdsMock,
  }));
  mock.module('../../repositories/settingsRepo.ts', () => ({
    ...settingsRepoSnap,
    upsertForUser: settingsUpsertForUserMock,
  }));
  mock.module('../../repositories/userAssignmentsRepo.ts', () => ({
    ...userAssignmentsRepoSnap,
    userHasTopManagerRole: userHasTopManagerRoleMock,
    syncTopManagerAssignmentsForUser: syncTopManagerAssignmentsForUserMock,
    replaceUserClients: replaceUserClientsMock,
    replaceUserProjects: replaceUserProjectsMock,
    replaceUserTasks: replaceUserTasksMock,
    clearProjectCascadeAssignments: clearProjectCascadeAssignmentsMock,
    applyProjectCascadeToClients: applyProjectCascadeToClientsMock,
    filterAssignedClientIds: filterAssignedClientIdsMock,
    filterAssignedProjectIds: filterAssignedProjectIdsMock,
    filterAssignedTaskIds: filterAssignedTaskIdsMock,
  }));
  mock.module('../../utils/permissions.ts', () => ({
    ...permissionsSnap,
    getRolePermissions: getRolePermissionsMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));

  routePlugin = (await import('../../routes/users.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/clientsRepo.ts', () => clientsRepoSnap);
  mock.module('../../repositories/projectsRepo.ts', () => projectsRepoSnap);
  mock.module('../../repositories/tasksRepo.ts', () => tasksRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../repositories/settingsRepo.ts', () => settingsRepoSnap);
  mock.module('../../repositories/userAssignmentsRepo.ts', () => userAssignmentsRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
  mock.module('../../db/drizzle.ts', () => drizzleSnap);
});

const ADMIN_USER = {
  id: 'u-admin',
  name: 'Adam Admin',
  username: 'admin',
  role: 'admin',
  avatarInitials: 'AA',
  isDisabled: false,
};

const MANAGER_USER = {
  id: 'u-mgr',
  name: 'Mary Manager',
  username: 'mary',
  role: 'manager',
  avatarInitials: 'MM',
  isDisabled: false,
};

const REGULAR_USER = {
  id: 'u-user',
  name: 'Ursula User',
  username: 'user',
  role: 'user',
  avatarInitials: 'UU',
  isDisabled: false,
};

// Permissions: cover everything users.ts checks for (admin-equivalent)
const ALL_USER_PERMS = [
  'administration.user_management.view',
  'administration.user_management.create',
  'administration.user_management.update',
  'administration.user_management.delete',
  'administration.user_management_all.view',
  'hr.internal.view',
  'hr.internal.create',
  'hr.internal.update',
  'hr.internal.delete',
  'hr.external.view',
  'hr.external.create',
  'hr.external.update',
  'hr.external.delete',
  'hr.costs.view',
  'hr.costs.update',
  'hr.employee_assignments.update',
  'hr.work_units_all.view',
  'timesheets.tracker.view',
];

// User-only permissions (no admin/management)
const USER_ONLY_PERMS = ['timesheets.tracker.view'];

const SAMPLE_USER_ROW = {
  id: 'u-target',
  name: 'Target',
  username: 'target',
  email: 'target@example.com',
  role: 'user',
  avatarInitials: 'T',
  costPerHour: 50,
  isDisabled: false,
  employeeType: 'app_user' as const,
  hasTopManagerRole: false,
  isAdminOnly: false,
};

const SAMPLE_USER_CORE = {
  id: 'u-target',
  name: 'Target',
  username: 'target',
  role: 'user',
  employeeType: 'app_user' as const,
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  listAllForAdminMock,
  listScopedForManagerMock,
  findCoreByIdMock,
  findByIdMock,
  existsByUsernameMock,
  insertUserMock,
  deleteByIdMock,
  updateUserDynamicMock,
  addUserRoleMock,
  replaceUserRolesMock,
  setPrimaryRoleMock,
  getUserRoleIdsMock,
  canManageUserMock,
  getAssignmentsMock,
  listClientsMock,
  listProjectsForUserMock,
  listTasksForUserMock,
  rolesFindByIdMock,
  rolesFindExistingIdsMock,
  settingsUpsertForUserMock,
  userHasTopManagerRoleMock,
  syncTopManagerAssignmentsForUserMock,
  replaceUserClientsMock,
  replaceUserProjectsMock,
  replaceUserTasksMock,
  clearProjectCascadeAssignmentsMock,
  applyProjectCascadeToClientsMock,
  filterAssignedClientIdsMock,
  filterAssignedProjectIdsMock,
  filterAssignedTaskIdsMock,
  logAuditMock,
  withDbTransactionMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();

  // Default to admin-style identity with all permissions
  findAuthUserByIdMock.mockResolvedValue(ADMIN_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(ALL_USER_PERMS);
  withDbTransactionMock.mockImplementation(async (cb) => cb(undefined));
  logAuditMock.mockImplementation(async () => undefined);
  filterAssignedClientIdsMock.mockResolvedValue(new Set(['c1']));
  filterAssignedProjectIdsMock.mockResolvedValue(new Set(['p1']));
  filterAssignedTaskIdsMock.mockResolvedValue(new Set(['t1']));
  listClientsMock.mockResolvedValue([]);
  listProjectsForUserMock.mockResolvedValue([]);
  listTasksForUserMock.mockResolvedValue([]);

  testApp = await buildRouteTestApp(routePlugin, '/api/users');
});

afterEach(async () => {
  await testApp.close();
});

const adminAuth = () => ({ authorization: `Bearer ${signToken({ userId: ADMIN_USER.id })}` });
const managerAuth = () => ({ authorization: `Bearer ${signToken({ userId: MANAGER_USER.id })}` });
const userAuth = () => ({ authorization: `Bearer ${signToken({ userId: REGULAR_USER.id })}` });

// =========================================================================
// GET /api/users - list users
// =========================================================================

describe('GET /api/users', () => {
  test('200 admin → listAllForAdmin', async () => {
    listAllForAdminMock.mockResolvedValue([SAMPLE_USER_ROW]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/users',
      headers: adminAuth(),
    });

    expect(res.statusCode).toBe(200);
    expect(listAllForAdminMock).toHaveBeenCalledTimes(1);
    expect(listScopedForManagerMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body[0].email).toBe('target@example.com');
    expect(body[0].costPerHour).toBe(50);
  });

  test('200 manager without all-view scope → listScopedForManager', async () => {
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue([
      'administration.user_management.view',
      'hr.internal.view',
      'hr.external.view',
      'hr.costs.view',
    ]);
    listScopedForManagerMock.mockResolvedValue([SAMPLE_USER_ROW]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/users',
      headers: managerAuth(),
    });

    expect(res.statusCode).toBe(200);
    expect(listScopedForManagerMock).toHaveBeenCalledWith(
      MANAGER_USER.id,
      expect.objectContaining({
        canViewManagedUsers: true,
        canViewInternal: true,
        canViewExternal: true,
      }),
    );
    expect(listAllForAdminMock).not.toHaveBeenCalled();
  });

  test('200 user without cost view → cost masked to 0, email masked to ""', async () => {
    findAuthUserByIdMock.mockResolvedValue(REGULAR_USER);
    getRolePermissionsMock.mockResolvedValue(USER_ONLY_PERMS);
    listScopedForManagerMock.mockResolvedValue([SAMPLE_USER_ROW]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/users',
      headers: userAuth(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body[0].costPerHour).toBe(0);
    expect(body[0].email).toBe('');
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/users' });
    expect(res.statusCode).toBe(401);
  });

  test('403 with no relevant permissions', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/users',
      headers: adminAuth(),
    });
    expect(res.statusCode).toBe(403);
  });
});

// =========================================================================
// POST /api/users - create user
// =========================================================================

describe('POST /api/users', () => {
  test('201 creates app_user', async () => {
    rolesFindByIdMock.mockResolvedValue({
      id: 'user',
      name: 'User',
      isSystem: true,
      isAdmin: false,
    });
    existsByUsernameMock.mockResolvedValue(false);
    insertUserMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users',
      headers: adminAuth(),
      payload: {
        name: 'New User',
        username: 'newuser',
        password: 'secret',
        role: 'user',
        email: 'new@example.com',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.username).toBe('newuser');
    expect(body.email).toBe('new@example.com');
    expect(insertUserMock).toHaveBeenCalled();
    expect(addUserRoleMock).toHaveBeenCalled();
    expect(settingsUpsertForUserMock).toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.created', entityType: 'user' }),
    );
  });

  test('201 creates internal employee with auto-generated username', async () => {
    insertUserMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users',
      headers: adminAuth(),
      payload: { name: 'Internal Bob', employeeType: 'internal' },
    });

    expect(res.statusCode).toBe(201);
    expect(insertUserMock).toHaveBeenCalled();
    // role auto-set to 'user', no rolesRepo.findById lookup needed
    expect(rolesFindByIdMock).not.toHaveBeenCalled();
  });

  test('201 top-manager triggers syncTopManagerAssignmentsForUser', async () => {
    rolesFindByIdMock.mockResolvedValue({
      id: 'top_manager',
      name: 'Top Manager',
      isSystem: true,
      isAdmin: false,
    });
    existsByUsernameMock.mockResolvedValue(false);
    insertUserMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users',
      headers: adminAuth(),
      payload: {
        name: 'Top Mgr',
        username: 'topmgr',
        password: 'secret',
        role: 'top_manager',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(syncTopManagerAssignmentsForUserMock).toHaveBeenCalled();
  });

  test('400 missing name', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users',
      headers: adminAuth(),
      payload: { username: 'x', password: 'x', role: 'user' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 missing username for app_user', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users',
      headers: adminAuth(),
      payload: { name: 'X', password: 'x', role: 'user' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/username/);
  });

  test('400 invalid role', async () => {
    rolesFindByIdMock.mockResolvedValue(null);
    existsByUsernameMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users',
      headers: adminAuth(),
      payload: { name: 'X', username: 'x', password: 'x', role: 'nope' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Invalid role');
  });

  test('400 username already exists', async () => {
    rolesFindByIdMock.mockResolvedValue({
      id: 'user',
      name: 'User',
      isSystem: true,
      isAdmin: false,
    });
    existsByUsernameMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users',
      headers: adminAuth(),
      payload: { name: 'X', username: 'x', password: 'x', role: 'user' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Username already exists');
  });

  test('400 invalid employeeType enum', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users',
      headers: adminAuth(),
      payload: { name: 'X', employeeType: 'banana' },
    });
    // Caught by Fastify's schema enum
    expect(res.statusCode).toBe(400);
  });

  test('403 without create permission for app_user', async () => {
    // Allow internal create, but not app_user
    getRolePermissionsMock.mockResolvedValue([
      'hr.internal.create',
      'administration.user_management.view',
    ]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users',
      headers: adminAuth(),
      payload: { name: 'X', username: 'x', password: 'x', role: 'user' },
    });

    expect(res.statusCode).toBe(403);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users',
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(401);
  });
});

// =========================================================================
// DELETE /api/users/:id
// =========================================================================

describe('DELETE /api/users/:id', () => {
  test('200 admin deletes app_user', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    deleteByIdMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/users/u-target',
      headers: adminAuth(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ message: 'User deleted' });
    expect(deleteByIdMock).toHaveBeenCalledWith('u-target');
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.deleted', entityId: 'u-target' }),
    );
  });

  test('400 cannot delete own account', async () => {
    const res = await testApp.inject({
      method: 'DELETE',
      url: `/api/users/${ADMIN_USER.id}`,
      headers: adminAuth(),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Cannot delete your own account');
  });

  test('404 user not found', async () => {
    findCoreByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/users/missing',
      headers: adminAuth(),
    });

    expect(res.statusCode).toBe(404);
  });

  test('403 without delete permission for target type', async () => {
    findCoreByIdMock.mockResolvedValue({ ...SAMPLE_USER_CORE, employeeType: 'internal' });
    // grant only app_user delete, not internal delete
    getRolePermissionsMock.mockResolvedValue([
      'administration.user_management.delete',
      'administration.user_management.view',
    ]);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/users/u-target',
      headers: adminAuth(),
    });

    expect(res.statusCode).toBe(403);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'DELETE', url: '/api/users/u-target' });
    expect(res.statusCode).toBe(401);
  });
});

// =========================================================================
// PUT /api/users/:id - update + disable/enable + role change
// =========================================================================

describe('PUT /api/users/:id', () => {
  test('200 admin updates name', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    updateUserDynamicMock.mockResolvedValue({
      ...SAMPLE_USER_CORE,
      name: 'Renamed',
      avatarInitials: 'R',
      costPerHour: 50,
      isDisabled: false,
    });
    findByIdMock.mockResolvedValue({ ...SAMPLE_USER_ROW, name: 'Renamed' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: adminAuth(),
      payload: { name: 'Renamed' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateUserDynamicMock).toHaveBeenCalledWith(
      'u-target',
      expect.objectContaining({ name: 'Renamed' }),
      undefined,
    );
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.updated' }));
  });

  test('200 isDisabled=true → user.disabled audit action', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    updateUserDynamicMock.mockResolvedValue({
      ...SAMPLE_USER_CORE,
      avatarInitials: 'T',
      costPerHour: 50,
      isDisabled: true,
    });
    findByIdMock.mockResolvedValue({ ...SAMPLE_USER_ROW, isDisabled: true });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: adminAuth(),
      payload: { isDisabled: true },
    });

    expect(res.statusCode).toBe(200);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.disabled' }));
  });

  test('200 isDisabled=false → user.enabled audit action', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    updateUserDynamicMock.mockResolvedValue({
      ...SAMPLE_USER_CORE,
      avatarInitials: 'T',
      costPerHour: 50,
      isDisabled: false,
    });
    findByIdMock.mockResolvedValue({ ...SAMPLE_USER_ROW, isDisabled: false });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: adminAuth(),
      payload: { isDisabled: false },
    });

    expect(res.statusCode).toBe(200);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.enabled' }));
  });

  test('200 role change triggers user.role_changed and syncTopManager', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    rolesFindByIdMock.mockResolvedValue({
      id: 'manager',
      name: 'Manager',
      isSystem: true,
      isAdmin: false,
    });
    updateUserDynamicMock.mockResolvedValue({
      ...SAMPLE_USER_CORE,
      role: 'manager',
      avatarInitials: 'T',
      costPerHour: 50,
      isDisabled: false,
    });
    findByIdMock.mockResolvedValue({ ...SAMPLE_USER_ROW, role: 'manager' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: adminAuth(),
      payload: { role: 'manager' },
    });

    expect(res.statusCode).toBe(200);
    expect(replaceUserRolesMock).toHaveBeenCalledWith('u-target', ['manager'], undefined);
    expect(syncTopManagerAssignmentsForUserMock).toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.role_changed' }),
    );
  });

  test('403 cannot change own role', async () => {
    findCoreByIdMock.mockResolvedValue({
      ...SAMPLE_USER_CORE,
      id: ADMIN_USER.id,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: `/api/users/${ADMIN_USER.id}`,
      headers: adminAuth(),
      payload: { role: 'user' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('Cannot change your own role');
  });

  test('400 cannot disable own account', async () => {
    findCoreByIdMock.mockResolvedValue({
      ...SAMPLE_USER_CORE,
      id: ADMIN_USER.id,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: `/api/users/${ADMIN_USER.id}`,
      headers: adminAuth(),
      payload: { isDisabled: true },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Cannot disable your own account');
  });

  test('400 invalid role', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    rolesFindByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: adminAuth(),
      payload: { role: 'fake' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Invalid role');
  });

  test('400 no fields to update', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: adminAuth(),
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('No fields to update');
  });

  test('404 user not found', async () => {
    findCoreByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/missing',
      headers: adminAuth(),
      payload: { name: 'X' },
    });

    expect(res.statusCode).toBe(404);
  });

  test('403 without update permission for target type', async () => {
    findCoreByIdMock.mockResolvedValue({ ...SAMPLE_USER_CORE, employeeType: 'internal' });
    getRolePermissionsMock.mockResolvedValue([
      'administration.user_management.update',
      'administration.user_management.view',
    ]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: adminAuth(),
      payload: { name: 'X' },
    });

    expect(res.statusCode).toBe(403);
  });

  test('403 manager cannot update unmanaged app_user', async () => {
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue([
      'administration.user_management.update',
      'administration.user_management.view',
    ]);
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    canManageUserMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: managerAuth(),
      payload: { name: 'Renamed' },
    });

    expect(res.statusCode).toBe(403);
  });

  test('200 only email change updates settings (no field updates needed)', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    findByIdMock.mockResolvedValue({ ...SAMPLE_USER_ROW, email: 'new@x.com' });
    settingsUpsertForUserMock.mockResolvedValue({});

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: adminAuth(),
      payload: { email: 'new@x.com' },
    });

    expect(res.statusCode).toBe(200);
    expect(settingsUpsertForUserMock).toHaveBeenCalled();
    // No dynamic field update needed → updateUserDynamic not called
    expect(updateUserDynamicMock).not.toHaveBeenCalled();
  });

  test('400 invalid email', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: adminAuth(),
      payload: { email: 'not-an-email' },
    });

    expect(res.statusCode).toBe(400);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(401);
  });
});

// =========================================================================
// GET /api/users/:id/roles
// =========================================================================

describe('GET /api/users/:id/roles', () => {
  test('200 returns assigned roles + primary', async () => {
    findCoreByIdMock.mockResolvedValue({ ...SAMPLE_USER_CORE, role: 'user' });
    getUserRoleIdsMock.mockResolvedValue(['user', 'manager']);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/users/u-target/roles',
      headers: adminAuth(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.primaryRoleId).toBe('user');
    expect(body.roleIds.sort()).toEqual(['manager', 'user']);
  });

  test('404 user not found', async () => {
    findCoreByIdMock.mockResolvedValue(null);
    getUserRoleIdsMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/users/missing/roles',
      headers: adminAuth(),
    });

    expect(res.statusCode).toBe(404);
  });

  test('403 without administration.user_management.update', async () => {
    getRolePermissionsMock.mockResolvedValue(['administration.user_management.view']);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/users/u-target/roles',
      headers: adminAuth(),
    });

    expect(res.statusCode).toBe(403);
  });
});

// =========================================================================
// PUT /api/users/:id/roles - role assignment
// =========================================================================

describe('PUT /api/users/:id/roles', () => {
  test('200 replaces user roles + sets primary', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    rolesFindExistingIdsMock.mockResolvedValue(new Set(['user', 'manager']));

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/roles',
      headers: adminAuth(),
      payload: { roleIds: ['user', 'manager'], primaryRoleId: 'manager' },
    });

    expect(res.statusCode).toBe(200);
    expect(replaceUserRolesMock).toHaveBeenCalledWith('u-target', ['user', 'manager'], undefined);
    expect(setPrimaryRoleMock).toHaveBeenCalledWith('u-target', 'manager', undefined);
    expect(syncTopManagerAssignmentsForUserMock).toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.roles_updated' }),
    );
  });

  test('403 cannot edit own roles', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: `/api/users/${ADMIN_USER.id}/roles`,
      headers: adminAuth(),
      payload: { roleIds: ['user'], primaryRoleId: 'user' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('Cannot change your own role');
  });

  test('400 empty roleIds', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/roles',
      headers: adminAuth(),
      payload: { roleIds: [], primaryRoleId: 'user' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('roleIds must not be empty');
  });

  test('400 primaryRoleId not in roleIds', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/roles',
      headers: adminAuth(),
      payload: { roleIds: ['user'], primaryRoleId: 'manager' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('primaryRoleId must be included in roleIds');
  });

  test('400 unknown role IDs', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    rolesFindExistingIdsMock.mockResolvedValue(new Set(['user']));

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/roles',
      headers: adminAuth(),
      payload: { roleIds: ['user', 'ghost'], primaryRoleId: 'user' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Invalid role/);
  });

  test('404 target user missing', async () => {
    findCoreByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/missing/roles',
      headers: adminAuth(),
      payload: { roleIds: ['user'], primaryRoleId: 'user' },
    });

    expect(res.statusCode).toBe(404);
  });

  test('403 without update permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['administration.user_management.view']);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/roles',
      headers: adminAuth(),
      payload: { roleIds: ['user'], primaryRoleId: 'user' },
    });

    expect(res.statusCode).toBe(403);
  });
});

// =========================================================================
// GET /api/users/:id/assignments
// =========================================================================

describe('GET /api/users/:id/assignments', () => {
  test('200 admin views any user assignments', async () => {
    getAssignmentsMock.mockResolvedValue({
      clientIds: ['c1'],
      projectIds: ['p1'],
      taskIds: ['t1'],
    });

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/users/u-target/assignments',
      headers: adminAuth(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      clientIds: ['c1'],
      projectIds: ['p1'],
      taskIds: ['t1'],
    });
  });

  test('200 user views own assignments without admin perms', async () => {
    findAuthUserByIdMock.mockResolvedValue(REGULAR_USER);
    getRolePermissionsMock.mockResolvedValue([]);
    getAssignmentsMock.mockResolvedValue({ clientIds: [], projectIds: [], taskIds: [] });

    const res = await testApp.inject({
      method: 'GET',
      url: `/api/users/${REGULAR_USER.id}/assignments`,
      headers: userAuth(),
    });

    expect(res.statusCode).toBe(200);
  });

  test('403 user without perms cannot view other assignments', async () => {
    findAuthUserByIdMock.mockResolvedValue(REGULAR_USER);
    getRolePermissionsMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/users/u-target/assignments',
      headers: userAuth(),
    });

    expect(res.statusCode).toBe(403);
  });

  test('403 manager without all-view + not managing target', async () => {
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue(['administration.user_management.view']);
    canManageUserMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/users/u-target/assignments',
      headers: managerAuth(),
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/users/:id/tracker-catalogs', () => {
  test('200 manager views managed user tracker catalogs including target-only tasks', async () => {
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue(['timesheets.tracker.view']);
    canManageUserMock.mockResolvedValue(true);
    listClientsMock.mockResolvedValue([{ id: 'c1', name: 'Acme Corp', isDisabled: false }]);
    listProjectsForUserMock.mockResolvedValue([
      {
        id: 'p1',
        name: 'Website Redesign',
        clientId: 'c1',
        color: '#123456',
        isDisabled: false,
        billingType: 'time_and_materials',
        billingFrequency: 'monthly',
      },
    ]);
    listTasksForUserMock.mockResolvedValue([
      {
        id: 't-target-only',
        name: 'Initial Design',
        projectId: 'p1',
        isDisabled: false,
      },
    ]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/users/u-target/tracker-catalogs',
      headers: managerAuth(),
    });

    expect(res.statusCode).toBe(200);
    expect(listClientsMock).toHaveBeenCalledWith({ canViewAllClients: false, userId: 'u-target' });
    expect(listProjectsForUserMock).toHaveBeenCalledWith('u-target');
    expect(listTasksForUserMock).toHaveBeenCalledWith('u-target');
    expect(JSON.parse(res.body)).toEqual({
      clients: [{ id: 'c1', name: 'Acme Corp', isDisabled: false }],
      projects: [
        {
          id: 'p1',
          name: 'Website Redesign',
          clientId: 'c1',
          color: '#123456',
          isDisabled: false,
          billingType: 'time_and_materials',
          billingFrequency: 'monthly',
        },
      ],
      projectTasks: [
        {
          id: 't-target-only',
          name: 'Initial Design',
          projectId: 'p1',
          isDisabled: false,
        },
      ],
    });
  });

  test('403 user without scope cannot view another user tracker catalogs', async () => {
    findAuthUserByIdMock.mockResolvedValue(REGULAR_USER);
    getRolePermissionsMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/users/u-target/tracker-catalogs',
      headers: userAuth(),
    });

    expect(res.statusCode).toBe(403);
    expect(listTasksForUserMock).not.toHaveBeenCalled();
  });
});

// =========================================================================
// POST /api/users/:id/assignments
// =========================================================================

describe('POST /api/users/:id/assignments', () => {
  test('200 admin updates assignments', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    userHasTopManagerRoleMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users/u-target/assignments',
      headers: adminAuth(),
      payload: { clientIds: ['c1'], projectIds: ['p1'], taskIds: ['t1'] },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ message: 'Assignments updated' });
    expect(replaceUserClientsMock).toHaveBeenCalled();
    expect(replaceUserProjectsMock).toHaveBeenCalled();
    expect(replaceUserTasksMock).toHaveBeenCalled();
    expect(applyProjectCascadeToClientsMock).toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.assignments_updated' }),
    );
  });

  test('404 user not found', async () => {
    findCoreByIdMock.mockResolvedValue(null);
    userHasTopManagerRoleMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users/missing/assignments',
      headers: adminAuth(),
      payload: {},
    });

    expect(res.statusCode).toBe(404);
  });

  test('409 cannot edit top-manager assignments manually', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    userHasTopManagerRoleMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users/u-target/assignments',
      headers: adminAuth(),
      payload: { clientIds: ['c1'] },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/Top Manager/);
  });

  test('403 manager not managing target user without all-view', async () => {
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue(['hr.employee_assignments.update']);
    canManageUserMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users/u-target/assignments',
      headers: managerAuth(),
      payload: { clientIds: ['c1'] },
    });

    expect(res.statusCode).toBe(403);
  });

  test('403 without hr.employee_assignments.update', async () => {
    getRolePermissionsMock.mockResolvedValue(['administration.user_management.view']);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users/u-target/assignments',
      headers: adminAuth(),
      payload: { clientIds: [] },
    });

    expect(res.statusCode).toBe(403);
  });

  test('403 scoped manager cannot assign clients outside own scope', async () => {
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue(['hr.employee_assignments.update']);
    filterAssignedClientIdsMock.mockResolvedValue(new Set());

    const res = await testApp.inject({
      method: 'POST',
      url: `/api/users/${MANAGER_USER.id}/assignments`,
      headers: managerAuth(),
      payload: { clientIds: ['c-out'] },
    });

    expect(res.statusCode).toBe(403);
    expect(replaceUserClientsMock).not.toHaveBeenCalled();
    expect(filterAssignedClientIdsMock).toHaveBeenCalledWith(MANAGER_USER.id, ['c-out']);
  });

  test('403 scoped manager cannot clear assignments with an empty array', async () => {
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue(['hr.employee_assignments.update']);

    const res = await testApp.inject({
      method: 'POST',
      url: `/api/users/${MANAGER_USER.id}/assignments`,
      headers: managerAuth(),
      payload: { clientIds: [] },
    });

    expect(res.statusCode).toBe(403);
    expect(replaceUserClientsMock).not.toHaveBeenCalled();
    expect(filterAssignedClientIdsMock).not.toHaveBeenCalled();
  });
});
