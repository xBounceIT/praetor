import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realWorkUnitsRepo from '../../repositories/workUnitsRepo.ts';
import * as realAudit from '../../utils/audit.ts';
import { NotFoundError } from '../../utils/http-errors.ts';
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
const workUnitsRepoSnap = { ...realWorkUnitsRepo };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const listAllMock = mock();
const listManagedByMock = mock();
const createMock = mock();
const addManagersMock = mock();
const addUsersToUnitMock = mock();
const findByIdMock = mock();
const lockByIdMock = mock();
const updateFieldsMock = mock();
const clearManagersMock = mock();
const clearUsersMock = mock();
const findNameByIdMock = mock();
const findUserIdsMock = mock();
const deleteByIdMock = mock();
const isUserManagerOfUnitMock = mock();
const listManagedUserIdsMock = mock();
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
  mock.module('../../repositories/workUnitsRepo.ts', () => ({
    ...workUnitsRepoSnap,
    listAll: listAllMock,
    listManagedBy: listManagedByMock,
    create: createMock,
    addManagers: addManagersMock,
    addUsersToUnit: addUsersToUnitMock,
    findById: findByIdMock,
    lockById: lockByIdMock,
    updateFields: updateFieldsMock,
    clearManagers: clearManagersMock,
    clearUsers: clearUsersMock,
    findNameById: findNameByIdMock,
    findUserIds: findUserIdsMock,
    deleteById: deleteByIdMock,
    isUserManagerOfUnit: isUserManagerOfUnitMock,
    listManagedUserIds: listManagedUserIdsMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
    // keep real deriveToggleAction & getAuditChangedFields
  }));
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));

  routePlugin = (await import('../../routes/work-units.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
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

const ALL_PERMS = [
  'hr.work_units.view',
  'hr.work_units.create',
  'hr.work_units.update',
  'hr.work_units.delete',
  'hr.work_units_all.view',
  'hr.work_units_all.create',
  'hr.work_units_all.update',
  'hr.work_units_all.delete',
];

const SAMPLE_UNIT = {
  id: 'wu-1',
  name: 'Engineering',
  managers: [{ id: 'u1', name: 'Alice' }],
  members: [
    { id: 'u1', name: 'Alice' },
    { id: 'u2', name: 'Bob' },
  ],
  description: null,
  isDisabled: false,
  userCount: 2,
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  listAllMock,
  listManagedByMock,
  createMock,
  addManagersMock,
  addUsersToUnitMock,
  findByIdMock,
  lockByIdMock,
  updateFieldsMock,
  clearManagersMock,
  clearUsersMock,
  findNameByIdMock,
  findUserIdsMock,
  deleteByIdMock,
  isUserManagerOfUnitMock,
  listManagedUserIdsMock,
  logAuditMock,
  withDbTransactionMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(ALL_PERMS);
  resetWithDbTransactionMock();
  logAuditMock.mockImplementation(async () => undefined);

  testApp = await buildRouteTestApp(routePlugin, '/api/work-units');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('GET /api/work-units', () => {
  test('200 with hr.work_units_all.view → listAll', async () => {
    listAllMock.mockResolvedValue([SAMPLE_UNIT]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/work-units',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(listAllMock).toHaveBeenCalledTimes(1);
    expect(listManagedByMock).not.toHaveBeenCalled();
    // The member list is serialized for the card preview (issue #761).
    expect(JSON.parse(res.body)[0].members).toEqual([
      { id: 'u1', name: 'Alice' },
      { id: 'u2', name: 'Bob' },
    ]);
  });

  test('200 without all-view → listManagedBy(viewer.id)', async () => {
    getRolePermissionsMock.mockResolvedValue(['hr.work_units.view']);
    listManagedByMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/work-units',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(listManagedByMock).toHaveBeenCalledWith('u1');
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/work-units' });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing view permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/work-units',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/work-units', () => {
  test('201 creates unit, also adds managers as users (line 136 behavior)', async () => {
    createMock.mockResolvedValue(undefined);
    addManagersMock.mockResolvedValue(undefined);
    addUsersToUnitMock.mockResolvedValue(undefined);
    findByIdMock.mockResolvedValue(SAMPLE_UNIT);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/work-units',
      headers: authHeader(),
      payload: {
        name: 'Engineering',
        managerIds: ['u1', 'u2'],
        description: 'Eng team',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(addManagersMock).toHaveBeenCalledWith(expect.any(String), ['u1', 'u2'], TX_SENTINEL);
    expect(addUsersToUnitMock).toHaveBeenCalledWith(expect.any(String), ['u1', 'u2'], TX_SENTINEL);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'work_unit.created',
        entityType: 'work_unit',
      }),
    );
  });

  test('400 missing name', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/work-units',
      headers: authHeader(),
      payload: { name: '   ', managerIds: ['u1'] },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'name is required' });
  });

  test('400 empty managerIds', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/work-units',
      headers: authHeader(),
      payload: { name: 'Eng', managerIds: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/managerIds must contain at least one item/);
  });

  test('201 scoped creator can assign themselves and users in their managed HR scope', async () => {
    getRolePermissionsMock.mockResolvedValue(['hr.work_units.create']);
    listManagedUserIdsMock.mockResolvedValue(['u2']);
    createMock.mockResolvedValue(undefined);
    addManagersMock.mockResolvedValue(undefined);
    addUsersToUnitMock.mockResolvedValue(undefined);
    findByIdMock.mockResolvedValue(SAMPLE_UNIT);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/work-units',
      headers: authHeader(),
      payload: { name: 'Engineering', managerIds: ['u1', 'u2'] },
    });

    expect(res.statusCode).toBe(201);
    expect(listManagedUserIdsMock).toHaveBeenCalledWith('u1');
  });

  test('403 scoped creator cannot assign managers outside their managed HR scope', async () => {
    getRolePermissionsMock.mockResolvedValue(['hr.work_units.create']);
    listManagedUserIdsMock.mockResolvedValue(['u2']);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/work-units',
      headers: authHeader(),
      payload: { name: 'Engineering', managerIds: ['u1', 'u3'] },
    });

    expect(res.statusCode).toBe(403);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('403 scoped creator must remain a manager of the new unit', async () => {
    getRolePermissionsMock.mockResolvedValue(['hr.work_units.create']);
    listManagedUserIdsMock.mockResolvedValue(['u2']);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/work-units',
      headers: authHeader(),
      payload: { name: 'Engineering', managerIds: ['u2'] },
    });

    expect(res.statusCode).toBe(403);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe('PUT /api/work-units/:id', () => {
  test('200 happy update emits work_unit.updated audit', async () => {
    lockByIdMock.mockResolvedValue(true);
    updateFieldsMock.mockResolvedValue(undefined);
    findByIdMock.mockResolvedValue({ ...SAMPLE_UNIT, name: 'Renamed' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/work-units/wu-1',
      headers: authHeader(),
      payload: { name: 'Renamed' },
    });

    expect(res.statusCode).toBe(200);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'work_unit.updated' }),
    );
    // managerIds not provided → no clear/add manager calls
    expect(clearManagersMock).not.toHaveBeenCalled();
  });

  test('200 isDisabled=true alone audits as work_unit.disabled', async () => {
    lockByIdMock.mockResolvedValue(true);
    updateFieldsMock.mockResolvedValue(undefined);
    findByIdMock.mockResolvedValue({ ...SAMPLE_UNIT, isDisabled: true });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/work-units/wu-1',
      headers: authHeader(),
      payload: { isDisabled: true },
    });

    expect(res.statusCode).toBe(200);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'work_unit.disabled' }),
    );
  });

  test('200 with managerIds calls clearManagers + addManagers + addUsersToUnit', async () => {
    lockByIdMock.mockResolvedValue(true);
    updateFieldsMock.mockResolvedValue(undefined);
    clearManagersMock.mockResolvedValue(undefined);
    addManagersMock.mockResolvedValue(undefined);
    addUsersToUnitMock.mockResolvedValue(undefined);
    findByIdMock.mockResolvedValue(SAMPLE_UNIT);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/work-units/wu-1',
      headers: authHeader(),
      payload: { managerIds: ['u3', 'u4'] },
    });

    expect(res.statusCode).toBe(200);
    expect(clearManagersMock).toHaveBeenCalled();
    expect(addManagersMock).toHaveBeenCalledWith('wu-1', ['u3', 'u4'], TX_SENTINEL);
    expect(addUsersToUnitMock).toHaveBeenCalledWith('wu-1', ['u3', 'u4'], TX_SENTINEL);
  });

  test('404 when lockById throws NotFoundError', async () => {
    withDbTransactionMock.mockImplementation(async () => {
      throw new NotFoundError('Work unit');
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/work-units/missing',
      headers: authHeader(),
      payload: { name: 'New' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Work unit not found' });
  });

  test('400 whitespace-only name', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/work-units/wu-1',
      headers: authHeader(),
      payload: { name: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/name must be a non-empty string/);
  });

  test('200 scoped updater can mutate a unit they manage', async () => {
    getRolePermissionsMock.mockResolvedValue(['hr.work_units.update']);
    isUserManagerOfUnitMock.mockResolvedValue(true);
    lockByIdMock.mockResolvedValue(true);
    updateFieldsMock.mockResolvedValue(undefined);
    findByIdMock.mockResolvedValue({ ...SAMPLE_UNIT, name: 'Renamed' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/work-units/wu-1',
      headers: authHeader(),
      payload: { name: 'Renamed' },
    });

    expect(res.statusCode).toBe(200);
    expect(isUserManagerOfUnitMock).toHaveBeenCalledWith('u1', 'wu-1');
  });

  test('200 scoped updater can retain themselves and assign a managed user as manager', async () => {
    getRolePermissionsMock.mockResolvedValue(['hr.work_units.update']);
    isUserManagerOfUnitMock.mockResolvedValue(true);
    listManagedUserIdsMock.mockResolvedValue(['u2']);
    lockByIdMock.mockResolvedValue(true);
    findByIdMock.mockResolvedValue(SAMPLE_UNIT);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/work-units/wu-1',
      headers: authHeader(),
      payload: { managerIds: ['u1', 'u2'] },
    });

    expect(res.statusCode).toBe(200);
    expect(listManagedUserIdsMock).toHaveBeenCalledWith('u1');
  });

  test('403 scoped updater cannot assign an out-of-scope manager', async () => {
    getRolePermissionsMock.mockResolvedValue(['hr.work_units.update']);
    isUserManagerOfUnitMock.mockResolvedValue(true);
    listManagedUserIdsMock.mockResolvedValue(['u2']);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/work-units/wu-1',
      headers: authHeader(),
      payload: { managerIds: ['u1', 'u3'] },
    });

    expect(res.statusCode).toBe(403);
    expect(lockByIdMock).not.toHaveBeenCalled();
  });

  test('403 scoped updater cannot remove themselves from the manager list', async () => {
    getRolePermissionsMock.mockResolvedValue(['hr.work_units.update']);
    isUserManagerOfUnitMock.mockResolvedValue(true);
    listManagedUserIdsMock.mockResolvedValue(['u2']);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/work-units/wu-1',
      headers: authHeader(),
      payload: { managerIds: ['u2'] },
    });

    expect(res.statusCode).toBe(403);
    expect(lockByIdMock).not.toHaveBeenCalled();
  });

  test('403 scoped updater cannot mutate a unit they do not manage', async () => {
    getRolePermissionsMock.mockResolvedValue(['hr.work_units.update', 'hr.work_units_all.view']);
    isUserManagerOfUnitMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/work-units/wu-other',
      headers: authHeader(),
      payload: { name: 'Hijacked' },
    });

    expect(res.statusCode).toBe(403);
    expect(lockByIdMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/work-units/:id', () => {
  test('204 happy + audit', async () => {
    deleteByIdMock.mockResolvedValue({ id: 'wu-1', name: 'Engineering' });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/work-units/wu-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'work_unit.deleted', entityId: 'wu-1' }),
    );
  });

  test('404 not found', async () => {
    deleteByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/work-units/missing',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
  });

  test('403 scoped deleter cannot delete a unit they do not manage', async () => {
    getRolePermissionsMock.mockResolvedValue(['hr.work_units.delete', 'hr.work_units_all.view']);
    isUserManagerOfUnitMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/work-units/wu-other',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(403);
    expect(deleteByIdMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/work-units/:id/users', () => {
  test('200 with hr.work_units_all.view skips manager check', async () => {
    findUserIdsMock.mockResolvedValue(['u1', 'u2']);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/work-units/wu-1/users',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(['u1', 'u2']);
    expect(isUserManagerOfUnitMock).not.toHaveBeenCalled();
  });

  test('200 as manager-of-unit', async () => {
    getRolePermissionsMock.mockResolvedValue(['hr.work_units.view']);
    isUserManagerOfUnitMock.mockResolvedValue(true);
    findUserIdsMock.mockResolvedValue(['u1']);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/work-units/wu-1/users',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(isUserManagerOfUnitMock).toHaveBeenCalledWith('u1', 'wu-1');
  });

  test('403 not manager and lacks all-view', async () => {
    getRolePermissionsMock.mockResolvedValue(['hr.work_units.view']);
    isUserManagerOfUnitMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/work-units/wu-1/users',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'Access denied' });
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/work-units/wu-1/users',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/work-units/:id/users', () => {
  test('200 clear+replace flow', async () => {
    findNameByIdMock.mockResolvedValue('Engineering');
    clearUsersMock.mockResolvedValue(undefined);
    addUsersToUnitMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/work-units/wu-1/users',
      headers: authHeader(),
      payload: { userIds: ['u1', 'u2', 'u3'] },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ message: 'Work unit users updated' });
    expect(clearUsersMock).toHaveBeenCalledWith('wu-1', TX_SENTINEL);
    expect(addUsersToUnitMock).toHaveBeenCalledWith('wu-1', ['u1', 'u2', 'u3'], TX_SENTINEL);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'work_unit.users_updated',
        entityId: 'wu-1',
      }),
    );
  });

  test('404 unit not found', async () => {
    findNameByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/work-units/missing/users',
      headers: authHeader(),
      payload: { userIds: [] },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Work unit not found' });
  });

  test('403 scoped updater cannot replace members of a unit they do not manage', async () => {
    getRolePermissionsMock.mockResolvedValue(['hr.work_units.update', 'hr.work_units_all.view']);
    isUserManagerOfUnitMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/work-units/wu-other/users',
      headers: authHeader(),
      payload: { userIds: ['u3'] },
    });

    expect(res.statusCode).toBe(403);
    expect(findNameByIdMock).not.toHaveBeenCalled();
    expect(clearUsersMock).not.toHaveBeenCalled();
  });
});
