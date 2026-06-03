import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
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
import { TX_SENTINEL } from '../helpers/txSentinel.ts';
import { makeWithDbTransactionMock } from '../helpers/withDbTransactionMock.ts';

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

// Auth middleware
const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

// rolesRepo
const listAllMock = mock();
const findByIdMock = mock();
const insertRoleMock = mock();
const updateRoleNameMock = mock();
const deleteRoleMock = mock();
const isRoleInUseMock = mock();
const insertPermissionsMock = mock();
const clearPermissionsMock = mock();
const listExplicitPermissionsMock = mock();
const listExplicitPermissionsForRolesMock = mock();

// audit / drizzle
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
    listAll: listAllMock,
    findById: findByIdMock,
    insertRole: insertRoleMock,
    updateRoleName: updateRoleNameMock,
    deleteRole: deleteRoleMock,
    isRoleInUse: isRoleInUseMock,
    insertPermissions: insertPermissionsMock,
    clearPermissions: clearPermissionsMock,
    listExplicitPermissions: listExplicitPermissionsMock,
    listExplicitPermissionsForRoles: listExplicitPermissionsForRolesMock,
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

  routePlugin = (await import('../../routes/roles.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
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
  sessionVersion: 1,
};

const MANAGER_USER = {
  id: 'u-mgr',
  name: 'Mary Manager',
  username: 'mary',
  role: 'manager',
  avatarInitials: 'MM',
  isDisabled: false,
  sessionVersion: 1,
};

const USER_USER = {
  id: 'u-user',
  name: 'Ursula User',
  username: 'user',
  role: 'user',
  avatarInitials: 'UU',
  isDisabled: false,
  sessionVersion: 1,
};

// Full admin permission set
const ADMIN_PERMS = [
  'administration.roles.view',
  'administration.roles.create',
  'administration.roles.update',
  'administration.roles.delete',
];

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  listAllMock,
  findByIdMock,
  insertRoleMock,
  updateRoleNameMock,
  deleteRoleMock,
  isRoleInUseMock,
  insertPermissionsMock,
  clearPermissionsMock,
  listExplicitPermissionsMock,
  listExplicitPermissionsForRolesMock,
  logAuditMock,
  withDbTransactionMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();

  findAuthUserByIdMock.mockResolvedValue(ADMIN_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(ADMIN_PERMS);
  resetWithDbTransactionMock();
  logAuditMock.mockImplementation(async () => undefined);
  // Default: no explicit permissions on any role
  listExplicitPermissionsMock.mockResolvedValue([]);
  listExplicitPermissionsForRolesMock.mockResolvedValue(new Map());

  testApp = await buildRouteTestApp(routePlugin, '/api/roles');
});

afterEach(async () => {
  await testApp.close();
});

const adminAuth = () => ({ authorization: `Bearer ${signToken({ userId: ADMIN_USER.id })}` });
const managerAuth = () => ({ authorization: `Bearer ${signToken({ userId: MANAGER_USER.id })}` });
const userAuth = () => ({ authorization: `Bearer ${signToken({ userId: USER_USER.id })}` });

// =========================================================================
// GET /api/roles
// =========================================================================

describe('GET /api/roles', () => {
  test('200 lists roles with permissions', async () => {
    listAllMock.mockResolvedValue([
      { id: 'admin', name: 'Admin', isSystem: true, isAdmin: true },
      { id: 'user', name: 'User', isSystem: true, isAdmin: false },
    ]);
    listExplicitPermissionsForRolesMock.mockResolvedValue(
      new Map([
        ['admin', []],
        ['user', ['timesheets.tracker.view']],
      ]),
    );

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/roles',
      headers: adminAuth(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    const adminRole = body.find((r: { id: string }) => r.id === 'admin');
    expect(adminRole.permissions).toEqual(expect.arrayContaining(['administration.roles.view']));
    const userRole = body.find((r: { id: string }) => r.id === 'user');
    expect(userRole.permissions).toEqual(expect.arrayContaining(['timesheets.tracker.view']));
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/roles' });
    expect(res.statusCode).toBe(401);
  });

  test('403 manager without administration.roles.view', async () => {
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue(['timesheets.tracker.view']);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/roles',
      headers: managerAuth(),
    });

    expect(res.statusCode).toBe(403);
  });

  test('403 user without administration.roles.view', async () => {
    findAuthUserByIdMock.mockResolvedValue(USER_USER);
    getRolePermissionsMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/roles',
      headers: userAuth(),
    });

    expect(res.statusCode).toBe(403);
  });
});

// =========================================================================
// POST /api/roles
// =========================================================================

