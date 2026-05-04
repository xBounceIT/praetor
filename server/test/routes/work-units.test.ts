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
};

const ALL_PERMS = [
  'hr.work_units.view',
  'hr.work_units.create',
  'hr.work_units.update',
  'hr.work_units.delete',
  'hr.work_units_all.view',
];

const SAMPLE_UNIT = {
  id: 'wu-1',
  name: 'Engineering',
  managers: [{ id: 'u1', name: 'Alice' }],
  description: null,
  isDisabled: false,
  userCount: 3,
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
  logAuditMock,
  withDbTransactionMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(ALL_PERMS);
  withDbTransactionMock.mockImplementation(async (cb) => cb(undefined));
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
    expect(addManagersMock).toHaveBeenCalledWith(expect.any(String), ['u1', 'u2'], undefined);
    expect(addUsersToUnitMock).toHaveBeenCalledWith(expect.any(String), ['u1', 'u2'], undefined);
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
    expect(addManagersMock).toHaveBeenCalledWith('wu-1', ['u3', 'u4'], undefined);
    expect(addUsersToUnitMock).toHaveBeenCalledWith('wu-1', ['u3', 'u4'], undefined);
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
});

describe('DELETE /api/work-units/:id', () => {
  test('200 happy + audit', async () => {
    deleteByIdMock.mockResolvedValue({ id: 'wu-1', name: 'Engineering' });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/work-units/wu-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ message: 'Work unit deleted' });
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
    expect(clearUsersMock).toHaveBeenCalledWith('wu-1', undefined);
    expect(addUsersToUnitMock).toHaveBeenCalledWith('wu-1', ['u1', 'u2', 'u3'], undefined);
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
});
