import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realClientsOrdersRepo from '../../repositories/clientsOrdersRepo.ts';
import * as realClientsRepo from '../../repositories/clientsRepo.ts';
import * as realOrderVersionsRepo from '../../repositories/orderVersionsRepo.ts';
import * as realProductsRepo from '../../repositories/productsRepo.ts';
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
import { TX_SENTINEL } from '../helpers/txSentinel.ts';
import { makeWithDbTransactionMock } from '../helpers/withDbTransactionMock.ts';

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const clientsRepoSnap = { ...realClientsRepo };
const clientsOrdersRepoSnap = { ...realClientsOrdersRepo };
const productsRepoSnap = { ...realProductsRepo };
const orderVersionsRepoSnap = { ...realOrderVersionsRepo };
const supplierQuotesRepoSnap = { ...realSupplierQuotesRepo };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const coExistsByIdMock = mock();
const coFindExistingMock = mock();
const coFindFullForSnapshotMock = mock();
const coFindItemsForOrderMock = mock();
const coFindIdConflictMock = mock();
const coFindOfferDetailsMock = mock();
const coFindExistingForOfferMock = mock();
const coFindStatusAndClientNameMock = mock();
const coUpdateMock = mock();
const coRenameMock = mock();
const coRestoreSnapshotOrderMock = mock();
const coReplaceItemsMock = mock();
const coDeleteDraftByIdMock = mock();

const clientsExistsByIdMock = mock();
const productsGetSnapshotsMock = mock();
const sqGetQuoteItemSnapshotsMock = mock();

const ovListForOrderMock = mock();
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
  mock.module('../../repositories/clientsOrdersRepo.ts', () => ({
    ...clientsOrdersRepoSnap,
    existsById: coExistsByIdMock,
    findExisting: coFindExistingMock,
    findFullForSnapshot: coFindFullForSnapshotMock,
    findItemsForOrder: coFindItemsForOrderMock,
    findIdConflict: coFindIdConflictMock,
    findOfferDetails: coFindOfferDetailsMock,
    findExistingForOffer: coFindExistingForOfferMock,
    findStatusAndClientName: coFindStatusAndClientNameMock,
    update: coUpdateMock,
    rename: coRenameMock,
    restoreSnapshotOrder: coRestoreSnapshotOrderMock,
    replaceItems: coReplaceItemsMock,
    deleteDraftById: coDeleteDraftByIdMock,
  }));
  mock.module('../../repositories/productsRepo.ts', () => ({
    ...productsRepoSnap,
    getSnapshots: productsGetSnapshotsMock,
  }));
  mock.module('../../repositories/orderVersionsRepo.ts', () => ({
    ...orderVersionsRepoSnap,
    listForOrder: ovListForOrderMock,
    findById: ovFindByIdMock,
    insert: ovInsertMock,
    buildSnapshot: ovBuildSnapshotMock,
  }));
  mock.module('../../repositories/supplierQuotesRepo.ts', () => ({
    ...supplierQuotesRepoSnap,
    getQuoteItemSnapshots: sqGetQuoteItemSnapshotsMock,
  }));
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
  mock.module('../../repositories/clientsRepo.ts', () => clientsRepoSnap);
  mock.module('../../repositories/clientsOrdersRepo.ts', () => clientsOrdersRepoSnap);
  mock.module('../../repositories/productsRepo.ts', () => productsRepoSnap);
  mock.module('../../repositories/orderVersionsRepo.ts', () => orderVersionsRepoSnap);
  mock.module('../../repositories/supplierQuotesRepo.ts', () => supplierQuotesRepoSnap);
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
  'accounting.clients_orders.view',
  'accounting.clients_orders.create',
  'accounting.clients_orders.update',
  'accounting.clients_orders.delete',
];

const SAMPLE_ORDER = {
  id: 'o-1',
  linkedQuoteId: null,
  linkedOfferId: null,
  clientId: 'c1',
  clientName: 'Client',
  paymentTerms: 'immediate',
  discount: 0,
  discountType: 'percentage' as const,
  status: 'draft',
  notes: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const SAMPLE_ITEM = {
  id: 'si-1',
  orderId: 'o-1',
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
  supplierSaleId: null,
  supplierSaleItemId: null,
  supplierSaleSupplierName: null,
  discount: 12.5,
  note: null,
  unitType: 'hours' as const,
};

// A sale line whose accepted supplier quote auto-created a supplier (procurement) order at
// create time: supplierSaleId / supplierSaleItemId point at the live supplier order row.
const SUPPLIER_BACKED_ITEM = {
  ...SAMPLE_ITEM,
  id: 'si-sup',
  supplierQuoteId: 'sq-1',
  supplierQuoteItemId: 'sqi-1',
  supplierQuoteSupplierName: 'ACME',
  supplierSaleId: 'ss-1',
  supplierSaleItemId: 'ssi-1',
  supplierSaleSupplierName: 'ACME',
};

const SAMPLE_SNAPSHOT = {
  schemaVersion: 1 as const,
  order: SAMPLE_ORDER,
  items: [SAMPLE_ITEM],
};

const SAMPLE_VERSION_ROW = {
  id: 'ov-1',
  orderId: 'o-1',
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
  coFindFullForSnapshotMock,
  coFindItemsForOrderMock,
  coFindIdConflictMock,
  coFindOfferDetailsMock,
  coFindExistingForOfferMock,
  coFindStatusAndClientNameMock,
  coUpdateMock,
  coRenameMock,
  coRestoreSnapshotOrderMock,
  coReplaceItemsMock,
  coDeleteDraftByIdMock,
  clientsExistsByIdMock,
  productsGetSnapshotsMock,
  sqGetQuoteItemSnapshotsMock,
  ovListForOrderMock,
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
  ovBuildSnapshotMock.mockImplementation((order, items) => ({
    schemaVersion: 1,
    order,
    items,
  }));
  coFindItemsForOrderMock.mockResolvedValue([SAMPLE_ITEM]);
  coFindIdConflictMock.mockResolvedValue(false);
  coFindOfferDetailsMock.mockResolvedValue({
    id: 'off-1',
    linkedQuoteId: null,
    clientId: 'c1',
    clientName: 'Client',
    status: 'accepted',
  });
  coFindExistingForOfferMock.mockResolvedValue(null);
  coFindStatusAndClientNameMock.mockResolvedValue({ status: 'draft', clientName: 'Client' });
  coDeleteDraftByIdMock.mockResolvedValue({ clientName: 'Client' });
  sqGetQuoteItemSnapshotsMock.mockResolvedValue(
    new Map([
      [
        'sqi-1',
        {
          supplierQuoteId: 'sq-1',
          supplierName: 'ACME',
          productId: 'p-1',
          unitPrice: 50,
          netCost: 50,
        },
      ],
    ]),
  );

  testApp = await buildRouteTestApp(routePlugin, '/api/clients-orders');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('DELETE /api/clients-orders/:id', () => {
  test('204 atomically deletes a draft and audits the returned client name', async () => {
    coDeleteDraftByIdMock.mockResolvedValue({ clientName: 'Deleted Client' });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(coDeleteDraftByIdMock).toHaveBeenCalledWith('o-1');
    expect(coFindStatusAndClientNameMock).not.toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'client_order.deleted',
        details: expect.objectContaining({ secondaryLabel: 'Deleted Client' }),
      }),
    );
  });

  test('409 when a concurrent confirmation wins before the atomic draft delete', async () => {
    coFindStatusAndClientNameMock.mockResolvedValue({
      status: 'confirmed',
      clientName: 'Client',
    });
    coDeleteDraftByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Only draft clients_orders can be deleted');
    expect(coDeleteDraftByIdMock).toHaveBeenCalledWith('o-1');
    expect(logAuditMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'client_order.deleted' }),
    );
  });

  test('404 when the draft disappears before the atomic delete', async () => {
    coFindStatusAndClientNameMock.mockResolvedValue(null);
    coDeleteDraftByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(coDeleteDraftByIdMock).toHaveBeenCalledWith('o-1');
    expect(logAuditMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'client_order.deleted' }),
    );
  });
});