describe('POST /api/roles', () => {
  test('201 creates role with permissions', async () => {
    insertRoleMock.mockResolvedValue(undefined);
    insertPermissionsMock.mockResolvedValue(undefined);
    listExplicitPermissionsMock.mockResolvedValue(['timesheets.tracker.view']);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/roles',
      headers: adminAuth(),
      payload: { name: 'Reviewer', permissions: ['timesheets.tracker.view'] },
    });

    expect(res.statusCode).toBe(201);
    expect(insertRoleMock).toHaveBeenCalled();
    expect(insertPermissionsMock).toHaveBeenCalledWith(
      expect.any(String),
      ['timesheets.tracker.view'],
      TX_SENTINEL,
    );
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'role.created' }));
  });

  test('201 creates role with no permissions array', async () => {
    insertRoleMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/roles',
      headers: adminAuth(),
      payload: { name: 'Empty' },
    });

    expect(res.statusCode).toBe(201);
    expect(insertPermissionsMock).toHaveBeenCalledWith(expect.any(String), [], TX_SENTINEL);
  });

  test('400 missing name', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/roles',
      headers: adminAuth(),
      payload: { permissions: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 unknown permission', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/roles',
      headers: adminAuth(),
      payload: { name: 'Bad', permissions: ['nonsense.permission.view'] },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Unknown permission/);
  });

  test('400 administration permission rejected for non-admin role', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/roles',
      headers: adminAuth(),
      payload: { name: 'BadAdmin', permissions: ['administration.roles.view'] },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/administration permissions/);
  });

  test('400 work_units permission rejected (only top_manager allowed)', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/roles',
      headers: adminAuth(),
      payload: { name: 'BadTM', permissions: ['hr.work_units.view'] },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Top Manager role/);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/roles',
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 manager without create permission', async () => {
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue(['administration.roles.view']);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/roles',
      headers: managerAuth(),
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(403);
  });
});

// =========================================================================
// PUT /api/roles/:id (rename)
// =========================================================================

describe('PUT /api/roles/:id', () => {
  test('200 renames role', async () => {
    findByIdMock.mockResolvedValue({
      id: 'role-x',
      name: 'Old Name',
      isSystem: false,
      isAdmin: false,
    });
    updateRoleNameMock.mockResolvedValue(undefined);
    listExplicitPermissionsMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/roles/role-x',
      headers: adminAuth(),
      payload: { name: 'New Name' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateRoleNameMock).toHaveBeenCalledWith('role-x', 'New Name');
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'role.updated' }));
  });

  test('404 role not found (audits the denial)', async () => {
    findByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/roles/missing',
      headers: adminAuth(),
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(404);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'role.rename.not_found',
        entityType: 'role',
        entityId: 'missing',
      }),
    );
  });

  test('403 cannot rename admin role (audits the denial)', async () => {
    findByIdMock.mockResolvedValue({
      id: 'admin',
      name: 'Admin',
      isSystem: true,
      isAdmin: true,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/roles/admin',
      headers: adminAuth(),
      payload: { name: 'NotAdmin' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/cannot be renamed/);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'role.rename.denied',
        entityType: 'role',
        entityId: 'admin',
      }),
    );
  });

  test('403 cannot rename system role', async () => {
    findByIdMock.mockResolvedValue({
      id: 'user',
      name: 'User',
      isSystem: true,
      isAdmin: false,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/roles/user',
      headers: adminAuth(),
      payload: { name: 'Renamed' },
    });

    expect(res.statusCode).toBe(403);
  });

  test('400 missing name', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/roles/role-x',
      headers: adminAuth(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  test('403 without update permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['administration.roles.view']);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/roles/role-x',
      headers: adminAuth(),
      payload: { name: 'X' },
    });

    expect(res.statusCode).toBe(403);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/roles/role-x',
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(401);
  });
});

// =========================================================================
// DELETE /api/roles/:id
// =========================================================================

