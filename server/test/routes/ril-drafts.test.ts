import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realRilDraftsRepo from '../../repositories/rilDraftsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
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
const rilDraftsRepoSnap = { ...realRilDraftsRepo };
const workUnitsRepoSnap = { ...realWorkUnitsRepo };

// Auth-middleware deps (the real authenticateToken runs under the wrapped mock and reads these).
const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

// Route deps
const getForUserMonthMock = mock();
const upsertForUserMonthMock = mock();
const deleteForUserMonthMock = mock();
const isUserManagedByMock = mock();

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
  mock.module('../../repositories/rilDraftsRepo.ts', () => ({
    ...rilDraftsRepoSnap,
    getForUserMonth: getForUserMonthMock,
    upsertForUserMonth: upsertForUserMonthMock,
    deleteForUserMonth: deleteForUserMonthMock,
  }));
  mock.module('../../repositories/workUnitsRepo.ts', () => ({
    ...workUnitsRepoSnap,
    isUserManagedBy: isUserManagedByMock,
  }));

  routePlugin = (await import('../../routes/ril-drafts.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/rilDraftsRepo.ts', () => rilDraftsRepoSnap);
  mock.module('../../repositories/workUnitsRepo.ts', () => workUnitsRepoSnap);
});

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'user',
  avatarInitials: 'AL',
  isDisabled: false,
  sessionVersion: 1,
};

// `requirePermission('timesheets.ril.view')` reads these off request.user, so the base grant must
// include it for the guard to pass.
const RIL_PERMS = ['timesheets.ril.view'];
// Cross-user access needs the verb-scoped all-permission: view for GET, update for PUT, delete for
// DELETE (mirrors listTimeEntries/updateTimeEntry/deleteTimeEntry). A read-all grant must NOT
// authorize cross-user writes/deletes.
const RIL_AND_TRACKER_ALL_VIEW = ['timesheets.ril.view', 'timesheets.tracker_all.view'];
const RIL_AND_TRACKER_ALL_UPDATE = ['timesheets.ril.view', 'timesheets.tracker_all.update'];
const RIL_AND_TRACKER_ALL_DELETE = ['timesheets.ril.view', 'timesheets.tracker_all.delete'];

const SAMPLE_ROWS = {
  '1': { entrance: '09:00', exit: '18:00', notes: '', transfer: '', code: '' },
};

const sampleDraft = (overrides: Record<string, unknown> = {}) => ({
  monthKey: '2026-05',
  rows: SAMPLE_ROWS,
  updatedAt: '2026-05-11T09:00:00.000Z',
  ...overrides,
});

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  getForUserMonthMock,
  upsertForUserMonthMock,
  deleteForUserMonthMock,
  isUserManagedByMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(RIL_PERMS);
  // Default: no manager link. Cross-user-allowed tests opt in explicitly.
  isUserManagedByMock.mockResolvedValue(false);

  testApp = await buildRouteTestApp(routePlugin, '/api/ril-drafts');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = (userId = 'u1') => ({ authorization: `Bearer ${signToken({ userId })}` });

