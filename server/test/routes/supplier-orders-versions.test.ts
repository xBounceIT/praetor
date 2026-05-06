import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realProductsRepo from '../../repositories/productsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realSupplierOrdersRepo from '../../repositories/supplierOrdersRepo.ts';
import * as realSupplierOrderVersionsRepo from '../../repositories/supplierOrderVersionsRepo.ts';
import * as realSupplierQuotesRepo from '../../repositories/supplierQuotesRepo.ts';
import * as realSuppliersRepo from '../../repositories/suppliersRepo.ts';
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
const supplierOrdersRepoSnap = { ...realSupplierOrdersRepo };
const supplierOrderVersionsRepoSnap = { ...realSupplierOrderVersionsRepo };
const suppliersRepoSnap = { ...realSuppliersRepo };
const productsRepoSnap = { ...realProductsRepo };
const supplierQuotesRepoSnap = { ...realSupplierQuotesRepo };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const soExistsByIdMock = mock();
const soFindExistingForUpdateMock = mock();
const soFindLinkedInvoiceIdMock = mock();
const soFindFullForSnapshotMock = mock();
const soFindItemsForOrderMock = mock();
const soFindIdConflictMock = mock();
const soUpdateMock = mock();
const soRestoreSnapshotOrderMock = mock();
const soReplaceItemsMock = mock();

const suppliersExistsByIdMock = mock();
const productsGetSnapshotsMock = mock();

