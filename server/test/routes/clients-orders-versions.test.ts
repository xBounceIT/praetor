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
const coFindForUpdateMock = mock();
const coFindFullForSnapshotMock = mock();
const coFindItemsForOrderMock = mock();
const coFindIdConflictMock = mock();
const coUpdateMock = mock();
const coRestoreSnapshotOrderMock = mock();
const coReplaceItemsMock = mock();

const clientsExistsByIdMock = mock();
const productsGetSnapshotsMock = mock();

const ovListForOrderMock = mock();
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
  mock.module('../../repositories/clientsOrdersRepo.ts', () => ({
    ...clientsOrdersRepoSnap,
    existsById: coExistsByIdMock,
    findForUpdate: coFindForUpdateMock,
    findFullForSnapshot: coFindFullForSnapshotMock,
    findItemsForOrder: coFindItemsForOrderMock,
    findIdConflict: coFindIdConflictMock,
    update: coUpdateMock,
    restoreSnapshotOrder: coRestoreSnapshotOrderMock,
    replaceItems: coReplaceItemsMock,
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
  discount: 0,
  note: null,
  unitType: 'hours' as const,
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
  coFindForUpdateMock,
  coFindFullForSnapshotMock,
  coFindItemsForOrderMock,
  coFindIdConflictMock,
  coUpdateMock,
  coRestoreSnapshotOrderMock,
  coReplaceItemsMock,
  clientsExistsByIdMock,
  productsGetSnapshotsMock,
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
  withDbTransactionMock.mockImplementation(async (cb) => cb(undefined));
  logAuditMock.mockImplementation(async () => undefined);
  ovBuildSnapshotMock.mockImplementation((order, items) => ({
    schemaVersion: 1,
    order,
    items,
  }));
  coFindItemsForOrderMock.mockResolvedValue([SAMPLE_ITEM]);
  coFindIdConflictMock.mockResolvedValue(false);

  testApp = await buildRouteTestApp(routePlugin, '/api/clients-orders');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

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
    coFindForUpdateMock.mockResolvedValue({
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
    coRestoreSnapshotOrderMock.mockResolvedValue(SAMPLE_ORDER);
    coReplaceItemsMock.mockResolvedValue([SAMPLE_ITEM]);
  };

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
      undefined,
    );
    // Order and items applied
    expect(clientsExistsByIdMock).toHaveBeenCalledWith('c1');
    expect(productsGetSnapshotsMock).toHaveBeenCalledWith(['p-1']);
    expect(coRestoreSnapshotOrderMock).toHaveBeenCalledWith(
      'o-1',
      expect.objectContaining({ clientId: 'c1', notes: null }),
      undefined,
    );
    expect(coReplaceItemsMock).toHaveBeenCalled();
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

  test('404 when current order does not exist', async () => {
    coFindForUpdateMock.mockResolvedValue(null);
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

  test('409 when order has linkedOfferId', async () => {
    coFindForUpdateMock.mockResolvedValue({
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
    ovFindByIdMock.mockResolvedValue(SAMPLE_VERSION);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Source-linked');
    expect(coRestoreSnapshotOrderMock).not.toHaveBeenCalled();
  });

  test('409 when order has linkedQuoteId', async () => {
    coFindForUpdateMock.mockResolvedValue({
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
    ovFindByIdMock.mockResolvedValue(SAMPLE_VERSION);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/clients-orders/o-1/versions/ov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Source-linked');
    expect(coRestoreSnapshotOrderMock).not.toHaveBeenCalled();
  });

  test('409 when order is non-draft', async () => {
    coFindForUpdateMock.mockResolvedValue({
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
    coFindForUpdateMock.mockResolvedValue({
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
});

describe('PUT /api/clients-orders/:id snapshots pre-update state', () => {
  test('PUT with content changes inserts a snapshot inside the transaction', async () => {
    coFindForUpdateMock.mockResolvedValue({
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
      undefined,
    );
  });

  test('PUT with status-only update does NOT snapshot (no locked field changes)', async () => {
    coFindForUpdateMock.mockResolvedValue({
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
  });

  test('PUT on source-linked order does NOT snapshot (status-only edit)', async () => {
    coFindForUpdateMock.mockResolvedValue({
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
    coFindForUpdateMock.mockResolvedValue({
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
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(ovInsertMock).not.toHaveBeenCalled();
    expect(coFindFullForSnapshotMock).not.toHaveBeenCalled();
  });
});
