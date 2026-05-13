import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realClientProfileOptionsRepo from '../../repositories/clientProfileOptionsRepo.ts';
import * as realClientsRepo from '../../repositories/clientsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUserAssignmentsRepo from '../../repositories/userAssignmentsRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
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
const clientsRepoSnap = { ...realClientsRepo };
const clientProfileOptionsRepoSnap = { ...realClientProfileOptionsRepo };
const userAssignmentsRepoSnap = { ...realUserAssignmentsRepo };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

// clientsRepo
const listClientsMock = mock();
const findByFiscalCodeMock = mock();
const findByClientCodeMock = mock();
const findContactsForUpdateMock = mock();
const createClientMock = mock();
const updateClientMock = mock();
const deleteClientByIdMock = mock();

// clientProfileOptionsRepo
const cpoListByCategoryMock = mock();
const cpoFindByCategoryAndIdMock = mock();
const cpoFindByCategoryAndValueMock = mock();
const cpoGetNextSortOrderMock = mock();
const cpoCreateMock = mock();
const cpoUpdateMock = mock();
const cpoGetUsageCountMock = mock();
const cpoDeleteByIdMock = mock();

// userAssignmentsRepo
const assignClientToUserMock = mock(async () => undefined);
const assignClientToTopManagersMock = mock(async () => undefined);
const isClientAssignedToUserMock = mock();

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
  mock.module('../../repositories/clientsRepo.ts', () => ({
    ...clientsRepoSnap,
    list: listClientsMock,
    findByFiscalCode: findByFiscalCodeMock,
    findByClientCode: findByClientCodeMock,
    findContactsForUpdate: findContactsForUpdateMock,
    create: createClientMock,
    update: updateClientMock,
    deleteById: deleteClientByIdMock,
  }));
  mock.module('../../repositories/clientProfileOptionsRepo.ts', () => ({
    ...clientProfileOptionsRepoSnap,
    listByCategory: cpoListByCategoryMock,
    findByCategoryAndId: cpoFindByCategoryAndIdMock,
    findByCategoryAndValue: cpoFindByCategoryAndValueMock,
    getNextSortOrder: cpoGetNextSortOrderMock,
    create: cpoCreateMock,
    update: cpoUpdateMock,
    getUsageCount: cpoGetUsageCountMock,
    deleteById: cpoDeleteByIdMock,
  }));
  mock.module('../../repositories/userAssignmentsRepo.ts', () => ({
    ...userAssignmentsRepoSnap,
    assignClientToUser: assignClientToUserMock,
    assignClientToTopManagers: assignClientToTopManagersMock,
    isClientAssignedToUser: isClientAssignedToUserMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));

  routePlugin = (await import('../../routes/clients.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/clientsRepo.ts', () => clientsRepoSnap);
  mock.module('../../repositories/clientProfileOptionsRepo.ts', () => clientProfileOptionsRepoSnap);
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

const ALL_PERMS = [
  'crm.clients.view',
  'crm.clients_all.view',
  'crm.clients_all.create',
  'crm.clients_all.update',
  'crm.clients_all.delete',
  'crm.clients.create',
  'crm.clients.update',
  'crm.clients.delete',
];

const SAMPLE_CLIENT = {
  id: 'c-1',
  name: 'ACME',
  description: null,
  isDisabled: false,
  type: 'company',
  contacts: [],
  contactName: null,
  clientCode: 'ACME-01',
  email: null,
  phone: null,
  address: null,
  addressCountry: null,
  addressState: null,
  addressCap: null,
  addressProvince: null,
  addressCivicNumber: null,
  addressLine: null,
  atecoCode: null,
  website: null,
  sector: null,
  numberOfEmployees: null,
  revenue: null,
  fiscalCode: 'IT12345678901',
  officeCountRange: null,
  totalSentQuotes: 0,
  totalAcceptedOrders: 0,
  vatNumber: 'IT12345678901',
  taxCode: 'IT12345678901',
  createdAt: 1_700_000_000_000,
};

const SAMPLE_PROFILE_OPTION = {
  id: 'cpo-1',
  category: 'sector' as const,
  value: 'Tech',
  sortOrder: 1,
  usageCount: 0,
  createdAt: 1_700_000_000_000,
  updatedAt: null,
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  listClientsMock,
  findByFiscalCodeMock,
  findByClientCodeMock,
  findContactsForUpdateMock,
  createClientMock,
  updateClientMock,
  deleteClientByIdMock,
  cpoListByCategoryMock,
  cpoFindByCategoryAndIdMock,
  cpoFindByCategoryAndValueMock,
  cpoGetNextSortOrderMock,
  cpoCreateMock,
  cpoUpdateMock,
  cpoGetUsageCountMock,
  cpoDeleteByIdMock,
  assignClientToUserMock,
  assignClientToTopManagersMock,
  isClientAssignedToUserMock,
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
  assignClientToUserMock.mockImplementation(async () => undefined);
  assignClientToTopManagersMock.mockImplementation(async () => undefined);
  isClientAssignedToUserMock.mockResolvedValue(true);

  testApp = await buildRouteTestApp(routePlugin, '/api/clients');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('GET /api/clients', () => {
  test('200 with clients_all.view → calls list({canViewAllClients: true})', async () => {
    listClientsMock.mockResolvedValue([SAMPLE_CLIENT]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/clients',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('c-1');
    expect(listClientsMock).toHaveBeenCalledWith({ canViewAllClients: true });
  });

  test('200 without clients_all.view → list scoped to viewer.id and full details visible', async () => {
    getRolePermissionsMock.mockResolvedValue(['crm.clients.view']);
    listClientsMock.mockResolvedValue([SAMPLE_CLIENT]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/clients',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(listClientsMock).toHaveBeenCalledWith({ canViewAllClients: false, userId: 'u1' });
    const body = JSON.parse(res.body);
    // crm.clients.view is granted, so full details remain
    expect(body[0].clientCode).toBe('ACME-01');
  });

  test('200 viewer with only timesheets perm → minimal fields only, schema-clean', async () => {
    getRolePermissionsMock.mockResolvedValue(['timesheets.tracker.view']);
    listClientsMock.mockResolvedValue([SAMPLE_CLIENT]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/clients',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // Summary arm: only id, name, description. The Fastify response schema (oneOf) must
    // serialize this shape cleanly, including stripping fields not declared in the summary.
    expect(body[0]).toEqual({ id: 'c-1', name: 'ACME', description: null });
    expect(Object.keys(body[0]).sort()).toEqual(['description', 'id', 'name']);
  });

  test('200 viewer with crm.clients.view → full client arm passes response schema', async () => {
    getRolePermissionsMock.mockResolvedValue(['crm.clients.view']);
    listClientsMock.mockResolvedValue([SAMPLE_CLIENT]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/clients',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // Full arm: must include the declared fields. createdAt is required for the full client.
    expect(body[0].id).toBe('c-1');
    expect(body[0].createdAt).toBeDefined();
    expect(body[0].contacts).toBeDefined();
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/clients' });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing any required permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/clients',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/clients', () => {
  const validBody = {
    name: 'ACME',
    clientCode: 'ACME-01',
    fiscalCode: 'IT12345678901',
  };

  test('201 happy path creates, assigns user + top managers, audits', async () => {
    findByFiscalCodeMock.mockResolvedValue(false);
    findByClientCodeMock.mockResolvedValue(false);
    createClientMock.mockResolvedValue(SAMPLE_CLIENT);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients',
      headers: authHeader(),
      payload: validBody,
    });

    expect(res.statusCode).toBe(201);
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(assignClientToUserMock).toHaveBeenCalledWith('u1', expect.any(String));
    expect(assignClientToTopManagersMock).toHaveBeenCalledWith(expect.any(String));
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'client.created', entityType: 'client' }),
    );
  });

  test('201 generated id keeps c- prefix and is a UUID (no Date.now collision risk)', async () => {
    findByFiscalCodeMock.mockResolvedValue(false);
    findByClientCodeMock.mockResolvedValue(false);
    createClientMock.mockImplementation(async (entry: { id: string }) => ({
      ...SAMPLE_CLIENT,
      id: entry.id,
    }));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients',
      headers: authHeader(),
      payload: validBody,
    });

    expect(res.statusCode).toBe(201);
    expect(createClientMock).toHaveBeenCalledTimes(1);
    const id = createClientMock.mock.calls[0][0].id as string;
    expect(id).toMatch(/^c-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  test('201 back-to-back creates produce unique ids', async () => {
    findByFiscalCodeMock.mockResolvedValue(false);
    findByClientCodeMock.mockResolvedValue(false);
    createClientMock.mockImplementation(async (entry: { id: string }) => ({
      ...SAMPLE_CLIENT,
      id: entry.id,
    }));

    const results = await Promise.all([
      testApp.inject({
        method: 'POST',
        url: '/api/clients',
        headers: authHeader(),
        payload: validBody,
      }),
      testApp.inject({
        method: 'POST',
        url: '/api/clients',
        headers: authHeader(),
        payload: validBody,
      }),
      testApp.inject({
        method: 'POST',
        url: '/api/clients',
        headers: authHeader(),
        payload: validBody,
      }),
    ]);

    for (const r of results) expect(r.statusCode).toBe(201);
    // Guard the Set/array length check below: without this, `new Set([]).size === [].length`
    // would pass vacuously if the mock was never called.
    expect(createClientMock).toHaveBeenCalledTimes(3);
    const ids = createClientMock.mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('201 accepts crm.clients_all.create without base create', async () => {
    getRolePermissionsMock.mockResolvedValue(['crm.clients_all.create']);
    findByFiscalCodeMock.mockResolvedValue(false);
    findByClientCodeMock.mockResolvedValue(false);
    createClientMock.mockResolvedValue(SAMPLE_CLIENT);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients',
      headers: authHeader(),
      payload: validBody,
    });

    expect(res.statusCode).toBe(201);
    expect(createClientMock).toHaveBeenCalledTimes(1);
  });

  test('400 whitespace-only name (handler validation)', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients',
      headers: authHeader(),
      payload: { name: '   ', clientCode: 'ACME-01', fiscalCode: 'IT12345678901' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'name is required' });
  });

  test('400 missing fiscal code', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients',
      headers: authHeader(),
      payload: { name: 'ACME', clientCode: 'ACME-01' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Fiscal code is required' });
  });

  test('400 duplicate fiscal code', async () => {
    findByFiscalCodeMock.mockResolvedValue(true);
    findByClientCodeMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients',
      headers: authHeader(),
      payload: validBody,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Fiscal code already exists' });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  test('400 duplicate client code', async () => {
    findByFiscalCodeMock.mockResolvedValue(false);
    findByClientCodeMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients',
      headers: authHeader(),
      payload: validBody,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Client ID already exists' });
  });

  test('400 unique violation from create maps to friendly error', async () => {
    findByFiscalCodeMock.mockResolvedValue(false);
    findByClientCodeMock.mockResolvedValue(false);
    createClientMock.mockRejectedValue(makeDbError('23505', 'idx_clients_client_code_unique'));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients',
      headers: authHeader(),
      payload: validBody,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Client ID already exists' });
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients',
      payload: validBody,
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing crm.clients.create permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['crm.clients.view']);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients',
      headers: authHeader(),
      payload: validBody,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /api/clients/:id', () => {
  test('200 happy update emits client.updated audit', async () => {
    findContactsForUpdateMock.mockResolvedValue({ contacts: [] });
    updateClientMock.mockResolvedValue({ ...SAMPLE_CLIENT, name: 'Renamed' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients/c-1',
      headers: authHeader(),
      payload: { name: 'Renamed' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateClientMock).toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'client.updated' }),
    );
  });

  test('200 isDisabled=true alone audits as client.disabled', async () => {
    findContactsForUpdateMock.mockResolvedValue({ contacts: [] });
    updateClientMock.mockResolvedValue({ ...SAMPLE_CLIENT, isDisabled: true });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients/c-1',
      headers: authHeader(),
      payload: { isDisabled: true },
    });

    expect(res.statusCode).toBe(200);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'client.disabled' }),
    );
  });

  test('200 isDisabled=false alone audits as client.enabled', async () => {
    findContactsForUpdateMock.mockResolvedValue({ contacts: [] });
    updateClientMock.mockResolvedValue({ ...SAMPLE_CLIENT, isDisabled: false });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients/c-1',
      headers: authHeader(),
      payload: { isDisabled: false },
    });

    expect(res.statusCode).toBe(200);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'client.enabled' }),
    );
  });

  test('200 crm.clients_all.update bypasses assigned-client check', async () => {
    getRolePermissionsMock.mockResolvedValue(['crm.clients_all.update']);
    isClientAssignedToUserMock.mockResolvedValue(false);
    findContactsForUpdateMock.mockResolvedValue({ contacts: [] });
    updateClientMock.mockResolvedValue({ ...SAMPLE_CLIENT, name: 'Renamed' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients/c-1',
      headers: authHeader(),
      payload: { name: 'Renamed' },
    });

    expect(res.statusCode).toBe(200);
    expect(isClientAssignedToUserMock).not.toHaveBeenCalled();
    expect(updateClientMock).toHaveBeenCalled();
  });

  test('404 when current client missing', async () => {
    findContactsForUpdateMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients/missing',
      headers: authHeader(),
      payload: { name: 'Foo' },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Client not found' });
  });

  test('400 whitespace-only name', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients/c-1',
      headers: authHeader(),
      payload: { name: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'name is required' });
  });

  test('400 fiscal duplicate', async () => {
    findContactsForUpdateMock.mockResolvedValue({ contacts: [] });
    findByFiscalCodeMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients/c-1',
      headers: authHeader(),
      payload: { fiscalCode: 'IT99999999999' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Fiscal code already exists' });
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients/c-1',
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing crm.clients.update permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['crm.clients.view']);
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients/c-1',
      headers: authHeader(),
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(403);
  });

  test('403 when scoped updater is not assigned to client', async () => {
    getRolePermissionsMock.mockResolvedValue(['crm.clients.view', 'crm.clients.update']);
    isClientAssignedToUserMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients/c-1',
      headers: authHeader(),
      payload: { name: 'X' },
    });

    expect(res.statusCode).toBe(403);
    expect(findContactsForUpdateMock).not.toHaveBeenCalled();
    expect(updateClientMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/clients/:id', () => {
  test('204 happy + audit', async () => {
    deleteClientByIdMock.mockResolvedValue({ id: 'c-1', name: 'ACME', clientCode: 'ACME-01' });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/clients/c-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'client.deleted', entityId: 'c-1' }),
    );
  });

  test('204 crm.clients_all.delete bypasses assigned-client check', async () => {
    getRolePermissionsMock.mockResolvedValue(['crm.clients_all.delete']);
    isClientAssignedToUserMock.mockResolvedValue(false);
    deleteClientByIdMock.mockResolvedValue({ id: 'c-1', name: 'ACME', clientCode: 'ACME-01' });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/clients/c-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(isClientAssignedToUserMock).not.toHaveBeenCalled();
    expect(deleteClientByIdMock).toHaveBeenCalledWith('c-1');
  });

  test('404 not found', async () => {
    deleteClientByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/clients/missing',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Client not found' });
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'DELETE', url: '/api/clients/c-1' });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing crm.clients.delete', async () => {
    getRolePermissionsMock.mockResolvedValue(['crm.clients.view']);
    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/clients/c-1',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });

  test('403 when scoped deleter is not assigned to client', async () => {
    getRolePermissionsMock.mockResolvedValue(['crm.clients.view', 'crm.clients.delete']);
    isClientAssignedToUserMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/clients/c-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(403);
    expect(deleteClientByIdMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/clients/profile-options/:category', () => {
  test('200 returns options for valid category', async () => {
    cpoListByCategoryMock.mockResolvedValue([SAMPLE_PROFILE_OPTION]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/clients/profile-options/sector',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveLength(1);
    expect(cpoListByCategoryMock).toHaveBeenCalledWith('sector');
  });

  test('400 invalid category caught by Fastify schema (enum)', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/clients/profile-options/invalid',
      headers: authHeader(),
    });
    // Fastify schema rejects with 400 before handler runs
    expect(res.statusCode).toBe(400);
    expect(cpoListByCategoryMock).not.toHaveBeenCalled();
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/clients/profile-options/sector',
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing crm.clients view permissions', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/clients/profile-options/sector',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/clients/profile-options/:category', () => {
  test('201 creates new profile option', async () => {
    cpoFindByCategoryAndValueMock.mockResolvedValue(false);
    cpoGetNextSortOrderMock.mockResolvedValue(2);
    cpoCreateMock.mockResolvedValue({ ...SAMPLE_PROFILE_OPTION, value: 'Finance', sortOrder: 2 });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients/profile-options/sector',
      headers: authHeader(),
      payload: { value: 'Finance' },
    });

    expect(res.statusCode).toBe(201);
    expect(cpoCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'sector', value: 'Finance', sortOrder: 2 }),
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'client.profile_option.created' }),
    );
  });

  test('400 duplicate value for category', async () => {
    cpoFindByCategoryAndValueMock.mockResolvedValue(true);
    cpoGetNextSortOrderMock.mockResolvedValue(1);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients/profile-options/sector',
      headers: authHeader(),
      payload: { value: 'Tech' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Option with this value already exists for this category',
    });
    expect(cpoCreateMock).not.toHaveBeenCalled();
  });

  test('400 missing value', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients/profile-options/sector',
      headers: authHeader(),
      payload: { value: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'value is required' });
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients/profile-options/sector',
      payload: { value: 'Tech' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing crm.clients.update', async () => {
    getRolePermissionsMock.mockResolvedValue(['crm.clients.view']);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients/profile-options/sector',
      headers: authHeader(),
      payload: { value: 'Tech' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /api/clients/profile-options/:category/:id', () => {
  test('200 updates profile option', async () => {
    cpoFindByCategoryAndIdMock.mockResolvedValue({ id: 'cpo-1', value: 'Tech' });
    cpoFindByCategoryAndValueMock.mockResolvedValue(false);
    cpoUpdateMock.mockResolvedValue({ ...SAMPLE_PROFILE_OPTION, value: 'Tech v2' });
    withDbTransactionMock.mockImplementation(async (cb) => cb(undefined));

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients/profile-options/sector/cpo-1',
      headers: authHeader(),
      payload: { value: 'Tech v2' },
    });

    expect(res.statusCode).toBe(200);
    expect(cpoUpdateMock).toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'client.profile_option.updated' }),
    );
  });

  test('404 when option not found', async () => {
    cpoFindByCategoryAndIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients/profile-options/sector/missing',
      headers: authHeader(),
      payload: { value: 'X' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Profile option not found' });
  });

  test('400 duplicate value collision with another row', async () => {
    cpoFindByCategoryAndIdMock.mockResolvedValue({ id: 'cpo-1', value: 'Tech' });
    cpoFindByCategoryAndValueMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients/profile-options/sector/cpo-1',
      headers: authHeader(),
      payload: { value: 'Other' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Option with this value already exists for this category',
    });
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients/profile-options/sector/cpo-1',
      payload: { value: 'X' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('DELETE /api/clients/profile-options/:category/:id', () => {
  test('204 deletes profile option when unused', async () => {
    cpoFindByCategoryAndIdMock.mockResolvedValue({ id: 'cpo-1', value: 'Tech' });
    cpoGetUsageCountMock.mockResolvedValue(0);
    cpoDeleteByIdMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/clients/profile-options/sector/cpo-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'client.profile_option.deleted' }),
    );
  });

  test('404 when option not found', async () => {
    cpoFindByCategoryAndIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/clients/profile-options/sector/missing',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Profile option not found' });
  });

  test('409 when option still in use', async () => {
    cpoFindByCategoryAndIdMock.mockResolvedValue({ id: 'cpo-1', value: 'Tech' });
    cpoGetUsageCountMock.mockResolvedValue(3);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/clients/profile-options/sector/cpo-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Cannot delete option "Tech" because it is used by 3 client(s)',
    });
    expect(cpoDeleteByIdMock).not.toHaveBeenCalled();
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/clients/profile-options/sector/cpo-1',
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing crm.clients.update', async () => {
    getRolePermissionsMock.mockResolvedValue(['crm.clients.view']);
    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/clients/profile-options/sector/cpo-1',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});
