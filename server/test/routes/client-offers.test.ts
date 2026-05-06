import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import type {
  ClientOffer,
  ClientOfferItem,
  ExistingOffer,
  NewClientOffer,
  NewClientOfferItem,
} from '../../repositories/clientOffersRepo.ts';
import * as realClientOffersRepo from '../../repositories/clientOffersRepo.ts';
import * as realClientQuotesRepo from '../../repositories/clientQuotesRepo.ts';
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
const clientOffersRepoSnap = { ...realClientOffersRepo };
const clientQuotesRepoSnap = { ...realClientQuotesRepo };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const listAllMock = mock();
const listAllItemsMock = mock();
const findByIdMock = mock();
const findItemsForOfferMock = mock();
const findMaxVersionNumberMock = mock();
const markGroupNotLatestMock = mock();
const createMock = mock();
const insertItemsMock = mock();
const findForUpdateMock = mock();
const updateMock = mock();
const findLinkedSaleIdMock = mock();
const findLinkedSaleIdForGroupMock = mock();
const deleteByIdMock = mock();
const promoteLatestInGroupMock = mock();
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
  mock.module('../../repositories/clientOffersRepo.ts', () => ({
    ...clientOffersRepoSnap,
    listAll: listAllMock,
    listAllItems: listAllItemsMock,
    findById: findByIdMock,
    findItemsForOffer: findItemsForOfferMock,
    findMaxVersionNumber: findMaxVersionNumberMock,
    markGroupNotLatest: markGroupNotLatestMock,
    create: createMock,
    insertItems: insertItemsMock,
    findForUpdate: findForUpdateMock,
    update: updateMock,
    findLinkedSaleId: findLinkedSaleIdMock,
    findLinkedSaleIdForGroup: findLinkedSaleIdForGroupMock,
    deleteById: deleteByIdMock,
    promoteLatestInGroup: promoteLatestInGroupMock,
  }));
  mock.module('../../repositories/clientQuotesRepo.ts', () => clientQuotesRepoSnap);
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));

  routePlugin = (await import('../../routes/client-offers.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/clientOffersRepo.ts', () => clientOffersRepoSnap);
  mock.module('../../repositories/clientQuotesRepo.ts', () => clientQuotesRepoSnap);
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
  'sales.client_offers.view',
  'sales.client_offers.create',
  'sales.client_offers.update',
  'sales.client_offers.delete',
];