describe('PUT /api/clients-orders/:id document discount validation', () => {
  test('200 allows unrelated updates to preserve a legacy percentage discount above 100', async () => {
    coFindExistingMock.mockResolvedValue({
      ...SAMPLE_ORDER,
      discount: 150,
      discountType: 'percentage',
    });
    coUpdateMock.mockResolvedValue({ ...SAMPLE_ORDER, discount: 150, notes: 'edited' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: { notes: 'edited' },
    });

    expect(res.statusCode).toBe(200);
    expect(coUpdateMock).toHaveBeenCalled();
  });

  test('200 allows updates that resend an unchanged legacy percentage discount above 100', async () => {
    coFindExistingMock.mockResolvedValue({
      ...SAMPLE_ORDER,
      discount: 150,
      discountType: 'percentage',
    });
    coUpdateMock.mockResolvedValue({ ...SAMPLE_ORDER, discount: 150, notes: 'edited' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: { discount: 150, discountType: 'percentage', notes: 'edited' },
    });

    expect(res.statusCode).toBe(200);
    expect(coUpdateMock).toHaveBeenCalled();
  });

  test('400 rejects changing an over-100 currency discount to percentage', async () => {
    coFindExistingMock.mockResolvedValue({
      ...SAMPLE_ORDER,
      discount: 150,
      discountType: 'currency',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: { discountType: 'percentage' },
    });

    expect(res.statusCode).toBe(400);
    expect(coUpdateMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/clients-orders/:id/versions', () => {
  test('200 returns versions newest-first when order exists', async () => {
    coExistsByIdMock.mockResolvedValue(true);
    ovListForOrderMock.mockResolvedValue([SAMPLE_VERSION_ROW]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/clients-orders/o-1/versions',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('ov-1');
    expect(ovListForOrderMock).toHaveBeenCalledWith('o-1');
  });

  test('404 when order does not exist', async () => {
    coExistsByIdMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/clients-orders/missing/versions',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
  });

  test('403 missing view permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/clients-orders/o-1/versions',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/clients-orders/:id/versions/:versionId', () => {
  test('200 returns version with snapshot scoped by both ids', async () => {
    ovFindByIdMock.mockResolvedValue(SAMPLE_VERSION);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/clients-orders/o-1/versions/ov-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('ov-1');
    expect(body.snapshot.order.id).toBe('o-1');
    expect(ovFindByIdMock).toHaveBeenCalledWith('o-1', 'ov-1');
  });

  test('404 when version not found (also covers cross-order ids)', async () => {
    ovFindByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/clients-orders/o-1/versions/ov-other',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/clients-orders/:id/versions/:versionId/restore', () => {
  const setupHappyPath = () => {
    coFindExistingMock.mockResolvedValue({
      id: 'o-1',
      linkedQuoteId: null,
      linkedOfferId: null,
      clientId: 'c1',
      clientName: 'Client',
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage' as const,
      status: 'draft',
      notes: null,
    });
    ovFindByIdMock.mockResolvedValue(SAMPLE_VERSION);
    coFindFullForSnapshotMock.mockResolvedValue({
      order: SAMPLE_ORDER,
      items: [SAMPLE_ITEM],
    });
    ovInsertMock.mockResolvedValue({ ...SAMPLE_VERSION_ROW, reason: 'restore' });
    clientsExistsByIdMock.mockResolvedValue(true);
    productsGetSnapshotsMock.mockResolvedValue(
      new Map([['p-1', { productCost: 50, productMolPercentage: null }]]),
    );
    // Default: a product-less snapshot line's supplier-quote item still resolves to an accepted quote.
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(
      new Map([
        [
          'sqi-1',
          {
            supplierQuoteId: 'sq-1',
            supplierName: 'ACME',
            productId: null,
            unitPrice: 50,
            netCost: 50,
          },
        ],
      ]),
    );
    coRestoreSnapshotOrderMock.mockResolvedValue(SAMPLE_ORDER);
    coReplaceItemsMock.mockResolvedValue([SAMPLE_ITEM]);
  };

  test('carries a non-default snapshot durationMonths through to replaceItems (issue #757)', async () => {
    setupHappyPath();
    ovFindByIdMock.mockResolvedValue({
      ...SAMPLE_VERSION,
      snapshot: {
        ...SAMPLE_SNAPSHOT,
        items: [{ ...SAMPLE_ITEM, durationMonths: 12, durationUnit: 'years' }],
      },
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const replacedItems = coReplaceItemsMock.mock.calls[0]?.[1];
    expect(replacedItems[0].durationMonths).toBe(12);
    expect(replacedItems[0].durationUnit).toBe('years');
  });

  test('200 happy path snapshots current then applies version atomically', async () => {
    setupHappyPath();

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('o-1');
    expect(body.items).toHaveLength(1);

    // Pre-restore snapshot inserted with reason='restore'
    expect(ovInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'o-1', reason: 'restore', createdByUserId: 'u1' }),
      TX_SENTINEL,
    );
    // Order and items applied
    expect(clientsExistsByIdMock).toHaveBeenCalledWith('c1');
    expect(productsGetSnapshotsMock).toHaveBeenCalledWith(['p-1']);
    expect(coRestoreSnapshotOrderMock).toHaveBeenCalledWith(
      'o-1',
      expect.objectContaining({ clientId: 'c1', notes: null }),
      TX_SENTINEL,
    );
    expect(coReplaceItemsMock).toHaveBeenCalled();
    expect(coReplaceItemsMock.mock.calls[0]?.[1]?.[0].productMolPercentage).toBe(50);
    // Atomically wrapped
    expect(withDbTransactionMock).toHaveBeenCalled();
    // Audit logged
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'client_order.restored',
        entityType: 'client_order',
        entityId: 'o-1',
        details: expect.objectContaining({ toValue: 'ov-1' }),
      }),
    );
  });

  test('restores description from a new snapshot', async () => {
    setupHappyPath();
    ovFindByIdMock.mockResolvedValue({
      ...SAMPLE_VERSION,
      snapshot: {
        ...SAMPLE_SNAPSHOT,
        order: { ...SAMPLE_ORDER, description: 'Restored order description' },
      },
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(coRestoreSnapshotOrderMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ description: 'Restored order description' }),
    );
  });

  test('does not clear description when a legacy snapshot omits it', async () => {
    setupHappyPath();

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(Object.hasOwn(coRestoreSnapshotOrderMock.mock.calls[0]?.[1], 'description')).toBe(false);
  });

  test('409 rejects restoring a snapshot with a percentage discount above 100%', async () => {
    setupHappyPath();
    ovFindByIdMock.mockResolvedValue({
      ...SAMPLE_VERSION,
      snapshot: {
        ...SAMPLE_SNAPSHOT,
        order: { ...SAMPLE_ORDER, discount: 100.01, discountType: 'percentage' as const },
      },
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('invalid discount');
    expect(coRestoreSnapshotOrderMock).not.toHaveBeenCalled();
    expect(ovInsertMock).not.toHaveBeenCalled();
  });

  test('200 restores a snapshot line with no productId (issue #783)', async () => {
    setupHappyPath();
    // A supplier-quote-sourced line carries the supplier-quote reference (supplierQuoteId +
    // supplierQuoteItemId) but no catalog product. Before sale_items.product_id became nullable
    // this restore was rejected with a 409.
    ovFindByIdMock.mockResolvedValue({
      ...SAMPLE_VERSION,
      snapshot: {
        ...SAMPLE_SNAPSHOT,
        items: [
          {
            ...SAMPLE_ITEM,
            id: 'si-free',
            productId: null,
            supplierQuoteId: 'sq-1',
            supplierQuoteItemId: 'sqi-1',
          },
        ],
      },
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const replacedItems = coReplaceItemsMock.mock.calls[0]?.[1];
    expect(replacedItems).toHaveLength(1);
    expect(replacedItems[0].productId).toBeNull();
  });

  test('200 restores authoritative supplier metadata instead of snapshot values', async () => {
    setupHappyPath();
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(
      new Map([
        [
          'sqi-1',
          {
            supplierQuoteId: 'sq-1',
            supplierName: 'ACME',
            productId: 'p-1',
            unitPrice: 50,
            netCost: 50,
          },
        ],
      ]),
    );
    ovFindByIdMock.mockResolvedValue({
      ...SAMPLE_VERSION,
      snapshot: {
        ...SAMPLE_SNAPSHOT,
        items: [
          {
            ...SAMPLE_ITEM,
            supplierQuoteId: 'sq-client-lie',
            supplierQuoteItemId: 'sqi-1',
            supplierQuoteSupplierName: 'Spoofed Supplier',
            supplierQuoteUnitPrice: 999,
          },
        ],
      },
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const restoredItem = coReplaceItemsMock.mock.calls[0]?.[1]?.[0];
    expect(restoredItem).toEqual(
      expect.objectContaining({
        productId: 'p-1',
        supplierQuoteId: 'sq-1',
        supplierQuoteItemId: 'sqi-1',
        supplierQuoteSupplierName: 'ACME',
        supplierQuoteUnitPrice: 50,
        productMolPercentage: 50,
      }),
    );
  });

  test('200 ignores a stale snapshot product replaced by the live supplier item', async () => {
    setupHappyPath();
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(
      new Map([
        [
          'sqi-1',
          {
            supplierQuoteId: 'sq-1',
            supplierName: 'ACME',
            productId: 'p-1',
            unitPrice: 50,
            netCost: 50,
          },
        ],
      ]),
    );
    ovFindByIdMock.mockResolvedValue({
      ...SAMPLE_VERSION,
      snapshot: {
        ...SAMPLE_SNAPSHOT,
        items: [
          {
            ...SAMPLE_ITEM,
            productId: 'p-old',
            supplierQuoteId: 'sq-1',
            supplierQuoteItemId: 'sqi-1',
          },
        ],
      },
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(productsGetSnapshotsMock).not.toHaveBeenCalledWith(['p-old']);
    expect(coReplaceItemsMock.mock.calls[0]?.[1]?.[0].productId).toBe('p-1');
  });

  test('409 when restoring a snapshot with an orphaned product-less item (issue #783)', async () => {
    setupHappyPath();
    // No catalog product AND no supplier-quote reference — the same invariant POST/PUT enforce.
    // Restoring this would insert an orphaned line that fails normal validation and is invisible
    // to product-based reporting, so it must be rejected before any write.
    ovFindByIdMock.mockResolvedValue({
      ...SAMPLE_VERSION,
      snapshot: {
        ...SAMPLE_SNAPSHOT,
        items: [
          {
            ...SAMPLE_ITEM,
            id: 'si-orphan',
            productId: '',
            supplierQuoteId: null,
            supplierQuoteItemId: null,
          },
        ],
      },
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain(
      'no catalog product and no supplier-quote reference',
    );
    // Rejected before any restore write.
    expect(coRestoreSnapshotOrderMock).not.toHaveBeenCalled();
    expect(coReplaceItemsMock).not.toHaveBeenCalled();
    expect(ovInsertMock).not.toHaveBeenCalled();
  });

  test('409 when restoring a product-less line whose supplier quote is stale (issue #783)', async () => {
    setupHappyPath();
    // The referenced supplier-quote item was deleted or its quote is no longer accepted, so it no
    // longer resolves. Restoring would persist a dead reference that the next edit rejects, so the
    // restore is blocked here instead — mirroring the POST/PUT resolveSupplierQuoteRefs validation.
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(new Map());
    ovFindByIdMock.mockResolvedValue({
      ...SAMPLE_VERSION,
      snapshot: {
        ...SAMPLE_SNAPSHOT,
        items: [
          {
            ...SAMPLE_ITEM,
            id: 'si-stale',
            productId: null,
            supplierQuoteId: 'sq-1',
            supplierQuoteItemId: 'sqi-gone',
          },
        ],
      },
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain(
      'references a supplier quote item that no longer exists',
    );
    expect(sqGetQuoteItemSnapshotsMock).toHaveBeenCalledWith(['sqi-gone']);
    expect(coRestoreSnapshotOrderMock).not.toHaveBeenCalled();
    expect(coReplaceItemsMock).not.toHaveBeenCalled();
  });

  test('409 when restoring a product-backed line whose supplier quote item is stale', async () => {
    setupHappyPath();
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(new Map());
    ovFindByIdMock.mockResolvedValue({
      ...SAMPLE_VERSION,
      snapshot: {
        ...SAMPLE_SNAPSHOT,
        items: [
          {
            ...SAMPLE_ITEM,
            id: 'si-stale-product',
            productId: 'p-1',
            supplierQuoteId: 'sq-1',
            supplierQuoteItemId: 'sqi-gone',
          },
        ],
      },
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain(
      'references a supplier quote item that no longer exists',
    );
    expect(sqGetQuoteItemSnapshotsMock).toHaveBeenCalledWith(['sqi-gone']);
    expect(coRestoreSnapshotOrderMock).not.toHaveBeenCalled();
    expect(coReplaceItemsMock).not.toHaveBeenCalled();
  });

  test('404 when current order does not exist', async () => {
    coFindExistingMock.mockResolvedValue(null);
    ovFindByIdMock.mockResolvedValue(SAMPLE_VERSION);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(coRestoreSnapshotOrderMock).not.toHaveBeenCalled();
    expect(ovInsertMock).not.toHaveBeenCalled();
  });

  test('200 restores a DRAFT order linked to an offer', async () => {
    setupHappyPath();
    coFindExistingMock.mockResolvedValue({
      id: 'o-1',
      linkedQuoteId: null,
      linkedOfferId: 'off-1',
      clientId: 'c1',
      clientName: 'Client',
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage' as const,
      status: 'draft',
      notes: null,
    });
    ovFindByIdMock.mockResolvedValue({
      ...SAMPLE_VERSION,
      snapshot: { ...SAMPLE_SNAPSHOT, order: { ...SAMPLE_ORDER, linkedOfferId: 'off-1' } },
    });
    coRestoreSnapshotOrderMock.mockResolvedValue({ ...SAMPLE_ORDER, linkedOfferId: 'off-1' });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    // Draft source-linked orders are editable, so their versions are restorable too. The
    // restore preserves the offer link (snapshot carries linkedOfferId).
    expect(res.statusCode).toBe(200);
    expect(coRestoreSnapshotOrderMock).toHaveBeenCalled();
    expect(ovInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'o-1', reason: 'restore' }),
      TX_SENTINEL,
    );
  });

  test('409 when a CONFIRMED source-linked order cannot be restored', async () => {
    coFindExistingMock.mockResolvedValue({
      id: 'o-1',
      linkedQuoteId: 'q-1',
      linkedOfferId: null,
      clientId: 'c1',
      clientName: 'Client',
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage' as const,
      status: 'confirmed',
      notes: null,
    });
    ovFindByIdMock.mockResolvedValue(SAMPLE_VERSION);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('restore is only available for draft');
    expect(coRestoreSnapshotOrderMock).not.toHaveBeenCalled();
  });

  test('409 when restore target is not draft', async () => {
    coFindExistingMock.mockResolvedValue({
      id: 'o-1',
      linkedQuoteId: null,
      linkedOfferId: null,
      clientId: 'c1',
      clientName: 'Client',
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage' as const,
      status: 'confirmed',
      notes: null,
    });
    ovFindByIdMock.mockResolvedValue(SAMPLE_VERSION);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('restore is only available for draft');
    expect(coRestoreSnapshotOrderMock).not.toHaveBeenCalled();
  });

  test('409 when snapshot client no longer exists', async () => {
    setupHappyPath();
    clientsExistsByIdMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Snapshot client');
    expect(coRestoreSnapshotOrderMock).not.toHaveBeenCalled();
  });

  test('409 when snapshot product no longer exists', async () => {
    setupHappyPath();
    productsGetSnapshotsMock.mockResolvedValue(new Map());

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Snapshot product');
    expect(coRestoreSnapshotOrderMock).not.toHaveBeenCalled();
  });

  test('404 when version not found (and no cross-order leak)', async () => {
    coFindExistingMock.mockResolvedValue({
      id: 'o-1',
      linkedQuoteId: null,
      linkedOfferId: null,
      clientId: 'c1',
      clientName: 'Client',
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage' as const,
      status: 'draft',
      notes: null,
    });
    ovFindByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-other/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    // findById should be scoped on (orderId, versionId) so a foreign versionId returns null
    expect(ovFindByIdMock).toHaveBeenCalledWith('o-1', 'ov-other');
    expect(coRestoreSnapshotOrderMock).not.toHaveBeenCalled();
  });

  test('403 without update permission (view only)', async () => {
    getRolePermissionsMock.mockResolvedValue(['accounting.clients_orders.view']);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });

  test('409 when a referenced product is deleted between pre-check and tx (FK race)', async () => {
    setupHappyPath();
    const fkError = Object.assign(new Error('foreign key violation'), {
      code: '23503',
      cause: undefined,
    });
    Object.setPrototypeOf(fkError, (await import('pg')).DatabaseError.prototype);
    withDbTransactionMock.mockImplementationOnce(async () => {
      throw fkError;
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('no longer exists');
  });

  // Regression for the codex review on PR #353: the snapshot now carries linkedOfferId, so
  // restore can hit the `idx_sales_linked_offer_id_unique` partial unique index if that offer
  // has been re-linked to a different order since the snapshot was taken. The 23505 must
  // surface as a 409 instead of a 500.
  test('409 when restoring linkedOfferId hits the linked-offer unique index', async () => {
    setupHappyPath();
    const uniqueError = Object.assign(new Error('duplicate key violates unique constraint'), {
      code: '23505',
      constraint: 'idx_sales_linked_offer_id_unique',
      detail: 'Key (linked_offer_id)=(off-1) already exists.',
      cause: undefined,
    });
    Object.setPrototypeOf(uniqueError, (await import('pg')).DatabaseError.prototype);
    withDbTransactionMock.mockImplementationOnce(async () => {
      throw uniqueError;
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('already linked');
  });

  test('POST restore: replaceItems failure rolls back (no audit, no success)', async () => {
    setupHappyPath();
    withDbTransactionMock.mockImplementation(async (cb) => cb(TX_SENTINEL));
    coReplaceItemsMock.mockRejectedValue(new Error('insert failed'));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(500);
    expect(withDbTransactionMock).toHaveBeenCalled();
    expect(coReplaceItemsMock).toHaveBeenCalled();
    expect(coReplaceItemsMock.mock.calls[0]?.at(-1)).toBe(TX_SENTINEL);
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe('PUT /api/clients-orders/:id snapshots pre-update state', () => {
  test('PUT with content changes inserts a snapshot inside the transaction', async () => {
    coFindExistingMock.mockResolvedValue({
      id: 'o-1',
      linkedQuoteId: null,
      linkedOfferId: null,
      clientId: 'c1',
      clientName: 'Client',
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage' as const,
      status: 'draft',
      notes: null,
    });
    coFindFullForSnapshotMock.mockResolvedValue({
      order: SAMPLE_ORDER,
      items: [SAMPLE_ITEM],
    });
    coUpdateMock.mockResolvedValue({ ...SAMPLE_ORDER, notes: 'updated' });
    coReplaceItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: { notes: 'updated' },
    });

    expect(res.statusCode).toBe(200);
    expect(coFindFullForSnapshotMock).toHaveBeenCalled();
    expect(ovInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'o-1', reason: 'update', createdByUserId: 'u1' }),
      TX_SENTINEL,
    );
  });

  test('PUT with status-only update does NOT snapshot (no locked field changes)', async () => {
    coFindExistingMock.mockResolvedValue({
      id: 'o-1',
      linkedQuoteId: null,
      linkedOfferId: null,
      clientId: 'c1',
      clientName: 'Client',
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage' as const,
      status: 'draft',
      notes: null,
    });
    coUpdateMock.mockResolvedValue({ ...SAMPLE_ORDER, status: 'confirmed' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: { status: 'confirmed' },
    });

    expect(res.statusCode).toBe(200);
    expect(ovInsertMock).not.toHaveBeenCalled();
    expect(coFindFullForSnapshotMock).not.toHaveBeenCalled();
    expect(coUpdateMock).toHaveBeenCalledWith('o-1', { status: 'confirmed' }, TX_SENTINEL);
  });

  test('PUT with explicit null notes clears notes and snapshots the previous value', async () => {
    coFindExistingMock.mockResolvedValue({
      id: 'o-1',
      linkedQuoteId: null,
      linkedOfferId: null,
      clientId: 'c1',
      clientName: 'Client',
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage' as const,
      status: 'draft',
      notes: 'old note',
    });
    coFindFullForSnapshotMock.mockResolvedValue({
      order: { ...SAMPLE_ORDER, notes: 'old note' },
      items: [SAMPLE_ITEM],
    });
    coUpdateMock.mockResolvedValue({ ...SAMPLE_ORDER, notes: null });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: { notes: null },
    });

    expect(res.statusCode).toBe(200);
    expect(ovInsertMock).toHaveBeenCalled();
    expect(coUpdateMock).toHaveBeenCalledWith('o-1', { notes: null }, TX_SENTINEL);
  });

  test('PUT on source-linked order does NOT snapshot (status-only edit)', async () => {
    coFindExistingMock.mockResolvedValue({
      id: 'o-1',
      linkedQuoteId: 'q-1',
      linkedOfferId: null,
      clientId: 'c1',
      clientName: 'Client',
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage' as const,
      status: 'draft',
      notes: null,
    });
    coUpdateMock.mockResolvedValue({ ...SAMPLE_ORDER, linkedQuoteId: 'q-1', status: 'confirmed' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: { status: 'confirmed' },
    });

    expect(res.statusCode).toBe(200);
    expect(ovInsertMock).not.toHaveBeenCalled();
  });

  test('PUT with field present but value unchanged does NOT snapshot', async () => {
    coFindExistingMock.mockResolvedValue({
      id: 'o-1',
      linkedQuoteId: null,
      linkedOfferId: null,
      clientId: 'c1',
      clientName: 'Client',
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage' as const,
      status: 'draft',
      notes: null,
    });
    coFindItemsForOrderMock.mockResolvedValue([SAMPLE_ITEM]);
    coUpdateMock.mockResolvedValue(SAMPLE_ORDER);
    coReplaceItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Client',
        paymentTerms: 'immediate',
        discount: 0,
        discountType: 'percentage',
        notes: '',
        items: [
          {
            id: SAMPLE_ITEM.id,
            productId: SAMPLE_ITEM.productId,
            productName: SAMPLE_ITEM.productName,
            quantity: SAMPLE_ITEM.quantity,
            unitPrice: SAMPLE_ITEM.unitPrice,
            productCost: SAMPLE_ITEM.productCost,
            discount: SAMPLE_ITEM.discount,
            unitType: 'hours',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(ovInsertMock).not.toHaveBeenCalled();
    expect(coFindFullForSnapshotMock).not.toHaveBeenCalled();
  });

  test('PUT changing only an item productCost snapshots (regression)', async () => {
    coFindExistingMock.mockResolvedValue({
      id: 'o-1',
      linkedQuoteId: null,
      linkedOfferId: null,
      clientId: 'c1',
      clientName: 'Client',
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage' as const,
      status: 'draft',
      notes: null,
    });
    coFindItemsForOrderMock.mockResolvedValue([SAMPLE_ITEM]);
    coFindFullForSnapshotMock.mockResolvedValue({
      order: SAMPLE_ORDER,
      items: [SAMPLE_ITEM],
    });
    coUpdateMock.mockResolvedValue(SAMPLE_ORDER);
    coReplaceItemsMock.mockResolvedValue([{ ...SAMPLE_ITEM, productCost: 75 }]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            id: SAMPLE_ITEM.id,
            productId: SAMPLE_ITEM.productId,
            productName: SAMPLE_ITEM.productName,
            quantity: SAMPLE_ITEM.quantity,
            unitPrice: SAMPLE_ITEM.unitPrice,
            productCost: 75,
            discount: SAMPLE_ITEM.discount,
            unitType: 'hours',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(ovInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'o-1', reason: 'update' }),
      TX_SENTINEL,
    );
  });

  test('PUT changing only an item unitType snapshots', async () => {
    coFindExistingMock.mockResolvedValue({
      id: 'o-1',
      linkedQuoteId: null,
      linkedOfferId: null,
      clientId: 'c1',
      clientName: 'Client',
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage' as const,
      status: 'draft',
      notes: null,
    });
    coFindItemsForOrderMock.mockResolvedValue([SAMPLE_ITEM]);
    coFindFullForSnapshotMock.mockResolvedValue({
      order: SAMPLE_ORDER,
      items: [SAMPLE_ITEM],
    });
    coUpdateMock.mockResolvedValue(SAMPLE_ORDER);
    coReplaceItemsMock.mockResolvedValue([{ ...SAMPLE_ITEM, unitType: 'days' as const }]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            id: SAMPLE_ITEM.id,
            productId: SAMPLE_ITEM.productId,
            productName: SAMPLE_ITEM.productName,
            quantity: SAMPLE_ITEM.quantity,
            unitPrice: SAMPLE_ITEM.unitPrice,
            productCost: SAMPLE_ITEM.productCost,
            discount: SAMPLE_ITEM.discount,
            unitType: 'days',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(ovInsertMock).toHaveBeenCalled();
  });

  test('PUT preserves each retained marker in a mixed order', async () => {
    const legacyItem = { ...SAMPLE_ITEM, id: 'si-legacy', pricingSemanticsVersion: 1 as const };
    const currentItem = { ...SAMPLE_ITEM, id: 'si-current', pricingSemanticsVersion: 2 as const };
    coFindExistingMock.mockResolvedValue(SAMPLE_ORDER);
    coFindItemsForOrderMock.mockResolvedValue([legacyItem, currentItem]);
    coFindFullForSnapshotMock.mockResolvedValue({
      order: SAMPLE_ORDER,
      items: [legacyItem, currentItem],
    });
    coUpdateMock.mockResolvedValue(SAMPLE_ORDER);
    coReplaceItemsMock.mockResolvedValue([legacyItem, currentItem]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            id: legacyItem.id,
            productId: legacyItem.productId,
            productName: legacyItem.productName,
            quantity: legacyItem.quantity,
            unitPrice: legacyItem.unitPrice,
            productCost: legacyItem.productCost,
            discount: legacyItem.discount,
            unitType: 'hours',
          },
          {
            id: currentItem.id,
            productId: currentItem.productId,
            productName: currentItem.productName,
            quantity: currentItem.quantity,
            unitPrice: currentItem.unitPrice,
            productCost: currentItem.productCost,
            discount: currentItem.discount,
            unitType: 'hours',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(
      (coReplaceItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>).map(
        (item) => item.pricingSemanticsVersion,
      ),
    ).toEqual([1, 2]);
  });

  test('PUT items: replaceItems failure rolls back (no audit, no success)', async () => {
    coFindExistingMock.mockResolvedValue({
      id: 'o-1',
      linkedQuoteId: null,
      linkedOfferId: null,
      clientId: 'c1',
      clientName: 'Client',
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage' as const,
      status: 'draft',
      notes: null,
    });
    coFindItemsForOrderMock.mockResolvedValue([SAMPLE_ITEM]);
    coFindFullForSnapshotMock.mockResolvedValue({
      order: SAMPLE_ORDER,
      items: [SAMPLE_ITEM],
    });
    coUpdateMock.mockResolvedValue(SAMPLE_ORDER);
    withDbTransactionMock.mockImplementation(async (cb) => cb(TX_SENTINEL));
    coReplaceItemsMock.mockRejectedValue(new Error('insert failed'));

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            id: 'si-new',
            productId: SAMPLE_ITEM.productId,
            productName: SAMPLE_ITEM.productName,
            quantity: SAMPLE_ITEM.quantity,
            unitPrice: SAMPLE_ITEM.unitPrice,
            productCost: 999, // differs to force content-change branch
            discount: SAMPLE_ITEM.discount,
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

  test('PUT rejects a fresh supplier quote item without supplier-order create permission', async () => {
    coFindExistingMock.mockResolvedValue(SAMPLE_ORDER);
    coFindItemsForOrderMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            id: SAMPLE_ITEM.id,
            productId: SAMPLE_ITEM.productId,
            productName: SAMPLE_ITEM.productName,
            quantity: SAMPLE_ITEM.quantity,
            unitPrice: SAMPLE_ITEM.unitPrice,
            productCost: SAMPLE_ITEM.productCost,
            discount: SAMPLE_ITEM.discount,
            unitType: SAMPLE_ITEM.unitType,
            supplierQuoteId: 'sq-1',
            supplierQuoteItemId: 'sqi-1',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toContain('accounting.supplier_orders.create');
    expect(sqGetQuoteItemSnapshotsMock).not.toHaveBeenCalled();
    expect(coReplaceItemsMock).not.toHaveBeenCalled();
  });

  test('PUT preserves the stored cost for a retained supplier quote item', async () => {
    const retainedSupplierItem = {
      ...SAMPLE_ITEM,
      supplierQuoteId: 'sq-1',
      supplierQuoteItemId: 'sqi-1',
      supplierQuoteSupplierName: 'ACME',
      supplierQuoteUnitPrice: 50,
    };
    coFindExistingMock.mockResolvedValue(SAMPLE_ORDER);
    coFindItemsForOrderMock.mockResolvedValue([retainedSupplierItem]);
    coFindFullForSnapshotMock.mockResolvedValue({
      order: SAMPLE_ORDER,
      items: [retainedSupplierItem],
    });
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(
      new Map([
        [
          'sqi-1',
          {
            supplierQuoteId: 'sq-1',
            supplierName: 'ACME',
            productId: 'p-1',
            unitPrice: 75,
            netCost: 75,
          },
        ],
      ]),
    );
    coUpdateMock.mockResolvedValue(SAMPLE_ORDER);
    coReplaceItemsMock.mockResolvedValue([{ ...retainedSupplierItem, unitPrice: 101 }]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            id: retainedSupplierItem.id,
            productId: retainedSupplierItem.productId,
            productName: retainedSupplierItem.productName,
            quantity: retainedSupplierItem.quantity,
            unitPrice: 101,
            productCost: retainedSupplierItem.productCost,
            discount: retainedSupplierItem.discount,
            unitType: retainedSupplierItem.unitType,
            supplierQuoteId: retainedSupplierItem.supplierQuoteId,
            supplierQuoteItemId: retainedSupplierItem.supplierQuoteItemId,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(sqGetQuoteItemSnapshotsMock).not.toHaveBeenCalled();
    expect(coReplaceItemsMock.mock.calls[0]?.[1]?.[0]).toEqual(
      expect.objectContaining({
        supplierQuoteUnitPrice: 50,
        productMolPercentage: 50.5,
      }),
    );
  });

  test('PUT rejects moving a retained supplier quote item onto a new sale line', async () => {
    const retainedSupplierItem = {
      ...SAMPLE_ITEM,
      supplierQuoteId: 'sq-1',
      supplierQuoteItemId: 'sqi-1',
      supplierQuoteSupplierName: 'ACME',
      supplierQuoteUnitPrice: 50,
    };
    coFindExistingMock.mockResolvedValue(SAMPLE_ORDER);
    coFindItemsForOrderMock.mockResolvedValue([retainedSupplierItem]);
    coFindFullForSnapshotMock.mockResolvedValue({
      order: SAMPLE_ORDER,
      items: [retainedSupplierItem],
    });
    coUpdateMock.mockResolvedValue(SAMPLE_ORDER);
    coReplaceItemsMock.mockResolvedValue([{ ...retainedSupplierItem, id: 'si-new' }]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            id: 'si-new',
            productId: retainedSupplierItem.productId,
            productName: retainedSupplierItem.productName,
            quantity: retainedSupplierItem.quantity,
            unitPrice: retainedSupplierItem.unitPrice,
            productCost: retainedSupplierItem.productCost,
            discount: retainedSupplierItem.discount,
            unitType: retainedSupplierItem.unitType,
            supplierQuoteId: retainedSupplierItem.supplierQuoteId,
            supplierQuoteItemId: retainedSupplierItem.supplierQuoteItemId,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(403);
    expect(coReplaceItemsMock).not.toHaveBeenCalled();
  });

  test('PUT rejects cloning a retained supplier reference through a repeated line id', async () => {
    const retainedSupplierItem = {
      ...SAMPLE_ITEM,
      supplierQuoteId: 'sq-1',
      supplierQuoteItemId: 'sqi-1',
      supplierQuoteSupplierName: 'ACME',
      supplierQuoteUnitPrice: 50,
    };
    coFindExistingMock.mockResolvedValue(SAMPLE_ORDER);
    coFindItemsForOrderMock.mockResolvedValue([retainedSupplierItem]);
    coFindFullForSnapshotMock.mockResolvedValue({
      order: SAMPLE_ORDER,
      items: [retainedSupplierItem],
    });
    coUpdateMock.mockResolvedValue(SAMPLE_ORDER);
    coReplaceItemsMock.mockResolvedValue([retainedSupplierItem, retainedSupplierItem]);

    const repeatedItem = {
      id: retainedSupplierItem.id,
      productId: retainedSupplierItem.productId,
      productName: retainedSupplierItem.productName,
      quantity: retainedSupplierItem.quantity,
      unitPrice: retainedSupplierItem.unitPrice,
      productCost: retainedSupplierItem.productCost,
      discount: retainedSupplierItem.discount,
      unitType: retainedSupplierItem.unitType,
      supplierQuoteId: retainedSupplierItem.supplierQuoteId,
      supplierQuoteItemId: retainedSupplierItem.supplierQuoteItemId,
    };
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: { items: [repeatedItem, repeatedItem] },
    });

    expect(res.statusCode).toBe(403);
    expect(coReplaceItemsMock).not.toHaveBeenCalled();
  });
});

describe('PUT /api/clients-orders/:id source-linked editability', () => {
  test('200 allows editing a DRAFT order linked to an offer (content + items)', async () => {
    coFindExistingMock.mockResolvedValue({
      id: 'o-1',
      linkedQuoteId: null,
      linkedOfferId: 'off-1',
      clientId: 'c1',
      clientName: 'Client',
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage' as const,
      status: 'draft',
      notes: null,
    });
    coFindItemsForOrderMock.mockResolvedValue([SAMPLE_ITEM]);
    coFindFullForSnapshotMock.mockResolvedValue({
      order: { ...SAMPLE_ORDER, linkedOfferId: 'off-1' },
      items: [SAMPLE_ITEM],
    });
    coUpdateMock.mockResolvedValue({ ...SAMPLE_ORDER, linkedOfferId: 'off-1', notes: 'edited' });
    coReplaceItemsMock.mockResolvedValue([{ ...SAMPLE_ITEM, quantity: 5 }]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: {
        notes: 'edited',
        items: [
          {
            id: SAMPLE_ITEM.id,
            productId: SAMPLE_ITEM.productId,
            productName: SAMPLE_ITEM.productName,
            quantity: 5,
            unitPrice: SAMPLE_ITEM.unitPrice,
            productCost: SAMPLE_ITEM.productCost,
            discount: SAMPLE_ITEM.discount,
            unitType: 'hours',
          },
        ],
      },
    });

    // Before the fix this returned 409 'Quote-linked order details are read-only'.
    expect(res.statusCode).toBe(200);
    expect(coUpdateMock).toHaveBeenCalledWith(
      'o-1',
      expect.objectContaining({ notes: 'edited' }),
      TX_SENTINEL,
    );
    // Items are now actually replaced for a draft source-linked order.
    expect(coReplaceItemsMock).toHaveBeenCalled();
    // The content change is captured in version history.
    expect(ovInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'o-1', reason: 'update' }),
      TX_SENTINEL,
    );
  });

  test('200 allows editing content on a CONFIRMED order linked to an offer', async () => {
    coFindExistingMock.mockResolvedValue({
      id: 'o-1',
      linkedQuoteId: null,
      linkedOfferId: 'off-1',
      clientId: 'c1',
      clientName: 'Client',
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage' as const,
      status: 'confirmed',
      notes: null,
    });
    coFindItemsForOrderMock.mockResolvedValue([SAMPLE_ITEM]);
    coFindFullForSnapshotMock.mockResolvedValue({
      order: { ...SAMPLE_ORDER, linkedOfferId: 'off-1', status: 'confirmed' },
      items: [SAMPLE_ITEM],
    });
    coUpdateMock.mockResolvedValue({
      ...SAMPLE_ORDER,
      linkedOfferId: 'off-1',
      status: 'confirmed',
      notes: 'edited',
      paymentTerms: '30gg',
    });
    coReplaceItemsMock.mockResolvedValue([{ ...SAMPLE_ITEM, quantity: 3 }]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: {
        linkedOfferId: 'off-1',
        clientId: 'c1',
        clientName: 'Client',
        paymentTerms: '30gg',
        notes: 'edited',
        items: [
          {
            id: SAMPLE_ITEM.id,
            productId: SAMPLE_ITEM.productId,
            productName: SAMPLE_ITEM.productName,
            quantity: 3,
            unitPrice: SAMPLE_ITEM.unitPrice,
            productCost: SAMPLE_ITEM.productCost,
            discount: SAMPLE_ITEM.discount,
            unitType: 'hours',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(coUpdateMock).toHaveBeenCalledWith(
      'o-1',
      expect.objectContaining({
        clientId: 'c1',
        clientName: 'Client',
        notes: 'edited',
        paymentTerms: '30gg',
      }),
      TX_SENTINEL,
    );
    expect(coReplaceItemsMock).toHaveBeenCalled();
    expect(coFindOfferDetailsMock).not.toHaveBeenCalled();
    expect(ovInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'o-1', reason: 'update' }),
      TX_SENTINEL,
    );
  });

  test('409 rejects identity changes on a CONFIRMED order', async () => {
    const cases = [
      { field: 'clientId', payload: { clientId: 'c2' } },
      { field: 'clientName', payload: { clientName: 'Other Client' } },
      { field: 'linkedOfferId', payload: { linkedOfferId: 'off-2' } },
      { field: 'id', payload: { id: 'o-2' } },
    ];

    for (const { field, payload } of cases) {
      coFindExistingMock.mockResolvedValue({
        id: 'o-1',
        linkedQuoteId: null,
        linkedOfferId: 'off-1',
        clientId: 'c1',
        clientName: 'Client',
        paymentTerms: 'immediate',
        discount: 0,
        discountType: 'percentage' as const,
        status: 'confirmed',
        notes: null,
      });

      const res = await testApp.inject({
        method: 'PUT',
        url: '/api/clients-orders/o-1',
        headers: authHeader(),
        payload,
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.error).toContain('identity fields are read-only');
      const auditCall = logAuditMock.mock.calls.at(-1) as
        | [{ details?: { changedFields?: string[] } }]
        | undefined;
      expect(auditCall?.[0].details?.changedFields).toContain(field);
    }
    expect(coUpdateMock).not.toHaveBeenCalled();
    expect(ovInsertMock).not.toHaveBeenCalled();
  });

  test('409 still rejects content edits on a DENIED order linked to an offer', async () => {
    coFindExistingMock.mockResolvedValue({
      id: 'o-1',
      linkedQuoteId: null,
      linkedOfferId: 'off-2',
      clientId: 'c1',
      clientName: 'Client',
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage' as const,
      status: 'denied',
      notes: null,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: { notes: 'edited' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Denied');
    expect(coUpdateMock).not.toHaveBeenCalled();
    expect(ovInsertMock).not.toHaveBeenCalled();
  });

  test('409 keeps supplier-order-backed lines protected on a CONFIRMED order', async () => {
    coFindExistingMock.mockResolvedValue({
      id: 'o-1',
      linkedQuoteId: null,
      linkedOfferId: 'off-1',
      clientId: 'c1',
      clientName: 'Client',
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage' as const,
      status: 'confirmed',
      notes: null,
    });
    coFindItemsForOrderMock.mockResolvedValue([SUPPLIER_BACKED_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            id: SUPPLIER_BACKED_ITEM.id,
            productId: SUPPLIER_BACKED_ITEM.productId,
            productName: SUPPLIER_BACKED_ITEM.productName,
            quantity: 99,
            unitPrice: SUPPLIER_BACKED_ITEM.unitPrice,
            productCost: SUPPLIER_BACKED_ITEM.productCost,
            discount: SUPPLIER_BACKED_ITEM.discount,
            supplierQuoteId: SUPPLIER_BACKED_ITEM.supplierQuoteId,
            supplierQuoteItemId: SUPPLIER_BACKED_ITEM.supplierQuoteItemId,
            supplierSaleId: SUPPLIER_BACKED_ITEM.supplierSaleId,
            supplierSaleItemId: SUPPLIER_BACKED_ITEM.supplierSaleItemId,
            unitType: 'hours',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('supplier order');
    expect(coReplaceItemsMock).not.toHaveBeenCalled();
    expect(coUpdateMock).not.toHaveBeenCalled();
  });

  const draftOfferLinkedOrder = {
    id: 'o-1',
    linkedQuoteId: null,
    linkedOfferId: 'off-1',
    clientId: 'c1',
    clientName: 'Client',
    paymentTerms: 'immediate',
    discount: 0,
    discountType: 'percentage' as const,
    status: 'draft',
    notes: null,
  };

  test('409 rejects dropping a line linked to a supplier order from a DRAFT order', async () => {
    coFindExistingMock.mockResolvedValue({ ...draftOfferLinkedOrder });
    coFindItemsForOrderMock.mockResolvedValue([SUPPLIER_BACKED_ITEM]);

    // Payload omits the supplier-order-backed line, replacing it with an unrelated one.
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            id: 'si-new',
            productId: 'p-2',
            productName: 'Other service',
            quantity: 1,
            unitPrice: 10,
            productCost: 5,
            discount: 0,
            unitType: 'hours',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('supplier order');
    expect(coReplaceItemsMock).not.toHaveBeenCalled();
    expect(coUpdateMock).not.toHaveBeenCalled();
    expect(ovInsertMock).not.toHaveBeenCalled();
  });

  test('409 rejects changing the quantity of a supplier-order-backed line', async () => {
    coFindExistingMock.mockResolvedValue({ ...draftOfferLinkedOrder });
    coFindItemsForOrderMock.mockResolvedValue([SUPPLIER_BACKED_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            id: SUPPLIER_BACKED_ITEM.id,
            productId: SUPPLIER_BACKED_ITEM.productId,
            productName: SUPPLIER_BACKED_ITEM.productName,
            quantity: 99, // changed from 2 — would desync the procurement order
            unitPrice: SUPPLIER_BACKED_ITEM.unitPrice,
            productCost: SUPPLIER_BACKED_ITEM.productCost,
            discount: SUPPLIER_BACKED_ITEM.discount,
            supplierQuoteId: SUPPLIER_BACKED_ITEM.supplierQuoteId,
            supplierQuoteItemId: SUPPLIER_BACKED_ITEM.supplierQuoteItemId,
            supplierSaleId: SUPPLIER_BACKED_ITEM.supplierSaleId,
            supplierSaleItemId: SUPPLIER_BACKED_ITEM.supplierSaleItemId,
            unitType: 'hours',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('supplier order');
    expect(coReplaceItemsMock).not.toHaveBeenCalled();
  });

  test('200 allows editing around a preserved supplier-order-backed line', async () => {
    coFindExistingMock.mockResolvedValue({ ...draftOfferLinkedOrder });
    coFindItemsForOrderMock.mockResolvedValue([SUPPLIER_BACKED_ITEM]);
    coFindFullForSnapshotMock.mockResolvedValue({
      order: { ...SAMPLE_ORDER, linkedOfferId: 'off-1' },
      items: [SUPPLIER_BACKED_ITEM],
    });
    coUpdateMock.mockResolvedValue({ ...SAMPLE_ORDER, linkedOfferId: 'off-1', notes: 'edited' });
    coReplaceItemsMock.mockResolvedValue([
      SUPPLIER_BACKED_ITEM,
      { ...SAMPLE_ITEM, id: 'si-new', productId: 'p-2' },
    ]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/clients-orders/o-1',
      headers: authHeader(),
      payload: {
        notes: 'edited',
        items: [
          {
            // Supplier-backed line preserved (same product + quantity); sale price and discount may move.
            id: SUPPLIER_BACKED_ITEM.id,
            productId: SUPPLIER_BACKED_ITEM.productId,
            productName: SUPPLIER_BACKED_ITEM.productName,
            quantity: SUPPLIER_BACKED_ITEM.quantity,
            unitPrice: 250,
            productCost: SUPPLIER_BACKED_ITEM.productCost,
            discount: 25,
            supplierQuoteId: SUPPLIER_BACKED_ITEM.supplierQuoteId,
            supplierQuoteItemId: SUPPLIER_BACKED_ITEM.supplierQuoteItemId,
            supplierSaleId: SUPPLIER_BACKED_ITEM.supplierSaleId,
            supplierSaleItemId: SUPPLIER_BACKED_ITEM.supplierSaleItemId,
            unitType: 'hours',
          },
          {
            // A brand-new, non-supplier line is allowed alongside it.
            id: 'si-new',
            productId: 'p-2',
            productName: 'Added service',
            quantity: 1,
            unitPrice: 10,
            productCost: 5,
            discount: 0,
            unitType: 'hours',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(coReplaceItemsMock).toHaveBeenCalled();
    const inserted = coReplaceItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(inserted[0].discount).toBe(25);
    expect(coUpdateMock).toHaveBeenCalledWith(
      'o-1',
      expect.objectContaining({ notes: 'edited' }),
      TX_SENTINEL,
    );
  });
});
