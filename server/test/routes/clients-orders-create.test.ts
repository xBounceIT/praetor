import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realClientOffersRepo from '../../repositories/clientOffersRepo.ts';
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
const clientOffersRepoSnap = { ...realClientOffersRepo };
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
const coFindOfferDetailsMock = mock();
const coFindExistingForOfferMock = mock();
const coCreateSupplierOrderMock = mock();
const coBulkInsertSupplierOrderItemsMock = mock();
const coLinkSaleItemsToSupplierOrderMock = mock();
const coMapSaleItemsToSupplierItemsMock = mock();
const coLinkSaleItemsToSupplierOrderAndItemsMock = mock();
const sqFindByIdMock = mock();
const sqFindLinkedOrderIdMock = mock();
const sqLockEffectiveStatusByIdMock = mock();
const sqFindItemsForQuoteMock = mock();
const sqGetQuoteItemSnapshotsMock = mock();
const clientOfferLockExistingByIdMock = mock();
const clientOfferFindItemsForOfferMock = mock();
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
    findOfferDetails: coFindOfferDetailsMock,
    findExistingForOffer: coFindExistingForOfferMock,
    createSupplierOrder: coCreateSupplierOrderMock,
    bulkInsertSupplierOrderItems: coBulkInsertSupplierOrderItemsMock,
    linkSaleItemsToSupplierOrder: coLinkSaleItemsToSupplierOrderMock,
    mapSaleItemsToSupplierItems: coMapSaleItemsToSupplierItemsMock,
    linkSaleItemsToSupplierOrderAndItems: coLinkSaleItemsToSupplierOrderAndItemsMock,
  }));
  mock.module('../../repositories/clientOffersRepo.ts', () => ({
    ...clientOffersRepoSnap,
    lockExistingById: clientOfferLockExistingByIdMock,
    findItemsForOffer: clientOfferFindItemsForOfferMock,
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
  mock.module('../../repositories/clientOffersRepo.ts', () => clientOffersRepoSnap);
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

const FULL_PERMS = ['accounting.clients_orders.create', 'accounting.supplier_orders.create'];

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
  coFindOfferDetailsMock,
  coFindExistingForOfferMock,
  coCreateSupplierOrderMock,
  coBulkInsertSupplierOrderItemsMock,
  coLinkSaleItemsToSupplierOrderMock,
  coMapSaleItemsToSupplierItemsMock,
  coLinkSaleItemsToSupplierOrderAndItemsMock,
  sqFindByIdMock,
  sqFindLinkedOrderIdMock,
  sqLockEffectiveStatusByIdMock,
  sqFindItemsForQuoteMock,
  sqGetQuoteItemSnapshotsMock,
  clientOfferLockExistingByIdMock,
  clientOfferFindItemsForOfferMock,
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
  coFindOfferDetailsMock.mockResolvedValue({
    id: 'OFF_26_0045_manual',
    linkedQuoteId: 'legacy-quote-id',
    clientId: 'c1',
    status: 'accepted',
  });
  coFindExistingForOfferMock.mockResolvedValue(null);
  clientOfferLockExistingByIdMock.mockResolvedValue({
    id: 'OFF_26_0045_manual',
    linkedQuoteId: 'legacy-quote-id',
    status: 'accepted',
  });
  clientOfferFindItemsForOfferMock.mockResolvedValue([]);
  coCreateSupplierOrderMock.mockResolvedValue(undefined);
  coBulkInsertSupplierOrderItemsMock.mockResolvedValue(undefined);
  coLinkSaleItemsToSupplierOrderMock.mockResolvedValue(undefined);
  coMapSaleItemsToSupplierItemsMock.mockResolvedValue(undefined);
  coLinkSaleItemsToSupplierOrderAndItemsMock.mockResolvedValue(undefined);
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
  test('400 rejects a percentage document discount above 100%', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Acme',
        discount: 100.01,
        discountType: 'percentage',
        items: [{ productId: 'p-1', productName: 'Service', quantity: 1, unitPrice: 100 }],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(coCreateMock).not.toHaveBeenCalled();
  });

  test('201 accepts a fixed-currency document discount above 100', async () => {
    coCreateMock.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({ ...CREATED_ORDER, ...input }),
    );
    coInsertItemsMock.mockResolvedValue([insertedItem()]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Acme',
        discount: 150,
        discountType: 'currency',
        items: [{ productId: 'p-1', productName: 'Service', quantity: 1, unitPrice: 100 }],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(coCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ discount: 150, discountType: 'currency' }),
      expect.anything(),
    );
  });

  test('201 accepts the inclusive 100% line-discount boundary', async () => {
    coCreateMock.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({ ...CREATED_ORDER, id: input.id }),
    );
    coInsertItemsMock.mockImplementation((orderId: string) =>
      Promise.resolve([insertedItem({ orderId, discount: 100 })]),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Acme',
        items: [
          {
            productId: 'p-1',
            productName: 'Service',
            quantity: 1,
            unitPrice: 100,
            discount: 100,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const inserted = coInsertItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(inserted[0].discount).toBe(100);
  });

  test('400 rejects a line discount above 100%', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Acme',
        items: [
          {
            productId: 'p-1',
            productName: 'Service',
            quantity: 1,
            unitPrice: 100,
            discount: 100.01,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(coCreateMock).not.toHaveBeenCalled();
  });

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

  test('201 inherits the automatic order code from a parseable linked quote id', async () => {
    coCreateMock.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({ ...CREATED_ORDER, id: input.id, linkedQuoteId: input.linkedQuoteId }),
    );
    coInsertItemsMock.mockImplementation((orderId: string) =>
      Promise.resolve([insertedItem({ orderId })]),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: {
        linkedQuoteId: 'PREV_26_0045_manual',
        clientId: 'c1',
        clientName: 'Acme',
        items: [{ productId: 'p-1', productName: 'Service', quantity: 1, unitPrice: 100 }],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(allocateDocumentCodeMock).toHaveBeenCalledWith('client_order', {
      exec: expect.anything(),
      sourceCodes: ['PREV_26_0045_manual'],
    });
  });

  test('201 inherits from linked offer when linked quote id is not parseable', async () => {
    coCreateMock.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({
        ...CREATED_ORDER,
        id: input.id,
        linkedQuoteId: input.linkedQuoteId,
        linkedOfferId: input.linkedOfferId,
      }),
    );
    coInsertItemsMock.mockImplementation((orderId: string) =>
      Promise.resolve([insertedItem({ orderId })]),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: {
        linkedQuoteId: 'legacy-quote-id',
        linkedOfferId: 'OFF_26_0045_manual',
        clientId: 'c1',
        clientName: 'Acme',
        items: [{ productId: 'p-1', productName: 'Service', quantity: 1, unitPrice: 100 }],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(allocateDocumentCodeMock).toHaveBeenCalledWith('client_order', {
      exec: expect.anything(),
      sourceCodes: ['legacy-quote-id', 'OFF_26_0045_manual'],
    });
  });

  test('409 when the submitted client does not match the accepted source offer', async () => {
    coFindOfferDetailsMock.mockResolvedValue({
      id: 'OFF_26_0045_manual',
      linkedQuoteId: 'legacy-quote-id',
      clientId: 'c-other',
      status: 'accepted',
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: {
        id: 'co-1',
        linkedOfferId: 'OFF_26_0045_manual',
        clientId: 'c1',
        clientName: 'Acme',
        items: [{ productId: 'p-1', productName: 'Service', quantity: 1, unitPrice: 100 }],
      },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('clientId must match');
    expect(coCreateMock).not.toHaveBeenCalled();
    expect(clientOfferFindItemsForOfferMock).not.toHaveBeenCalled();
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

  test('201 warns when auto-created supplier order code allocation collides', async () => {
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
      supplierId: 'sup-1',
      supplierName: 'Supplier Co',
      paymentTerms: 'net30',
      status: 'accepted',
      expirationDate: '2999-12-31',
      linkedOrderId: null,
      notes: null,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      linkedClientQuoteId: null,
      linkedClientQuoteStatus: 'offer',
      linkedClientQuoteExpiration: '2999-12-31',
      linkedOfferStatus: 'accepted',
      linkedOfferExpiration: '2999-12-31',
    });
    sqLockEffectiveStatusByIdMock.mockResolvedValue({
      expirationDate: '2999-12-31',
      linkedClientStatus: 'offer',
      linkedClientQuoteExpiration: '2999-12-31',
      linkedOfferStatus: 'accepted',
      linkedOfferExpiration: '2999-12-31',
    });
    sqFindItemsForQuoteMock.mockResolvedValue([
      {
        id: 'sqi-1',
        productId: null,
        productName: 'Sourced line',
        quantity: 1,
        unitPrice: 50,
        note: null,
        durationMonths: 1,
        durationUnit: 'months',
      },
    ]);
    allocateDocumentCodeMock.mockRejectedValue(
      new realDocumentCodes.DocumentCodeCollisionError('supplier_order'),
    );

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
      'Supplier order not created for supplier quote sq-1: unable to allocate a unique supplier order code',
    ]);
    expect(coCreateSupplierOrderMock).not.toHaveBeenCalled();
  });

  test('auto-created supplier order preserves an explicit synced quote cost', async () => {
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
      supplierId: 'sup-1',
      supplierName: 'Supplier Co',
      paymentTerms: 'net30',
      status: 'accepted',
      expirationDate: '2999-12-31',
      linkedOrderId: null,
      notes: null,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      linkedClientQuoteId: null,
      linkedClientQuoteStatus: 'offer',
      linkedClientQuoteExpiration: '2999-12-31',
      linkedOfferStatus: 'accepted',
      linkedOfferExpiration: '2999-12-31',
    });
    sqLockEffectiveStatusByIdMock.mockResolvedValue({
      expirationDate: '2999-12-31',
      linkedClientStatus: 'offer',
      linkedClientQuoteExpiration: '2999-12-31',
      linkedOfferStatus: 'accepted',
      linkedOfferExpiration: '2999-12-31',
    });
    sqFindItemsForQuoteMock.mockResolvedValue([
      {
        id: 'sqi-1',
        productId: null,
        productName: 'Sourced line',
        quantity: 150,
        listPrice: 37.75,
        discountPercent: 15,
        unitPrice: 32.09,
        note: null,
        unitType: 'unit',
        durationMonths: 1,
        durationUnit: 'months',
      },
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
            productName: 'Sourced line',
            quantity: 150,
            unitPrice: 100,
            supplierQuoteId: 'sq-1',
            supplierQuoteItemId: 'sqi-1',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const insertedSupplierItems = coBulkInsertSupplierOrderItemsMock.mock.calls[0][1] as Array<
      Record<string, unknown>
    >;
    expect(insertedSupplierItems[0]).toEqual(
      expect.objectContaining({ quantity: 150, unitPrice: 32.09, discount: 0 }),
    );
  });

  test('does not trust a product line supplierQuoteId for supplier-order auto-create', async () => {
    getRolePermissionsMock.mockResolvedValue(['accounting.clients_orders.create']);
    coInsertItemsMock.mockImplementation((orderId: string, items: Array<Record<string, unknown>>) =>
      Promise.resolve(items.map((item) => insertedItem({ ...item, orderId }))),
    );
    sqFindByIdMock.mockResolvedValue({
      id: 'sq-victim',
      supplierId: 'sup-victim',
      supplierName: 'Unrelated Supplier',
      paymentTerms: 'net30',
      status: 'accepted',
      expirationDate: '2999-12-31',
      linkedOrderId: null,
      notes: null,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      linkedClientQuoteId: null,
      linkedClientQuoteStatus: 'offer',
      linkedClientQuoteExpiration: '2999-12-31',
      linkedOfferStatus: 'accepted',
      linkedOfferExpiration: '2999-12-31',
    });
    sqLockEffectiveStatusByIdMock.mockResolvedValue({
      expirationDate: '2999-12-31',
      linkedClientStatus: 'offer',
      linkedClientQuoteExpiration: '2999-12-31',
      linkedOfferStatus: 'accepted',
      linkedOfferExpiration: '2999-12-31',
    });
    sqFindItemsForQuoteMock.mockResolvedValue([
      {
        id: 'sqi-victim',
        productId: 'p-1',
        productName: 'Victim product',
        quantity: 1,
        listPrice: 50,
        discountPercent: 0,
        note: null,
        durationMonths: 1,
        durationUnit: 'months',
      },
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
            productId: 'p-1',
            productName: 'Ordinary product line',
            quantity: 1,
            unitPrice: 100,
            supplierQuoteId: 'sq-victim',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(coCreateSupplierOrderMock).not.toHaveBeenCalled();
    expect(sqFindByIdMock).not.toHaveBeenCalledWith('sq-victim');
    const insertedItems = coInsertItemsMock.mock.calls[0][1] as Array<{
      supplierQuoteId: unknown;
    }>;
    expect(insertedItems[0].supplierQuoteId).toBeNull();
  });

  test('403 blocks an unprivileged order from sourcing an item absent from its source offer', async () => {
    getRolePermissionsMock.mockResolvedValue(['accounting.clients_orders.create']);
    coInsertItemsMock.mockImplementation((orderId: string, items: Array<Record<string, unknown>>) =>
      Promise.resolve(items.map((item) => insertedItem({ ...item, orderId }))),
    );
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(
      new Map([
        [
          'sqi-victim',
          {
            supplierQuoteId: 'sq-victim',
            supplierName: 'Unrelated Supplier',
            productId: 'p-1',
            unitPrice: 50,
            netCost: 50,
          },
        ],
      ]),
    );
    sqFindByIdMock.mockResolvedValue({
      id: 'sq-victim',
      supplierId: 'sup-victim',
      supplierName: 'Unrelated Supplier',
      paymentTerms: 'net30',
      status: 'accepted',
      expirationDate: '2999-12-31',
      linkedOrderId: null,
      notes: null,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      linkedClientQuoteId: null,
      linkedClientQuoteStatus: 'offer',
      linkedClientQuoteExpiration: '2999-12-31',
      linkedOfferStatus: 'accepted',
      linkedOfferExpiration: '2999-12-31',
    });
    sqLockEffectiveStatusByIdMock.mockResolvedValue({
      expirationDate: '2999-12-31',
      linkedClientStatus: 'offer',
      linkedClientQuoteExpiration: '2999-12-31',
      linkedOfferStatus: 'accepted',
      linkedOfferExpiration: '2999-12-31',
    });
    sqFindItemsForQuoteMock.mockResolvedValue([
      {
        id: 'sqi-victim',
        productId: 'p-1',
        productName: 'Victim product',
        quantity: 1,
        listPrice: 50,
        discountPercent: 0,
        note: null,
        durationMonths: 1,
        durationUnit: 'months',
      },
    ]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: {
        id: 'co-1',
        linkedOfferId: 'OFF_26_0045_manual',
        clientId: 'c1',
        clientName: 'Acme',
        items: [
          {
            productId: 'p-1',
            productName: 'Ordinary product line',
            quantity: 1,
            unitPrice: 100,
            supplierQuoteId: 'sq-victim',
            supplierQuoteItemId: 'sqi-victim',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(403);
    expect(coCreateMock).not.toHaveBeenCalled();
    expect(coInsertItemsMock).not.toHaveBeenCalled();
    expect(coCreateSupplierOrderMock).not.toHaveBeenCalled();
  });

  test('allows an unprivileged conversion to auto-create only from its accepted source offer', async () => {
    getRolePermissionsMock.mockResolvedValue(['accounting.clients_orders.create']);
    clientOfferFindItemsForOfferMock.mockResolvedValue([{ supplierQuoteItemId: 'sqi-1' }]);
    coInsertItemsMock.mockImplementation((orderId: string, items: Array<Record<string, unknown>>) =>
      Promise.resolve(items.map((item) => insertedItem({ ...item, orderId }))),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: {
        id: 'co-1',
        linkedOfferId: 'OFF_26_0045_manual',
        linkedQuoteId: 'legacy-quote-id',
        clientId: 'c1',
        clientName: 'Acme',
        items: [
          {
            productId: 'p-1',
            productName: 'Offer product line',
            quantity: 1,
            unitPrice: 100,
            supplierQuoteId: 'sq-client-lie',
            supplierQuoteItemId: 'sqi-1',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(sqFindByIdMock).toHaveBeenCalledWith('sq-1');
    expect(sqFindByIdMock).not.toHaveBeenCalledWith('sq-client-lie');
  });

  test('rejects duplicate supplier references beyond the source offer line count', async () => {
    getRolePermissionsMock.mockResolvedValue(['accounting.clients_orders.create']);
    clientOfferFindItemsForOfferMock.mockResolvedValue([{ supplierQuoteItemId: 'sqi-1' }]);
    coInsertItemsMock.mockImplementation((orderId: string, items: Array<Record<string, unknown>>) =>
      Promise.resolve(items.map((item) => insertedItem({ ...item, orderId }))),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders',
      headers: authHeader(),
      payload: {
        id: 'co-1',
        linkedOfferId: 'OFF_26_0045_manual',
        clientId: 'c1',
        clientName: 'Acme',
        items: [
          {
            productId: 'p-1',
            productName: 'Offer product line',
            quantity: 1,
            unitPrice: 100,
            supplierQuoteItemId: 'sqi-1',
          },
          {
            productId: 'p-1',
            productName: 'Cloned procurement line',
            quantity: 1,
            unitPrice: 100,
            supplierQuoteItemId: 'sqi-1',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(403);
    expect(coCreateMock).not.toHaveBeenCalled();
    expect(coInsertItemsMock).not.toHaveBeenCalled();
    expect(coCreateSupplierOrderMock).not.toHaveBeenCalled();
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
    // The stale/null snapshot is replaced from effective supplier cost 50 and sale price 100.
    expect(inserted[0].productMolPercentage).toBe(50);
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
    // A product-backed direct POST cannot spoof supplier metadata: the persisted line carries the
    // snapshot's authoritative quote id / supplier name / unit price.
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(
      new Map([
        [
          'sqi-1',
          {
            supplierQuoteId: 'sq-real',
            supplierName: 'Real Supplier',
            productId: 'p-1',
            unitPrice: 75,
            netCost: 75,
          },
        ],
      ]),
    );
    coInsertItemsMock.mockResolvedValue([
      insertedItem({
        productId: 'p-1',
        productName: 'Catalog supplier line',
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
            productId: 'p-1',
            productName: 'Catalog supplier line',
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

  test('clears a client productId when the supplier item snapshot is free-form', async () => {
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
    coInsertItemsMock.mockImplementation((orderId: string, items: Array<Record<string, unknown>>) =>
      Promise.resolve(items.map((item) => insertedItem({ ...item, orderId }))),
    );

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
            productId: 'p-client-controlled',
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
    const inserted = coInsertItemsMock.mock.calls[0][1] as Array<{ productId: unknown }>;
    expect(inserted[0].productId).toBeNull();
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
