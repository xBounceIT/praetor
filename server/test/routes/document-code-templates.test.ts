import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realRepo from '../../repositories/documentCodeTemplatesRepo.ts';
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

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const repoSnap = { ...realRepo };
const auditSnap = { ...realAudit };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const listMock = mock();
const upsertManyMock = mock();
const logAuditMock = mock(async () => undefined);

let routePlugin: FastifyPluginAsync;

const TEMPLATES = [
  {
    moduleId: 'client_quote',
    label: 'Client quotes',
    prefix: 'PREV',
    template: '{PREFIX}_{YY}_{SEQ}',
    sequencePadding: 4,
  },
  {
    moduleId: 'client_invoice',
    label: 'Client invoices',
    prefix: 'INV',
    template: '{PREFIX}-{YYYY}-{SEQ}',
    sequencePadding: 5,
  },
];

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
  mock.module('../../repositories/documentCodeTemplatesRepo.ts', () => ({
    ...repoSnap,
    list: listMock,
    upsertMany: upsertManyMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));

  routePlugin = (await import('../../routes/document-code-templates.ts')).default;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/documentCodeTemplatesRepo.ts', () => repoSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
});

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'admin',
  avatarInitials: 'AL',
  isDisabled: false,
  sessionVersion: 1,
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  listMock,
  upsertManyMock,
  logAuditMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue([
    'administration.general.view',
    'administration.general.update',
  ]);
  listMock.mockResolvedValue(TEMPLATES);
  upsertManyMock.mockResolvedValue(TEMPLATES);
  logAuditMock.mockResolvedValue(undefined);

  testApp = await buildRouteTestApp(routePlugin, '/api/document-code-templates');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('GET /api/document-code-templates', () => {
  test('200 returns templates with previews', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/document-code-templates',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body[0]).toEqual(
      expect.objectContaining({
        moduleId: 'client_quote',
        preview: expect.stringMatching(/^PREV_\d{2}_0001$/),
      }),
    );
    expect(body[1].preview).toMatch(/^INV-\d{4}-00001$/);
  });

  test('403 without administration.general.view', async () => {
    getRolePermissionsMock.mockResolvedValue(['administration.general.update']);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/document-code-templates',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /api/document-code-templates', () => {
  test('200 validates and upserts templates', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/document-code-templates',
      headers: authHeader(),
      payload: {
        templates: [
          {
            moduleId: 'client_invoice',
            prefix: 'FT',
            template: '{PREFIX}/{YYYY}/{SEQ}',
            sequencePadding: 6,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(upsertManyMock).toHaveBeenCalledWith([
      {
        moduleId: 'client_invoice',
        prefix: 'FT',
        template: '{PREFIX}/{YYYY}/{SEQ}',
        sequencePadding: 6,
      },
    ]);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'settings.document_codes.updated',
        entityType: 'settings',
      }),
    );
  });

  test('400 rejects invalid templates', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/document-code-templates',
      headers: authHeader(),
      payload: {
        templates: [
          {
            moduleId: 'client_invoice',
            prefix: 'FT',
            template: '{PREFIX}/{YYYY}',
            sequencePadding: 4,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('template must include {SEQ}');
    expect(upsertManyMock).not.toHaveBeenCalled();
  });

  test('400 rejects duplicate module updates', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/document-code-templates',
      headers: authHeader(),
      payload: {
        templates: [
          {
            moduleId: 'client_invoice',
            prefix: 'INV',
            template: '{PREFIX}_{YY}_{SEQ}',
            sequencePadding: 4,
          },
          {
            moduleId: 'client_invoice',
            prefix: 'FT',
            template: '{PREFIX}_{YYYY}_{SEQ}',
            sequencePadding: 4,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('duplicate moduleId');
  });

  test('403 without administration.general.update', async () => {
    getRolePermissionsMock.mockResolvedValue(['administration.general.view']);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/document-code-templates',
      headers: authHeader(),
      payload: { templates: [] },
    });

    expect(res.statusCode).toBe(403);
  });
});