const sovListForOrderMock = mock();
const sovFindByIdMock = mock();
const sovInsertMock = mock();
const sovBuildSnapshotMock = mock();

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
  mock.module('../../repositories/supplierOrdersRepo.ts', () => ({
    ...supplierOrdersRepoSnap,
    existsById: soExistsByIdMock,
    findExistingForUpdate: soFindExistingForUpdateMock,
    findLinkedInvoiceId: soFindLinkedInvoiceIdMock,
    findFullForSnapshot: soFindFullForSnapshotMock,
    findItemsForOrder: soFindItemsForOrderMock,
    findIdConflict: soFindIdConflictMock,
    update: soUpdateMock,
    restoreSnapshotOrder: soRestoreSnapshotOrderMock,
    replaceItems: soReplaceItemsMock,
  }));
  mock.module('../../repositories/suppliersRepo.ts', () => ({
    ...suppliersRepoSnap,
    existsById: suppliersExistsByIdMock,
  }));
  mock.module('../../repositories/productsRepo.ts', () => ({
    ...productsRepoSnap,
    getSnapshots: productsGetSnapshotsMock,
  }));
  mock.module('../../repositories/supplierOrderVersionsRepo.ts', () => ({
    ...supplierOrderVersionsRepoSnap,
    listForOrder: sovListForOrderMock,
    findById: sovFindByIdMock,
    insert: sovInsertMock,
    buildSnapshot: sovBuildSnapshotMock,
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

  routePlugin = (await import('../../routes/supplier-orders.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/supplierOrdersRepo.ts', () => supplierOrdersRepoSnap);
  mock.module('../../repositories/suppliersRepo.ts', () => suppliersRepoSnap);
  mock.module('../../repositories/productsRepo.ts', () => productsRepoSnap);
  mock.module(
    '../../repositories/supplierOrderVersionsRepo.ts',
    () => supplierOrderVersionsRepoSnap,
  );
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
  'accounting.supplier_orders.view',
  'accounting.supplier_orders.create',
  'accounting.supplier_orders.update',
  'accounting.supplier_orders.delete',
];

const SAMPLE_ORDER = {
  id: 'so-1',
  linkedQuoteId: null,
  supplierId: 's-1',
  supplierName: 'Acme',
  paymentTerms: 'immediate',
  discount: 0,
  discountType: 'percentage' as const,
  status: 'draft',
  notes: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const SAMPLE_ITEM = {
  id: 'ssi-1',
  orderId: 'so-1',
  productId: 'p-1',
  productName: 'Widget',
  quantity: 2,
  unitPrice: 100,
  discount: 0,
  note: null,
};

const SAMPLE_SNAPSHOT = {
  schemaVersion: 1 as const,
  order: SAMPLE_ORDER,
  items: [SAMPLE_ITEM],
};

const SAMPLE_VERSION_ROW = {
  id: 'sov-1',
  orderId: 'so-1',
  reason: 'update' as const,
  createdByUserId: 'u1',
  createdAt: 1_700_000_001_000,
};

const SAMPLE_VERSION = { ...SAMPLE_VERSION_ROW, snapshot: SAMPLE_SNAPSHOT };

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  soExistsByIdMock,
  soFindExistingForUpdateMock,
  soFindLinkedInvoiceIdMock,
  soFindFullForSnapshotMock,
  soFindItemsForOrderMock,
  soFindIdConflictMock,
  soUpdateMock,
  soRestoreSnapshotOrderMock,
  soReplaceItemsMock,
  suppliersExistsByIdMock,
  productsGetSnapshotsMock,
  sovListForOrderMock,
  sovFindByIdMock,
  sovInsertMock,
  sovBuildSnapshotMock,
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
  sovBuildSnapshotMock.mockImplementation((order, items) => ({
    schemaVersion: 1,
    order,
    items,
  }));
  // Default safe values for repos that PUT calls but most tests don't care about.
  soFindItemsForOrderMock.mockResolvedValue([SAMPLE_ITEM]);
  soFindIdConflictMock.mockResolvedValue(false);

  testApp = await buildRouteTestApp(routePlugin, '/api/accounting/supplier-orders');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('GET /api/accounting/supplier-orders/:id/versions', () => {
  test('200 returns versions newest-first when order exists', async () => {
    soExistsByIdMock.mockResolvedValue(true);
    sovListForOrderMock.mockResolvedValue([SAMPLE_VERSION_ROW]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/accounting/supplier-orders/so-1/versions',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('sov-1');
    expect(sovListForOrderMock).toHaveBeenCalledWith('so-1');
  });

  test('404 when order does not exist', async () => {
    soExistsByIdMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/accounting/supplier-orders/missing/versions',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
  });

  test('403 missing view permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/accounting/supplier-orders/so-1/versions',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/accounting/supplier-orders/:id/versions/:versionId', () => {
  test('200 returns version with snapshot scoped by both ids', async () => {
    sovFindByIdMock.mockResolvedValue(SAMPLE_VERSION);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/accounting/supplier-orders/so-1/versions/sov-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('sov-1');
    expect(body.snapshot.order.id).toBe('so-1');
    expect(sovFindByIdMock).toHaveBeenCalledWith('so-1', 'sov-1');
  });

  test('404 when version not found (also covers cross-order ids)', async () => {
    sovFindByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/accounting/supplier-orders/so-1/versions/sov-other',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/accounting/supplier-orders/:id/versions/:versionId/restore', () => {
  const setupHappyPath = () => {
    soFindLinkedInvoiceIdMock.mockResolvedValue(null);
    soFindExistingForUpdateMock.mockResolvedValue({
      id: 'so-1',
      linkedQuoteId: null,
      supplierId: 's-1',
      supplierName: 'Acme',
      status: 'draft',
    });
    sovFindByIdMock.mockResolvedValue(SAMPLE_VERSION);
    soFindFullForSnapshotMock.mockResolvedValue({
      order: SAMPLE_ORDER,
      items: [SAMPLE_ITEM],
    });
    sovInsertMock.mockResolvedValue({ ...SAMPLE_VERSION_ROW, reason: 'restore' });
    suppliersExistsByIdMock.mockResolvedValue(true);
    productsGetSnapshotsMock.mockResolvedValue(
      new Map([['p-1', { productCost: 50, productMolPercentage: null }]]),
    );
    soRestoreSnapshotOrderMock.mockResolvedValue(SAMPLE_ORDER);
    soReplaceItemsMock.mockResolvedValue([SAMPLE_ITEM]);
  };

  test('200 happy path snapshots current then applies version atomically', async () => {
    setupHappyPath();

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/accounting/supplier-orders/so-1/versions/sov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('so-1');
    expect(body.items).toHaveLength(1);

    // Pre-restore snapshot inserted with reason='restore'
    expect(sovInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'so-1', reason: 'restore', createdByUserId: 'u1' }),
      undefined,
    );
    // Reference checks ran
    expect(suppliersExistsByIdMock).toHaveBeenCalledWith('s-1');
    expect(productsGetSnapshotsMock).toHaveBeenCalledWith(['p-1']);
    // Order and items applied
    expect(soRestoreSnapshotOrderMock).toHaveBeenCalledWith(
      'so-1',
      expect.objectContaining({ supplierId: 's-1', supplierName: 'Acme' }),
      undefined,
    );
    expect(soReplaceItemsMock).toHaveBeenCalled();
    // Atomically wrapped
    expect(withDbTransactionMock).toHaveBeenCalled();
    // Audit logged
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'supplier_order.restored',
        entityType: 'supplier_order',
        entityId: 'so-1',
        details: expect.objectContaining({ toValue: 'sov-1' }),
      }),
    );
  });

  test('409 when linked invoice exists', async () => {
    soFindLinkedInvoiceIdMock.mockResolvedValue('inv-1');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/accounting/supplier-orders/so-1/versions/sov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(soRestoreSnapshotOrderMock).not.toHaveBeenCalled();
    expect(sovInsertMock).not.toHaveBeenCalled();
  });

  test('404 when current order does not exist', async () => {
    soFindLinkedInvoiceIdMock.mockResolvedValue(null);
    soFindExistingForUpdateMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/accounting/supplier-orders/so-1/versions/sov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(soRestoreSnapshotOrderMock).not.toHaveBeenCalled();
  });

  test('409 when order is non-draft', async () => {
    soFindLinkedInvoiceIdMock.mockResolvedValue(null);
    soFindExistingForUpdateMock.mockResolvedValue({
      id: 'so-1',
      linkedQuoteId: null,
      supplierId: 's-1',
      supplierName: 'Acme',
      status: 'sent',
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/accounting/supplier-orders/so-1/versions/sov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(soRestoreSnapshotOrderMock).not.toHaveBeenCalled();
  });

  test('409 when snapshot supplier no longer exists', async () => {
    setupHappyPath();
    suppliersExistsByIdMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/accounting/supplier-orders/so-1/versions/sov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Snapshot supplier');
    expect(soRestoreSnapshotOrderMock).not.toHaveBeenCalled();
  });

  test('409 when snapshot product no longer exists', async () => {
    setupHappyPath();
    productsGetSnapshotsMock.mockResolvedValue(new Map());

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/accounting/supplier-orders/so-1/versions/sov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Snapshot product');
    expect(soRestoreSnapshotOrderMock).not.toHaveBeenCalled();
  });

  test('404 when version not found (and no cross-order leak)', async () => {
    soFindLinkedInvoiceIdMock.mockResolvedValue(null);
    soFindExistingForUpdateMock.mockResolvedValue({
      id: 'so-1',
      linkedQuoteId: null,
      supplierId: 's-1',
      supplierName: 'Acme',
      status: 'draft',
    });
    sovFindByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/accounting/supplier-orders/so-1/versions/sov-other/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    // findById should be scoped on (orderId, versionId) so a foreign versionId returns null
    expect(sovFindByIdMock).toHaveBeenCalledWith('so-1', 'sov-other');
    expect(soRestoreSnapshotOrderMock).not.toHaveBeenCalled();
  });

  test('403 without update permission (view only)', async () => {
    getRolePermissionsMock.mockResolvedValue(['accounting.supplier_orders.view']);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/accounting/supplier-orders/so-1/versions/sov-1/restore',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });

  test('snapshot product check skips null/empty productIds', async () => {
    setupHappyPath();
    sovFindByIdMock.mockResolvedValue({
      ...SAMPLE_VERSION,
      snapshot: {
        ...SAMPLE_SNAPSHOT,
        items: [
          { ...SAMPLE_ITEM, id: 'ssi-1', productId: null },
          { ...SAMPLE_ITEM, id: 'ssi-2', productId: '' },
          { ...SAMPLE_ITEM, id: 'ssi-3', productId: 'p-1' },
        ],
      },
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/accounting/supplier-orders/so-1/versions/sov-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(productsGetSnapshotsMock).toHaveBeenCalledWith(['p-1']);
  });
});

describe('PUT /api/accounting/supplier-orders/:id snapshots pre-update state', () => {
  test('PUT with content changes inserts a snapshot inside the transaction', async () => {
    soFindExistingForUpdateMock.mockResolvedValue({
      id: 'so-1',
      linkedQuoteId: null,
      supplierId: 's-1',
      supplierName: 'Acme',
      status: 'draft',
    });
    soFindFullForSnapshotMock.mockResolvedValue({
      order: SAMPLE_ORDER,
      items: [SAMPLE_ITEM],
    });
    soUpdateMock.mockResolvedValue({ ...SAMPLE_ORDER, status: 'sent' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/accounting/supplier-orders/so-1',
      headers: authHeader(),
      payload: { status: 'sent' },
    });

    expect(res.statusCode).toBe(200);
    expect(soFindFullForSnapshotMock).toHaveBeenCalled();
    expect(sovInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'so-1', reason: 'update', createdByUserId: 'u1' }),
      undefined,
    );
  });

  test('PUT with id-only rename does NOT snapshot (no content change)', async () => {
    soFindExistingForUpdateMock.mockResolvedValue({
      id: 'so-1',
      linkedQuoteId: null,
      supplierId: 's-1',
      supplierName: 'Acme',
      status: 'draft',
    });
    soUpdateMock.mockResolvedValue({ ...SAMPLE_ORDER, id: 'so-1-renamed' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/accounting/supplier-orders/so-1',
      headers: authHeader(),
      payload: { id: 'so-1-renamed' },
    });

    expect(res.statusCode).toBe(200);
    expect(sovInsertMock).not.toHaveBeenCalled();
    expect(soFindFullForSnapshotMock).not.toHaveBeenCalled();
  });
});
