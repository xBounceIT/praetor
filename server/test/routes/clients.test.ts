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
import { TX_SENTINEL } from '../helpers/txSentinel.ts';
import { makeWithDbTransactionMock } from '../helpers/withDbTransactionMock.ts';

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
const findExistingIdentifiersMock = mock();
const findContactsForUpdateMock = mock();
const createClientMock = mock();
const updateClientMock = mock();
const deleteClientByIdMock = mock();

// clientProfileOptionsRepo
const cpoListByCategoryMock = mock();
const cpoListValuesMock = mock();
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
  mock.module('../../repositories/clientsRepo.ts', () => ({
    ...clientsRepoSnap,
    list: listClientsMock,
    findByFiscalCode: findByFiscalCodeMock,
    findByClientCode: findByClientCodeMock,
    findExistingIdentifiers: findExistingIdentifiersMock,
    findContactsForUpdate: findContactsForUpdateMock,
    create: createClientMock,
    update: updateClientMock,
    deleteById: deleteClientByIdMock,
  }));
  mock.module('../../repositories/clientProfileOptionsRepo.ts', () => ({
    ...clientProfileOptionsRepoSnap,
    listByCategory: cpoListByCategoryMock,
    listValues: cpoListValuesMock,
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
  sessionVersion: 1,
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
  findExistingIdentifiersMock,
  findContactsForUpdateMock,
  createClientMock,
  updateClientMock,
  deleteClientByIdMock,
  cpoListByCategoryMock,
  cpoListValuesMock,
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
  resetWithDbTransactionMock();
  logAuditMock.mockImplementation(async () => undefined);
  assignClientToUserMock.mockImplementation(async () => undefined);
  assignClientToTopManagersMock.mockImplementation(async () => undefined);
  isClientAssignedToUserMock.mockResolvedValue(true);
  cpoListByCategoryMock.mockResolvedValue([]);
  cpoListValuesMock.mockResolvedValue([]);
  findExistingIdentifiersMock.mockResolvedValue({
    clientCodes: new Set<string>(),
    fiscalCodes: new Set<string>(),
  });

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

  test('200 viewer with only sales.supplier_quotes.view can list clients (#759)', async () => {
    // The supplier-quotes view needs the client list for its optional Cliente select; the
    // frontend canListClients preload gate relies on this server-side authorization.
    getRolePermissionsMock.mockResolvedValue(['sales.supplier_quotes.view']);
    listClientsMock.mockResolvedValue([SAMPLE_CLIENT]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/clients',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // Non-crm viewer → summary arm (id, name, description only).
    expect(body[0]).toEqual({ id: 'c-1', name: 'ACME', description: null });
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
    expect(assignClientToUserMock).toHaveBeenCalledWith(
      'u1',
      expect.any(String),
      undefined,
      TX_SENTINEL,
    );
    expect(assignClientToTopManagersMock).toHaveBeenCalledWith(expect.any(String), TX_SENTINEL);
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

  test('201 POST with taxCode only populates fiscal_code shadow from taxCode', async () => {
    // No vatNumber, no fiscalCode — resolveFiscalCode falls through to taxCode.
    findByFiscalCodeMock.mockResolvedValue(false);
    findByClientCodeMock.mockResolvedValue(false);
    createClientMock.mockResolvedValue(SAMPLE_CLIENT);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients',
      headers: authHeader(),
      payload: {
        name: 'ACME',
        clientCode: 'ACME-01',
        taxCode: 'RSSMRO80A01H501Z',
      },
    });

    expect(res.statusCode).toBe(201);
    const entry = createClientMock.mock.calls[0][0] as {
      fiscalCode: string;
      vatNumber: string | null;
      taxCode: string | null;
    };
    expect(entry.fiscalCode).toBe('RSSMRO80A01H501Z');
    expect(entry.vatNumber).toBeNull();
    expect(entry.taxCode).toBe('RSSMRO80A01H501Z');
  });

  test('201 POST with all three identifiers uses vatNumber as the fiscal_code primary', async () => {
    // vatNumber takes precedence in resolveFiscalCode; vat_number / tax_code are stored
    // independently.
    findByFiscalCodeMock.mockResolvedValue(false);
    findByClientCodeMock.mockResolvedValue(false);
    createClientMock.mockResolvedValue(SAMPLE_CLIENT);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients',
      headers: authHeader(),
      payload: {
        name: 'ACME',
        clientCode: 'ACME-01',
        vatNumber: 'IT01234567890',
        fiscalCode: 'IT99999999999',
        taxCode: 'RSSMRO80A01H501Z',
      },
    });

    expect(res.statusCode).toBe(201);
    const entry = createClientMock.mock.calls[0][0] as {
      fiscalCode: string;
      vatNumber: string | null;
      taxCode: string | null;
    };
    // resolveFiscalCode = vatNumber || fiscalCode || taxCode → vatNumber wins.
    expect(entry.fiscalCode).toBe('IT01234567890');
    expect(entry.vatNumber).toBe('IT01234567890');
    expect(entry.taxCode).toBe('RSSMRO80A01H501Z');
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

  test('canonicalizes configured profile values case-insensitively for single creation', async () => {
    cpoListValuesMock.mockResolvedValue([{ category: 'sector', value: 'Technology' }]);
    findByFiscalCodeMock.mockResolvedValue(false);
    findByClientCodeMock.mockResolvedValue(false);
    createClientMock.mockImplementation(async (entry: Record<string, unknown>) => ({
      ...SAMPLE_CLIENT,
      ...entry,
    }));

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/clients',
      headers: authHeader(),
      payload: { ...validBody, sector: ' technology ' },
    });

    expect(response.statusCode).toBe(201);
    expect(createClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ sector: 'Technology' }),
      TX_SENTINEL,
    );
  });

  test('rejects an unknown configured profile value for single creation', async () => {
    const response = await testApp.inject({
      method: 'POST',
      url: '/api/clients',
      headers: authHeader(),
      payload: { ...validBody, sector: 'Unknown' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: 'sector must match an existing client profile option',
    });
    expect(createClientMock).not.toHaveBeenCalled();
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

  test('500: failing auto-assignment rolls back client insert (atomic)', async () => {
    // Simulate a real transaction: if the callback rejects, nothing is committed.
    // The fake `withDbTransaction` here runs the callback and lets the rejection
    // propagate — that's the same shape `db.transaction` exposes for callers, so
    // the route's behavior on rollback is what we're asserting.
    findByFiscalCodeMock.mockResolvedValue(false);
    findByClientCodeMock.mockResolvedValue(false);
    let createInvoked = false;
    createClientMock.mockImplementation(async () => {
      createInvoked = true;
      return SAMPLE_CLIENT;
    });
    assignClientToTopManagersMock.mockImplementation(async () => {
      throw new Error('boom');
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients',
      headers: authHeader(),
      payload: validBody,
    });

    // Failing assignment propagates → 500. The whole block was inside
    // `withDbTransaction`, so a real DB would have rolled back the client insert.
    expect(res.statusCode).toBe(500);
    expect(withDbTransactionMock).toHaveBeenCalledTimes(1);
    expect(createInvoked).toBe(true);
    // Audit log lives after the awaited transaction, so a failed txn must skip it.
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/clients/bulk', () => {
  const validRows = [
    { clientCode: 'CLI-1', name: 'Alpha', fiscalCode: 'IT001' },
    { clientCode: 'CLI-2', name: 'Beta', fiscalCode: 'IT002' },
  ];

  const mockCreatedClients = () => {
    createClientMock.mockImplementation(async (entry: Record<string, unknown>) => ({
      ...SAMPLE_CLIENT,
      ...entry,
    }));
  };

  test('401 without a token and 403 without crm.clients.create', async () => {
    const unauthorized = await testApp.inject({
      method: 'POST',
      url: '/api/clients/bulk',
      payload: { clients: validRows },
    });
    expect(unauthorized.statusCode).toBe(401);

    getRolePermissionsMock.mockResolvedValue(['crm.clients.view']);
    const forbidden = await testApp.inject({
      method: 'POST',
      url: '/api/clients/bulk',
      headers: authHeader(),
      payload: { clients: validRows },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  test('400 for an empty batch or more than 500 rows', async () => {
    const empty = await testApp.inject({
      method: 'POST',
      url: '/api/clients/bulk',
      headers: authHeader(),
      payload: { clients: [] },
    });
    expect(empty.statusCode).toBe(400);

    const overLimit = await testApp.inject({
      method: 'POST',
      url: '/api/clients/bulk',
      headers: authHeader(),
      payload: {
        clients: Array.from({ length: 501 }, (_, index) => ({
          ...validRows[0],
          clientCode: `CLI-${index}`,
        })),
      },
    });
    expect(overLimit.statusCode).toBe(400);
    expect(findExistingIdentifiersMock).not.toHaveBeenCalled();
  });

  test('normalizes values, creates one primary contact, composes the address, and canonicalizes profile values', async () => {
    cpoListValuesMock.mockResolvedValue([{ category: 'sector', value: 'Technology' }]);
    mockCreatedClients();

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/clients/bulk',
      headers: authHeader(),
      payload: {
        clients: [
          {
            clientCode: ' CLI-1 ',
            name: ' Alpha ',
            fiscalCode: ' IT001 ',
            type: '',
            contactName: ' Mario Rossi ',
            contactRole: ' Acquisti ',
            email: ' mario@example.com ',
            addressLine: ' Via Roma ',
            addressCivicNumber: ' 1 ',
            addressCap: ' 00100 ',
            addressState: ' Roma ',
            addressProvince: ' RM ',
            addressCountry: ' Italia ',
            sector: ' technology ',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).summary).toEqual({ total: 1, succeeded: 1, failed: 0 });
    expect(createClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientCode: 'CLI-1',
        name: 'Alpha',
        fiscalCode: 'IT001',
        type: 'company',
        sector: 'Technology',
        contactName: 'Mario Rossi',
        contacts: [
          {
            fullName: 'Mario Rossi',
            role: 'Acquisti',
            email: 'mario@example.com',
            phone: undefined,
          },
        ],
        address: 'Via Roma 1, 00100 Roma (RM), Italia',
      }),
      TX_SENTINEL,
    );
  });

  test('returns all validation errors for a row, including contact and profile errors', async () => {
    const response = await testApp.inject({
      method: 'POST',
      url: '/api/clients/bulk',
      headers: authHeader(),
      payload: {
        clients: [
          {
            clientCode: 'bad code',
            name: ' ',
            fiscalCode: 'IT001',
            type: 'other',
            email: 'not-an-email',
            phone: '123',
            sector: 'Missing option',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.summary).toEqual({ total: 1, succeeded: 0, failed: 1 });
    expect(body.results[0].errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'clientCode' }),
        expect.objectContaining({ field: 'name' }),
        expect.objectContaining({ field: 'type' }),
        expect.objectContaining({ field: 'email' }),
        expect.objectContaining({ field: 'contactName', code: 'required' }),
        expect.objectContaining({ field: 'sector', code: 'unknown_option' }),
      ]),
    );
    expect(createClientMock).not.toHaveBeenCalled();
  });

  test('matches client codes case-sensitively and fiscal codes case-insensitively', async () => {
    findExistingIdentifiersMock.mockResolvedValue({
      clientCodes: new Set(['EXISTING']),
      fiscalCodes: new Set(['it-existing']),
    });
    const response = await testApp.inject({
      method: 'POST',
      url: '/api/clients/bulk',
      headers: authHeader(),
      payload: {
        clients: [
          { clientCode: 'DUP', name: 'One', fiscalCode: 'DUP-FISCAL' },
          { clientCode: 'dup', name: 'Two', fiscalCode: 'dup-fiscal' },
          { clientCode: 'EXISTING', name: 'Three', fiscalCode: 'IT-EXISTING' },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.summary).toEqual({ total: 3, succeeded: 0, failed: 3 });
    expect(body.results[0].errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'fiscalCode', code: 'duplicate' })]),
    );
    expect(body.results[0].errors).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'clientCode' })]),
    );
    expect(body.results[1].errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'fiscalCode', code: 'duplicate' })]),
    );
    expect(body.results[1].errors).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'clientCode' })]),
    );
    expect(body.results[2].errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'clientCode', code: 'duplicate' }),
        expect.objectContaining({ field: 'fiscalCode', code: 'duplicate' }),
      ]),
    );
    expect(createClientMock).not.toHaveBeenCalled();
  });

  test('keeps input order, commits valid rows independently, and audits only successes', async () => {
    mockCreatedClients();
    assignClientToTopManagersMock
      .mockImplementationOnce(async () => {
        throw new Error('assignment failed');
      })
      .mockImplementation(async () => undefined);

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/clients/bulk',
      headers: authHeader(),
      payload: { clients: validRows },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.summary).toEqual({ total: 2, succeeded: 1, failed: 1 });
    expect(body.results).toEqual([
      expect.objectContaining({ index: 0, success: false }),
      expect.objectContaining({ index: 1, success: true }),
    ]);
    expect(withDbTransactionMock).toHaveBeenCalledTimes(2);
    expect(assignClientToUserMock).toHaveBeenCalledTimes(2);
    expect(assignClientToTopManagersMock).toHaveBeenCalledTimes(2);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'client.created' }),
    );
  });

  test('bounds concurrent row transactions while preserving all results', async () => {
    let activeCreates = 0;
    let maxActiveCreates = 0;
    createClientMock.mockImplementation(async (entry: Record<string, unknown>) => {
      activeCreates += 1;
      maxActiveCreates = Math.max(maxActiveCreates, activeCreates);
      await Promise.resolve();
      activeCreates -= 1;
      return { ...SAMPLE_CLIENT, ...entry };
    });
    const clients = Array.from({ length: 12 }, (_, index) => ({
      clientCode: `CLI-${index}`,
      name: `Client ${index}`,
      fiscalCode: `IT${index}`,
    }));

    const response = await testApp.inject({
      method: 'POST',
      url: '/api/clients/bulk',
      headers: authHeader(),
      payload: { clients },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).summary).toEqual({ total: 12, succeeded: 12, failed: 0 });
    expect(maxActiveCreates).toBe(10);
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

  test('200 taxCode-only PUT preserves fiscal_code shadow (does NOT clobber vat_number-derived value)', async () => {
    // Regression for the issue where a taxCode-only PUT would set
    // resolvedFiscalCode = taxCode, overwriting fiscal_code (which is the unique-index
    // backing column) and allowing duplicate vatNumbers to slip through detection.
    findContactsForUpdateMock.mockResolvedValue({ contacts: [] });
    updateClientMock.mockResolvedValue(SAMPLE_CLIENT);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients/c-1',
      headers: authHeader(),
      payload: { taxCode: 'RSSMRO80A01H501Z' },
    });

    expect(res.statusCode).toBe(200);
    expect(findByFiscalCodeMock).not.toHaveBeenCalled();
    expect(updateClientMock).toHaveBeenCalledTimes(1);
    const patch = updateClientMock.mock.calls[0][1] as {
      fiscalCode: string | null;
      taxCode: string | null;
      taxCodeProvided: boolean;
      vatNumberProvided: boolean;
    };
    // fiscal_code must NOT be updated (null → repo's COALESCE keeps existing value)
    expect(patch.fiscalCode).toBeNull();
    expect(patch.taxCode).toBe('RSSMRO80A01H501Z');
    expect(patch.taxCodeProvided).toBe(true);
    expect(patch.vatNumberProvided).toBe(false);
  });

  test('200 null email/phone/contactName clears the columns (regression for #405)', async () => {
    // Regression for #405: when the edit form blanks out email/phone/contactName,
    // the frontend now sends explicit `null` instead of omitting the keys. The
    // route must translate that into `{value: null, *Provided: true}` so the
    // repo's CASE-WHEN clears the columns instead of preserving the old values.
    findContactsForUpdateMock.mockResolvedValue({ contacts: [] });
    updateClientMock.mockResolvedValue(SAMPLE_CLIENT);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients/c-1',
      headers: authHeader(),
      payload: { email: null, phone: null, contactName: null },
    });

    expect(res.statusCode).toBe(200);
    const patch = updateClientMock.mock.calls[0][1] as {
      email: string | null;
      emailProvided: boolean;
      phone: string | null;
      phoneProvided: boolean;
      contactName: string | null;
      contactNameProvided: boolean;
    };
    expect(patch.email).toBeNull();
    expect(patch.emailProvided).toBe(true);
    expect(patch.phone).toBeNull();
    expect(patch.phoneProvided).toBe(true);
    expect(patch.contactName).toBeNull();
    expect(patch.contactNameProvided).toBe(true);
  });

  test('200 vatNumber-only PUT updates fiscal_code shadow to vatNumber', async () => {
    findContactsForUpdateMock.mockResolvedValue({ contacts: [] });
    findByFiscalCodeMock.mockResolvedValue(false);
    updateClientMock.mockResolvedValue(SAMPLE_CLIENT);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients/c-1',
      headers: authHeader(),
      payload: { vatNumber: 'IT99999999999' },
    });

    expect(res.statusCode).toBe(200);
    // Duplicate check ran against the resolved fiscal_code
    expect(findByFiscalCodeMock).toHaveBeenCalledWith('IT99999999999', 'c-1');
    const patch = updateClientMock.mock.calls[0][1] as {
      fiscalCode: string | null;
      vatNumberProvided: boolean;
    };
    expect(patch.fiscalCode).toBe('IT99999999999');
    expect(patch.vatNumberProvided).toBe(true);
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

  // Migration 0033 changed the FK from CASCADE to RESTRICT on financial-doc tables. PG raises
  // 23503 when any dependent invoice/quote/offer/sale references the client being deleted -
  // the route catches it and surfaces 409 instead of letting the 500 bubble up.
  test('409 when client has financial documents (FK RESTRICT)', async () => {
    deleteClientByIdMock.mockRejectedValueOnce(
      makeDbError('23503', 'invoices_client_id_clients_id_fk'),
    );

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/clients/c-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('financial documents');
    expect(logAuditMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'client.deleted' }),
    );
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
    resetWithDbTransactionMock();

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
