import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realClientsOrdersRepo from '../../repositories/clientsOrdersRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realSupplierQuotesRepo from '../../repositories/supplierQuotesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realDocumentCodes from '../../services/documentCodes.ts';
import * as realAudit from '../../utils/audit.ts';
import * as realPermissions from '../../utils/permissions.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';
import { signToken } from '../helpers/jwt.ts';
import { makeWithDbTransactionMock } from '../helpers/withDbTransactionMock.ts';

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const clientsOrdersRepoSnap = { ...realClientsOrdersRepo };
const supplierQuotesRepoSnap = { ...realSupplierQuotesRepo };
const documentCodesSnap = { ...realDocumentCodes };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const coCreateMock = mock();
const coInsertItemsMock = mock();
const coFindItemsForOrderMock = mock();
const coCreateSupplierOrderMock = mock();
const coBulkInsertSupplierOrderItemsMock = mock();
const coLinkSaleItemsToSupplierOrderMock = mock();
const coMapSaleItemsToSupplierItemsMock = mock();
const sqFindByIdMock = mock();
const sqFindLinkedOrderIdMock = mock();
const sqLockEffectiveStatusByIdMock = mock();
const sqFindItemsForQuoteMock = mock();
const sqGetQuoteItemSnapshotsMock = mock();
const allocateDocumentCodeMock = mock();

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
  mock.module('../../repositories/clientsOrdersRepo.ts', () => ({
    ...clientsOrdersRepoSnap,
    create: coCreateMock,
    insertItems: coInsertItemsMock,
    findItemsForOrder: coFindItemsForOrderMock,
    createSupplierOrder: coCreateSupplierOrderMock,
    bulkInsertSupplierOrderItems: coBulkInsertSupplierOrderItemsMock,
    linkSaleItemsToSupplierOrder: coLinkSaleItemsToSupplierOrderMock,
    mapSaleItemsToSupplierItems: coMapSaleItemsToSupplierItemsMock,
  }));
  mock.module('../../repositories/supplierQuotesRepo.ts', () => ({
    ...supplierQuotesRepoSnap,
    findById: sqFindByIdMock,
    findLinkedOrderId: sqFindLinkedOrderIdMock,
    lockEffectiveStatusById: sqLockEffectiveStatusByIdMock,
    findItemsForQuote: sqFindItemsForQuoteMock,
    getQuoteItemSnapshots: sqGetQuoteItemSnapshotsMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));
  mock.module('../../services/documentCodes.ts', () => ({
    ...documentCodesSnap,
    allocateDocumentCode: allocateDocumentCodeMock,
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
  mock.module('../../services/documentCodes.ts', () => documentCodesSnap);
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

const FULL_PERMS = ['accounting.clients_orders.create'];

const CREATED_ORDER = {
  id: 'co-1',
  linkedQuoteId: null,
  linkedOfferId: null,
  clientId: 'c1',
  clientName: 'Acme',
  paymentTerms: 'immediate',
  discount: 0,
  discountType: 'percentage' as const,
  status: 'draft',
  notes: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

// Mirrors clientOrderItemSchema's required fields so fast-json-stringify serializes the 201 body.
const insertedItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'si-1',
  orderId: 'co-1',
  productId: 'p-1',
  productName: 'Service',
  quantity: 1,
  unitPrice: 100,
  productCost: 0,
  productMolPercentage: null,
  supplierQuoteId: null,
  supplierQuoteItemId: null,
  supplierQuoteSupplierName: null,
  supplierQuoteUnitPrice: null,
  supplierSaleId: null,
  supplierSaleItemId: null,
  supplierSaleSupplierName: null,
  unitType: 'hours' as const,
  note: null,
  discount: 0,
  durationMonths: 1,
  durationUnit: 'months' as const,
  ...overrides,
});

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  coCreateMock,
  coInsertItemsMock,
  coFindItemsForOrderMock,
  coCreateSupplierOrderMock,
  coBulkInsertSupplierOrderItemsMock,
  coLinkSaleItemsToSupplierOrderMock,
  coMapSaleItemsToSupplierItemsMock,
  sqFindByIdMock,
  sqFindLinkedOrderIdMock,
  sqLockEffectiveStatusByIdMock,
  sqFindItemsForQuoteMock,
  sqGetQuoteItemSnapshotsMock,
  allocateDocumentCodeMock,
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
  coCreateMock.mockResolvedValue(CREATED_ORDER);
  allocateDocumentCodeMock.mockResolvedValue('ORD-2999-0001');
  coFindItemsForOrderMock.mockResolvedValue([insertedItem()]);
  coCreateSupplierOrderMock.mockResolvedValue(undefined);
  coBulkInsertSupplierOrderItemsMock.mockResolvedValue(undefined);
  coLinkSaleItemsToSupplierOrderMock.mockResolvedValue(undefined);
  coMapSaleItemsToSupplierItemsMock.mockResolvedValue(undefined);
  // Default: no supplier quote resolves, so the auto-create-supplier-order branch fast-fails.
  sqFindByIdMock.mockResolvedValue(null);
  sqFindLinkedOrderIdMock.mockResolvedValue(null);
  sqLockEffectiveStatusByIdMock.mockResolvedValue(null);
  sqFindItemsForQuoteMock.mockResolvedValue([]);
  // Default: the referenced supplier-quote item belongs to an accepted quote (sq-1), so a
  // product-less line resolves. The dangling/bogus-ref test overrides this to an empty Map.
  sqGetQuoteItemSnapshotsMock.mockResolvedValue(
    new Map([
      [
        'sqi-1',
        {
          supplierQuoteId: 'sq-1',
          supplierName: 'Supplier Co',
          productId: null,
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

describe('POST /api/clients-orders product-less supplier lines (issue #783)', () => {
  test('201 auto-generates an order id when the create payload omits it', async () => {
    coCreateMock.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({ ...CREATED_ORDER, id: input.id }),
    );
    coInsertItemsMock.mockImplementation((orderId: string) =>
      Promise.resolve([insertedItem({ orderId })]),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Acme',
        items: [{ productId: 'p-1', productName: 'Service', quantity: 1, unitPrice: 100 }],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(allocateDocumentCodeMock).toHaveBeenCalledWith('client_order', {
      exec: expect.anything(),
    });
    expect(coCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ORD-2999-0001' }),
      expect.anything(),
    );
    expect(JSON.parse(res.body).id).toBe('ORD-2999-0001');
  });

  test('201 creates an order from a supplier-quote line with no productId', async () => {
    // The offer→order conversion sends this exact shape: a free-form supplier line carries the
    // supplier-quote reference (supplierQuoteId + supplierQuoteItemId) but a null productId.
    coInsertItemsMock.mockResolvedValue([
      insertedItem({
        productId: null,
        productName: 'Free-form supplier line',
        supplierQuoteId: 'sq-1',
        supplierQuoteItemId: 'sqi-1',
      }),
    ]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: {
        id: 'co-1',
        clientId: 'c1',
        clientName: 'Acme',
        items: [
          {
            productId: null,
            productName: 'Free-form supplier line',
            quantity: 1,
            unitPrice: 100,
            supplierQuoteId: 'sq-1',
            supplierQuoteItemId: 'sqi-1',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    // The line reached the repo insert with a NULL productId, not a rejected request.
    expect(coInsertItemsMock).toHaveBeenCalledTimes(1);
    const insertedItems = coInsertItemsMock.mock.calls[0][1] as Array<{ productId: unknown }>;
    expect(insertedItems[0].productId).toBeNull();
    const body = JSON.parse(res.body);
    expect(body.items[0].productId).toBeNull();
  });

  test('201 accepts an item-only supplier reference (supplierQuoteItemId, no supplierQuoteId)', async () => {
    // The client-quotes pattern: callers may send only the item id. resolveSupplierQuoteRefs
    // resolves it against accepted quotes and stamps the authoritative supplierQuoteId, so the
    // line is not dangling and clients need not duplicate the quote id.
    coInsertItemsMock.mockResolvedValue([
      insertedItem({
        productId: null,
        productName: 'Item-only supplier line',
        supplierQuoteId: 'sq-1',
        supplierQuoteItemId: 'sqi-1',
      }),
    ]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: {
        id: 'co-1',
        clientId: 'c1',
        clientName: 'Acme',
        items: [
          {
            productId: null,
            productName: 'Item-only supplier line',
            quantity: 1,
            unitPrice: 100,
            supplierQuoteItemId: 'sqi-1',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const insertedItems = coInsertItemsMock.mock.calls[0][1] as Array<{
      productId: unknown;
      supplierQuoteId: unknown;
    }>;
    // supplierQuoteId was derived from the accepted-quote snapshot, not supplied by the client.
    expect(insertedItems[0].supplierQuoteId).toBe('sq-1');
  });

  test('400 when a line has neither productId nor supplierQuoteItemId', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: {
        id: 'co-1',
        clientId: 'c1',
        clientName: 'Acme',
        items: [{ productName: 'Orphan line', quantity: 1, unitPrice: 100 }],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('productId is required');
    expect(coCreateMock).not.toHaveBeenCalled();
    expect(coInsertItemsMock).not.toHaveBeenCalled();
  });

  test('a product-less line carrying a supplierQuoteId enters supplier-order auto-create', async () => {
    // The real offer→order payload sends a product-less line that ALSO carries supplierQuoteId +
    // supplier fields, which drives the auto-create-supplier-order loop. Exercise that the null
    // productId does not derail the supplier-quote extraction (here it fast-fails to skip).
    coInsertItemsMock.mockResolvedValue([
      insertedItem({
        productId: null,
        productName: 'Free-form supplier line',
        supplierQuoteId: 'sq-1',
        supplierQuoteItemId: 'sqi-1',
      }),
    ]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: {
        id: 'co-1',
        clientId: 'c1',
        clientName: 'Acme',
        items: [
          {
            productId: null,
            productName: 'Free-form supplier line',
            quantity: 1,
            unitPrice: 100,
            supplierQuoteId: 'sq-1',
            supplierQuoteItemId: 'sqi-1',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    // The supplier-quote extraction ran for the product-less line (keyed on supplierQuoteId).
    expect(sqFindByIdMock).toHaveBeenCalledWith('sq-1');
    const insertedItems = coInsertItemsMock.mock.calls[0][1] as Array<{
      productId: unknown;
      supplierQuoteId: unknown;
    }>;
    expect(insertedItems[0].productId).toBeNull();
    expect(insertedItems[0].supplierQuoteId).toBe('sq-1');
    // The vanished supplier quote is surfaced, not silently skipped (#779).
    expect(JSON.parse(res.body).warnings).toEqual([
      expect.stringContaining('supplier quote sq-1 no longer exists'),
    ]);
  });

  test('201 with a warning when a sourced supplier quote is not derived-accepted (#779)', async () => {
    // Line-sourced only — no header link — so the quote derives 'draft' forever and the
    // auto-create must skip it LOUDLY: silent skips left multi-supplier procurement undone.
    coInsertItemsMock.mockResolvedValue([
      insertedItem({
        productId: null,
        productName: 'Sourced line',
        supplierQuoteId: 'sq-1',
        supplierQuoteItemId: 'sqi-1',
      }),
    ]);
    sqFindByIdMock.mockResolvedValue({
      id: 'sq-1',
      supplierId: 's-1',
      supplierName: 'Supplier Co',
      clientId: null,
      clientName: null,
      paymentTerms: 'net30',
      status: 'draft',
      expirationDate: '2999-12-31',
      linkedOrderId: null,
      notes: null,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      linkedClientQuoteId: null,
      linkedClientQuoteStatus: null,
      linkedClientQuoteExpiration: null,
      linkedOfferStatus: null,
      linkedOfferExpiration: null,
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: {
        id: 'co-1',
        clientId: 'c1',
        clientName: 'Acme',
        items: [
          {
            productId: null,
            productName: 'Sourced line',
            quantity: 1,
            unitPrice: 100,
            supplierQuoteId: 'sq-1',
            supplierQuoteItemId: 'sqi-1',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).warnings).toEqual([
      expect.stringContaining("its status is 'draft', not 'accepted'"),
    ]);
  });

  test('201 still creates a normal catalog-product line', async () => {
    coInsertItemsMock.mockResolvedValue([insertedItem()]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: {
        id: 'co-1',
        clientId: 'c1',
        clientName: 'Acme',
        items: [{ productId: 'p-1', productName: 'Service', quantity: 1, unitPrice: 100 }],
      },
    });

    expect(res.statusCode).toBe(201);
    const insertedItems = coInsertItemsMock.mock.calls[0][1] as Array<{ productId: unknown }>;
    expect(insertedItems[0].productId).toBe('p-1');
  });

  test('accepts the real offer→order payload: supplier line keeps optional nullable fields null', async () => {
    coInsertItemsMock.mockResolvedValue([
      insertedItem({
        productId: null,
        productName: 'Free-form supplier line',
        supplierQuoteId: 'sq-1',
        supplierQuoteItemId: 'sqi-1',
      }),
    ]);

    // This is the exact shape `clientOffersRepo.mapItem` + the frontend spread produce for a
    // supplier-quote-sourced offer line: the supplier reference (supplierQuoteId + item id) is set,
    // while the remaining nullable fields arrive as explicit `null`, not omitted. The body schema
    // must accept the nulls and they must survive validation (not be coerced to 0/'').
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: {
        id: 'co-1',
        clientId: 'c1',
        clientName: 'Acme',
        items: [
          {
            productId: null,
            productName: 'Free-form supplier line',
            quantity: 1,
            unitPrice: 100,
            productCost: 0,
            productMolPercentage: null,
            supplierQuoteId: 'sq-1',
            supplierQuoteItemId: 'sqi-1',
            supplierQuoteSupplierName: null,
            supplierQuoteUnitPrice: null,
            supplierSaleId: null,
            supplierSaleItemId: null,
            supplierSaleSupplierName: null,
            note: null,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const inserted = coInsertItemsMock.mock.calls[0][1] as Array<{
      productMolPercentage: unknown;
      supplierQuoteUnitPrice: unknown;
      supplierQuoteId: unknown;
    }>;
    // productMolPercentage isn't derived, so its explicit null survives validation (not coerced).
    expect(inserted[0].productMolPercentage).toBeNull();
    // supplierQuoteId + supplierQuoteUnitPrice are stamped from the accepted-quote snapshot.
    expect(inserted[0].supplierQuoteId).toBe('sq-1');
    expect(inserted[0].supplierQuoteUnitPrice).toBe(50);
  });

  test('400 when a product-less line references an invalid or non-accepted supplier quote', async () => {
    // No snapshot resolves (bogus id, or the quote isn't accepted): the line has no real supplier
    // backing and must be rejected, not persisted as a dangling UI-locked supplier line.
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(new Map());

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: {
        id: 'co-1',
        clientId: 'c1',
        clientName: 'Acme',
        items: [
          {
            productId: null,
            productName: 'Bogus supplier line',
            quantity: 1,
            unitPrice: 100,
            supplierQuoteId: 'sq-unknown',
            supplierQuoteItemId: 'sqi-unknown',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain(
      'does not reference an existing supplier quote item',
    );
    expect(coCreateMock).not.toHaveBeenCalled();
    expect(coInsertItemsMock).not.toHaveBeenCalled();
  });

  test('derives supplier fields from the snapshot, overriding mismatched client values', async () => {
    // A direct POST cannot spoof supplier metadata: the persisted line carries the snapshot's
    // authoritative quote id / supplier name / unit price, and the auto-create keys off the real id.
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(
      new Map([
        [
          'sqi-1',
          {
            supplierQuoteId: 'sq-real',
            supplierName: 'Real Supplier',
            productId: null,
            unitPrice: 75,
            netCost: 75,
          },
        ],
      ]),
    );
    coInsertItemsMock.mockResolvedValue([
      insertedItem({
        productId: null,
        productName: 'Free-form supplier line',
        supplierQuoteId: 'sq-real',
        supplierQuoteItemId: 'sqi-1',
      }),
    ]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: {
        id: 'co-1',
        clientId: 'c1',
        clientName: 'Acme',
        items: [
          {
            productId: null,
            productName: 'Free-form supplier line',
            quantity: 1,
            unitPrice: 100,
            supplierQuoteId: 'sq-client-lie',
            supplierQuoteItemId: 'sqi-1',
            supplierQuoteSupplierName: 'Client Spoof',
            supplierQuoteUnitPrice: 999,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const inserted = coInsertItemsMock.mock.calls[0][1] as Array<{
      supplierQuoteId: unknown;
      supplierQuoteSupplierName: unknown;
      supplierQuoteUnitPrice: unknown;
    }>;
    expect(inserted[0].supplierQuoteId).toBe('sq-real');
    expect(inserted[0].supplierQuoteSupplierName).toBe('Real Supplier');
    expect(inserted[0].supplierQuoteUnitPrice).toBe(75);
    expect(sqFindByIdMock).toHaveBeenCalledWith('sq-real');
    expect(sqFindByIdMock).not.toHaveBeenCalledWith('sq-client-lie');
  });

  test('adopts the catalog productId from a catalog-backed supplier-quote snapshot', async () => {
    // When the accepted supplier-quote item maps to a real catalog product, a product-less order
    // line must inherit that productId so the sale is not stored product-less and stays visible to
    // product quick-links and the catalog usage/revenue reports.
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(
      new Map([
        [
          'sqi-1',
          {
            supplierQuoteId: 'sq-1',
            supplierName: 'Supplier Co',
            productId: 'p-cat',
            unitPrice: 50,
            netCost: 50,
          },
        ],
      ]),
    );
    coInsertItemsMock.mockResolvedValue([
      insertedItem({
        productId: 'p-cat',
        productName: 'Catalog supplier line',
        supplierQuoteId: 'sq-1',
        supplierQuoteItemId: 'sqi-1',
      }),
    ]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: {
        id: 'co-1',
        clientId: 'c1',
        clientName: 'Acme',
        items: [
          {
            productId: null,
            productName: 'Catalog supplier line',
            quantity: 1,
            unitPrice: 100,
            supplierQuoteId: 'sq-1',
            supplierQuoteItemId: 'sqi-1',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const inserted = coInsertItemsMock.mock.calls[0][1] as Array<{
      productId: unknown;
      supplierQuoteItemId: unknown;
    }>;
    // The line inherited the catalog productId from the snapshot — no longer product-less.
    expect(inserted[0].productId).toBe('p-cat');
    expect(inserted[0].supplierQuoteItemId).toBe('sqi-1');
  });
});