describe('GET /api/ril-drafts/:monthKey', () => {
  test('200 self: returns the repo draft', async () => {
    const draft = sampleDraft();
    getForUserMonthMock.mockResolvedValue(draft);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/ril-drafts/2026-05',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(draft);
    expect(getForUserMonthMock).toHaveBeenCalledWith('u1', '2026-05');
    expect(isUserManagedByMock).not.toHaveBeenCalled();
  });

  test('200 self: empty shape when repo returns null', async () => {
    getForUserMonthMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/ril-drafts/2026-05',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ monthKey: '2026-05', rows: {}, updatedAt: null });
    expect(getForUserMonthMock).toHaveBeenCalledWith('u1', '2026-05');
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/ril-drafts/2026-05' });
    expect(res.statusCode).toBe(401);
  });

  test('400 invalid monthKey (out-of-range month)', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/ril-drafts/2026-13',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(400);
    expect(getForUserMonthMock).not.toHaveBeenCalled();
  });

  test('400 invalid monthKey (non-date string)', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/ril-drafts/nope',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(400);
    expect(getForUserMonthMock).not.toHaveBeenCalled();
  });

  describe('cross-user (userId=u2)', () => {
    test('200 allowed with tracker_all.view', async () => {
      getRolePermissionsMock.mockResolvedValue(RIL_AND_TRACKER_ALL_VIEW);
      const draft = sampleDraft();
      getForUserMonthMock.mockResolvedValue(draft);

      const res = await testApp.inject({
        method: 'GET',
        url: '/api/ril-drafts/2026-05?userId=u2',
        headers: authHeader(),
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual(draft);
      expect(getForUserMonthMock).toHaveBeenCalledWith('u2', '2026-05');
      // tracker_all short-circuits before the manager lookup.
      expect(isUserManagedByMock).not.toHaveBeenCalled();
    });

    test('200 allowed via manager link (isUserManagedBy true)', async () => {
      isUserManagedByMock.mockResolvedValue(true);
      const draft = sampleDraft();
      getForUserMonthMock.mockResolvedValue(draft);

      const res = await testApp.inject({
        method: 'GET',
        url: '/api/ril-drafts/2026-05?userId=u2',
        headers: authHeader(),
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual(draft);
      expect(isUserManagedByMock).toHaveBeenCalledWith('u1', 'u2');
      expect(getForUserMonthMock).toHaveBeenCalledWith('u2', '2026-05');
    });

    test('403 forbidden without view-all and no manager link', async () => {
      isUserManagedByMock.mockResolvedValue(false);

      const res = await testApp.inject({
        method: 'GET',
        url: '/api/ril-drafts/2026-05?userId=u2',
        headers: authHeader(),
      });

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body)).toEqual({
        error: 'Not authorized to access RIL drafts for this user',
      });
      expect(isUserManagedByMock).toHaveBeenCalledWith('u1', 'u2');
      expect(getForUserMonthMock).not.toHaveBeenCalled();
    });
  });
});

describe('PUT /api/ril-drafts/:monthKey', () => {
  test('200 self: upserts and returns the saved draft', async () => {
    const draft = sampleDraft();
    upsertForUserMonthMock.mockResolvedValue(draft);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/ril-drafts/2026-05',
      headers: authHeader(),
      payload: { rows: SAMPLE_ROWS },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(draft);
    expect(upsertForUserMonthMock).toHaveBeenCalledWith('u1', '2026-05', SAMPLE_ROWS);
    expect(isUserManagedByMock).not.toHaveBeenCalled();
  });

  // rows must be an object keyed by day. An array is rejected — Fastify's schema may reject before
  // the handler's own guard, so we only assert the 400 + that nothing was persisted.
  test('400 when rows is not an object (array)', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/ril-drafts/2026-05',
      headers: authHeader(),
      payload: { rows: [] },
    });

    expect(res.statusCode).toBe(400);
    expect(upsertForUserMonthMock).not.toHaveBeenCalled();
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/ril-drafts/2026-05',
      payload: { rows: SAMPLE_ROWS },
    });
    expect(res.statusCode).toBe(401);
  });

  test('400 invalid monthKey', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/ril-drafts/2026-13',
      headers: authHeader(),
      payload: { rows: SAMPLE_ROWS },
    });

    expect(res.statusCode).toBe(400);
    expect(upsertForUserMonthMock).not.toHaveBeenCalled();
  });

  describe('cross-user (userId=u2)', () => {
    test('200 allowed with tracker_all.update', async () => {
      getRolePermissionsMock.mockResolvedValue(RIL_AND_TRACKER_ALL_UPDATE);
      const draft = sampleDraft();
      upsertForUserMonthMock.mockResolvedValue(draft);

      const res = await testApp.inject({
        method: 'PUT',
        url: '/api/ril-drafts/2026-05?userId=u2',
        headers: authHeader(),
        payload: { rows: SAMPLE_ROWS },
      });

      expect(res.statusCode).toBe(200);
      expect(upsertForUserMonthMock).toHaveBeenCalledWith('u2', '2026-05', SAMPLE_ROWS);
      expect(isUserManagedByMock).not.toHaveBeenCalled();
    });

    // Read-all must NOT authorize a cross-user write — only tracker_all.update or a manager link.
    test('403 with only tracker_all.view (read-all does not authorize writes)', async () => {
      getRolePermissionsMock.mockResolvedValue(RIL_AND_TRACKER_ALL_VIEW);
      isUserManagedByMock.mockResolvedValue(false);

      const res = await testApp.inject({
        method: 'PUT',
        url: '/api/ril-drafts/2026-05?userId=u2',
        headers: authHeader(),
        payload: { rows: SAMPLE_ROWS },
      });

      expect(res.statusCode).toBe(403);
      expect(upsertForUserMonthMock).not.toHaveBeenCalled();
    });

    test('200 allowed via manager link', async () => {
      isUserManagedByMock.mockResolvedValue(true);
      const draft = sampleDraft();
      upsertForUserMonthMock.mockResolvedValue(draft);

      const res = await testApp.inject({
        method: 'PUT',
        url: '/api/ril-drafts/2026-05?userId=u2',
        headers: authHeader(),
        payload: { rows: SAMPLE_ROWS },
      });

      expect(res.statusCode).toBe(200);
      expect(isUserManagedByMock).toHaveBeenCalledWith('u1', 'u2');
      expect(upsertForUserMonthMock).toHaveBeenCalledWith('u2', '2026-05', SAMPLE_ROWS);
    });

    test('403 forbidden without view-all and no manager link', async () => {
      isUserManagedByMock.mockResolvedValue(false);

      const res = await testApp.inject({
        method: 'PUT',
        url: '/api/ril-drafts/2026-05?userId=u2',
        headers: authHeader(),
        payload: { rows: SAMPLE_ROWS },
      });

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body)).toEqual({
        error: 'Not authorized to access RIL drafts for this user',
      });
      expect(isUserManagedByMock).toHaveBeenCalledWith('u1', 'u2');
      expect(upsertForUserMonthMock).not.toHaveBeenCalled();
    });
  });
});

