import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realViewsRepo from '../../repositories/viewsRepo.ts';
import * as realAudit from '../../utils/audit.ts';
import * as realPermissions from '../../utils/permissions.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';
import { makeDbError } from '../helpers/dbErrors.ts';
import { signToken } from '../helpers/jwt.ts';

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const viewsRepoSnap = { ...realViewsRepo };
const auditSnap = { ...realAudit };

// Auth-middleware dependencies (the real `authenticateToken` still runs; these feed it).
const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

// usersRepo (directory)
const listDirectoryMock = mock();

// viewsRepo
const listForUserMock = mock();
const findAccessMock = mock();
const getViewKindMock = mock();
const createMock = mock();
const updateMock = mock();
const deleteByIdMock = mock();
const getSharesMock = mock();
const replaceSharesMock = mock();

const logAuditMock = mock(async () => undefined);

let routePlugin: FastifyPluginAsync;

beforeAll(async () => {
  installAuthMiddlewareMock();

  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnap,
    findAuthUserById: findAuthUserByIdMock,
    listDirectory: listDirectoryMock,
  }));
  mock.module('../../repositories/rolesRepo.ts', () => ({
    ...rolesRepoSnap,
    userHasRole: userHasRoleMock,
  }));
  mock.module('../../utils/permissions.ts', () => ({
    ...permissionsSnap,
    getRolePermissions: getRolePermissionsMock,
  }));
  mock.module('../../repositories/viewsRepo.ts', () => ({
    ...viewsRepoSnap,
    listForUser: listForUserMock,
    findAccess: findAccessMock,
    getViewKind: getViewKindMock,
    create: createMock,
    update: updateMock,
    deleteById: deleteByIdMock,
    getShares: getSharesMock,
    replaceShares: replaceSharesMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));

  routePlugin = (await import('../../routes/views.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/viewsRepo.ts', () => viewsRepoSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
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

const TABLE_CONFIG = {
  schemaVersion: 2,
  hiddenColIds: ['col-x'],
  columnOrder: ['col-y', 'col-x'],
  sortState: null,
  filterState: {},
};

const OWNED_VIEW = {
  id: 'sv-1',
  ownerId: 'u1',
  ownerName: 'Alice',
  kind: 'table' as const,
  scopeKey: 'projects.directory',
  name: 'Alpha',
  config: TABLE_CONFIG,
  access: 'owner' as const,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000,
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  listDirectoryMock,
  listForUserMock,
  findAccessMock,
  getViewKindMock,
  createMock,
  updateMock,
  deleteByIdMock,
  getSharesMock,
  replaceSharesMock,
  logAuditMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  // Saved views are gated by `authenticateToken` only, so the auth dependencies must resolve a
  // valid user for every authenticated request.
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue([]);
  logAuditMock.mockImplementation(async () => undefined);

  testApp = await buildRouteTestApp(routePlugin, '/api/views');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = (userId = 'u1') => ({ authorization: `Bearer ${signToken({ userId })}` });

describe('GET /api/views', () => {
  test('200 returns own + shared views scoped by kind/scopeKey', async () => {
    listForUserMock.mockResolvedValue([OWNED_VIEW]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/views?kind=table&scopeKey=projects.directory',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([OWNED_VIEW]);
    // Scoping is delegated to the repo with the caller's id.
    expect(listForUserMock).toHaveBeenCalledWith('u1', 'table', 'projects.directory');
  });

  test('400 when kind is invalid', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/views?kind=bogus&scopeKey=projects.directory',
      headers: authHeader(),
    });
    // The route schema enum rejects `bogus` before the handler runs.
    expect(res.statusCode).toBe(400);
    expect(listForUserMock).not.toHaveBeenCalled();
  });

  test('401 without a token', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/views?kind=table&scopeKey=projects.directory',
    });
    expect(res.statusCode).toBe(401);
    expect(listForUserMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/views', () => {
  test('201 creates a view owned by the caller and audits', async () => {
    createMock.mockResolvedValue(OWNED_VIEW);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/views',
      headers: authHeader(),
      payload: {
        kind: 'table',
        scopeKey: 'projects.directory',
        name: 'Alpha',
        config: TABLE_CONFIG,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual(OWNED_VIEW);
    // Owner is forced to the authenticated user, never trusted from the body.
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'u1',
        kind: 'table',
        scopeKey: 'projects.directory',
        name: 'Alpha',
        config: TABLE_CONFIG,
      }),
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'saved_view.created', entityType: 'saved_view' }),
    );
  });

  test('201 accepts a legacy table config without columnOrder', async () => {
    const legacyConfig = { hiddenColIds: [], sortState: null, filterState: {} };
    createMock.mockResolvedValue({ ...OWNED_VIEW, config: legacyConfig });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/views',
      headers: authHeader(),
      payload: {
        kind: 'table',
        scopeKey: 'projects.directory',
        name: 'Legacy',
        config: legacyConfig,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ config: legacyConfig }));
  });

  test('400 when columnOrder is not an array of strings', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/views',
      headers: authHeader(),
      payload: {
        kind: 'table',
        scopeKey: 'projects.directory',
        name: 'Bad Order',
        config: {
          hiddenColIds: [],
          columnOrder: ['name', 1],
          sortState: null,
          filterState: {},
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('400 when the config is not a valid table payload', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/views',
      headers: authHeader(),
      payload: {
        kind: 'table',
        scopeKey: 'projects.directory',
        name: 'Bad',
        config: { hiddenColIds: 'not-an-array' },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('400 when filterState has an empty array (mirrors the frontend, which drops them)', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/views',
      headers: authHeader(),
      payload: {
        kind: 'table',
        scopeKey: 'projects.directory',
        name: 'EmptyFilter',
        config: { hiddenColIds: [], sortState: null, filterState: { status: [] } },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('401 without a token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/views',
      payload: { kind: 'table', scopeKey: 'projects.directory', name: 'X', config: TABLE_CONFIG },
    });
    expect(res.statusCode).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe('PUT /api/views/:id', () => {
  test('200 when the owner updates (name only)', async () => {
    findAccessMock.mockResolvedValue({ ownerId: 'u1', access: 'owner' });
    updateMock.mockResolvedValue({ ...OWNED_VIEW, name: 'Renamed' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/views/sv-1',
      headers: authHeader(),
      payload: { name: 'Renamed' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).name).toBe('Renamed');
    expect(updateMock).toHaveBeenCalledWith('sv-1', { name: 'Renamed' });
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'saved_view.updated' }),
    );
  });

  test('200 when a write recipient updates the config', async () => {
    findAccessMock.mockResolvedValue({ ownerId: 'owner-x', access: 'write' });
    getViewKindMock.mockResolvedValue('table');
    // The repo returns the owner-perspective row (access:'owner') regardless of caller.
    updateMock.mockResolvedValue({ ...OWNED_VIEW, ownerId: 'owner-x', access: 'owner' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/views/sv-1',
      headers: authHeader('u2'),
      payload: { config: TABLE_CONFIG },
    });

    expect(res.statusCode).toBe(200);
    // The config patch is validated against the view's own kind before persisting.
    expect(getViewKindMock).toHaveBeenCalledWith('sv-1');
    expect(updateMock).toHaveBeenCalledWith('sv-1', { config: TABLE_CONFIG });
    // The response must report the CALLER's real access ('write'), not the repo's owner row —
    // otherwise the client would render owner-only delete/share controls for a write recipient.
    expect(res.json().access).toBe('write');
  });

  test('403 when a read recipient tries to update', async () => {
    findAccessMock.mockResolvedValue({ ownerId: 'owner-x', access: 'read' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/views/sv-1',
      headers: authHeader('u2'),
      payload: { name: 'Nope' },
    });

    expect(res.statusCode).toBe(403);
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('403 when a stranger (no share) tries to update', async () => {
    findAccessMock.mockResolvedValue({ ownerId: 'owner-x', access: null });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/views/sv-1',
      headers: authHeader('u2'),
      payload: { name: 'Nope' },
    });

    expect(res.statusCode).toBe(403);
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('404 when the view does not exist', async () => {
    findAccessMock.mockResolvedValue({ ownerId: null, access: null });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/views/ghost',
      headers: authHeader(),
      payload: { name: 'X' },
    });

    expect(res.statusCode).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/views/:id', () => {
  test('204 when the owner deletes', async () => {
    findAccessMock.mockResolvedValue({ ownerId: 'u1', access: 'owner' });
    deleteByIdMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/views/sv-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(deleteByIdMock).toHaveBeenCalledWith('sv-1');
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'saved_view.deleted' }),
    );
  });

  test('403 when a write recipient tries to delete (owner-only)', async () => {
    findAccessMock.mockResolvedValue({ ownerId: 'owner-x', access: 'write' });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/views/sv-1',
      headers: authHeader('u2'),
    });

    expect(res.statusCode).toBe(403);
    expect(deleteByIdMock).not.toHaveBeenCalled();
  });

  test('404 when the view does not exist', async () => {
    findAccessMock.mockResolvedValue({ ownerId: null, access: null });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/views/ghost',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(deleteByIdMock).not.toHaveBeenCalled();
  });
});

describe('PUT /api/views/:id/shares', () => {
  test('200 when the owner replaces shares, returning the persisted set', async () => {
    findAccessMock.mockResolvedValue({ ownerId: 'u1', access: 'owner' });
    replaceSharesMock.mockResolvedValue(undefined);
    getSharesMock.mockResolvedValue([
      { userId: 'u2', permission: 'read' },
      { userId: 'u3', permission: 'write' },
    ]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/views/sv-1/shares',
      headers: authHeader(),
      payload: {
        shares: [
          { userId: 'u2', permission: 'read' },
          { userId: 'u3', permission: 'write' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      shares: [
        { userId: 'u2', permission: 'read' },
        { userId: 'u3', permission: 'write' },
      ],
    });
    expect(replaceSharesMock).toHaveBeenCalledWith('sv-1', [
      { userId: 'u2', permission: 'read' },
      { userId: 'u3', permission: 'write' },
    ]);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'saved_view.shares_updated',
        details: expect.objectContaining({ counts: { shares: 2 } }),
      }),
    );
  });

  test('403 when a non-owner (write recipient) tries to manage shares', async () => {
    findAccessMock.mockResolvedValue({ ownerId: 'owner-x', access: 'write' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/views/sv-1/shares',
      headers: authHeader('u2'),
      payload: { shares: [{ userId: 'u3', permission: 'read' }] },
    });

    expect(res.statusCode).toBe(403);
    expect(replaceSharesMock).not.toHaveBeenCalled();
  });

  test('400 when a share has an invalid permission', async () => {
    findAccessMock.mockResolvedValue({ ownerId: 'u1', access: 'owner' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/views/sv-1/shares',
      headers: authHeader(),
      payload: { shares: [{ userId: 'u2', permission: 'admin' }] },
    });

    expect(res.statusCode).toBe(400);
    expect(replaceSharesMock).not.toHaveBeenCalled();
  });

  test('400 when a share recipient does not exist (FK violation → 400)', async () => {
    findAccessMock.mockResolvedValue({ ownerId: 'u1', access: 'owner' });
    replaceSharesMock.mockRejectedValue(
      makeDbError('23503', 'saved_view_shares_user_id_users_id_fk'),
    );

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/views/sv-1/shares',
      headers: authHeader(),
      payload: { shares: [{ userId: 'ghost', permission: 'read' }] },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('One or more share recipients do not exist');
  });

  test('404 when the view does not exist', async () => {
    findAccessMock.mockResolvedValue({ ownerId: null, access: null });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/views/ghost/shares',
      headers: authHeader(),
      payload: { shares: [] },
    });

    expect(res.statusCode).toBe(404);
    expect(replaceSharesMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/views/:id/shares', () => {
  test('200 for the owner', async () => {
    findAccessMock.mockResolvedValue({ ownerId: 'u1', access: 'owner' });
    getSharesMock.mockResolvedValue([{ userId: 'u2', permission: 'read' }]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/views/sv-1/shares',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ shares: [{ userId: 'u2', permission: 'read' }] });
  });

  test('403 for a non-owner', async () => {
    findAccessMock.mockResolvedValue({ ownerId: 'owner-x', access: 'write' });

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/views/sv-1/shares',
      headers: authHeader('u2'),
    });

    expect(res.statusCode).toBe(403);
    expect(getSharesMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/views/directory', () => {
  test('200 returns the minimal user list for any authenticated user', async () => {
    const directory = [
      { id: 'u1', name: 'Alice', username: 'alice', avatarInitials: 'AL' },
      { id: 'u2', name: 'Bob', username: 'bob', avatarInitials: 'BO' },
    ];
    listDirectoryMock.mockResolvedValue(directory);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/views/directory',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    // Only the minimal share-picker fields are surfaced (no PII beyond id/name/username/initials).
    expect(JSON.parse(res.body)).toEqual(directory);
    expect(listDirectoryMock).toHaveBeenCalled();
  });

  test('401 without a token (authenticated-only)', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/views/directory' });
    expect(res.statusCode).toBe(401);
    expect(listDirectoryMock).not.toHaveBeenCalled();
  });
});
