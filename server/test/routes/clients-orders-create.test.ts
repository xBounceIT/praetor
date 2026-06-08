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
import { makeWithDbTransactionMock } from '../helpers/withDbTransactionMock.ts';

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

const coCreateMock = mock();
const coInsertItemsMock = mock();
const sqFindByIdMock = mock();
const sqFindLinkedOrderIdMock = mock();

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
  }));
  mock.module('../../repositories/supplierQuotesRepo.ts', () => ({
    ...supplierQuotesRepoSnap,
    findById: sqFindByIdMock,
    findLinkedOrderId: sqFindLinkedOrderIdMock,
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
  mock.module('../../repositories/clientsOrdersRepo.ts', () => clientsOrdersRepoSnap);
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
  sqFindByIdMock,
  sqFindLinkedOrderIdMock,
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
  // Default: no supplier quote resolves, so the auto-create-supplier-order branch fast-fails.
  sqFindByIdMock.mockResolvedValue(null);
  sqFindLinkedOrderIdMock.mockResolvedValue(null);

  testApp = await buildRouteTestApp(routePlugin, '/api/clients-orders');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('POST /api/clients-orders product-less supplier lines (issue #783)', () => {
  test('201 creates an order from a supplier-quote line with no productId', async () => {
    // The offer→order conversion sends this exact shape: a free-form supplier line carries a
    // supplierQuoteItemId but a null productId (no catalog product).
    coInsertItemsMock.mockResolvedValue([
      insertedItem({
        productId: null,
        productName: 'Free-form supplier line',
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

  test('accepts the real offer→order payload: product-less line with every nullable field null', async () => {
    coInsertItemsMock.mockResolvedValue([
      insertedItem({
        productId: null,
        productName: 'Free-form supplier line',
        supplierQuoteItemId: 'sqi-1',
      }),
    ]);

    // This is the exact shape `clientOffersRepo.mapItem` + the frontend spread produce for a
    // supplier-quote-sourced offer line: the nullable fields arrive as explicit `null`, not
    // omitted. The body schema must accept them (they reach `normalizeIncomingItems`).
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
            supplierQuoteId: null,
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
    // The nullable fields survive validation as null (not coerced to 0/'') and reach the insert.
    const inserted = coInsertItemsMock.mock.calls[0][1] as Array<{
      productMolPercentage: unknown;
      supplierQuoteUnitPrice: unknown;
      supplierQuoteId: unknown;
    }>;
    expect(inserted[0].productMolPercentage).toBeNull();
    expect(inserted[0].supplierQuoteUnitPrice).toBeNull();
    expect(inserted[0].supplierQuoteId).toBeNull();
  });
});
