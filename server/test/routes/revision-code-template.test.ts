import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realRevisionCodeTemplateRepo from '../../repositories/revisionCodeTemplateRepo.ts';
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
const templateRepoSnap = { ...realRevisionCodeTemplateRepo };
const auditSnap = { ...realAudit };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();
const getTemplateMock = mock();
const upsertTemplateMock = mock();
const logAuditMock = mock(async () => undefined);

let routePlugin: FastifyPluginAsync;
let testApp: FastifyInstance;

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
  mock.module('../../repositories/revisionCodeTemplateRepo.ts', () => ({
    ...templateRepoSnap,
    get: getTemplateMock,
    upsert: upsertTemplateMock,
  }));
  mock.module('../../utils/audit.ts', () => ({ ...auditSnap, logAudit: logAuditMock }));
  routePlugin = (await import('../../routes/revision-code-template.ts'))
    .default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/revisionCodeTemplateRepo.ts', () => templateRepoSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
});

beforeEach(async () => {
  for (const fn of [
    findAuthUserByIdMock,
    userHasRoleMock,
    getRolePermissionsMock,
    getTemplateMock,
    upsertTemplateMock,
    logAuditMock,
  ]) {
    fn.mockReset();
  }
  findAuthUserByIdMock.mockResolvedValue({
    id: 'u1',
    name: 'Alice',
    username: 'alice',
    role: 'admin',
    avatarInitials: 'AL',
    isDisabled: false,
    sessionVersion: 1,
  });
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue([
    'administration.general.view',
    'administration.general.update',
  ]);
  getTemplateMock.mockResolvedValue({
    prefix: 'REV',
    template: '{PREFIX}{SEQ}',
    sequencePadding: 1,
  });
  upsertTemplateMock.mockImplementation((value) => Promise.resolve(value));
  logAuditMock.mockImplementation(async () => undefined);
  testApp = await buildRouteTestApp(routePlugin, '/api/revision-code-template');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('/api/revision-code-template', () => {
  test('GET returns the immutable-code preview', async () => {
    const response = await testApp.inject({
      method: 'GET',
      url: '/api/revision-code-template',
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      prefix: 'REV',
      template: '{PREFIX}{SEQ}',
      sequencePadding: 1,
      preview: 'REV1',
    });
  });

  test('PUT requires {SEQ}, saves valid future settings and audits the change', async () => {
    const invalid = await testApp.inject({
      method: 'PUT',
      url: '/api/revision-code-template',
      headers: authHeader(),
      payload: { prefix: 'REV', template: '{PREFIX}', sequencePadding: 1 },
    });
    expect(invalid.statusCode).toBe(400);
    expect(upsertTemplateMock).not.toHaveBeenCalled();

    const valid = await testApp.inject({
      method: 'PUT',
      url: '/api/revision-code-template',
      headers: authHeader(),
      payload: { prefix: 'R', template: '{PREFIX}-{SEQ}', sequencePadding: 3 },
    });

    expect(valid.statusCode).toBe(200);
    expect(JSON.parse(valid.body).preview).toBe('R-001');
    expect(upsertTemplateMock).toHaveBeenCalledWith({
      prefix: 'R',
      template: '{PREFIX}-{SEQ}',
      sequencePadding: 3,
    });
    expect(logAuditMock).toHaveBeenCalled();
  });

  test('enforces the administration view permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const response = await testApp.inject({
      method: 'GET',
      url: '/api/revision-code-template',
      headers: authHeader(),
    });
    expect(response.statusCode).toBe(403);
  });
});