describe('DELETE /api/ril-drafts/:monthKey', () => {
  test('204 self: discards the draft', async () => {
    deleteForUserMonthMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/ril-drafts/2026-05',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(deleteForUserMonthMock).toHaveBeenCalledWith('u1', '2026-05');
    expect(isUserManagedByMock).not.toHaveBeenCalled();
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'DELETE', url: '/api/ril-drafts/2026-05' });
    expect(res.statusCode).toBe(401);
  });

  test('400 invalid monthKey', async () => {
    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/ril-drafts/nope',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(400);
    expect(deleteForUserMonthMock).not.toHaveBeenCalled();
  });

  describe('cross-user (userId=u2)', () => {
    test('204 allowed with tracker_all.delete', async () => {
      getRolePermissionsMock.mockResolvedValue(RIL_AND_TRACKER_ALL_DELETE);
      deleteForUserMonthMock.mockResolvedValue(true);

      const res = await testApp.inject({
        method: 'DELETE',
        url: '/api/ril-drafts/2026-05?userId=u2',
        headers: authHeader(),
      });

      expect(res.statusCode).toBe(204);
      expect(deleteForUserMonthMock).toHaveBeenCalledWith('u2', '2026-05');
      expect(isUserManagedByMock).not.toHaveBeenCalled();
    });

    // Read-all must NOT authorize a cross-user delete — only tracker_all.delete or a manager link.
    test('403 with only tracker_all.view (read-all does not authorize deletes)', async () => {
      getRolePermissionsMock.mockResolvedValue(RIL_AND_TRACKER_ALL_VIEW);
      isUserManagedByMock.mockResolvedValue(false);

      const res = await testApp.inject({
        method: 'DELETE',
        url: '/api/ril-drafts/2026-05?userId=u2',
        headers: authHeader(),
      });

      expect(res.statusCode).toBe(403);
      expect(deleteForUserMonthMock).not.toHaveBeenCalled();
    });

    test('403 forbidden without view-all and no manager link', async () => {
      isUserManagedByMock.mockResolvedValue(false);

      const res = await testApp.inject({
        method: 'DELETE',
        url: '/api/ril-drafts/2026-05?userId=u2',
        headers: authHeader(),
      });

      expect(res.statusCode).toBe(403);
      expect(isUserManagedByMock).toHaveBeenCalledWith('u1', 'u2');
      expect(deleteForUserMonthMock).not.toHaveBeenCalled();
    });
  });
});
