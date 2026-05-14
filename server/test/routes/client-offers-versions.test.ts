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
import { TX_SENTINEL } from '../helpers/txSentinel.ts';
import { makeWithDbTransactionMock } from '../helpers/withDbTransactionMock.ts';

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
const coFindExistingMock = mock();
const coLockExistingByIdMock = mock();
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
    existsById: clientsExistsByIdMock,
  }));
  mock.module('../../repositories/clientOffersRepo.ts', () => ({
    ...clientOffersRepoSnap,
    existsById: coExistsByIdMock,
    findExisting: coFindExistingMock,
    lockExistingById: coLockExistingByIdMock,
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
  sessionVersion: 1,
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
  coFindExistingMock,
  coLockExistingByIdMock,
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
  resetWithDbTransactionMock();
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
    coLockExistingByIdMock.mockResolvedValue({
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

    // TOCTOU guard: gate-read must use the FOR UPDATE helper, not the non-locking findExisting
    expect(coLockExistingByIdMock).toHaveBeenCalledWith('off-1', TX_SENTINEL);
    expect(coFindExistingMock).not.toHaveBeenCalled();

    // Pre-restore snapshot inserted with reason='restore'
    expect(ovInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ offerId: 'off-1', reason: 'restore', createdByUserId: 'u1' }),
      TX_SENTINEL,
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
      TX_SENTINEL,
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
    coLockExistingByIdMock.mockResolvedValue(null);

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
    coLockExistingByIdMock.mockResolvedValue({
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
    coLockExistingByIdMock.mockResolvedValue({
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
    coLockExistingByIdMock.mockResolvedValue({
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

  test('POST restore: replaceItems failure rolls back (no audit, no success)', async () => {
    setupHappyPath();
    withDbTransactionMock.mockImplementation(async (cb) => cb(TX_SENTINEL));
    coReplaceItemsMock.mockRejectedValue(new Error('insert failed'));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers/off-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(500);
    expect(withDbTransactionMock).toHaveBeenCalled();
    expect(coReplaceItemsMock).toHaveBeenCalled();
    expect(coReplaceItemsMock.mock.calls[0]?.at(-1)).toBe(TX_SENTINEL);
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/sales/client-offers/:id/revert-to-draft', () => {
  const setupHappyPath = (status = 'accepted') => {
    findAuthUserByIdMock.mockResolvedValue({ ...HAPPY_USER, role: 'top_manager' });
    coLockExistingByIdMock.mockResolvedValue({
      id: 'off-1',
      linkedQuoteId: 'q-1',
      clientId: 'c1',
      clientName: 'Client',
      status,
    });
    coFindLinkedSaleIdMock.mockResolvedValue(null);
    coFindFullForSnapshotMock.mockResolvedValue({
      offer: { ...SAMPLE_OFFER, status },
      items: [SAMPLE_ITEM],
    });
    ovInsertMock.mockResolvedValue({ ...SAMPLE_VERSION_ROW, reason: 'update' });
    coUpdateMock.mockResolvedValue({ ...SAMPLE_OFFER, status: 'draft' });
    coFindItemsForOfferMock.mockResolvedValue([SAMPLE_ITEM]);
  };

  test('200 top manager reverts accepted offer to draft with snapshot and audit reason', async () => {
    setupHappyPath('accepted');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers/off-1/revert-to-draft',
      headers: authHeader(),
      payload: { reason: 'Wrong status' },
    });

    expect(res.statusCode).toBe(200);
    expect(coLockExistingByIdMock).toHaveBeenCalledWith('off-1', TX_SENTINEL);
    expect(ovInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ offerId: 'off-1', reason: 'update', createdByUserId: 'u1' }),
      TX_SENTINEL,
    );
    expect(coUpdateMock).toHaveBeenCalledWith('off-1', { status: 'draft' }, TX_SENTINEL);
    expect(coFindItemsForOfferMock).toHaveBeenCalledWith('off-1', TX_SENTINEL);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'client_offer.reverted_to_draft',
        entityType: 'client_offer',
        entityId: 'off-1',
        details: expect.objectContaining({
          changedFields: ['status'],
          fromValue: 'accepted',
          toValue: 'draft',
          reason: 'Wrong status',
        }),
      }),
    );
  });

  test('200 admin can use the dedicated revert endpoint', async () => {
    setupHappyPath('denied');
    findAuthUserByIdMock.mockResolvedValue({ ...HAPPY_USER, role: 'admin' });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers/off-1/revert-to-draft',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(coUpdateMock).toHaveBeenCalledWith('off-1', { status: 'draft' }, TX_SENTINEL);
  });

  test('403 manager cannot revert terminal offers through the dedicated endpoint', async () => {
    setupHappyPath('accepted');
    findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers/off-1/revert-to-draft',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(403);
    expect(coLockExistingByIdMock).not.toHaveBeenCalled();
  });

  test('409 when current offer is not terminal', async () => {
    setupHappyPath('sent');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers/off-1/revert-to-draft',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(coUpdateMock).not.toHaveBeenCalled();
    expect(ovInsertMock).not.toHaveBeenCalled();
  });

  test('409 when accepted offer already has a linked sale order', async () => {
    setupHappyPath('accepted');
    coFindLinkedSaleIdMock.mockResolvedValue('sale-1');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers/off-1/revert-to-draft',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(coUpdateMock).not.toHaveBeenCalled();
    expect(ovInsertMock).not.toHaveBeenCalled();
  });
});

describe('PUT /api/sales/client-offers/:id snapshots pre-update state', () => {
  test('PUT with content changes inserts a snapshot inside the transaction', async () => {
    coFindExistingMock.mockResolvedValue({
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
      TX_SENTINEL,
    );
  });

  test('PUT with id-only rename does NOT snapshot (no content change)', async () => {
    coFindExistingMock.mockResolvedValue({
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

  test('PUT terminal-to-draft rejects ordinary manager before generic update', async () => {
    coFindExistingMock.mockResolvedValue({
      id: 'off-1',
      linkedQuoteId: 'q-1',
      clientId: 'c1',
      clientName: 'Client',
      status: 'accepted',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-offers/off-1',
      headers: authHeader(),
      payload: { status: 'draft' },
    });

    expect(res.statusCode).toBe(403);
    expect(coUpdateMock).not.toHaveBeenCalled();
    expect(ovInsertMock).not.toHaveBeenCalled();
  });

  test('PUT items: replaceItems failure rolls back (no audit, no success)', async () => {
    coFindExistingMock.mockResolvedValue({
      id: 'off-1',
      linkedQuoteId: null,
      clientId: 'c1',
      clientName: 'Client',
      status: 'draft',
    });
    coFindFullForSnapshotMock.mockResolvedValue({
      offer: { ...SAMPLE_OFFER, linkedQuoteId: null },
      items: [SAMPLE_ITEM],
    });
    coUpdateMock.mockResolvedValue({ ...SAMPLE_OFFER, linkedQuoteId: null });
    withDbTransactionMock.mockImplementation(async (cb) => cb(TX_SENTINEL));
    coReplaceItemsMock.mockRejectedValue(new Error('insert failed'));

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-offers/off-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            id: 'coi-new',
            productId: 'p-1',
            productName: 'Service',
            quantity: 1,
            unitPrice: 100,
            productCost: 50,
            productMolPercentage: null,
            supplierQuoteId: null,
            supplierQuoteItemId: null,
            supplierQuoteSupplierName: null,
            supplierQuoteUnitPrice: null,
            discount: 0,
            note: null,
            unitType: 'hours',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(500);
    expect(withDbTransactionMock).toHaveBeenCalled();
    expect(coReplaceItemsMock).toHaveBeenCalled();
    expect(coReplaceItemsMock.mock.calls[0]?.at(-1)).toBe(TX_SENTINEL);
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
