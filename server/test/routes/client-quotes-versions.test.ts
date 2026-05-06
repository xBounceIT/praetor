import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realClientQuotesRepo from '../../repositories/clientQuotesRepo.ts';
import * as realClientsRepo from '../../repositories/clientsRepo.ts';
import * as realProductsRepo from '../../repositories/productsRepo.ts';
import * as realQuoteVersionsRepo from '../../repositories/quoteVersionsRepo.ts';
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
const clientQuotesRepoSnap = { ...realClientQuotesRepo };
const productsRepoSnap = { ...realProductsRepo };
const quoteVersionsRepoSnap = { ...realQuoteVersionsRepo };
const supplierQuotesRepoSnap = { ...realSupplierQuotesRepo };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const cqExistsByIdMock = mock();
const cqFindLinkedOfferIdMock = mock();
const cqFindCurrentForUpdateMock = mock();
const cqFindNonDraftLinkedSaleMock = mock();
const cqFindAnyLinkedSaleMock = mock();
const cqDeleteDraftSalesForQuoteMock = mock();
const cqFindFullForSnapshotMock = mock();
const cqFindItemsForQuoteMock = mock();
const cqFindIdConflictMock = mock();
const cqUpdateMock = mock();
const cqRestoreSnapshotQuoteMock = mock();
const cqReplaceItemsMock = mock();

const clientsExistsByIdMock = mock();
const productsGetSnapshotsMock = mock();