describe('DELETE /api/roles/:id', () => {
  test('200 deletes unused custom role', async () => {
    findByIdMock.mockResolvedValue({
      id: 'role-x',
      name: 'Custom',
      isSystem: false,
      isAdmin: false,
    });
    isRoleInUseMock.mockResolvedValue(false);
    deleteRoleMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/roles/role-x',
      headers: adminAuth(),
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(deleteRoleMock).toHaveBeenCalledWith('role-x');
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'role.deleted' }));
  });

  test('404 role not found', async () => {
    findByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/roles/missing',
      headers: adminAuth(),
    });
    expect(res.statusCode).toBe(404);
  });

  test('403 cannot delete admin role', async () => {
    findByIdMock.mockResolvedValue({
      id: 'admin',
      name: 'Admin',
      isSystem: true,
      isAdmin: true,
    });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/roles/admin',
      headers: adminAuth(),
    });

    expect(res.statusCode).toBe(403);
  });

  test('403 cannot delete system role', async () => {
    findByIdMock.mockResolvedValue({
      id: 'user',
      name: 'User',
      isSystem: true,
      isAdmin: false,
    });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/roles/user',
      headers: adminAuth(),
    });

    expect(res.statusCode).toBe(403);
  });

  test('409 role in use', async () => {
    findByIdMock.mockResolvedValue({
      id: 'role-x',
      name: 'Custom',
      isSystem: false,
      isAdmin: false,
    });
    isRoleInUseMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/roles/role-x',
      headers: adminAuth(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/in use/);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'role.delete.conflict',
        entityType: 'role',
        entityId: 'role-x',
      }),
    );
  });

  test('403 manager without delete permission', async () => {
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue(['administration.roles.view']);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/roles/role-x',
      headers: managerAuth(),
    });

    expect(res.statusCode).toBe(403);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'DELETE', url: '/api/roles/role-x' });
    expect(res.statusCode).toBe(401);
  });
});

// =========================================================================
// PUT /api/roles/:id/permissions
// =========================================================================

describe('PUT /api/roles/:id/permissions', () => {
  test('200 updates permissions for non-admin role', async () => {
    findByIdMock.mockResolvedValue({
      id: 'role-x',
      name: 'Reviewer',
      isSystem: false,
      isAdmin: false,
    });
    listExplicitPermissionsMock.mockResolvedValue(['timesheets.tracker.view']);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/roles/role-x/permissions',
      headers: adminAuth(),
      payload: { permissions: ['timesheets.tracker.view'] },
    });

    expect(res.statusCode).toBe(200);
    expect(clearPermissionsMock).toHaveBeenCalledWith('role-x', TX_SENTINEL);
    expect(insertPermissionsMock).toHaveBeenCalledWith(
      'role-x',
      ['timesheets.tracker.view'],
      TX_SENTINEL,
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'role.permissions_updated' }),
    );
  });

  test('200 top_manager role can include hr.work_units permission', async () => {
    findByIdMock.mockResolvedValue({
      id: 'top_manager',
      name: 'Top Manager',
      isSystem: true,
      isAdmin: false,
    });
    listExplicitPermissionsMock.mockResolvedValue(['hr.work_units.view']);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/roles/top_manager/permissions',
      headers: adminAuth(),
      payload: { permissions: ['hr.work_units.view'] },
    });

    expect(res.statusCode).toBe(200);
  });

  test('404 role not found', async () => {
    findByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/roles/missing/permissions',
      headers: adminAuth(),
      payload: { permissions: [] },
    });
    expect(res.statusCode).toBe(404);
  });

  test('403 admin role permissions are locked', async () => {
    findByIdMock.mockResolvedValue({
      id: 'admin',
      name: 'Admin',
      isSystem: true,
      isAdmin: true,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/roles/admin/permissions',
      headers: adminAuth(),
      payload: { permissions: ['administration.roles.view'] },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/Admin role permissions are locked/);
  });

  test('400 unknown permission', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/roles/role-x/permissions',
      headers: adminAuth(),
      payload: { permissions: ['fake.permission.view'] },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Unknown permission/);
  });

  test('400 administration permission rejected for non-admin role', async () => {
    findByIdMock.mockResolvedValue({
      id: 'role-x',
      name: 'Reviewer',
      isSystem: false,
      isAdmin: false,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/roles/role-x/permissions',
      headers: adminAuth(),
      payload: { permissions: ['administration.roles.view'] },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/administration permissions/);
  });

  test('400 work_units permission rejected for non-top_manager', async () => {
    findByIdMock.mockResolvedValue({
      id: 'role-x',
      name: 'Reviewer',
      isSystem: false,
      isAdmin: false,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/roles/role-x/permissions',
      headers: adminAuth(),
      payload: { permissions: ['hr.work_units.view'] },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Top Manager role/);
  });

  test('400 permissions not an array', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/roles/role-x/permissions',
      headers: adminAuth(),
      payload: { permissions: 'not-array' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('403 without update permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['administration.roles.view']);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/roles/role-x/permissions',
      headers: adminAuth(),
      payload: { permissions: [] },
    });

    expect(res.statusCode).toBe(403);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/roles/role-x/permissions',
      payload: { permissions: [] },
    });
    expect(res.statusCode).toBe(401);
  });
});
