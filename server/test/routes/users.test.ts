import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realClientsRepo from '../../repositories/clientsRepo.ts';
import * as realExternalIdentitiesRepo from '../../repositories/externalIdentitiesRepo.ts';
import * as realGeneralSettingsRepo from '../../repositories/generalSettingsRepo.ts';
import * as realProjectsRepo from '../../repositories/projectsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realSettingsRepo from '../../repositories/settingsRepo.ts';
import * as realSsoProvidersRepo from '../../repositories/ssoProvidersRepo.ts';
import * as realTasksRepo from '../../repositories/tasksRepo.ts';
import * as realUserAssignmentsRepo from '../../repositories/userAssignmentsRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realExternalAuth from '../../services/external-auth.ts';
import realLdapService from '../../services/ldap.ts';
import * as realAudit from '../../utils/audit.ts';
import * as realPermissions from '../../utils/permissions.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';
import { makeDbError } from '../helpers/dbErrors.ts';
import { signToken } from '../helpers/jwt.ts';
import { TX_SENTINEL } from '../helpers/txSentinel.ts';
import { makeWithDbTransactionMock } from '../helpers/withDbTransactionMock.ts';

const usersRepoSnap = { ...realUsersRepo };
const clientsRepoSnap = { ...realClientsRepo };
const externalIdentitiesRepoSnap = { ...realExternalIdentitiesRepo };
const generalSettingsRepoSnap = { ...realGeneralSettingsRepo };
const projectsRepoSnap = { ...realProjectsRepo };
const tasksRepoSnap = { ...realTasksRepo };
const rolesRepoSnap = { ...realRolesRepo };
const settingsRepoSnap = { ...realSettingsRepo };
const ssoProvidersRepoSnap = { ...realSsoProvidersRepo };
const userAssignmentsRepoSnap = { ...realUserAssignmentsRepo };
const externalAuthSnap = { ...realExternalAuth };
const ldapServiceSnap = realLdapService;
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
const updateAuthMethodMock = mock();
const addUserRoleMock = mock();
const replaceUserRolesMock = mock();
const setPrimaryRoleMock = mock();
const getUserRoleIdsMock = mock();
const canManageUserMock = mock();
const getAssignmentsMock = mock();
const disableTotpMock = mock();
const revokeUserCredentialsMock = mock();
const getTotpStateMock = mock();
const generalSettingsGetMock = mock<() => Promise<{ enforceTotpForAdmins: boolean } | null>>(
  async () => null,
);

// tracker catalog repos
const listClientsMock = mock();
const listClientsByIdsMock = mock();
const listProjectsForUserMock = mock();
const listProjectsByIdsMock = mock();
const listTasksForUserMock = mock();

// rolesRepo
const rolesFindByIdMock = mock();
const rolesFindExistingIdsMock = mock();

// ssoProvidersRepo
const ssoFindByIdMock = mock();

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

// LDAP / external-auth
const ldapLookupUserGroupsMock = mock();
const applyExternalRolesForUserIfMatchedMock = mock();
const externalGroupsYieldNoKnownRoleMock = mock();

// externalIdentitiesRepo
const deleteAllForUserMock = mock();

