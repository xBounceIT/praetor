import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realClientOffersRepo from '../../repositories/clientOffersRepo.ts';
import * as realClientQuotesRepo from '../../repositories/clientQuotesRepo.ts';
import * as realClientsRepo from '../../repositories/clientsRepo.ts';
import * as realOfferVersionsRepo from '../../repositories/offerVersionsRepo.ts';
import * as realProductsRepo from '../../repositories/productsRepo.ts';
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
const clientsRepoSnap = { ...realClientsRepo };
const clientOffersRepoSnap = { ...realClientOffersRepo };
const clientQuotesRepoSnap = { ...realClientQuotesRepo };
const productsRepoSnap = { ...realProductsRepo };
const offerVersionsRepoSnap = { ...realOfferVersionsRepo };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const coExistsByIdMock = mock();
const coFindForUpdateMock = mock();
const coFindLinkedSaleIdMock = mock();
const coFindFullForSnapshotMock = mock();
const coFindItemsForOfferMock = mock();
const coFindIdConflictMock = mock();
const coUpdateMock = mock();
const coRestoreSnapshotOfferMock = mock();
const coReplaceItemsMock = mock();

const clientsExistsByIdMock = mock();
const productsGetSnapshotsMock = mock();

const ovListForOfferMock = mock();
const ovFindByIdMock = mock();
const ovInsertMock = mock();
const ovBuildSnapshotMock = mock();

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
    existsById: clientsExistsByIdMock,
  }));
  mock.module('../../repositories/clientOffersRepo.ts', () => ({
    ...clientOffersRepoSnap,
    existsById: coExistsByIdMock,
    findForUpdate: coFindForUpdateMock,
    findLinkedSaleId: coFindLinkedSaleIdMock,
    findFullForSnapshot: coFindFullForSnapshotMock,
    findItemsForOffer: coFindItemsForOfferMock,
    findIdConflict: coFindIdConflictMock,
    update: coUpdateMock,
    restoreSnapshotOffer: coRestoreSnapshotOfferMock,
    replaceItems: coReplaceItemsMock,
  }));
  mock.module('../../repositories/clientQuotesRepo.ts', () => ({
    ...clientQuotesRepoSnap,
  }));
  mock.module('../../repositories/productsRepo.ts', () => ({
    ...productsRepoSnap,
    getSnapshots: productsGetSnapshotsMock,
  }));
  mock.module('../../repositories/offerVersionsRepo.ts', () => ({
    ...offerVersionsRepoSnap,
    listForOffer: ovListForOfferMock,
    findById: ovFindByIdMock,
    insert: ovInsertMock,
    buildSnapshot: ovBuildSnapshotMock,
  }));
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
  mock.module('../../repositories/clientsRepo.ts', () => clientsRepoSnap);
  mock.module('../../repositories/clientOffersRepo.ts', () => clientOffersRepoSnap);
  mock.module('../../repositories/clientQuotesRepo.ts', () => clientQuotesRepoSnap);
  mock.module('../../repositories/productsRepo.ts', () => productsRepoSnap);
  mock.module('../../repositories/offerVersionsRepo.ts', () => offerVersionsRepoSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
  mock.module('../../db/drizzle.ts', () => drizzleSnap);
});

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'manager',
  avatarInitials: 'AL',
  isDisabled: false,
};

const FULL_PERMS = [
  'sales.client_offers.view',
  'sales.client_offers.create',
  'sales.client_offers.update',
  'sales.client_offers.delete',
];

