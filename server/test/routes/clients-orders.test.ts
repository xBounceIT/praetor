import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realClientsOrdersRepo from '../../repositories/clientsOrdersRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realSupplierQuotesRepo from '../../repositories/supplierQuotesRepo.ts';
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
const clientsOrdersRepoSnap = { ...realClientsOrdersRepo };
const supplierQuotesRepoSnap = { ...realSupplierQuotesRepo };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const listAllMock = mock();
const listAllItemsMock = mock();
const findOfferDetailsMock = mock();
const findExistingForOfferMock = mock();
const findForUpdateMock = mock();
const findIdConflictMock = mock();
const createMock = mock();
const updateMock = mock();
const insertItemsMock = mock();
const replaceItemsMock = mock();
const findItemsForOrderMock = mock();
const logAuditMock = mock(async () => undefined);
const tx = { tx: true };
const withDbTransactionMock = mock(async (cb: (executor: unknown) => unknown) => cb(tx));

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
  mock.module('../../repositories/clientsOrdersRepo.ts', () => ({
    ...clientsOrdersRepoSnap,
    listAll: listAllMock,
    listAllItems: listAllItemsMock,
    findOfferDetails: findOfferDetailsMock,
    findExistingForOffer: findExistingForOfferMock,
    findForUpdate: findForUpdateMock,
    findIdConflict: findIdConflictMock,
    create: createMock,
    update: updateMock,
    insertItems: insertItemsMock,
    replaceItems: replaceItemsMock,
    findItemsForOrder: findItemsForOrderMock,
  }));
  mock.module('../../repositories/supplierQuotesRepo.ts', () => supplierQuotesRepoSnap);
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));

  routePlugin = (await import('../../routes/clients-orders.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/clientsOrdersRepo.ts', () => clientsOrdersRepoSnap);
  mock.module('../../repositories/supplierQuotesRepo.ts', () => supplierQuotesRepoSnap);
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
  'accounting.clients_orders.view',
  'accounting.clients_orders.create',
  'accounting.clients_orders.update',
  'accounting.clients_orders.delete',
];

const payloadWithOffer = {
  linkedOfferId: 'co-1',
  clientId: 'c-1',
  clientName: 'Acme',
  items: [
    {
      productId: 'p-1',
      productName: 'Consulting',
      quantity: 1,
      unitPrice: 100,
    },
  ],
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  listAllMock,
  listAllItemsMock,
  findOfferDetailsMock,
  findExistingForOfferMock,
  findForUpdateMock,
  findIdConflictMock,
  createMock,
  updateMock,
  insertItemsMock,
  replaceItemsMock,
  findItemsForOrderMock,
  logAuditMock,
  withDbTransactionMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(ALL_PERMS);
  withDbTransactionMock.mockImplementation(async (cb) => cb(tx));
  logAuditMock.mockImplementation(async () => undefined);

  testApp = await buildRouteTestApp(routePlugin, '/api/clients-orders');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('POST /api/clients-orders', () => {
  test('rejects non-latest source offer versions', async () => {
    findOfferDetailsMock.mockResolvedValue({
      id: 'co-1',
      linkedQuoteId: 'cq-1',
      status: 'accepted',
      isLatest: false,
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: payloadWithOffer,
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as { error: string };
    expect(body).toEqual({
      error: 'Sale orders can only be created from the latest offer version',
    });
    expect(findExistingForOfferMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe('PUT /api/clients-orders/:id', () => {
  test('rejects relinking a draft order to a non-latest source offer version', async () => {
    findForUpdateMock.mockResolvedValue({
      id: 'so-1',
      linkedQuoteId: null,
      linkedOfferId: null,
      clientId: 'c-1',
      clientName: 'Acme',
      paymentTerms: 'immediate',
      discount: 0,
      status: 'draft',
      notes: null,
    });
    findOfferDetailsMock.mockResolvedValue({
      id: 'co-1',
      linkedQuoteId: 'cq-1',
      status: 'accepted',
      isLatest: false,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/so-1',
      headers: authHeader(),
      payload: { linkedOfferId: 'co-1' },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as { error: string };
    expect(body).toEqual({
      error: 'Sale orders can only be created from the latest offer version',
    });
    expect(findExistingForOfferMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