// audit / drizzle
const logAuditMock = mock(async () => undefined);
const { withDbTransactionMock, resetWithDbTransactionMock } = makeWithDbTransactionMock();

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
    updateAuthMethod: updateAuthMethodMock,
    addUserRole: addUserRoleMock,
    replaceUserRoles: replaceUserRolesMock,
    setPrimaryRole: setPrimaryRoleMock,
    getUserRoleIds: getUserRoleIdsMock,
    canManageUser: canManageUserMock,
    getAssignments: getAssignmentsMock,
    disableTotp: disableTotpMock,
    revokeUserCredentials: revokeUserCredentialsMock,
    getTotpState: getTotpStateMock,
  }));
  mock.module('../../repositories/clientsRepo.ts', () => ({
    ...clientsRepoSnap,
    list: listClientsMock,
    listByIds: listClientsByIdsMock,
  }));
  mock.module('../../repositories/externalIdentitiesRepo.ts', () => ({
    ...externalIdentitiesRepoSnap,
    deleteAllForUser: deleteAllForUserMock,
  }));
  mock.module('../../repositories/projectsRepo.ts', () => ({
    ...projectsRepoSnap,
    listForUser: listProjectsForUserMock,
    listByIds: listProjectsByIdsMock,
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
  mock.module('../../repositories/generalSettingsRepo.ts', () => ({
    ...generalSettingsRepoSnap,
    get: generalSettingsGetMock,
  }));
  mock.module('../../repositories/settingsRepo.ts', () => ({
    ...settingsRepoSnap,
    upsertForUser: settingsUpsertForUserMock,
  }));
  mock.module('../../repositories/ssoProvidersRepo.ts', () => ({
    ...ssoProvidersRepoSnap,
    findById: ssoFindByIdMock,
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
  mock.module('../../services/external-auth.ts', () => ({
    ...externalAuthSnap,
    applyExternalRolesForUserIfMatched: applyExternalRolesForUserIfMatchedMock,
    externalGroupsYieldNoKnownRole: externalGroupsYieldNoKnownRoleMock,
  }));
  mock.module('../../services/ldap.ts', () => ({
    default: {
      lookupUserGroups: ldapLookupUserGroupsMock,
    },
  }));

  routePlugin = (await import('../../routes/users.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/clientsRepo.ts', () => clientsRepoSnap);
  mock.module('../../repositories/externalIdentitiesRepo.ts', () => externalIdentitiesRepoSnap);
  mock.module('../../repositories/projectsRepo.ts', () => projectsRepoSnap);
  mock.module('../../repositories/tasksRepo.ts', () => tasksRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../repositories/generalSettingsRepo.ts', () => generalSettingsRepoSnap);
  mock.module('../../repositories/settingsRepo.ts', () => settingsRepoSnap);
  mock.module('../../repositories/ssoProvidersRepo.ts', () => ssoProvidersRepoSnap);
  mock.module('../../repositories/userAssignmentsRepo.ts', () => userAssignmentsRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
  mock.module('../../db/drizzle.ts', () => drizzleSnap);
  mock.module('../../services/external-auth.ts', () => externalAuthSnap);
  mock.module('../../services/ldap.ts', () => ({ default: ldapServiceSnap }));
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

const REGULAR_USER = {
  id: 'u-user',
  name: 'Ursula User',
  username: 'user',
  role: 'user',
  avatarInitials: 'UU',
  isDisabled: false,
  sessionVersion: 1,
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
  'hr.costs_all.view',
  'hr.costs_all.update',
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
  phone: '+39 02 1234',
  jobTitle: 'Consultant',
  department: 'Delivery',
  employeeCode: 'EMP-001',
  hireDate: '2024-01-15',
  terminationDate: null,
  contractType: 'permanent' as const,
  employmentStatus: 'active' as const,
  workLocation: 'hybrid' as const,
  emergencyContactName: 'Maria',
  emergencyContactPhone: '+39 02 5678',
  notes: 'Prefers morning shifts',
  authMethod: 'local' as const,
  authProviderId: null,
  authProviderName: null,
  hasTopManagerRole: false,
  isAdminOnly: false,
};

const SAMPLE_USER_CORE = {
  id: 'u-target',
  name: 'Target',
  username: 'target',
  role: 'user',
  employeeType: 'app_user' as const,
  hireDate: '2024-01-15',
  terminationDate: null,
  authMethod: 'local' as const,
  authProviderId: null,
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
  updateAuthMethodMock,
  addUserRoleMock,
  replaceUserRolesMock,
  setPrimaryRoleMock,
  getUserRoleIdsMock,
  canManageUserMock,
  getAssignmentsMock,
  disableTotpMock,
  revokeUserCredentialsMock,
  getTotpStateMock,
  generalSettingsGetMock,
  listClientsMock,
  listClientsByIdsMock,
  listProjectsForUserMock,
  listProjectsByIdsMock,
  listTasksForUserMock,
  rolesFindByIdMock,
  rolesFindExistingIdsMock,
  ssoFindByIdMock,
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
  ldapLookupUserGroupsMock,
  applyExternalRolesForUserIfMatchedMock,
  externalGroupsYieldNoKnownRoleMock,
  deleteAllForUserMock,
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
  resetWithDbTransactionMock();
  logAuditMock.mockImplementation(async () => undefined);
  getTotpStateMock.mockResolvedValue(null);
  generalSettingsGetMock.mockResolvedValue(null);
  filterAssignedClientIdsMock.mockResolvedValue(new Set(['c1']));
  filterAssignedProjectIdsMock.mockResolvedValue(new Set(['p1']));
  filterAssignedTaskIdsMock.mockResolvedValue(new Set(['t1']));
  listClientsMock.mockResolvedValue([]);
  listClientsByIdsMock.mockResolvedValue(new Map());
  listProjectsForUserMock.mockResolvedValue([]);
  listProjectsByIdsMock.mockResolvedValue(new Map());
  listTasksForUserMock.mockResolvedValue([]);

  // Default: LDAP unreachable / disabled — route falls back to existing role.
  ldapLookupUserGroupsMock.mockResolvedValue(null);
  applyExternalRolesForUserIfMatchedMock.mockResolvedValue({ applied: false, roleIds: [] });
  // Default: bind groups yield a known role (no warn). Tests exercising the no-match
  // diagnostic override with mockResolvedValue(true).
  externalGroupsYieldNoKnownRoleMock.mockResolvedValue(false);
  deleteAllForUserMock.mockResolvedValue(0);

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
      'hr.costs_all.view',
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

  test('200 RIL viewer can list scoped users for the RIL user picker', async () => {
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue(['timesheets.ril.view']);
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
        canViewInternal: false,
        canViewExternal: false,
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

  test('200 HR internal view reveals matching HR fields and email', async () => {
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue(['hr.internal.view']);
    listScopedForManagerMock.mockResolvedValue([SAMPLE_USER_ROW]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/users',
      headers: managerAuth(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body[0]).toEqual(
      expect.objectContaining({
        email: 'target@example.com',
        phone: '+39 02 1234',
        employeeCode: 'EMP-001',
        employmentStatus: 'active',
      }),
    );
  });

  test('200 non-HR viewer omits HR detail fields', async () => {
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
    expect(body[0]).not.toHaveProperty('phone');
    expect(body[0]).not.toHaveProperty('employeeCode');
    expect(body[0]).not.toHaveProperty('employmentStatus');
  });

  test('200 with ONLY hr.costs.view → caller sees own cost, other rows masked to 0', async () => {
    // Personal-scope hr.costs.view is the read-only counterpart of
    // hr.costs.update: it grants visibility of the caller's *own* costPerHour
    // without exposing other users' costs (those still require hr.costs_all.view).
    findAuthUserByIdMock.mockResolvedValue(REGULAR_USER);
    getRolePermissionsMock.mockResolvedValue(['timesheets.tracker.view', 'hr.costs.view']);
    listScopedForManagerMock.mockResolvedValue([
      { ...SAMPLE_USER_ROW, id: REGULAR_USER.id, costPerHour: 42 },
      { ...SAMPLE_USER_ROW, id: 'u-other', costPerHour: 999 },
    ]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/users',
      headers: userAuth(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Array<{ id: string; costPerHour: number }>;
    const ownRow = body.find((row) => row.id === REGULAR_USER.id);
    const otherRow = body.find((row) => row.id === 'u-other');
    expect(ownRow?.costPerHour).toBe(42);
    expect(otherRow?.costPerHour).toBe(0);
  });

  test('200 with ONLY hr.costs_all.view → caller sees OTHER rows, own row masked to 0', async () => {
    // Symmetric regression for the explicit-split semantics: hr.costs_all.view
    // is strictly cross-user and intentionally does NOT cover the caller's own
    // cost. To see every cost (including own), a role must hold BOTH
    // hr.costs.view + hr.costs_all.view (which is exactly what manager and
    // top_manager defaults seed via migration 0055).
    findAuthUserByIdMock.mockResolvedValue(REGULAR_USER);
    getRolePermissionsMock.mockResolvedValue(['timesheets.tracker.view', 'hr.costs_all.view']);
    listScopedForManagerMock.mockResolvedValue([
      { ...SAMPLE_USER_ROW, id: REGULAR_USER.id, costPerHour: 42 },
      { ...SAMPLE_USER_ROW, id: 'u-other', costPerHour: 999 },
    ]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/users',
      headers: userAuth(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Array<{ id: string; costPerHour: number }>;
    const ownRow = body.find((row) => row.id === REGULAR_USER.id);
    const otherRow = body.find((row) => row.id === 'u-other');
    expect(ownRow?.costPerHour).toBe(0);
    expect(otherRow?.costPerHour).toBe(999);
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

  test('201 creates internal employee with HR profile fields', async () => {
    getRolePermissionsMock.mockResolvedValue([
      'hr.internal.create',
      'hr.internal.update',
      'hr.internal.view',
      'hr.costs_all.view',
      'hr.costs_all.update',
    ]);
    insertUserMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users',
      headers: adminAuth(),
      payload: {
        name: 'Internal Bob',
        employeeType: 'internal',
        email: 'bob@example.com',
        phone: '+39 02 1234',
        jobTitle: 'Consultant',
        department: 'Delivery',
        employeeCode: 'EMP-123',
        hireDate: '2024-01-15',
        contractType: 'permanent',
        employmentStatus: 'onboarding',
        workLocation: 'hybrid',
        emergencyContactName: 'Maria',
        emergencyContactPhone: '+39 02 5678',
        notes: 'Starts next week',
        costPerHour: 70,
      },
    });

    expect(res.statusCode).toBe(201);
    const [insertedRow] = insertUserMock.mock.calls[0] as [Record<string, unknown>];
    expect(insertedRow).toEqual(
      expect.objectContaining({
        employeeType: 'internal',
        phone: '+39 02 1234',
        jobTitle: 'Consultant',
        department: 'Delivery',
        employeeCode: 'EMP-123',
        hireDate: '2024-01-15',
        contractType: 'permanent',
        employmentStatus: 'onboarding',
        workLocation: 'hybrid',
        costPerHour: 70,
      }),
    );
    expect(JSON.parse(res.body)).toEqual(
      expect.objectContaining({
        email: 'bob@example.com',
        employeeCode: 'EMP-123',
        employmentStatus: 'onboarding',
      }),
    );
  });

  test('400 maps duplicate employee code on create', async () => {
    getRolePermissionsMock.mockResolvedValue(['hr.internal.create', 'hr.internal.update']);
    insertUserMock.mockRejectedValue(makeDbError('23505', 'idx_users_employee_code_unique'));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users',
      headers: adminAuth(),
      payload: { name: 'Internal Bob', employeeType: 'internal', employeeCode: 'EMP-123' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Employee code already exists');
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

  test('400 invalid HR enum', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users',
      headers: adminAuth(),
      payload: { name: 'X', employeeType: 'internal', contractType: 'invalid' },
    });

    expect(res.statusCode).toBe(400);
  });

  test('400 invalid HR date range', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users',
      headers: adminAuth(),
      payload: {
        name: 'X',
        employeeType: 'internal',
        hireDate: '2024-02-01',
        terminationDate: '2024-01-01',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('hireDate must be on or before terminationDate');
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

  test('400 rejects negative costPerHour even when caller lacks hr.costs_all.update', async () => {
    // Validation must run before the permission gate so malformed input still
    // surfaces 400, matching the pre-split contract. The permission gate
    // controls whether the validated value is *applied*, not whether the input
    // is *validated*.
    getRolePermissionsMock.mockResolvedValue([
      'hr.internal.create',
      'administration.user_management.view',
    ]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users',
      headers: adminAuth(),
      payload: { name: 'X', employeeType: 'internal', costPerHour: -1 },
    });

    expect(res.statusCode).toBe(400);
    expect(insertUserMock).not.toHaveBeenCalled();
  });

  test('201 ignores costPerHour from caller without hr.costs_all.update', async () => {
    // Without the cost-update permission, the row is created with 0 even when
    // the caller sent a positive number — silent-drop matches the PUT contract.
    getRolePermissionsMock.mockResolvedValue([
      'hr.internal.create',
      'administration.user_management.view',
    ]);
    insertUserMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users',
      headers: adminAuth(),
      payload: { name: 'X', employeeType: 'internal', costPerHour: 99 },
    });

    expect(res.statusCode).toBe(201);
    const [insertedRow] = insertUserMock.mock.calls[0] as [Record<string, unknown>];
    expect(insertedRow.costPerHour).toBe(0);
    // Response must also report 0 so the client cache matches the DB row —
    // returning the caller's input would silently advertise a value we didn't
    // persist.
    expect(JSON.parse(res.body).costPerHour).toBe(0);
  });
});

// =========================================================================
// DELETE /api/users/:id
// =========================================================================

describe('DELETE /api/users/:id', () => {
  test('204 admin deletes app_user', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    deleteByIdMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/users/u-target',
      headers: adminAuth(),
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
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

  test('403 without delete permission for target type (audits the denial)', async () => {
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
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.delete.denied',
        entityType: 'user',
        entityId: 'u-target',
      }),
    );
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
      TX_SENTINEL,
    );
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.updated' }));
  });

  test('200 HR internal update edits app-user profile fields and email without manager scope', async () => {
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue(['hr.internal.update', 'hr.internal.view']);
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    canManageUserMock.mockResolvedValue(false);
    updateUserDynamicMock.mockResolvedValue({
      ...SAMPLE_USER_CORE,
      phone: '+39 02 1234',
      jobTitle: 'Consultant',
      department: 'Delivery',
      employeeCode: 'EMP-123',
      hireDate: '2024-01-15',
      contractType: 'permanent',
      employmentStatus: 'active',
      workLocation: 'hybrid',
      avatarInitials: 'T',
      costPerHour: 50,
      isDisabled: false,
    });
    findByIdMock.mockResolvedValue({
      ...SAMPLE_USER_ROW,
      email: 'target.hr@example.com',
      phone: '+39 02 1234',
      employeeCode: 'EMP-123',
      employmentStatus: 'active',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: managerAuth(),
      payload: {
        email: 'target.hr@example.com',
        phone: '+39 02 1234',
        jobTitle: 'Consultant',
        department: 'Delivery',
        employeeCode: 'EMP-123',
        hireDate: '2024-01-15',
        contractType: 'permanent',
        employmentStatus: 'active',
        workLocation: 'hybrid',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(canManageUserMock).not.toHaveBeenCalled();
    expect(updateUserDynamicMock).toHaveBeenCalledWith(
      'u-target',
      expect.objectContaining({
        phone: '+39 02 1234',
        jobTitle: 'Consultant',
        department: 'Delivery',
        employeeCode: 'EMP-123',
        hireDate: '2024-01-15',
        contractType: 'permanent',
        employmentStatus: 'active',
        workLocation: 'hybrid',
      }),
      TX_SENTINEL,
    );
    expect(settingsUpsertForUserMock).toHaveBeenCalledWith(
      'u-target',
      expect.objectContaining({ email: 'target.hr@example.com' }),
      TX_SENTINEL,
    );
    expect(JSON.parse(res.body)).toEqual(
      expect.objectContaining({ email: 'target.hr@example.com', employeeCode: 'EMP-123' }),
    );
  });

  test('403 standard user-management update cannot edit HR details without HR update permission', async () => {
    getRolePermissionsMock.mockResolvedValue([
      'administration.user_management.view',
      'administration.user_management.update',
      'administration.user_management_all.view',
    ]);
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: adminAuth(),
      payload: { phone: '+39 02 9999' },
    });

    expect(res.statusCode).toBe(403);
    expect(updateUserDynamicMock).not.toHaveBeenCalled();
    expect(settingsUpsertForUserMock).not.toHaveBeenCalled();
  });

  test('409 rejects manual name or email changes for external-auth users', async () => {
    findCoreByIdMock.mockResolvedValue({
      ...SAMPLE_USER_CORE,
      authMethod: 'oidc',
      authProviderId: 'sso-1',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: adminAuth(),
      payload: { email: 'manual@example.com' },
    });

    expect(res.statusCode).toBe(409);
    expect(updateUserDynamicMock).not.toHaveBeenCalled();
    expect(settingsUpsertForUserMock).not.toHaveBeenCalled();
  });

  test('409 rejects manual first/last name changes for external-auth users', async () => {
    findCoreByIdMock.mockResolvedValue({
      ...SAMPLE_USER_CORE,
      authMethod: 'ldap',
      authProviderId: null,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: adminAuth(),
      payload: { firstName: 'Manual' },
    });

    expect(res.statusCode).toBe(409);
    expect(updateUserDynamicMock).not.toHaveBeenCalled();
    expect(settingsUpsertForUserMock).not.toHaveBeenCalled();
  });

  test('200 external-auth user account update succeeds when synced identity is omitted', async () => {
    findCoreByIdMock.mockResolvedValue({
      ...SAMPLE_USER_CORE,
      authMethod: 'ldap',
    });
    updateUserDynamicMock.mockResolvedValue({
      ...SAMPLE_USER_CORE,
      authMethod: 'ldap',
      avatarInitials: 'T',
      costPerHour: 50,
      isDisabled: true,
    });
    findByIdMock.mockResolvedValue({
      ...SAMPLE_USER_ROW,
      authMethod: 'ldap',
      isDisabled: true,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: adminAuth(),
      payload: { isDisabled: true },
    });

    expect(res.statusCode).toBe(200);
    expect(updateUserDynamicMock).toHaveBeenCalledWith(
      'u-target',
      expect.objectContaining({ isDisabled: true }),
      TX_SENTINEL,
    );
    const [, fields] = updateUserDynamicMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
      unknown,
    ];
    expect(fields).not.toHaveProperty('name');
    expect(settingsUpsertForUserMock).not.toHaveBeenCalled();
  });

  test('400 rejects invalid HR update enum and date range', async () => {
    let res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: adminAuth(),
      payload: { employmentStatus: 'invalid' },
    });
    expect(res.statusCode).toBe(400);

    res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: adminAuth(),
      payload: { hireDate: '2024-02-01', terminationDate: '2024-01-01' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 rejects HR date patches that conflict with the stored range', async () => {
    findCoreByIdMock.mockResolvedValue({
      ...SAMPLE_USER_CORE,
      hireDate: '2024-01-15',
      terminationDate: '2024-02-15',
    });

    let res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: adminAuth(),
      payload: { hireDate: '2024-03-01' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('hireDate must be on or before terminationDate');

    res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: adminAuth(),
      payload: { terminationDate: '2024-01-01' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('hireDate must be on or before terminationDate');
    expect(updateUserDynamicMock).not.toHaveBeenCalled();
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
    expect(replaceUserRolesMock).toHaveBeenCalledWith('u-target', ['manager'], TX_SENTINEL);
    expect(syncTopManagerAssignmentsForUserMock).toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.role_changed' }),
    );
  });

  test('200 promoting to an admin role via PUT /:id revokes sessions when 2FA is enforced', async () => {
    // The legacy single-role update path must also revoke a newly-admin user's sessions under
    // enforcement — otherwise their pre-existing token keeps admin access without enrolling.
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    rolesFindByIdMock.mockResolvedValue({
      id: 'admin',
      name: 'Admin',
      isSystem: true,
      isAdmin: true,
    });
    updateUserDynamicMock.mockResolvedValue({ ...SAMPLE_USER_CORE, role: 'admin' });
    findByIdMock.mockResolvedValue({ ...SAMPLE_USER_ROW, role: 'admin' });
    generalSettingsGetMock.mockResolvedValue({ enforceTotpForAdmins: true });
    getTotpStateMock.mockResolvedValue({
      totpSecret: null,
      totpEnabled: false,
      totpConfirmedAt: null,
      totpBackupCodes: null,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: adminAuth(),
      payload: { role: 'admin' },
    });

    expect(res.statusCode).toBe(200);
    expect(replaceUserRolesMock).toHaveBeenCalledWith('u-target', ['admin'], TX_SENTINEL);
    expect(revokeUserCredentialsMock).toHaveBeenCalledWith('u-target');
  });

  test('403 cannot change own role (audits the denial)', async () => {
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
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.update.denied',
        entityType: 'user',
        entityId: ADMIN_USER.id,
        details: expect.objectContaining({ secondaryLabel: 'self_role_change_forbidden' }),
      }),
    );
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
    // Even with only an email change, settings upsert must run inside the same
    // withDbTransaction wrapper so users.email and settings.email stay consistent.
    expect(settingsUpsertForUserMock).toHaveBeenCalledWith(
      'u-target',
      expect.objectContaining({ email: 'new@x.com' }),
      TX_SENTINEL,
    );
    // No dynamic field update needed → updateUserDynamic not called
    expect(updateUserDynamicMock).not.toHaveBeenCalled();
  });

  test('200 blank email explicitly clears the settings-backed email', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    findByIdMock.mockResolvedValue({ ...SAMPLE_USER_ROW, email: '' });
    settingsUpsertForUserMock.mockResolvedValue({});

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: adminAuth(),
      payload: { email: '' },
    });

    expect(res.statusCode).toBe(200);
    expect(settingsUpsertForUserMock).toHaveBeenCalledWith(
      'u-target',
      expect.objectContaining({ email: '' }),
      TX_SENTINEL,
    );
    expect(updateUserDynamicMock).not.toHaveBeenCalled();
  });

  test('200 name + email change: settings upsert runs inside the user-update transaction', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    updateUserDynamicMock.mockResolvedValue({
      ...SAMPLE_USER_CORE,
      name: 'Renamed',
      avatarInitials: 'R',
      costPerHour: 50,
      isDisabled: false,
    });
    findByIdMock.mockResolvedValue({
      ...SAMPLE_USER_ROW,
      name: 'Renamed',
      email: 'new@x.com',
    });
    settingsUpsertForUserMock.mockResolvedValue({});

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: adminAuth(),
      payload: { name: 'Renamed', email: 'new@x.com' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateUserDynamicMock).toHaveBeenCalledWith(
      'u-target',
      expect.objectContaining({ name: 'Renamed' }),
      TX_SENTINEL,
    );
    expect(settingsUpsertForUserMock).toHaveBeenCalledWith(
      'u-target',
      expect.objectContaining({ fullName: 'Renamed', email: 'new@x.com' }),
      TX_SENTINEL,
    );
  });

  test('settings upsert failure rolls back the user update (regression for #615)', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    updateUserDynamicMock.mockResolvedValue({
      ...SAMPLE_USER_CORE,
      name: 'Renamed',
      avatarInitials: 'R',
      costPerHour: 50,
      isDisabled: false,
    });
    settingsUpsertForUserMock.mockRejectedValue(new Error('settings upsert failed'));

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: adminAuth(),
      payload: { name: 'Renamed', email: 'new@x.com' },
    });

    expect(res.statusCode).not.toBe(200);
    // The load-bearing assertion: when the upsert fails, it must have been called with the
    // transaction handle (TX_SENTINEL). On the pre-fix code the upsert ran outside the tx
    // with no executor, so the user update would have already committed — this assertion
    // would fail on that buggy code path.
    expect(settingsUpsertForUserMock).toHaveBeenCalledWith(
      'u-target',
      expect.anything(),
      TX_SENTINEL,
    );
    expect(findByIdMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
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

  test('200 self edit with only hr.costs.update applies costPerHour', async () => {
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue([
      'administration.user_management.update',
      'administration.user_management_all.view',
      'hr.costs.update',
    ]);
    findCoreByIdMock.mockResolvedValue({ ...SAMPLE_USER_CORE, id: MANAGER_USER.id });
    updateUserDynamicMock.mockResolvedValue({
      ...SAMPLE_USER_CORE,
      id: MANAGER_USER.id,
      avatarInitials: 'MM',
      costPerHour: 99,
      isDisabled: false,
    });
    findByIdMock.mockResolvedValue({ ...SAMPLE_USER_ROW, id: MANAGER_USER.id, costPerHour: 99 });

    const res = await testApp.inject({
      method: 'PUT',
      url: `/api/users/${MANAGER_USER.id}`,
      headers: managerAuth(),
      payload: { costPerHour: 99 },
    });

    expect(res.statusCode).toBe(200);
    expect(updateUserDynamicMock).toHaveBeenCalledWith(
      MANAGER_USER.id,
      expect.objectContaining({ costPerHour: 99 }),
      TX_SENTINEL,
    );
  });

  test('200 self edit with ONLY hr.costs.update (no user_management/hr update) applies costPerHour', async () => {
    // Regression for the personal-cost permission being unreachable: a role
    // granted just hr.costs.update must be able to self-edit costPerHour even
    // without administration.user_management.update / hr.internal.update /
    // hr.external.update. The route guard's requireAnyPermission accepts
    // hr.costs.update, and the per-employee-type check inside the handler is
    // bypassed for self-only-cost edits.
    const userAuthForSelf = () => ({
      authorization: `Bearer ${signToken({ userId: REGULAR_USER.id })}`,
    });
    findAuthUserByIdMock.mockResolvedValue(REGULAR_USER);
    getRolePermissionsMock.mockResolvedValue(['hr.costs.update']);
    findCoreByIdMock.mockResolvedValue({ ...SAMPLE_USER_CORE, id: REGULAR_USER.id });
    updateUserDynamicMock.mockResolvedValue({
      ...SAMPLE_USER_CORE,
      id: REGULAR_USER.id,
      avatarInitials: 'UU',
      costPerHour: 33,
      isDisabled: false,
    });
    findByIdMock.mockResolvedValue({ ...SAMPLE_USER_ROW, id: REGULAR_USER.id, costPerHour: 33 });

    const res = await testApp.inject({
      method: 'PUT',
      url: `/api/users/${REGULAR_USER.id}`,
      headers: userAuthForSelf(),
      payload: { costPerHour: 33 },
    });

    expect(res.statusCode).toBe(200);
    expect(updateUserDynamicMock).toHaveBeenCalledWith(
      REGULAR_USER.id,
      expect.objectContaining({ costPerHour: 33 }),
      TX_SENTINEL,
    );
  });

  test('403 self edit with ONLY hr.costs.update but body includes name (cost-only bypass does not apply)', async () => {
    // The self-cost-only bypass is gated on costPerHour being the SOLE field
    // being touched. As soon as the body adds another field (here: name) the
    // bypass is off and the request falls back to the standard
    // UPDATE_PERM_BY_EMPLOYEE_TYPE check — which rejects this caller.
    findAuthUserByIdMock.mockResolvedValue(REGULAR_USER);
    getRolePermissionsMock.mockResolvedValue(['hr.costs.update']);
    findCoreByIdMock.mockResolvedValue({ ...SAMPLE_USER_CORE, id: REGULAR_USER.id });

    const res = await testApp.inject({
      method: 'PUT',
      url: `/api/users/${REGULAR_USER.id}`,
      headers: { authorization: `Bearer ${signToken({ userId: REGULAR_USER.id })}` },
      payload: { costPerHour: 33, name: 'Renamed' },
    });

    expect(res.statusCode).toBe(403);
    expect(updateUserDynamicMock).not.toHaveBeenCalled();
  });

  test('403 other-user edit with ONLY hr.costs.update is rejected (personal grant is self-only)', async () => {
    // Personal hr.costs.update only authorizes self-edits. With another user as
    // the target, the cost-only bypass requires hr.costs_all.update, which
    // this caller doesn't have — so the per-employee-type check trips.
    findAuthUserByIdMock.mockResolvedValue(REGULAR_USER);
    getRolePermissionsMock.mockResolvedValue(['hr.costs.update']);
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE); // u-target ≠ u-user

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: { authorization: `Bearer ${signToken({ userId: REGULAR_USER.id })}` },
      payload: { costPerHour: 33 },
    });

    expect(res.statusCode).toBe(403);
    expect(updateUserDynamicMock).not.toHaveBeenCalled();
  });

  test('400 self edit with ONLY hr.costs_all.update silently drops costPerHour', async () => {
    // Symmetric regression for the explicit-split semantics on the update side:
    // hr.costs_all.update is strictly cross-user and intentionally does NOT
    // cover the caller's own cost. With cost as the sole field and only the
    // all-scope grant, the route silently strips costPerHour (matching the
    // existing 'no cost permission' behavior) and returns 400 'No fields to
    // update'. To self-edit, the caller would need hr.costs.update.
    findAuthUserByIdMock.mockResolvedValue(REGULAR_USER);
    getRolePermissionsMock.mockResolvedValue([
      'administration.user_management.update',
      'administration.user_management_all.view',
      'hr.costs_all.update',
    ]);
    findCoreByIdMock.mockResolvedValue({ ...SAMPLE_USER_CORE, id: REGULAR_USER.id });

    const res = await testApp.inject({
      method: 'PUT',
      url: `/api/users/${REGULAR_USER.id}`,
      headers: { authorization: `Bearer ${signToken({ userId: REGULAR_USER.id })}` },
      payload: { costPerHour: 33 },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('No fields to update');
    expect(updateUserDynamicMock).not.toHaveBeenCalled();
  });

  test('200 other-user edit with ONLY hr.costs_all.update applies costPerHour (app_user target)', async () => {
    // Regression for the symmetric Codex finding on hr.costs_all.update: a role
    // granted just the all-scope cost-edit permission must be able to reach
    // this route and edit ANY user's costPerHour. The route guard accepts
    // hr.costs_all.update, the per-employee-type check is bypassed for
    // cost-only edits, and the canManageUser check is also bypassed (the
    // all-scope grant is cross-user by design — gating it through
    // canManageUser would only work for internal/external employees and would
    // break for app_user targets, making the permission half-useful).
    findAuthUserByIdMock.mockResolvedValue(REGULAR_USER);
    getRolePermissionsMock.mockResolvedValue(['hr.costs_all.update']);
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE); // u-target, employeeType=app_user
    updateUserDynamicMock.mockResolvedValue({
      ...SAMPLE_USER_CORE,
      avatarInitials: 'T',
      costPerHour: 77,
      isDisabled: false,
    });
    findByIdMock.mockResolvedValue({ ...SAMPLE_USER_ROW, costPerHour: 77 });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: { authorization: `Bearer ${signToken({ userId: REGULAR_USER.id })}` },
      payload: { costPerHour: 77 },
    });

    expect(res.statusCode).toBe(200);
    expect(updateUserDynamicMock).toHaveBeenCalledWith(
      'u-target',
      expect.objectContaining({ costPerHour: 77 }),
      TX_SENTINEL,
    );
    // canManageUser must NOT have been consulted — the cost-only bypass skips it.
    expect(canManageUserMock).not.toHaveBeenCalled();
  });

  test('403 other-user edit with ONLY hr.costs_all.update but body includes name (cost-only bypass does not apply)', async () => {
    // As soon as a non-cost field appears in the body, the bypass is off and
    // the request falls back to the standard UPDATE_PERM_BY_EMPLOYEE_TYPE
    // check. With only hr.costs_all.update granted, that check rejects.
    findAuthUserByIdMock.mockResolvedValue(REGULAR_USER);
    getRolePermissionsMock.mockResolvedValue(['hr.costs_all.update']);
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: { authorization: `Bearer ${signToken({ userId: REGULAR_USER.id })}` },
      payload: { costPerHour: 77, name: 'Renamed' },
    });

    expect(res.statusCode).toBe(403);
    expect(updateUserDynamicMock).not.toHaveBeenCalled();
  });

  test('400 self edit without any cost permission silently drops costPerHour', async () => {
    // Caller has no hr.costs.* grant. costPerHour is silently stripped from the
    // payload, which leaves no remaining fields to update, so the route returns
    // 400 "No fields to update". This locks in the silent-drop contract so a
    // future refactor cannot accidentally write costPerHour=0 over the real value.
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue([
      'administration.user_management.update',
      'administration.user_management_all.view',
    ]);
    findCoreByIdMock.mockResolvedValue({ ...SAMPLE_USER_CORE, id: MANAGER_USER.id });

    const res = await testApp.inject({
      method: 'PUT',
      url: `/api/users/${MANAGER_USER.id}`,
      headers: managerAuth(),
      payload: { costPerHour: 99 },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('No fields to update');
    expect(updateUserDynamicMock).not.toHaveBeenCalled();
  });

  test('other-user edit with only hr.costs.update does NOT apply costPerHour', async () => {
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue([
      'administration.user_management.update',
      'administration.user_management_all.view',
      'hr.costs.update',
    ]);
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE); // u-target ≠ manager
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
      headers: managerAuth(),
      payload: { name: 'Renamed', costPerHour: 999 },
    });

    expect(res.statusCode).toBe(200);
    // Name is applied, cost is silently dropped because manager lacks hr.costs_all.update.
    const [, fields] = updateUserDynamicMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(fields.name).toBe('Renamed');
    expect(fields).not.toHaveProperty('costPerHour');
  });

  test('other-user edit with hr.costs_all.update applies costPerHour', async () => {
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue([
      'administration.user_management.update',
      'administration.user_management_all.view',
      'hr.costs_all.update',
    ]);
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    updateUserDynamicMock.mockResolvedValue({
      ...SAMPLE_USER_CORE,
      avatarInitials: 'T',
      costPerHour: 75,
      isDisabled: false,
    });
    findByIdMock.mockResolvedValue({ ...SAMPLE_USER_ROW, costPerHour: 75 });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: managerAuth(),
      payload: { costPerHour: 75 },
    });

    expect(res.statusCode).toBe(200);
    expect(updateUserDynamicMock).toHaveBeenCalledWith(
      'u-target',
      expect.objectContaining({ costPerHour: 75 }),
      TX_SENTINEL,
    );
  });

  test('audit changedFields includes costPerHour when written via hr.costs_all.update only', async () => {
    // Regression: the audit-log gate must mirror the write-side gate. A caller
    // holding only the all-scope permission (no personal) successfully writes
    // costPerHour and the audit row must reflect that — otherwise cross-user
    // cost edits would be invisible in the audit trail.
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue([
      'administration.user_management.update',
      'administration.user_management_all.view',
      'hr.costs_all.update',
      // Note: no hr.costs.update — the personal grant is intentionally absent.
    ]);
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    updateUserDynamicMock.mockResolvedValue({
      ...SAMPLE_USER_CORE,
      avatarInitials: 'T',
      costPerHour: 42,
      isDisabled: false,
    });
    findByIdMock.mockResolvedValue({ ...SAMPLE_USER_ROW, costPerHour: 42 });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target',
      headers: managerAuth(),
      payload: { costPerHour: 42 },
    });

    expect(res.statusCode).toBe(200);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.updated',
        details: expect.objectContaining({
          changedFields: expect.arrayContaining(['costPerHour']),
        }),
      }),
    );
  });

  test('audit changedFields omits costPerHour when caller has no cost permission', async () => {
    // Regression: the audit row must not falsely advertise a cost change when
    // the route silently dropped the field for lack of permission.
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue([
      'administration.user_management.update',
      'administration.user_management_all.view',
    ]);
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
      headers: managerAuth(),
      payload: { name: 'Renamed', costPerHour: 999 },
    });

    expect(res.statusCode).toBe(200);
    type AuditArg = { action: string; details: { changedFields: string[] } };
    const auditCall = (logAuditMock.mock.calls as unknown as Array<[AuditArg]>).find(
      ([arg]) => arg.action === 'user.updated',
    );
    expect(auditCall?.[0].details.changedFields).toEqual(['name']);
  });

  test('200 self edit response with ONLY hr.costs.view → response includes own costPerHour unmasked', async () => {
    // Regression for the personal-scope view permission: PUT /:id's response
    // mask honors hr.costs.view for the caller's own row even when the broader
    // hr.costs_all.view is absent. Combined with administration.user_management.update
    // so the route guard + per-employee-type check both pass, allowing the
    // (no-op) PUT to reach the response-masking branch.
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue([
      'administration.user_management.update',
      'administration.user_management_all.view',
      'hr.costs.view',
    ]);
    findCoreByIdMock.mockResolvedValue({ ...SAMPLE_USER_CORE, id: MANAGER_USER.id });
    updateUserDynamicMock.mockResolvedValue({
      ...SAMPLE_USER_CORE,
      id: MANAGER_USER.id,
      name: 'Mary Manager Renamed',
      avatarInitials: 'MM',
      costPerHour: 88,
      isDisabled: false,
    });
    findByIdMock.mockResolvedValue({
      ...SAMPLE_USER_ROW,
      id: MANAGER_USER.id,
      name: 'Mary Manager Renamed',
      costPerHour: 88,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: `/api/users/${MANAGER_USER.id}`,
      headers: managerAuth(),
      payload: { name: 'Mary Manager Renamed' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.costPerHour).toBe(88);
  });

  test('200 other-user edit response with ONLY hr.costs.view → response masks costPerHour to 0', async () => {
    // Same caller permissions as above, but targeting another user. The
    // response mask must drop the cost field because personal-scope hr.costs.view
    // is self-only.
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue([
      'administration.user_management.update',
      'administration.user_management_all.view',
      'hr.costs.view',
    ]);
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE); // u-target ≠ manager
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
      headers: managerAuth(),
      payload: { name: 'Renamed' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.costPerHour).toBe(0);
  });
});

