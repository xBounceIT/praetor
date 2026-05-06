import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realProductsRepo from '../../repositories/productsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realSupplierQuotesRepo from '../../repositories/supplierQuotesRepo.ts';
import * as realSupplierQuoteVersionsRepo from '../../repositories/supplierQuoteVersionsRepo.ts';
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
const suppliersRepoSnap = { ...realSuppliersRepo };
const supplierQuotesRepoSnap = { ...realSupplierQuotesRepo };
const supplierQuoteVersionsRepoSnap = { ...realSupplierQuoteVersionsRepo };
const productsRepoSnap = { ...realProductsRepo };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const sqExistsByIdMock = mock();
const sqFindLinkedOrderIdMock = mock();
const sqFindFullForSnapshotMock = mock();
const sqFindItemsForQuoteMock = mock();
const sqFindIdConflictMock = mock();
const sqUpdateMock = mock();
const sqRestoreSnapshotQuoteMock = mock();
const sqReplaceItemsMock = mock();

const suppliersFindByIdMock = mock();
const productsGetSnapshotsMock = mock();

const sqvListForQuoteMock = mock();
const sqvFindByIdMock = mock();
const sqvInsertMock = mock();
const sqvBuildSnapshotMock = mock();

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
  mock.module('../../repositories/suppliersRepo.ts', () => ({
    ...suppliersRepoSnap,
    findById: suppliersFindByIdMock,
  }));
  mock.module('../../repositories/supplierQuotesRepo.ts', () => ({
    ...supplierQuotesRepoSnap,
    existsById: sqExistsByIdMock,
    findLinkedOrderId: sqFindLinkedOrderIdMock,
    findFullForSnapshot: sqFindFullForSnapshotMock,
    findItemsForQuote: sqFindItemsForQuoteMock,
    findIdConflict: sqFindIdConflictMock,
    update: sqUpdateMock,
    restoreSnapshotQuote: sqRestoreSnapshotQuoteMock,
    replaceItems: sqReplaceItemsMock,
  }));
  mock.module('../../repositories/productsRepo.ts', () => ({
    ...productsRepoSnap,
    getSnapshots: productsGetSnapshotsMock,
  }));
  mock.module('../../repositories/supplierQuoteVersionsRepo.ts', () => ({
    ...supplierQuoteVersionsRepoSnap,
    listForQuote: sqvListForQuoteMock,
    findById: sqvFindByIdMock,
    insert: sqvInsertMock,
    buildSnapshot: sqvBuildSnapshotMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));

  routePlugin = (await import('../../routes/supplier-quotes.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/suppliersRepo.ts', () => suppliersRepoSnap);
  mock.module('../../repositories/supplierQuotesRepo.ts', () => supplierQuotesRepoSnap);
  mock.module(
    '../../repositories/supplierQuoteVersionsRepo.ts',
    () => supplierQuoteVersionsRepoSnap,
  );
  mock.module('../../repositories/productsRepo.ts', () => productsRepoSnap);
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
  'sales.supplier_quotes.view',
  'sales.supplier_quotes.create',
  'sales.supplier_quotes.update',
  'sales.supplier_quotes.delete',
];

const SAMPLE_QUOTE = {
  id: 'sq-1',
  supplierId: 's1',
  supplierName: 'Acme',
  paymentTerms: 'immediate',
  status: 'draft',
  expirationDate: '2026-12-31',
  linkedOrderId: null,
  notes: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const SAMPLE_ITEM = {
  id: 'sqi-1',
  quoteId: 'sq-1',
  productId: 'p-1',
  productName: 'Service',
  quantity: 2,
  unitPrice: 100,
  note: null,
  unitType: 'unit' as const,
};

const SAMPLE_SNAPSHOT = {
  schemaVersion: 1 as const,
  quote: SAMPLE_QUOTE,
  items: [SAMPLE_ITEM],
};

const SAMPLE_VERSION_ROW = {
  id: 'sqv-1',
  quoteId: 'sq-1',
  reason: 'update' as const,
  createdByUserId: 'u1',
  createdAt: 1_700_000_001_000,
};

const SAMPLE_VERSION = { ...SAMPLE_VERSION_ROW, snapshot: SAMPLE_SNAPSHOT };

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  sqExistsByIdMock,
  sqFindLinkedOrderIdMock,
  sqFindFullForSnapshotMock,
  sqFindItemsForQuoteMock,
  sqFindIdConflictMock,
  sqUpdateMock,
  sqRestoreSnapshotQuoteMock,
  sqReplaceItemsMock,
  suppliersFindByIdMock,
  productsGetSnapshotsMock,
  sqvListForQuoteMock,
  sqvFindByIdMock,
  sqvInsertMock,
  sqvBuildSnapshotMock,
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
  sqvBuildSnapshotMock.mockImplementation((quote, items) => ({
    schemaVersion: 1,
    quote,
    items,
  }));
  // Default safe values for repos that PUT calls but most tests don't care about.
  sqFindItemsForQuoteMock.mockResolvedValue([SAMPLE_ITEM]);
  sqFindIdConflictMock.mockResolvedValue(false);

  testApp = await buildRouteTestApp(routePlugin, '/api/sales/supplier-quotes');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('GET /api/sales/supplier-quotes/:id/versions', () => {
  test('200 returns versions newest-first when quote exists', async () => {
    sqExistsByIdMock.mockResolvedValue(true);
    sqvListForQuoteMock.mockResolvedValue([SAMPLE_VERSION_ROW]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/supplier-quotes/sq-1/versions',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('sqv-1');
    expect(sqvListForQuoteMock).toHaveBeenCalledWith('sq-1');
  });

  test('404 when quote does not exist', async () => {
    sqExistsByIdMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/supplier-quotes/missing/versions',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
  });

  test('403 missing view permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/supplier-quotes/sq-1/versions',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/sales/supplier-quotes/:id/versions/:versionId', () => {
  test('200 returns version with snapshot scoped by both ids', async () => {
    sqvFindByIdMock.mockResolvedValue(SAMPLE_VERSION);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/supplier-quotes/sq-1/versions/sqv-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('sqv-1');
    expect(body.snapshot.quote.id).toBe('sq-1');
    expect(sqvFindByIdMock).toHaveBeenCalledWith('sq-1', 'sqv-1');
  });

  test('404 when version not found (also covers cross-quote ids)', async () => {
    sqvFindByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/supplier-quotes/sq-1/versions/sqv-other',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/sales/supplier-quotes/:id/versions/:versionId/restore', () => {
  const setupHappyPath = () => {
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqExistsByIdMock.mockResolvedValue(true);
    sqvFindByIdMock.mockResolvedValue(SAMPLE_VERSION);
    sqFindFullForSnapshotMock.mockResolvedValue({
      quote: SAMPLE_QUOTE,
      items: [SAMPLE_ITEM],
    });
    sqvInsertMock.mockResolvedValue({ ...SAMPLE_VERSION_ROW, reason: 'restore' });
    suppliersFindByIdMock.mockResolvedValue({ id: 's1', name: 'Acme' });
    productsGetSnapshotsMock.mockResolvedValue(
      new Map([['p-1', { productCost: 50, productMolPercentage: null }]]),
    );
    sqRestoreSnapshotQuoteMock.mockResolvedValue(SAMPLE_QUOTE);
    sqReplaceItemsMock.mockResolvedValue([SAMPLE_ITEM]);
  };

  test('200 happy path snapshots current then applies version atomically', async () => {
    setupHappyPath();

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes/sq-1/versions/sqv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('sq-1');
    expect(body.items).toHaveLength(1);

    // Pre-restore snapshot inserted with reason='restore'
    expect(sqvInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ quoteId: 'sq-1', reason: 'restore', createdByUserId: 'u1' }),
      undefined,
    );
    expect(suppliersFindByIdMock).toHaveBeenCalledWith('s1');
    expect(productsGetSnapshotsMock).toHaveBeenCalledWith(['p-1']);
    expect(sqRestoreSnapshotQuoteMock).toHaveBeenCalledWith(
      'sq-1',
      expect.objectContaining({ supplierId: 's1', notes: null }),
      undefined,
    );
    expect(sqReplaceItemsMock).toHaveBeenCalled();
    expect(withDbTransactionMock).toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'supplier_quote.restored',
        entityType: 'supplier_quote',
        entityId: 'sq-1',
        details: expect.objectContaining({ toValue: 'sqv-1' }),
      }),
    );
  });

  test('409 when linked order exists', async () => {
    sqFindLinkedOrderIdMock.mockResolvedValue('sord-1');
    sqExistsByIdMock.mockResolvedValue(true);
    sqvFindByIdMock.mockResolvedValue(SAMPLE_VERSION);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes/sq-1/versions/sqv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(sqRestoreSnapshotQuoteMock).not.toHaveBeenCalled();
    expect(sqvInsertMock).not.toHaveBeenCalled();
  });

  test('404 when current quote does not exist', async () => {
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqExistsByIdMock.mockResolvedValue(false);
    sqvFindByIdMock.mockResolvedValue(SAMPLE_VERSION);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes/sq-1/versions/sqv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(sqRestoreSnapshotQuoteMock).not.toHaveBeenCalled();
  });

  test('409 when snapshot supplier no longer exists', async () => {
    setupHappyPath();
    suppliersFindByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes/sq-1/versions/sqv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Snapshot supplier');
    expect(sqRestoreSnapshotQuoteMock).not.toHaveBeenCalled();
  });

  test('409 when snapshot product no longer exists', async () => {
    setupHappyPath();
    productsGetSnapshotsMock.mockResolvedValue(new Map());

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes/sq-1/versions/sqv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Snapshot product');
    expect(sqRestoreSnapshotQuoteMock).not.toHaveBeenCalled();
  });

  test('404 when version not found (and no cross-quote leak)', async () => {
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqExistsByIdMock.mockResolvedValue(true);
    sqvFindByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes/sq-1/versions/sqv-other/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(sqvFindByIdMock).toHaveBeenCalledWith('sq-1', 'sqv-other');
    expect(sqRestoreSnapshotQuoteMock).not.toHaveBeenCalled();
  });

  test('403 without update permission (view only)', async () => {
    getRolePermissionsMock.mockResolvedValue(['sales.supplier_quotes.view']);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes/sq-1/versions/sqv-1/restore',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /api/sales/supplier-quotes/:id snapshots pre-update state', () => {
  test('PUT with content changes inserts a snapshot inside the transaction', async () => {
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqFindFullForSnapshotMock.mockResolvedValue({
      quote: SAMPLE_QUOTE,
      items: [SAMPLE_ITEM],
    });
    sqUpdateMock.mockResolvedValue({ ...SAMPLE_QUOTE, status: 'sent' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { status: 'sent' },
    });

    expect(res.statusCode).toBe(200);
    expect(sqFindFullForSnapshotMock).toHaveBeenCalled();
    expect(sqvInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ quoteId: 'sq-1', reason: 'update', createdByUserId: 'u1' }),
      undefined,
    );
  });

  test('PUT with id-only rename does NOT snapshot (no content change)', async () => {
    sqUpdateMock.mockResolvedValue({ ...SAMPLE_QUOTE, id: 'sq-1-renamed' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { id: 'sq-1-renamed' },
    });

    expect(res.statusCode).toBe(200);
    expect(sqvInsertMock).not.toHaveBeenCalled();
    expect(sqFindFullForSnapshotMock).not.toHaveBeenCalled();
  });
});