const SAMPLE_OFFER = {
  id: 'off-1',
  linkedQuoteId: 'q-1',
  clientId: 'c1',
  clientName: 'Client',
  paymentTerms: 'immediate',
  discount: 0,
  discountType: 'percentage' as const,
  status: 'draft',
  expirationDate: '2026-12-31',
  notes: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const SAMPLE_ITEM = {
  id: 'coi-1',
  offerId: 'off-1',
  productId: 'p-1',
  productName: 'Service',
  quantity: 2,
  unitPrice: 100,
  productCost: 50,
  productMolPercentage: null,
  supplierQuoteId: null,
  supplierQuoteItemId: null,
  supplierQuoteSupplierName: null,
  supplierQuoteUnitPrice: null,
  discount: 0,
  note: null,
  unitType: 'hours' as const,
};

const SAMPLE_SNAPSHOT = {
  schemaVersion: 1 as const,
  offer: SAMPLE_OFFER,
  items: [SAMPLE_ITEM],
};

const SAMPLE_VERSION_ROW = {
  id: 'ov-1',
  offerId: 'off-1',
  reason: 'update' as const,
  createdByUserId: 'u1',
  createdAt: 1_700_000_001_000,
};

const SAMPLE_VERSION = { ...SAMPLE_VERSION_ROW, snapshot: SAMPLE_SNAPSHOT };

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  coExistsByIdMock,
  coFindForUpdateMock,
  coFindLinkedSaleIdMock,
  coFindFullForSnapshotMock,
  coFindItemsForOfferMock,
  coFindIdConflictMock,
  coUpdateMock,
  coRestoreSnapshotOfferMock,
  coReplaceItemsMock,
  clientsExistsByIdMock,
  productsGetSnapshotsMock,
  ovListForOfferMock,
  ovFindByIdMock,
  ovInsertMock,
  ovBuildSnapshotMock,
  logAuditMock,
  withDbTransactionMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(FULL_PERMS);
  withDbTransactionMock.mockImplementation(async (cb) => cb(undefined));
  logAuditMock.mockImplementation(async () => undefined);
  ovBuildSnapshotMock.mockImplementation((offer, items) => ({
    schemaVersion: 1,
    offer,
    items,
  }));
  coFindItemsForOfferMock.mockResolvedValue([SAMPLE_ITEM]);
  coFindIdConflictMock.mockResolvedValue(false);

  testApp = await buildRouteTestApp(routePlugin, '/api/sales/client-offers');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('GET /api/sales/client-offers/:id/versions', () => {
  test('200 returns versions newest-first when offer exists', async () => {
    coExistsByIdMock.mockResolvedValue(true);
    ovListForOfferMock.mockResolvedValue([SAMPLE_VERSION_ROW]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/client-offers/off-1/versions',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('ov-1');
    expect(ovListForOfferMock).toHaveBeenCalledWith('off-1');
  });

  test('404 when offer does not exist', async () => {
    coExistsByIdMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/client-offers/missing/versions',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
  });

  test('403 missing view permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/client-offers/off-1/versions',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/sales/client-offers/:id/versions/:versionId', () => {
  test('200 returns version with snapshot scoped by both ids', async () => {
    ovFindByIdMock.mockResolvedValue(SAMPLE_VERSION);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/client-offers/off-1/versions/ov-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('ov-1');
    expect(body.snapshot.offer.id).toBe('off-1');
    expect(ovFindByIdMock).toHaveBeenCalledWith('off-1', 'ov-1');
  });

  test('404 when version not found (also covers cross-offer ids)', async () => {
    ovFindByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/client-offers/off-1/versions/ov-other',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/sales/client-offers/:id/versions/:versionId/restore', () => {
  const setupHappyPath = () => {
    coFindForUpdateMock.mockResolvedValue({
      id: 'off-1',
      linkedQuoteId: 'q-1',
      clientId: 'c1',
      clientName: 'Client',
      status: 'draft',
    });
    coFindLinkedSaleIdMock.mockResolvedValue(null);
    ovFindByIdMock.mockResolvedValue(SAMPLE_VERSION);
    coFindFullForSnapshotMock.mockResolvedValue({
      offer: SAMPLE_OFFER,
      items: [SAMPLE_ITEM],
    });
    ovInsertMock.mockResolvedValue({ ...SAMPLE_VERSION_ROW, reason: 'restore' });
    clientsExistsByIdMock.mockResolvedValue(true);
    productsGetSnapshotsMock.mockResolvedValue(
      new Map([['p-1', { productCost: 50, productMolPercentage: null }]]),
    );
    coRestoreSnapshotOfferMock.mockResolvedValue(SAMPLE_OFFER);
    coReplaceItemsMock.mockResolvedValue([SAMPLE_ITEM]);
  };

  test('200 happy path snapshots current then applies version atomically', async () => {
    setupHappyPath();

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers/off-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('off-1');
    expect(body.items).toHaveLength(1);

    // Pre-restore snapshot inserted with reason='restore'
    expect(ovInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ offerId: 'off-1', reason: 'restore', createdByUserId: 'u1' }),
      undefined,
    );
    // Snapshot reference validation ran inside the tx. The second arg is the tx executor;
    // bun's toHaveBeenCalledWith(..., undefined) hangs the runner, so we read positional
    // args from mock.calls directly.
    expect(clientsExistsByIdMock).toHaveBeenCalled();
    expect(clientsExistsByIdMock.mock.calls[0]?.[0]).toBe('c1');
    expect(productsGetSnapshotsMock).toHaveBeenCalled();
    expect(productsGetSnapshotsMock.mock.calls[0]?.[0]).toEqual(['p-1']);
    // Offer + items applied
    expect(coRestoreSnapshotOfferMock).toHaveBeenCalledWith(
      'off-1',
      expect.objectContaining({ notes: null }),
      undefined,
    );
    expect(coReplaceItemsMock).toHaveBeenCalled();
    // Atomically wrapped
    expect(withDbTransactionMock).toHaveBeenCalled();
    // Audit logged
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'client_offer.restored',
        entityType: 'client_offer',
        entityId: 'off-1',
        details: expect.objectContaining({ toValue: 'ov-1' }),
      }),
    );
  });

  test('404 when current offer does not exist', async () => {
    coFindForUpdateMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers/off-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(coRestoreSnapshotOfferMock).not.toHaveBeenCalled();
    expect(ovInsertMock).not.toHaveBeenCalled();
  });

  test('409 when offer is not draft', async () => {
    coFindForUpdateMock.mockResolvedValue({
      id: 'off-1',
      linkedQuoteId: 'q-1',
      clientId: 'c1',
      clientName: 'Client',
      status: 'sent',
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers/off-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(coRestoreSnapshotOfferMock).not.toHaveBeenCalled();
  });

  test('409 when any linked sale exists (draft or otherwise)', async () => {
    coFindForUpdateMock.mockResolvedValue({
      id: 'off-1',
      linkedQuoteId: 'q-1',
      clientId: 'c1',
      clientName: 'Client',
      status: 'draft',
    });
    coFindLinkedSaleIdMock.mockResolvedValue('sale-99');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers/off-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(coRestoreSnapshotOfferMock).not.toHaveBeenCalled();
    expect(ovInsertMock).not.toHaveBeenCalled();
  });

  test('409 when snapshot client no longer exists', async () => {
    setupHappyPath();
    clientsExistsByIdMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers/off-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Snapshot client');
    expect(coRestoreSnapshotOfferMock).not.toHaveBeenCalled();
  });

  test('409 when snapshot product no longer exists', async () => {
    setupHappyPath();
    productsGetSnapshotsMock.mockResolvedValue(new Map());

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers/off-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Snapshot product');
    expect(coRestoreSnapshotOfferMock).not.toHaveBeenCalled();
  });

  test('404 when version not found (and no cross-offer leak)', async () => {
    coFindForUpdateMock.mockResolvedValue({
      id: 'off-1',
      linkedQuoteId: 'q-1',
      clientId: 'c1',
      clientName: 'Client',
      status: 'draft',
    });
    coFindLinkedSaleIdMock.mockResolvedValue(null);
    ovFindByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers/off-1/versions/ov-other/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    // findById should be scoped on (offerId, versionId) so a foreign versionId returns null
    expect(ovFindByIdMock).toHaveBeenCalled();
    expect(ovFindByIdMock.mock.calls[0]?.slice(0, 2)).toEqual(['off-1', 'ov-other']);
    expect(coRestoreSnapshotOfferMock).not.toHaveBeenCalled();
  });

  test('403 without update permission (view only)', async () => {
    getRolePermissionsMock.mockResolvedValue(['sales.client_offers.view']);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers/off-1/versions/ov-1/restore',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /api/sales/client-offers/:id snapshots pre-update state', () => {
  test('PUT with content changes inserts a snapshot inside the transaction', async () => {
    coFindForUpdateMock.mockResolvedValue({
      id: 'off-1',
      linkedQuoteId: 'q-1',
      clientId: 'c1',
      clientName: 'Client',
      status: 'draft',
    });
    coFindFullForSnapshotMock.mockResolvedValue({
      offer: SAMPLE_OFFER,
      items: [SAMPLE_ITEM],
    });
    coUpdateMock.mockResolvedValue({ ...SAMPLE_OFFER, status: 'sent' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-offers/off-1',
      headers: authHeader(),
      payload: { status: 'sent' },
    });

    expect(res.statusCode).toBe(200);
    expect(coFindFullForSnapshotMock).toHaveBeenCalled();
    expect(ovInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ offerId: 'off-1', reason: 'update', createdByUserId: 'u1' }),
      undefined,
    );
  });

  test('PUT with id-only rename does NOT snapshot (no content change)', async () => {
    coFindForUpdateMock.mockResolvedValue({
      id: 'off-1',
      linkedQuoteId: 'q-1',
      clientId: 'c1',
      clientName: 'Client',
      status: 'draft',
    });
    coUpdateMock.mockResolvedValue({ ...SAMPLE_OFFER, id: 'off-1-renamed' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-offers/off-1',
      headers: authHeader(),
      payload: { id: 'off-1-renamed' },
    });

    expect(res.statusCode).toBe(200);
    expect(ovInsertMock).not.toHaveBeenCalled();
    expect(coFindFullForSnapshotMock).not.toHaveBeenCalled();
  });
});