// =========================================================================
// PUT /api/users/:id/auth-method
// =========================================================================

describe('PUT /api/users/:id/auth-method', () => {
  test('200 changes app user to LDAP and applies role mapping from directory groups', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    updateAuthMethodMock.mockResolvedValue({
      ...SAMPLE_USER_ROW,
      authMethod: 'ldap',
      role: 'user',
    });
    ldapLookupUserGroupsMock.mockResolvedValue({
      groups: ['cn=managers,ou=groups,dc=test,dc=com'],
      roleMappings: [{ externalGroup: 'managers', role: 'manager' }],
    });
    applyExternalRolesForUserIfMatchedMock.mockResolvedValue({
      applied: true,
      roleIds: ['manager'],
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/auth-method',
      headers: adminAuth(),
      payload: { authMethod: 'ldap' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateAuthMethodMock).toHaveBeenCalledWith('u-target', 'ldap', null, TX_SENTINEL);
    expect(ldapLookupUserGroupsMock).toHaveBeenCalledWith('target');
    expect(applyExternalRolesForUserIfMatchedMock).toHaveBeenCalledWith(
      'u-target',
      ['cn=managers,ou=groups,dc=test,dc=com'],
      [{ externalGroup: 'managers', role: 'manager' }],
    );
    const body = JSON.parse(res.body);
    expect(body.authMethod).toBe('ldap');
    expect(body.role).toBe('manager');
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.auth_method_changed',
        details: expect.objectContaining({ roleIds: ['manager'] }),
      }),
    );
  });

  // App role mapping is prioritized: if no LDAP group matches, the admin-assigned role
  // survives the bind. Pre-fix, applyExternalRolesForUser fell back to DEFAULT_ROLE_ID
  // and silently demoted users with a non-default role.
  test('200 changes app user to LDAP with no matching mapping preserves admin-assigned role', async () => {
    findCoreByIdMock.mockResolvedValue({ ...SAMPLE_USER_CORE, role: 'manager' });
    updateAuthMethodMock.mockResolvedValue({
      ...SAMPLE_USER_ROW,
      authMethod: 'ldap',
      role: 'manager',
    });
    ldapLookupUserGroupsMock.mockResolvedValue({
      groups: ['cn=unrelated,ou=groups,dc=test,dc=com'],
      roleMappings: [{ externalGroup: 'managers', role: 'manager' }],
    });
    applyExternalRolesForUserIfMatchedMock.mockResolvedValue({ applied: false, roleIds: [] });
    // Groups exist but don't map to any configured role — diagnostic should fire.
    externalGroupsYieldNoKnownRoleMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/auth-method',
      headers: adminAuth(),
      payload: { authMethod: 'ldap' },
    });

    expect(res.statusCode).toBe(200);
    expect(applyExternalRolesForUserIfMatchedMock).toHaveBeenCalled();
    // The bind-path diagnostic helper was consulted with the same inputs the
    // login/sync paths use, so admins debugging stale config get a consistent signal.
    expect(externalGroupsYieldNoKnownRoleMock).toHaveBeenCalledWith(
      ['cn=unrelated,ou=groups,dc=test,dc=com'],
      [{ externalGroup: 'managers', role: 'manager' }],
    );
    expect(JSON.parse(res.body).role).toBe('manager');
  });

  // When the admin hasn't configured any role mappings, the diagnostic helper returns
  // false (no warn) — binding a user to LDAP shouldn't log a misleading "did not resolve
  // to any known role mapping" message in that case.
  test('200 changes app user to LDAP with zero mappings configured does not consult the no-match diagnostic incorrectly', async () => {
    findCoreByIdMock.mockResolvedValue({ ...SAMPLE_USER_CORE, role: 'manager' });
    updateAuthMethodMock.mockResolvedValue({
      ...SAMPLE_USER_ROW,
      authMethod: 'ldap',
      role: 'manager',
    });
    ldapLookupUserGroupsMock.mockResolvedValue({
      groups: ['cn=anything,dc=test,dc=com'],
      roleMappings: [],
    });
    applyExternalRolesForUserIfMatchedMock.mockResolvedValue({ applied: false, roleIds: [] });
    // Helper returns false (no warn) — admin opted out of mapping by leaving it empty.
    externalGroupsYieldNoKnownRoleMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/auth-method',
      headers: adminAuth(),
      payload: { authMethod: 'ldap' },
    });

    expect(res.statusCode).toBe(200);
    expect(externalGroupsYieldNoKnownRoleMock).toHaveBeenCalledWith(
      ['cn=anything,dc=test,dc=com'],
      [],
    );
    expect(JSON.parse(res.body).role).toBe('manager');
  });

  test('200 changes app user to LDAP when LDAP is disabled → role unchanged, no failure', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    updateAuthMethodMock.mockResolvedValue({
      ...SAMPLE_USER_ROW,
      authMethod: 'ldap',
      role: 'manager',
    });
    ldapLookupUserGroupsMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/auth-method',
      headers: adminAuth(),
      payload: { authMethod: 'ldap' },
    });

    expect(res.statusCode).toBe(200);
    expect(ldapLookupUserGroupsMock).toHaveBeenCalledWith('target');
    expect(applyExternalRolesForUserIfMatchedMock).not.toHaveBeenCalled();
    expect(JSON.parse(res.body).role).toBe('manager');
  });

  test('200 changes to local does not trigger any LDAP lookup', async () => {
    findCoreByIdMock.mockResolvedValue({ ...SAMPLE_USER_CORE, authMethod: 'ldap' });
    updateAuthMethodMock.mockResolvedValue({ ...SAMPLE_USER_ROW, authMethod: 'local' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/auth-method',
      headers: adminAuth(),
      payload: { authMethod: 'local' },
    });

    expect(res.statusCode).toBe(200);
    expect(ldapLookupUserGroupsMock).not.toHaveBeenCalled();
    expect(applyExternalRolesForUserIfMatchedMock).not.toHaveBeenCalled();
  });

  test('200 changes app user to OIDC with enabled matching provider', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    ssoFindByIdMock.mockResolvedValue({
      id: 'sso-1',
      protocol: 'oidc',
      name: 'Keycloak',
      enabled: true,
    });
    updateAuthMethodMock.mockResolvedValue({
      ...SAMPLE_USER_ROW,
      authMethod: 'oidc',
      authProviderId: 'sso-1',
      authProviderName: 'Keycloak',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/auth-method',
      headers: adminAuth(),
      payload: { authMethod: 'oidc', authProviderId: 'sso-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateAuthMethodMock).toHaveBeenCalledWith('u-target', 'oidc', 'sso-1', TX_SENTINEL);
    expect(JSON.parse(res.body)).toMatchObject({
      authMethod: 'oidc',
      authProviderId: 'sso-1',
      authProviderName: 'Keycloak',
    });
  });

  test('400 rejects OIDC without provider', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/auth-method',
      headers: adminAuth(),
      payload: { authMethod: 'oidc' },
    });

    expect(res.statusCode).toBe(400);
    expect(updateAuthMethodMock).not.toHaveBeenCalled();
  });

  test('400 rejects OIDC with a missing provider', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    ssoFindByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/auth-method',
      headers: adminAuth(),
      payload: { authMethod: 'oidc', authProviderId: 'sso-missing' },
    });

    expect(res.statusCode).toBe(400);
    expect(updateAuthMethodMock).not.toHaveBeenCalled();
  });

  test('400 rejects OIDC with a disabled provider', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    ssoFindByIdMock.mockResolvedValue({
      id: 'sso-1',
      protocol: 'oidc',
      name: 'OIDC',
      enabled: false,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/auth-method',
      headers: adminAuth(),
      payload: { authMethod: 'oidc', authProviderId: 'sso-1' },
    });

    expect(res.statusCode).toBe(400);
    expect(updateAuthMethodMock).not.toHaveBeenCalled();
  });

  test('400 rejects provider with wrong protocol', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    ssoFindByIdMock.mockResolvedValue({
      id: 'sso-1',
      protocol: 'saml',
      name: 'SAML',
      enabled: true,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/auth-method',
      headers: adminAuth(),
      payload: { authMethod: 'oidc', authProviderId: 'sso-1' },
    });

    expect(res.statusCode).toBe(400);
    expect(updateAuthMethodMock).not.toHaveBeenCalled();
  });

  test('409 rejects non app users', async () => {
    findCoreByIdMock.mockResolvedValue({ ...SAMPLE_USER_CORE, employeeType: 'internal' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/auth-method',
      headers: adminAuth(),
      payload: { authMethod: 'ldap' },
    });

    expect(res.statusCode).toBe(409);
  });

  test('400 rejects changing your own authentication method', async () => {
    findCoreByIdMock.mockResolvedValue({
      ...SAMPLE_USER_CORE,
      id: ADMIN_USER.id,
      username: ADMIN_USER.username,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: `/api/users/${ADMIN_USER.id}/auth-method`,
      headers: adminAuth(),
      payload: { authMethod: 'local' },
    });

    expect(res.statusCode).toBe(400);
    expect(updateAuthMethodMock).not.toHaveBeenCalled();
  });

  test('403 rejects users without update permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['administration.user_management.view']);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/auth-method',
      headers: adminAuth(),
      payload: { authMethod: 'ldap' },
    });

    expect(res.statusCode).toBe(403);
  });

  test('403 manager cannot change auth method for unmanaged app_user', async () => {
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue([
      'administration.user_management.update',
      'administration.user_management.view',
    ]);
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    canManageUserMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/auth-method',
      headers: managerAuth(),
      payload: { authMethod: 'ldap' },
    });

    expect(res.statusCode).toBe(403);
    expect(updateAuthMethodMock).not.toHaveBeenCalled();
  });

  // Regression: spawned follow-up from PR #659 review. Stale external_identities rows
  // from a prior SSO binding must be wiped when an admin changes the auth method or
  // provider, or an A → B → A flip will silently re-authenticate via the original
  // subject. See server/services/external-auth.ts:resolveExternalIdentity.
  describe('external_identities cleanup on auth-method change', () => {
    test('wipes external_identities when changing OIDC user to local', async () => {
      findCoreByIdMock.mockResolvedValue({
        ...SAMPLE_USER_CORE,
        authMethod: 'oidc',
        authProviderId: 'sso-1',
      });
      updateAuthMethodMock.mockResolvedValue({ ...SAMPLE_USER_ROW, authMethod: 'local' });
      deleteAllForUserMock.mockResolvedValue(2);

      const res = await testApp.inject({
        method: 'PUT',
        url: '/api/users/u-target/auth-method',
        headers: adminAuth(),
        payload: { authMethod: 'local' },
      });

      expect(res.statusCode).toBe(200);
      expect(updateAuthMethodMock).toHaveBeenCalledWith('u-target', 'local', null, TX_SENTINEL);
      expect(deleteAllForUserMock).toHaveBeenCalledWith('u-target', TX_SENTINEL);
      expect(withDbTransactionMock).toHaveBeenCalled();
    });

    test('wipes external_identities when switching OIDC provider sso-1 → sso-2', async () => {
      findCoreByIdMock.mockResolvedValue({
        ...SAMPLE_USER_CORE,
        authMethod: 'oidc',
        authProviderId: 'sso-1',
      });
      ssoFindByIdMock.mockResolvedValue({
        id: 'sso-2',
        protocol: 'oidc',
        name: 'Other OIDC',
        enabled: true,
      });
      updateAuthMethodMock.mockResolvedValue({
        ...SAMPLE_USER_ROW,
        authMethod: 'oidc',
        authProviderId: 'sso-2',
      });
      deleteAllForUserMock.mockResolvedValue(1);

      const res = await testApp.inject({
        method: 'PUT',
        url: '/api/users/u-target/auth-method',
        headers: adminAuth(),
        payload: { authMethod: 'oidc', authProviderId: 'sso-2' },
      });

      expect(res.statusCode).toBe(200);
      expect(deleteAllForUserMock).toHaveBeenCalledWith('u-target', TX_SENTINEL);
    });

    test('wipes external_identities on A → B → A flip back to original provider', async () => {
      // Admin had previously flipped this user away from sso-1 (so external_identities still
      // holds the old sub). Now they're flipping back. Without the wipe, the original
      // subject would re-authenticate the user via findByIdentity on the next login.
      findCoreByIdMock.mockResolvedValue({
        ...SAMPLE_USER_CORE,
        authMethod: 'local',
        authProviderId: null,
      });
      ssoFindByIdMock.mockResolvedValue({
        id: 'sso-1',
        protocol: 'oidc',
        name: 'Keycloak',
        enabled: true,
      });
      updateAuthMethodMock.mockResolvedValue({
        ...SAMPLE_USER_ROW,
        authMethod: 'oidc',
        authProviderId: 'sso-1',
      });
      deleteAllForUserMock.mockResolvedValue(1);

      const res = await testApp.inject({
        method: 'PUT',
        url: '/api/users/u-target/auth-method',
        headers: adminAuth(),
        payload: { authMethod: 'oidc', authProviderId: 'sso-1' },
      });

      expect(res.statusCode).toBe(200);
      expect(deleteAllForUserMock).toHaveBeenCalledWith('u-target', TX_SENTINEL);
    });

    test('skips wipe when method and provider are unchanged (idempotent PUT)', async () => {
      findCoreByIdMock.mockResolvedValue({
        ...SAMPLE_USER_CORE,
        authMethod: 'oidc',
        authProviderId: 'sso-1',
      });
      ssoFindByIdMock.mockResolvedValue({
        id: 'sso-1',
        protocol: 'oidc',
        name: 'Keycloak',
        enabled: true,
      });
      updateAuthMethodMock.mockResolvedValue({
        ...SAMPLE_USER_ROW,
        authMethod: 'oidc',
        authProviderId: 'sso-1',
      });

      const res = await testApp.inject({
        method: 'PUT',
        url: '/api/users/u-target/auth-method',
        headers: adminAuth(),
        payload: { authMethod: 'oidc', authProviderId: 'sso-1' },
      });

      expect(res.statusCode).toBe(200);
      expect(deleteAllForUserMock).not.toHaveBeenCalled();
    });
  });
});