const offerFixture = (overrides: Partial<ClientOffer> = {}): ClientOffer => ({
  id: 'co-1',
  offerCode: 'OFF-1',
  versionGroupId: 'co-1',
  versionParentId: null,
  versionNumber: 1,
  isLatest: true,
  linkedQuoteId: 'cq-1',
  clientId: 'c-1',
  clientName: 'Acme',
  paymentTerms: 'immediate',
  discount: 5,
  discountType: 'percentage',
  status: 'accepted',
  expirationDate: '2026-06-01',
  notes: 'Notes',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const itemFixture = (overrides: Partial<ClientOfferItem> = {}): ClientOfferItem => ({
  id: 'coi-1',
  offerId: 'co-1',
  productId: 'p-1',
  productName: 'Consulting',
  quantity: 2,
  unitPrice: 100,
  productCost: 40,
  productMolPercentage: null,
  supplierQuoteId: null,
  supplierQuoteItemId: null,
  supplierQuoteSupplierName: null,
  supplierQuoteUnitPrice: null,
  unitType: 'hours',
  note: null,
  discount: 0,
  ...overrides,
});

const existingOfferFixture = (overrides: Partial<ExistingOffer> = {}): ExistingOffer => ({
  id: 'co-1',
  offerCode: 'OFF-1',
  versionGroupId: 'co-1',
  versionParentId: null,
  versionNumber: 1,
  isLatest: true,
  linkedQuoteId: 'cq-1',
  clientId: 'c-1',
  clientName: 'Acme',
  status: 'draft',
  ...overrides,
});

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  listAllMock,
  listAllItemsMock,
  findByIdMock,
  findItemsForOfferMock,
  findMaxVersionNumberMock,
  markGroupNotLatestMock,
  createMock,
  insertItemsMock,
  findForUpdateMock,
  updateMock,
  findLinkedSaleIdMock,
  findLinkedSaleIdForGroupMock,
  deleteByIdMock,
  promoteLatestInGroupMock,
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
  findLinkedSaleIdForGroupMock.mockResolvedValue(null);
  createMock.mockImplementation(async (input: NewClientOffer) =>
    offerFixture({
      ...input,
      versionGroupId: input.versionGroupId ?? input.id,
      versionParentId: input.versionParentId ?? null,
      versionNumber: input.versionNumber ?? 1,
      isLatest: input.isLatest ?? true,
    }),
  );
  insertItemsMock.mockImplementation(
    async (offerId: string, items: NewClientOfferItem[]): Promise<ClientOfferItem[]> =>
      items.map((item) => itemFixture({ ...item, offerId })),
  );

  testApp = await buildRouteTestApp(routePlugin, '/api/sales/client-offers');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('POST /api/sales/client-offers/:id/versions', () => {
  test('clones the latest non-draft offer into a new draft version', async () => {
    findByIdMock.mockResolvedValue(offerFixture({ status: 'sent' }));
    findItemsForOfferMock.mockResolvedValue([itemFixture()]);
    findMaxVersionNumberMock.mockResolvedValue(1);
    markGroupNotLatestMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers/co-1/versions',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      offerCode: 'OFF-1',
      versionGroupId: 'co-1',
      versionParentId: 'co-1',
      versionNumber: 2,
      isLatest: true,
      status: 'draft',
      items: [{ productName: 'Consulting' }],
    });
    expect(markGroupNotLatestMock).toHaveBeenCalledWith('co-1', tx);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        offerCode: 'OFF-1',
        versionGroupId: 'co-1',
        versionParentId: 'co-1',
        versionNumber: 2,
        isLatest: true,
        status: 'draft',
      }),
      tx,
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'client_offer.version_created',
        entityType: 'client_offer',
      }),
    );
  });

  test('rejects previous versions', async () => {
    findByIdMock.mockResolvedValue(offerFixture({ isLatest: false, status: 'accepted' }));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers/co-1/versions',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(createMock).not.toHaveBeenCalled();
    expect(markGroupNotLatestMock).not.toHaveBeenCalled();
  });

  test('rejects draft versions', async () => {
    findByIdMock.mockResolvedValue(offerFixture({ status: 'draft' }));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers/co-1/versions',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('rejects version creation after any offer version has a sale order', async () => {
    findByIdMock.mockResolvedValue(offerFixture({ status: 'accepted' }));
    findLinkedSaleIdForGroupMock.mockResolvedValue('so-1');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers/co-1/versions',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Cannot create a new version once a sale order has been created from this offer',
    });
    expect(findLinkedSaleIdForGroupMock).toHaveBeenCalledWith('co-1', tx);
    expect(createMock).not.toHaveBeenCalled();
    expect(markGroupNotLatestMock).not.toHaveBeenCalled();
  });
});

describe('PUT /api/sales/client-offers/:id', () => {
  test('rejects mutations to non-latest versions', async () => {
    findForUpdateMock.mockResolvedValue(existingOfferFixture({ isLatest: false }));

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-offers/co-1',
      headers: authHeader(),
      payload: { status: 'sent' },
    });

    expect(res.statusCode).toBe(409);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/sales/client-offers/:id', () => {
  test('deletes the latest draft and promotes the previous version', async () => {
    findForUpdateMock.mockResolvedValue(existingOfferFixture({ id: 'co-2', versionNumber: 2 }));
    findLinkedSaleIdMock.mockResolvedValue(null);
    deleteByIdMock.mockResolvedValue(true);
    promoteLatestInGroupMock.mockResolvedValue('co-1');

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/sales/client-offers/co-2',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(deleteByIdMock).toHaveBeenCalledWith('co-2', tx);
    expect(promoteLatestInGroupMock).toHaveBeenCalledWith('co-1', tx);
  });
});