const qvListForQuoteMock = mock();
const qvFindByIdMock = mock();
const qvInsertMock = mock();
const qvBuildSnapshotMock = mock();

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
  mock.module('../../repositories/clientQuotesRepo.ts', () => ({
    ...clientQuotesRepoSnap,
    existsById: cqExistsByIdMock,
    findLinkedOfferId: cqFindLinkedOfferIdMock,
    findCurrentForUpdate: cqFindCurrentForUpdateMock,
    findNonDraftLinkedSale: cqFindNonDraftLinkedSaleMock,
    findAnyLinkedSale: cqFindAnyLinkedSaleMock,
    deleteDraftSalesForQuote: cqDeleteDraftSalesForQuoteMock,
    findFullForSnapshot: cqFindFullForSnapshotMock,
    findItemsForQuote: cqFindItemsForQuoteMock,
    findIdConflict: cqFindIdConflictMock,
    update: cqUpdateMock,
    restoreSnapshotQuote: cqRestoreSnapshotQuoteMock,
    replaceItems: cqReplaceItemsMock,
  }));
  mock.module('../../repositories/productsRepo.ts', () => ({
    ...productsRepoSnap,
    getSnapshots: productsGetSnapshotsMock,
  }));
  mock.module('../../repositories/quoteVersionsRepo.ts', () => ({
    ...quoteVersionsRepoSnap,
    listForQuote: qvListForQuoteMock,
    findById: qvFindByIdMock,
    insert: qvInsertMock,
    buildSnapshot: qvBuildSnapshotMock,
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

  routePlugin = (await import('../../routes/client-quotes.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/clientsRepo.ts', () => clientsRepoSnap);
  mock.module('../../repositories/clientQuotesRepo.ts', () => clientQuotesRepoSnap);
  mock.module('../../repositories/productsRepo.ts', () => productsRepoSnap);
  mock.module('../../repositories/quoteVersionsRepo.ts', () => quoteVersionsRepoSnap);
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
  'sales.client_quotes.view',
  'sales.client_quotes.create',
  'sales.client_quotes.update',
  'sales.client_quotes.delete',
];

const SAMPLE_QUOTE = {
  id: 'q-1',
  linkedOfferId: null,
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
  id: 'qi-1',
  quoteId: 'q-1',
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
  quote: SAMPLE_QUOTE,
  items: [SAMPLE_ITEM],
};

const SAMPLE_VERSION_ROW = {
  id: 'qv-1',
  quoteId: 'q-1',
  reason: 'update' as const,
  createdByUserId: 'u1',
  createdAt: 1_700_000_001_000,
};

const SAMPLE_VERSION = { ...SAMPLE_VERSION_ROW, snapshot: SAMPLE_SNAPSHOT };

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  cqExistsByIdMock,
  cqFindLinkedOfferIdMock,
  cqFindCurrentForUpdateMock,
  cqFindNonDraftLinkedSaleMock,
  cqFindAnyLinkedSaleMock,
  cqDeleteDraftSalesForQuoteMock,
  cqFindFullForSnapshotMock,
  cqFindItemsForQuoteMock,
  cqFindIdConflictMock,
  cqUpdateMock,
  cqRestoreSnapshotQuoteMock,
  cqReplaceItemsMock,
  clientsExistsByIdMock,
  productsGetSnapshotsMock,
  qvListForQuoteMock,
  qvFindByIdMock,
  qvInsertMock,
  qvBuildSnapshotMock,
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
  qvBuildSnapshotMock.mockImplementation((quote, items) => ({
    schemaVersion: 1,
    quote,
    items,
  }));
  // Default safe values for repos that PUT calls but most tests don't care about.
  cqFindItemsForQuoteMock.mockResolvedValue([SAMPLE_ITEM]);
  cqFindIdConflictMock.mockResolvedValue(false);
  cqFindAnyLinkedSaleMock.mockResolvedValue(null);

  testApp = await buildRouteTestApp(routePlugin, '/api/sales/client-quotes');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('GET /api/sales/client-quotes/:id/versions', () => {
  test('200 returns versions newest-first when quote exists', async () => {
    cqExistsByIdMock.mockResolvedValue(true);
    qvListForQuoteMock.mockResolvedValue([SAMPLE_VERSION_ROW]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/client-quotes/q-1/versions',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('qv-1');
    expect(qvListForQuoteMock).toHaveBeenCalledWith('q-1');
  });

  test('404 when quote does not exist', async () => {
    cqExistsByIdMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/client-quotes/missing/versions',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
  });

  test('403 missing view permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/client-quotes/q-1/versions',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/sales/client-quotes/:id/versions/:versionId', () => {
  test('200 returns version with snapshot scoped by both ids', async () => {
    qvFindByIdMock.mockResolvedValue(SAMPLE_VERSION);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/client-quotes/q-1/versions/qv-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('qv-1');
    expect(body.snapshot.quote.id).toBe('q-1');
    expect(qvFindByIdMock).toHaveBeenCalledWith('q-1', 'qv-1');
  });

  test('404 when version not found (also covers cross-quote ids)', async () => {
    qvFindByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/client-quotes/q-1/versions/qv-other',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/sales/client-quotes/:id/versions/:versionId/restore', () => {
  const setupHappyPath = () => {
    cqFindLinkedOfferIdMock.mockResolvedValue(null);
    cqFindCurrentForUpdateMock.mockResolvedValue({
      status: 'draft',
      discount: 0,
      discountType: 'percentage',
    });
    cqFindNonDraftLinkedSaleMock.mockResolvedValue(null);
    cqDeleteDraftSalesForQuoteMock.mockResolvedValue(undefined);
    qvFindByIdMock.mockResolvedValue(SAMPLE_VERSION);
    cqFindFullForSnapshotMock.mockResolvedValue({
      quote: SAMPLE_QUOTE,
      items: [SAMPLE_ITEM],
    });
    qvInsertMock.mockResolvedValue({ ...SAMPLE_VERSION_ROW, reason: 'restore' });
    clientsExistsByIdMock.mockResolvedValue(true);
    productsGetSnapshotsMock.mockResolvedValue(
      new Map([['p-1', { productCost: 50, productMolPercentage: null }]]),
    );
    cqRestoreSnapshotQuoteMock.mockResolvedValue(SAMPLE_QUOTE);
    cqReplaceItemsMock.mockResolvedValue([SAMPLE_ITEM]);
  };

  test('200 happy path snapshots current then applies version atomically', async () => {
    setupHappyPath();

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('q-1');
    expect(body.items).toHaveLength(1);

    // Pre-restore snapshot inserted with reason='restore'
    expect(qvInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ quoteId: 'q-1', reason: 'restore', createdByUserId: 'u1' }),
      undefined,
    );
    // Quote and items applied
    expect(clientsExistsByIdMock).toHaveBeenCalledWith('c1');
    expect(productsGetSnapshotsMock).toHaveBeenCalledWith(['p-1']);
    expect(cqRestoreSnapshotQuoteMock).toHaveBeenCalledWith(
      'q-1',
      expect.objectContaining({ notes: null }),
      undefined,
    );
    expect(cqReplaceItemsMock).toHaveBeenCalled();
    // Atomically wrapped
    expect(withDbTransactionMock).toHaveBeenCalled();
    // Audit logged
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'client_quote.restored',
        entityType: 'client_quote',
        entityId: 'q-1',
        details: expect.objectContaining({ toValue: 'qv-1' }),
      }),
    );
  });

  test('409 when linked offer exists', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue('off-1');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(cqRestoreSnapshotQuoteMock).not.toHaveBeenCalled();
    expect(qvInsertMock).not.toHaveBeenCalled();
  });

  test('404 when current quote does not exist', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue(null);
    cqFindCurrentForUpdateMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(cqRestoreSnapshotQuoteMock).not.toHaveBeenCalled();
  });

  test('409 when quote is confirmed', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue(null);
    cqFindCurrentForUpdateMock.mockResolvedValue({
      status: 'confirmed',
      discount: 0,
      discountType: 'percentage',
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(cqRestoreSnapshotQuoteMock).not.toHaveBeenCalled();
  });

  test('409 when non-draft linked sale exists', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue(null);
    cqFindCurrentForUpdateMock.mockResolvedValue({
      status: 'draft',
      discount: 0,
      discountType: 'percentage',
    });
    cqFindNonDraftLinkedSaleMock.mockResolvedValue('sale-99');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(cqDeleteDraftSalesForQuoteMock).not.toHaveBeenCalled();
    expect(cqRestoreSnapshotQuoteMock).not.toHaveBeenCalled();
  });

  test('409 when snapshot client no longer exists', async () => {
    setupHappyPath();
    clientsExistsByIdMock.mockResolvedValue(false);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Snapshot client');
    expect(cqDeleteDraftSalesForQuoteMock).not.toHaveBeenCalled();
    expect(cqRestoreSnapshotQuoteMock).not.toHaveBeenCalled();
  });

  test('409 when snapshot product no longer exists', async () => {
    setupHappyPath();
    productsGetSnapshotsMock.mockResolvedValue(new Map());

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Snapshot product');
    expect(cqDeleteDraftSalesForQuoteMock).not.toHaveBeenCalled();
    expect(cqRestoreSnapshotQuoteMock).not.toHaveBeenCalled();
  });

  test('404 when version not found (and no cross-quote leak)', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue(null);
    cqFindCurrentForUpdateMock.mockResolvedValue({
      status: 'draft',
      discount: 0,
      discountType: 'percentage',
    });
    cqFindNonDraftLinkedSaleMock.mockResolvedValue(null);
    qvFindByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-other/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    // findById should be scoped on (quoteId, versionId) so a foreign versionId returns null
    expect(qvFindByIdMock).toHaveBeenCalledWith('q-1', 'qv-other');
    expect(cqRestoreSnapshotQuoteMock).not.toHaveBeenCalled();
  });

  test('403 without update permission (view only)', async () => {
    getRolePermissionsMock.mockResolvedValue(['sales.client_quotes.view']);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /api/sales/client-quotes/:id snapshots pre-update state', () => {
  test('PUT with content changes inserts a snapshot inside the transaction', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue(null);
    cqFindCurrentForUpdateMock.mockResolvedValue({
      status: 'draft',
      discount: 0,
      discountType: 'percentage',
    });
    cqFindFullForSnapshotMock.mockResolvedValue({
      quote: SAMPLE_QUOTE,
      items: [SAMPLE_ITEM],
    });
    cqUpdateMock.mockResolvedValue({ ...SAMPLE_QUOTE, status: 'sent' });
    cqReplaceItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: { status: 'sent' },
    });

    expect(res.statusCode).toBe(200);
    expect(cqFindFullForSnapshotMock).toHaveBeenCalled();
    expect(qvInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ quoteId: 'q-1', reason: 'update', createdByUserId: 'u1' }),
      undefined,
    );
  });

  test('PUT with id-only rename does NOT snapshot (no content change)', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue(null);
    cqFindCurrentForUpdateMock.mockResolvedValue({
      status: 'draft',
      discount: 0,
      discountType: 'percentage',
    });
    cqUpdateMock.mockResolvedValue({ ...SAMPLE_QUOTE, id: 'q-1-renamed' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: { id: 'q-1-renamed' },
    });

    expect(res.statusCode).toBe(200);
    expect(qvInsertMock).not.toHaveBeenCalled();
    expect(cqFindFullForSnapshotMock).not.toHaveBeenCalled();
  });
});