// =========================================================================
// POST /api/users/:id/2fa/reset
// =========================================================================

describe('POST /api/users/:id/2fa/reset', () => {
  test('200 admin with all-scope resets TOTP: disables + revokes all credentials atomically', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    disableTotpMock.mockResolvedValue(undefined);
    revokeUserCredentialsMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users/u-target/2fa/reset',
      headers: adminAuth(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });

    // Recovery clears the target's enrollment AND revokes every live credential — both interactive
    // sessions and PAT/MCP tokens (revokeUserCredentials bumps session_version AND token_version),
    // so a surviving token can't keep admin API access if the reset leaves an enforced admin
    // unenrolled. Both run inside the same withDbTransaction, landing with the shared TX sentinel.
    expect(disableTotpMock).toHaveBeenCalledWith('u-target', TX_SENTINEL);
    expect(revokeUserCredentialsMock).toHaveBeenCalledWith('u-target', TX_SENTINEL);

    // Caller already holds administration.user_management_all.view, so the
    // manager-scope fallback is short-circuited.
    expect(canManageUserMock).not.toHaveBeenCalled();

    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.totp_reset',
        entityType: 'user',
        entityId: 'u-target',
        details: expect.objectContaining({ secondaryLabel: 'admin_reset' }),
      }),
    );
  });

  test('200 manager with scope over the target can reset (canManageUser consulted)', async () => {
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    // No administration.user_management_all.view → falls through to canManageUser.
    getRolePermissionsMock.mockResolvedValue([
      'administration.user_management.update',
      'administration.user_management.view',
    ]);
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    canManageUserMock.mockResolvedValue(true);
    disableTotpMock.mockResolvedValue(undefined);
    revokeUserCredentialsMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users/u-target/2fa/reset',
      headers: managerAuth(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(canManageUserMock).toHaveBeenCalledWith('u-target', MANAGER_USER.id);
    expect(disableTotpMock).toHaveBeenCalledWith('u-target', TX_SENTINEL);
    expect(revokeUserCredentialsMock).toHaveBeenCalledWith('u-target', TX_SENTINEL);
  });

  test('404 when the target user does not exist', async () => {
    findCoreByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users/missing/2fa/reset',
      headers: adminAuth(),
    });

    expect(res.statusCode).toBe(404);
    expect(disableTotpMock).not.toHaveBeenCalled();
    expect(revokeUserCredentialsMock).not.toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.totp_reset.not_found',
        entityType: 'user',
        entityId: 'missing',
      }),
    );
  });

  test('403 caller lacking administration.user_management.update permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['administration.user_management.view']);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users/u-target/2fa/reset',
      headers: adminAuth(),
    });

    expect(res.statusCode).toBe(403);
    // Permission gate (requirePermission) rejects before the handler body runs.
    expect(findCoreByIdMock).not.toHaveBeenCalled();
    expect(disableTotpMock).not.toHaveBeenCalled();
    expect(revokeUserCredentialsMock).not.toHaveBeenCalled();
  });

  test('403 non-all-scope caller without canManageUser over the target', async () => {
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue([
      'administration.user_management.update',
      'administration.user_management.view',
    ]);
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    canManageUserMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users/u-target/2fa/reset',
      headers: managerAuth(),
    });

    expect(res.statusCode).toBe(403);
    expect(disableTotpMock).not.toHaveBeenCalled();
    expect(revokeUserCredentialsMock).not.toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.totp_reset.denied',
        entityType: 'user',
        entityId: 'u-target',
        details: expect.objectContaining({ secondaryLabel: 'cannot_manage_user' }),
      }),
    );
  });

  test('400 cannot reset your own two-factor authentication', async () => {
    findCoreByIdMock.mockResolvedValue({ ...SAMPLE_USER_CORE, id: ADMIN_USER.id });

    const res = await testApp.inject({
      method: 'POST',
      url: `/api/users/${ADMIN_USER.id}/2fa/reset`,
      headers: adminAuth(),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Cannot reset your own two-factor authentication');
    expect(disableTotpMock).not.toHaveBeenCalled();
    expect(revokeUserCredentialsMock).not.toHaveBeenCalled();
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'POST', url: '/api/users/u-target/2fa/reset' });
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
    expect(replaceUserRolesMock).toHaveBeenCalledWith('u-target', ['user', 'manager'], TX_SENTINEL);
    expect(setPrimaryRoleMock).toHaveBeenCalledWith('u-target', 'manager', TX_SENTINEL);
    expect(syncTopManagerAssignmentsForUserMock).toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.roles_updated' }),
    );
  });

  test('200 granting an admin role to an unenrolled user revokes sessions when 2FA is enforced', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    rolesFindExistingIdsMock.mockResolvedValue(new Set(['user', 'admin']));
    generalSettingsGetMock.mockResolvedValue({ enforceTotpForAdmins: true });
    getTotpStateMock.mockResolvedValue({
      totpSecret: null,
      totpEnabled: false,
      totpConfirmedAt: null,
      totpBackupCodes: null,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/roles',
      headers: adminAuth(),
      payload: { roleIds: ['user', 'admin'], primaryRoleId: 'admin' },
    });

    expect(res.statusCode).toBe(200);
    expect(replaceUserRolesMock).toHaveBeenCalledWith('u-target', ['user', 'admin'], TX_SENTINEL);
    // Primary role is now admin, the mandate is on, and they have no TOTP → revoke their sessions
    // so they must re-login and enrol before they can act as an admin.
    expect(revokeUserCredentialsMock).toHaveBeenCalledWith('u-target');
  });

  test('200 role change without enforcement does not revoke sessions', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    rolesFindExistingIdsMock.mockResolvedValue(new Set(['user', 'admin']));
    // generalSettingsGetMock defaults to null (enforcement off) — no revocation.
    getTotpStateMock.mockResolvedValue({
      totpSecret: null,
      totpEnabled: false,
      totpConfirmedAt: null,
      totpBackupCodes: null,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/roles',
      headers: adminAuth(),
      payload: { roleIds: ['user', 'admin'], primaryRoleId: 'admin' },
    });

    expect(res.statusCode).toBe(200);
    expect(revokeUserCredentialsMock).not.toHaveBeenCalled();
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

  // Regression: replaceUserRoles + setPrimaryRole + syncTopManagerAssignmentsForUser
  // must run inside a single `withDbTransaction`. Without it, an INSERT failure in
  // replaceUserRoles (or in any following step) leaves the user with their roles
  // already deleted.
  test('wraps replaceUserRoles + setPrimaryRole + syncTopManager in a single withDbTransaction', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    rolesFindExistingIdsMock.mockResolvedValue(new Set(['user', 'manager']));

    const callOrder: string[] = [];
    replaceUserRolesMock.mockImplementation(async () => {
      callOrder.push('replaceUserRoles');
    });
    setPrimaryRoleMock.mockImplementation(async () => {
      callOrder.push('setPrimaryRole');
    });
    syncTopManagerAssignmentsForUserMock.mockImplementation(async () => {
      callOrder.push('syncTopManager');
    });
    withDbTransactionMock.mockImplementation(async (cb) => {
      callOrder.push('tx:open');
      const result = await cb(TX_SENTINEL);
      callOrder.push('tx:close');
      return result;
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/roles',
      headers: adminAuth(),
      payload: { roleIds: ['user', 'manager'], primaryRoleId: 'manager' },
    });

    expect(res.statusCode).toBe(200);
    expect(withDbTransactionMock).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual([
      'tx:open',
      'replaceUserRoles',
      'setPrimaryRole',
      'syncTopManager',
      'tx:close',
    ]);
    // Each write step must run on the tx the wrapper handed us (not `db`), otherwise
    // a failure in a later step won't roll the earlier ones back.
    expect(replaceUserRolesMock.mock.calls[0]?.at(-1)).toBe(TX_SENTINEL);
    expect(setPrimaryRoleMock.mock.calls[0]?.at(-1)).toBe(TX_SENTINEL);
    expect(syncTopManagerAssignmentsForUserMock.mock.calls[0]?.at(-1)).toBe(TX_SENTINEL);
  });

  test('does not commit role replacement when a tx step throws', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    rolesFindExistingIdsMock.mockResolvedValue(new Set(['user', 'manager']));

    replaceUserRolesMock.mockResolvedValue(undefined);
    setPrimaryRoleMock.mockRejectedValue(new Error('primary role update failed'));
    resetWithDbTransactionMock();

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/users/u-target/roles',
      headers: adminAuth(),
      payload: { roleIds: ['user', 'manager'], primaryRoleId: 'manager' },
    });

    expect(res.statusCode).toBe(500);
    expect(replaceUserRolesMock).toHaveBeenCalled();
    expect(setPrimaryRoleMock).toHaveBeenCalled();
    expect(syncTopManagerAssignmentsForUserMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
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

  test('200 includes parent project and client for task-only assignments', async () => {
    findAuthUserByIdMock.mockResolvedValue(MANAGER_USER);
    getRolePermissionsMock.mockResolvedValue(['timesheets.tracker.view']);
    canManageUserMock.mockResolvedValue(true);
    listTasksForUserMock.mockResolvedValue([
      {
        id: 't-task-only',
        name: 'Initial Design',
        projectId: 'p-parent',
        isDisabled: false,
      },
    ]);
    listProjectsByIdsMock.mockResolvedValue(
      new Map([
        [
          'p-parent',
          {
            id: 'p-parent',
            name: 'Website Redesign',
            clientId: 'c-parent',
            isDisabled: false,
            billingType: 'time_and_materials',
            billingFrequency: 'monthly',
          },
        ],
      ]),
    );
    listClientsByIdsMock.mockResolvedValue(
      new Map([
        [
          'c-parent',
          {
            id: 'c-parent',
            name: 'Acme Corp',
            isDisabled: false,
          },
        ],
      ]),
    );

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/users/u-target/tracker-catalogs',
      headers: managerAuth(),
    });

    expect(res.statusCode).toBe(200);
    expect(listProjectsByIdsMock).toHaveBeenCalledWith(['p-parent']);
    expect(listClientsByIdsMock).toHaveBeenCalledWith(['c-parent']);
    expect(JSON.parse(res.body)).toEqual({
      clients: [{ id: 'c-parent', name: 'Acme Corp', isDisabled: false }],
      projects: [
        {
          id: 'p-parent',
          name: 'Website Redesign',
          clientId: 'c-parent',
          isDisabled: false,
          billingType: 'time_and_materials',
          billingFrequency: 'monthly',
        },
      ],
      projectTasks: [
        {
          id: 't-task-only',
          name: 'Initial Design',
          projectId: 'p-parent',
          isDisabled: false,
        },
      ],
    });
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

  // Regression: each replaceUser<Kind> writes a DELETE then an INSERT; partial failure
  // between them wipes the user's existing assignments unless the whole batch is
  // wrapped in `withDbTransaction`.
  test('wraps all replaceUser<Kind> + clearProjectCascade + applyProjectCascade in a single withDbTransaction', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    userHasTopManagerRoleMock.mockResolvedValue(false);

    const callOrder: string[] = [];
    replaceUserClientsMock.mockImplementation(async () => {
      callOrder.push('replaceUserClients');
    });
    replaceUserProjectsMock.mockImplementation(async () => {
      callOrder.push('replaceUserProjects');
    });
    replaceUserTasksMock.mockImplementation(async () => {
      callOrder.push('replaceUserTasks');
    });
    clearProjectCascadeAssignmentsMock.mockImplementation(async () => {
      callOrder.push('clearProjectCascade');
    });
    applyProjectCascadeToClientsMock.mockImplementation(async () => {
      callOrder.push('applyProjectCascade');
    });
    withDbTransactionMock.mockImplementation(async (cb) => {
      callOrder.push('tx:open');
      const result = await cb(TX_SENTINEL);
      callOrder.push('tx:close');
      return result;
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users/u-target/assignments',
      headers: adminAuth(),
      payload: { clientIds: ['c1'], projectIds: ['p1'], taskIds: ['t1'] },
    });

    expect(res.statusCode).toBe(200);
    expect(withDbTransactionMock).toHaveBeenCalledTimes(1);
    expect(callOrder[0]).toBe('tx:open');
    expect(callOrder[callOrder.length - 1]).toBe('tx:close');
    expect(callOrder.slice(1, -1)).toEqual([
      'replaceUserClients',
      'replaceUserProjects',
      'replaceUserTasks',
      'clearProjectCascade',
      'applyProjectCascade',
    ]);
    // Every write step must run on the tx the wrapper handed us, not `db` —
    // that is the entire rollback contract this PR pins.
    expect(replaceUserClientsMock.mock.calls[0]?.at(-1)).toBe(TX_SENTINEL);
    expect(replaceUserProjectsMock.mock.calls[0]?.at(-1)).toBe(TX_SENTINEL);
    expect(replaceUserTasksMock.mock.calls[0]?.at(-1)).toBe(TX_SENTINEL);
    expect(clearProjectCascadeAssignmentsMock.mock.calls[0]?.at(-1)).toBe(TX_SENTINEL);
    expect(applyProjectCascadeToClientsMock.mock.calls[0]?.at(-1)).toBe(TX_SENTINEL);
  });

  test('does not commit assignment updates when a replace step throws in the tx', async () => {
    findCoreByIdMock.mockResolvedValue(SAMPLE_USER_CORE);
    userHasTopManagerRoleMock.mockResolvedValue(false);

    replaceUserClientsMock.mockResolvedValue(undefined);
    // Canonical failure: DELETE half of replaceUserProjects succeeded, then INSERT
    // threw; the exception propagates out of the tx callback.
    replaceUserProjectsMock.mockRejectedValue(new Error('FK violation on user_projects'));
    resetWithDbTransactionMock();

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/users/u-target/assignments',
      headers: adminAuth(),
      payload: { clientIds: ['c1'], projectIds: ['p1'], taskIds: ['t1'] },
    });

    expect(res.statusCode).toBe(500);
    expect(replaceUserClientsMock).toHaveBeenCalled();
    expect(replaceUserProjectsMock).toHaveBeenCalled();
    expect(replaceUserTasksMock).not.toHaveBeenCalled();
    expect(applyProjectCascadeToClientsMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
