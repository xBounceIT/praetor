import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realClientOffersRepo from '../../repositories/clientOffersRepo.ts';
import * as realClientQuotesRepo from '../../repositories/clientQuotesRepo.ts';
import * as realClientsRepo from '../../repositories/clientsRepo.ts';
import * as realProductsRepo from '../../repositories/productsRepo.ts';
import * as realQuoteCandidatesRepo from '../../repositories/quoteCandidatesRepo.ts';
import * as realQuoteCommunicationChannelsRepo from '../../repositories/quoteCommunicationChannelsRepo.ts';
import * as realQuoteVersionsRepo from '../../repositories/quoteVersionsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realSupplierQuotesRepo from '../../repositories/supplierQuotesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realDocumentCodes from '../../services/documentCodes.ts';
import * as realDocumentRevisions from '../../services/documentRevisions.ts';
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
const quoteCandidatesRepoSnap = { ...realQuoteCandidatesRepo };
const productsRepoSnap = { ...realProductsRepo };
const quoteCommunicationChannelsRepoSnap = { ...realQuoteCommunicationChannelsRepo };
const quoteVersionsRepoSnap = { ...realQuoteVersionsRepo };
const supplierQuotesRepoSnap = { ...realSupplierQuotesRepo };
const documentCodesSnap = { ...realDocumentCodes };
const documentRevisionsSnap = { ...realDocumentRevisions };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const cqExistsByIdMock = mock();
const cqFindByIdMock = mock();
const cqFindLinkedOfferIdMock = mock();
const cqFindCurrentMock = mock();
const cqLockCurrentByIdMock = mock();
const cqFindNonDraftLinkedSaleMock = mock();
const cqFindAnyLinkedSaleMock = mock();
const cqDeleteDraftSalesForQuoteMock = mock();
const cqFindFullForSnapshotMock = mock();
const cqFindItemsForQuoteMock = mock();
const cqFindItemSnapshotsForQuoteMock = mock();
const cqFindIdConflictMock = mock();
const cqUpdateMock = mock();
const cqRenameMock = mock();
const cqRestoreSnapshotQuoteMock = mock();
const cqReplaceItemsMock = mock();
const cqCreateMock = mock();
const cqInsertItemsMock = mock();

const qcInsertMock = mock();
const qcListForQuoteMock = mock();
const qcDeleteAllForQuoteMock = mock();

const qccFindByIdMock = mock();
const qccFindDefaultMock = mock();
const coCreateMock = mock();
const coInsertItemsMock = mock();
const coLockExistingByIdMock = mock();
const coFindLinkedSaleIdMock = mock();
const coDeleteByIdMock = mock();

const clientsExistsByIdMock = mock();
const productsGetSnapshotsMock = mock();
const sqGetQuoteItemSnapshotsMock = mock();
const sqFindEarliestExpirationByIdsMock = mock();
const sqFindBlockingExpirationsByIdsMock = mock();

const qvListForQuoteMock = mock();
const qvFindByIdMock = mock();
const qvInsertMock = mock();
const qvBuildSnapshotMock = mock();
const allocateDocumentCodeMock = mock();
const createQuoteRevisionIfChangedMock = mock();
const lockSupplierRevisionStatesMock = mock();
const createDerivedSupplierRevisionsMock = mock();

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
  mock.module('../../repositories/clientQuotesRepo.ts', () => ({
    ...clientQuotesRepoSnap,
    existsById: cqExistsByIdMock,
    findById: cqFindByIdMock,
    findLinkedOfferId: cqFindLinkedOfferIdMock,
    findCurrent: cqFindCurrentMock,
    lockCurrentById: cqLockCurrentByIdMock,
    findNonDraftLinkedSale: cqFindNonDraftLinkedSaleMock,
    findAnyLinkedSale: cqFindAnyLinkedSaleMock,
    deleteDraftSalesForQuote: cqDeleteDraftSalesForQuoteMock,
    findFullForSnapshot: cqFindFullForSnapshotMock,
    findItemsForQuote: cqFindItemsForQuoteMock,
    findItemSnapshotsForQuote: cqFindItemSnapshotsForQuoteMock,
    findIdConflict: cqFindIdConflictMock,
    update: cqUpdateMock,
    rename: cqRenameMock,
    restoreSnapshotQuote: cqRestoreSnapshotQuoteMock,
    replaceItems: cqReplaceItemsMock,
    create: cqCreateMock,
    insertItems: cqInsertItemsMock,
  }));
  mock.module('../../repositories/quoteCandidatesRepo.ts', () => ({
    ...quoteCandidatesRepoSnap,
    insert: qcInsertMock,
    listForQuote: qcListForQuoteMock,
    deleteAllForQuote: qcDeleteAllForQuoteMock,
  }));
  mock.module('../../repositories/clientOffersRepo.ts', () => ({
    ...clientOffersRepoSnap,
    create: coCreateMock,
    insertItems: coInsertItemsMock,
    lockExistingById: coLockExistingByIdMock,
    findLinkedSaleId: coFindLinkedSaleIdMock,
    deleteById: coDeleteByIdMock,
  }));
  mock.module('../../repositories/productsRepo.ts', () => ({
    ...productsRepoSnap,
    getSnapshots: productsGetSnapshotsMock,
  }));
  mock.module('../../repositories/quoteCommunicationChannelsRepo.ts', () => ({
    ...quoteCommunicationChannelsRepoSnap,
    findById: qccFindByIdMock,
    findDefault: qccFindDefaultMock,
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
    getQuoteItemSnapshots: sqGetQuoteItemSnapshotsMock,
    findEarliestExpirationByIds: sqFindEarliestExpirationByIdsMock,
    findBlockingExpirationsByIds: sqFindBlockingExpirationsByIdsMock,
  }));
  mock.module('../../services/documentCodes.ts', () => ({
    ...documentCodesSnap,
    allocateDocumentCode: allocateDocumentCodeMock,
  }));
  mock.module('../../services/documentRevisions.ts', () => ({
    ...documentRevisionsSnap,
    createQuoteRevisionIfChanged: createQuoteRevisionIfChangedMock,
    lockSupplierRevisionStates: lockSupplierRevisionStatesMock,
    createDerivedSupplierRevisions: createDerivedSupplierRevisionsMock,
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
  mock.module('../../repositories/quoteCandidatesRepo.ts', () => quoteCandidatesRepoSnap);
  mock.module('../../repositories/clientOffersRepo.ts', () => clientOffersRepoSnap);
  mock.module('../../repositories/clientQuotesRepo.ts', () => clientQuotesRepoSnap);
  mock.module('../../repositories/productsRepo.ts', () => productsRepoSnap);
  mock.module(
    '../../repositories/quoteCommunicationChannelsRepo.ts',
    () => quoteCommunicationChannelsRepoSnap,
  );
  mock.module('../../repositories/quoteVersionsRepo.ts', () => quoteVersionsRepoSnap);
  mock.module('../../repositories/supplierQuotesRepo.ts', () => supplierQuotesRepoSnap);
  mock.module('../../services/documentCodes.ts', () => documentCodesSnap);
  mock.module('../../services/documentRevisions.ts', () => documentRevisionsSnap);
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
  communicationChannelId: 'qcc_email',
  communicationChannelName: 'Email',
  notes: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const SAMPLE_ITEM = {
  id: 'qi-1',
  quoteId: 'q-1',
  candidateId: 'q-1',
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
  discount: 12.5,
  note: null,
  unitType: 'hours' as const,
  durationMonths: 1,
  durationUnit: 'months' as const,
};

const SAMPLE_CANDIDATE = {
  id: 'q-1',
  quoteId: 'q-1',
  name: 'Variante A',
  position: 0,
  state: 'active' as const,
  paymentTerms: 'immediate',
  discount: 0,
  discountType: 'percentage' as const,
  expirationDate: '2026-12-31',
  communicationChannelId: 'qcc_email',
  communicationChannelName: 'Email',
  notes: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const SAMPLE_SNAPSHOT = {
  schemaVersion: 2 as const,
  quote: SAMPLE_QUOTE,
  candidates: [SAMPLE_CANDIDATE],
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
  cqFindByIdMock,
  cqFindLinkedOfferIdMock,
  cqFindCurrentMock,
  cqLockCurrentByIdMock,
  cqFindNonDraftLinkedSaleMock,
  cqFindAnyLinkedSaleMock,
  cqDeleteDraftSalesForQuoteMock,
  cqFindFullForSnapshotMock,
  cqFindItemsForQuoteMock,
  cqFindItemSnapshotsForQuoteMock,
  cqFindIdConflictMock,
  cqUpdateMock,
  cqRenameMock,
  cqRestoreSnapshotQuoteMock,
  cqReplaceItemsMock,
  cqCreateMock,
  cqInsertItemsMock,
  qcInsertMock,
  qcListForQuoteMock,
  qcDeleteAllForQuoteMock,
  qccFindByIdMock,
  qccFindDefaultMock,
  coCreateMock,
  coInsertItemsMock,
  coLockExistingByIdMock,
  coFindLinkedSaleIdMock,
  coDeleteByIdMock,
  clientsExistsByIdMock,
  productsGetSnapshotsMock,
  sqGetQuoteItemSnapshotsMock,
  sqFindEarliestExpirationByIdsMock,
  sqFindBlockingExpirationsByIdsMock,
  qvListForQuoteMock,
  qvFindByIdMock,
  qvInsertMock,
  qvBuildSnapshotMock,
  allocateDocumentCodeMock,
  createQuoteRevisionIfChangedMock,
  lockSupplierRevisionStatesMock,
  createDerivedSupplierRevisionsMock,
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
  allocateDocumentCodeMock.mockResolvedValue('OFF-2999-0001');
  createQuoteRevisionIfChangedMock.mockResolvedValue({ revisionNumber: 1, revisionCode: 'REV1' });
  lockSupplierRevisionStatesMock.mockResolvedValue(new Map());
  createDerivedSupplierRevisionsMock.mockResolvedValue(undefined);
  qvBuildSnapshotMock.mockImplementation((quote, items, candidates) => ({
    schemaVersion: 2,
    quote,
    candidates,
    items,
  }));
  qcInsertMock.mockImplementation((input: Record<string, unknown>) =>
    Promise.resolve({ ...input, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 }),
  );
  qcListForQuoteMock.mockResolvedValue([SAMPLE_CANDIDATE]);
  qcDeleteAllForQuoteMock.mockResolvedValue(undefined);

  // Default safe values for repos that PUT calls but most tests don't care about.
  cqFindByIdMock.mockResolvedValue(SAMPLE_QUOTE);
  cqLockCurrentByIdMock.mockResolvedValue(SAMPLE_QUOTE);
  cqFindItemsForQuoteMock.mockResolvedValue([SAMPLE_ITEM]);
  cqInsertItemsMock.mockResolvedValue([SAMPLE_ITEM]);
  cqFindIdConflictMock.mockResolvedValue(false);
  cqFindAnyLinkedSaleMock.mockResolvedValue(null);
  // Product-only items resolve no supplier snapshots; default to an empty map.
  sqGetQuoteItemSnapshotsMock.mockResolvedValue(new Map());
  sqFindBlockingExpirationsByIdsMock.mockResolvedValue(new Map());
  qccFindByIdMock.mockResolvedValue({ id: 'qcc_email', name: 'Email' });
  qccFindDefaultMock.mockResolvedValue({ id: 'qcc_email', name: 'Email' });
  // Restore's progression guard reads the SNAPSHOT's earliest sourced supplier-quote expiration;
  // default to "nothing sourced is expired" (far-future) so most tests don't trip it.
  sqFindEarliestExpirationByIdsMock.mockResolvedValue('2999-12-31');
  // Status-only advances resolve the CURRENT lines' sourced supplier quotes (#812 round 10);
  // default to no lines so unrelated tests don't trip the expired-supplier guard.
  cqFindItemSnapshotsForQuoteMock.mockResolvedValue([]);
  coCreateMock.mockImplementation((input: Record<string, unknown>) =>
    Promise.resolve({
      id: input.id,
      linkedQuoteId: input.linkedQuoteId,
      clientId: input.clientId,
      clientName: input.clientName,
      paymentTerms: input.paymentTerms,
      discount: input.discount,
      discountType: input.discountType,
      status: input.status,
      deliveryDate: null,
      expirationDate: input.expirationDate,
      notes: input.notes,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    }),
  );
  coInsertItemsMock.mockResolvedValue([]);
  coLockExistingByIdMock.mockResolvedValue({
    id: 'off-1',
    linkedQuoteId: 'q-1',
    clientId: 'c1',
    clientName: 'Client',
    status: 'draft',
    deliveryDate: null,
    expirationDate: '2999-12-31',
  });
  coFindLinkedSaleIdMock.mockResolvedValue(null);
  coDeleteByIdMock.mockResolvedValue(true);

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

  test('decodes dot-only quote and version transport values before repository access', async () => {
    qvFindByIdMock.mockResolvedValue(SAMPLE_VERSION);
    const escapePrefix = '~'.repeat(101);

    const res = await testApp.inject({
      method: 'GET',
      url: `/api/sales/client-quotes/${escapePrefix}./versions/${escapePrefix}..`,
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(qvFindByIdMock).toHaveBeenCalledWith('.', '..');
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
    cqLockCurrentByIdMock.mockResolvedValue({
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
      TX_SENTINEL,
    );
    // TOCTOU guard: gate-read must use the FOR UPDATE helper, not the non-locking findCurrent
    expect(cqLockCurrentByIdMock).toHaveBeenCalledWith('q-1', TX_SENTINEL);
    expect(cqFindCurrentMock).not.toHaveBeenCalled();
    // Quote and items applied (refs checked inside the same tx)
    expect(clientsExistsByIdMock).toHaveBeenCalledWith('c1', TX_SENTINEL);
    expect(productsGetSnapshotsMock).toHaveBeenCalledWith(['p-1'], TX_SENTINEL);
    expect(cqRestoreSnapshotQuoteMock).toHaveBeenCalledWith(
      'q-1',
      expect.objectContaining({ notes: null }),
      TX_SENTINEL,
    );
    expect(qcDeleteAllForQuoteMock).toHaveBeenCalledWith('q-1', TX_SENTINEL);
    expect(qcInsertMock).toHaveBeenCalled();
    expect(cqInsertItemsMock).toHaveBeenCalled();
    expect(cqInsertItemsMock.mock.calls[0]?.[1]?.[0].productMolPercentage).toBe(50);
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

  test('restores description from a new snapshot', async () => {
    setupHappyPath();
    qvFindByIdMock.mockResolvedValue({
      ...SAMPLE_VERSION,
      snapshot: {
        ...SAMPLE_SNAPSHOT,
        quote: { ...SAMPLE_QUOTE, description: 'Restored quote description' },
      },
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(cqRestoreSnapshotQuoteMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ description: 'Restored quote description' }),
    );
  });

  test('does not clear description when a legacy snapshot omits it', async () => {
    setupHappyPath();

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(Object.hasOwn(cqRestoreSnapshotQuoteMock.mock.calls[0]?.[1], 'description')).toBe(false);
  });

  test('200 restores a draft snapshot by deleting a linked draft offer', async () => {
    setupHappyPath();
    cqFindLinkedOfferIdMock.mockResolvedValue('off-1');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).linkedOfferId).toBeNull();
    expect(coLockExistingByIdMock).toHaveBeenCalledWith('off-1', TX_SENTINEL);
    expect(coDeleteByIdMock).toHaveBeenCalledWith('off-1', TX_SENTINEL);
  });

  test('409 when linked offer exists and snapshot is not draft', async () => {
    setupHappyPath();
    cqFindLinkedOfferIdMock.mockResolvedValue('off-1');
    qvFindByIdMock.mockResolvedValue({
      ...SAMPLE_VERSION,
      snapshot: { ...SAMPLE_SNAPSHOT, quote: { ...SAMPLE_QUOTE, status: 'sent' } },
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(cqRestoreSnapshotQuoteMock).not.toHaveBeenCalled();
    expect(qvInsertMock).not.toHaveBeenCalled();
  });

  test('409 when linked offer rollback finds a downstream offer', async () => {
    setupHappyPath();
    cqFindLinkedOfferIdMock.mockResolvedValue('off-1');
    coLockExistingByIdMock.mockResolvedValue({
      id: 'off-1',
      linkedQuoteId: 'q-1',
      clientId: 'c1',
      clientName: 'Client',
      status: 'accepted',
      deliveryDate: null,
      expirationDate: '2999-12-31',
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('linked offer is no longer draft');
    expect(coDeleteByIdMock).not.toHaveBeenCalled();
  });

  test('409 when a snapshot item references a candidate outside the family', async () => {
    setupHappyPath();
    qvFindByIdMock.mockResolvedValue({
      ...SAMPLE_VERSION,
      snapshot: {
        ...SAMPLE_SNAPSHOT,
        items: [{ ...SAMPLE_ITEM, candidateId: 'qc-orphan' }],
      },
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('no matching candidate');
    expect(qcDeleteAllForQuoteMock).not.toHaveBeenCalled();
  });

  test('409 restoring an offer snapshot cannot bypass candidate promotion', async () => {
    setupHappyPath();
    qvFindByIdMock.mockResolvedValue({
      ...SAMPLE_VERSION,
      snapshot: { ...SAMPLE_SNAPSHOT, quote: { ...SAMPLE_QUOTE, status: 'offer' } },
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('candidate promotion');
    expect(coCreateMock).not.toHaveBeenCalled();
  });

  test('409 when the quote is not draft (restore blocked like offers)', async () => {
    setupHappyPath();
    cqLockCurrentByIdMock.mockResolvedValue({
      status: 'sent',
      discount: 0,
      discountType: 'percentage',
      expirationDate: '2999-12-31',
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Non-draft');
    expect(cqRestoreSnapshotQuoteMock).not.toHaveBeenCalled();
    expect(qvInsertMock).not.toHaveBeenCalled();
  });

  test('409 when the draft quote is effectively expired (restore would rewrite frozen content)', async () => {
    // Expired quotes are content-read-only and exit only via a date extension (issue #779);
    // restore must enforce the same rule the PUT does. Non-draft outranks expired, so this
    // fixture stays on draft to assert the expired message specifically.
    setupHappyPath();
    cqLockCurrentByIdMock.mockResolvedValue({
      status: 'draft',
      discount: 0,
      discountType: 'percentage',
      expirationDate: '2000-01-01',
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Expired');
    expect(cqRestoreSnapshotQuoteMock).not.toHaveBeenCalled();
    expect(qvInsertMock).not.toHaveBeenCalled();
  });

  test('409 when the snapshot would park the quote in sent beside an expired sourced supplier', async () => {
    // The PUT guard blocks progressing to — or being parked in — sent/offer/accepted while a
    // sourced supplier quote is expired (issue #779 follow-up); restore must not bypass it. The
    // restore REPLACES the lines with the snapshot's, so the guard reads the SNAPSHOT's earliest
    // sourced expiration, not the pre-restore quote's.
    setupHappyPath();
    cqLockCurrentByIdMock.mockResolvedValue({
      status: 'draft',
      discount: 0,
      discountType: 'percentage',
    });
    qvFindByIdMock.mockResolvedValue({
      ...SAMPLE_VERSION,
      snapshot: { ...SAMPLE_SNAPSHOT, quote: { ...SAMPLE_QUOTE, status: 'sent' } },
    });
    // The snapshot's lines source a supplier quote that is now expired.
    sqFindEarliestExpirationByIdsMock.mockResolvedValue('2000-01-01');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('expired');
    expect(cqRestoreSnapshotQuoteMock).not.toHaveBeenCalled();
    expect(qvInsertMock).not.toHaveBeenCalled();
  });

  test('200 restores a draft snapshot even while a sourced supplier quote is expired', async () => {
    // Parking in draft is not a progressed state — mirrors the PUT guard's tolerance.
    setupHappyPath();
    cqLockCurrentByIdMock.mockResolvedValue({
      status: 'draft',
      discount: 0,
      discountType: 'percentage',
    });
    // Even with an expired sourced supplier quote, a draft target is not blocked.
    sqFindEarliestExpirationByIdsMock.mockResolvedValue('2000-01-01');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(cqRestoreSnapshotQuoteMock).toHaveBeenCalled();
  });

  test('404 when current quote does not exist', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue(null);
    cqLockCurrentByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(cqRestoreSnapshotQuoteMock).not.toHaveBeenCalled();
    expect(cqFindLinkedOfferIdMock).not.toHaveBeenCalled();
    expect(cqFindNonDraftLinkedSaleMock).not.toHaveBeenCalled();
    expect(qvFindByIdMock).not.toHaveBeenCalled();
  });

  test('409 when quote is confirmed', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue(null);
    cqLockCurrentByIdMock.mockResolvedValue({
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
    expect(cqFindLinkedOfferIdMock).not.toHaveBeenCalled();
    expect(cqFindNonDraftLinkedSaleMock).not.toHaveBeenCalled();
    expect(qvFindByIdMock).not.toHaveBeenCalled();
  });

  test('409 when non-draft linked sale exists', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue(null);
    cqLockCurrentByIdMock.mockResolvedValue({
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
    cqLockCurrentByIdMock.mockResolvedValue({
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
    expect(qvFindByIdMock).toHaveBeenCalledWith('q-1', 'qv-other', TX_SENTINEL);
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

  test('POST restore: candidate item insert failure rolls back (no audit, no success)', async () => {
    setupHappyPath();
    withDbTransactionMock.mockImplementation(async (cb) => cb(TX_SENTINEL));
    cqInsertItemsMock.mockRejectedValue(new Error('insert failed'));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(500);
    expect(withDbTransactionMock).toHaveBeenCalled();
    expect(qcDeleteAllForQuoteMock).toHaveBeenCalledWith('q-1', TX_SENTINEL);
    expect(qcInsertMock).toHaveBeenCalled();
    expect(cqInsertItemsMock).toHaveBeenCalled();
    expect(cqInsertItemsMock.mock.calls[0]?.at(-2)).toBe(TX_SENTINEL);
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe('PUT /api/sales/client-quotes/:id snapshots pre-update state', () => {
  test('400 rejects an explicitly blank communication channel on update', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue(null);
    cqFindCurrentMock.mockResolvedValue({
      status: 'draft',
      discount: 0,
      discountType: 'percentage',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: { communicationChannelId: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'communicationChannelId is required' });
    expect(qccFindByIdMock).not.toHaveBeenCalled();
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('PUT with content changes inserts a snapshot inside the transaction', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue(null);
    cqFindCurrentMock.mockResolvedValue({
      status: 'draft',
      discount: 0,
      discountType: 'percentage',
      expirationDate: SAMPLE_QUOTE.expirationDate,
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
      TX_SENTINEL,
    );
  });

  test('PUT with id-only rename does NOT snapshot (no content change)', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue(null);
    cqFindCurrentMock.mockResolvedValue({
      status: 'draft',
      discount: 0,
      discountType: 'percentage',
      expirationDate: SAMPLE_QUOTE.expirationDate,
    });
    cqRenameMock.mockResolvedValue({ ...SAMPLE_QUOTE, id: 'q-1-renamed' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: { id: 'q-1-renamed' },
    });

    expect(res.statusCode).toBe(200);
    expect(qvInsertMock).not.toHaveBeenCalled();
    expect(cqFindFullForSnapshotMock).not.toHaveBeenCalled();
    // PK rename goes through the dedicated repo call (issue #621), not the generic update().
    expect(cqRenameMock).toHaveBeenCalledWith('q-1', 'q-1-renamed', TX_SENTINEL);
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });
});

// Duration column (issue #757): the route owns its own validation (whole-number / positive /
// default-to-1) and feeds durationMonths into the persisted line items. (Offers, orders, and
// invoices validate/coerce duration the same way; invoices additionally fold it into their
// server-authoritative totals.) Exercise the quote variant here.
describe('POST /api/sales/client-quotes - duration handling (issue #757)', () => {
  const createBody = (itemOverrides: Record<string, unknown> = {}) => {
    const items = [
      {
        productId: 'prod-1',
        productName: 'Service',
        quantity: 2,
        unitPrice: 10,
        productCost: 5,
        unitType: 'hours',
        ...itemOverrides,
      },
    ];
    return {
      id: 'q-new',
      clientId: 'c1',
      clientName: 'Client',
      candidates: [
        {
          name: 'Variante A',
          expirationDate: '2026-12-31',
          communicationChannelId: 'qcc_email',
          items,
        },
      ],
    };
  };

  const setupCreateMocks = () => {
    productsGetSnapshotsMock.mockResolvedValue(
      new Map([['prod-1', { productCost: 5, productMolPercentage: null }]]),
    );
    cqCreateMock.mockResolvedValue(SAMPLE_QUOTE);
    cqInsertItemsMock.mockResolvedValue([SAMPLE_ITEM]);
  };

  test('201 persists a multi-month duration: it reaches insertItems unchanged', async () => {
    setupCreateMocks();

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes',
      headers: authHeader(),
      payload: createBody({ durationMonths: 12, durationUnit: 'years' }),
    });

    expect(res.statusCode).toBe(201);
    const insertedItems = cqInsertItemsMock.mock.calls[0][1];
    expect(insertedItems).toHaveLength(1);
    expect(insertedItems[0].durationMonths).toBe(12);
    expect(insertedItems[0].durationUnit).toBe('years');
  });

  test('400 requires a communication channel on create', async () => {
    setupCreateMocks();
    const payload = createBody();
    delete (payload.candidates[0] as { communicationChannelId?: string }).communicationChannelId;

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes',
      headers: authHeader(),
      payload,
    });

    expect(res.statusCode).toBe(400);
    expect(cqCreateMock).not.toHaveBeenCalled();
  });

  test('400 rejects an unknown communication channel on create', async () => {
    setupCreateMocks();
    qccFindByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes',
      headers: authHeader(),
      payload: createBody(),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('communicationChannelId');
    expect(cqCreateMock).not.toHaveBeenCalled();
  });

  test('201 preserves a unit-measured line duration (Durata applies to every unit type)', async () => {
    setupCreateMocks();

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes',
      headers: authHeader(),
      payload: createBody({ unitType: 'unit', durationMonths: 12, durationUnit: 'years' }),
    });

    expect(res.statusCode).toBe(201);
    const insertedItems = cqInsertItemsMock.mock.calls[0][1];
    expect(insertedItems[0].unitType).toBe('unit');
    // Unit lines carry a duration like any other line — it reaches insertItems unchanged.
    expect(insertedItems[0].durationMonths).toBe(12);
    expect(insertedItems[0].durationUnit).toBe('years');
  });

  test('201 defaults an omitted durationMonths to 1 (one-off line)', async () => {
    setupCreateMocks();

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes',
      headers: authHeader(),
      payload: createBody(),
    });

    expect(res.statusCode).toBe(201);
    expect(cqInsertItemsMock.mock.calls[0][1][0].durationMonths).toBe(1);
    expect(cqInsertItemsMock.mock.calls[0][1][0].durationUnit).toBe('months');
  });

  test('400 rejects a fractional durationMonths with a whole-months message', async () => {
    setupCreateMocks();

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes',
      headers: authHeader(),
      payload: createBody({ durationMonths: 2.5 }),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('whole number of months');
    expect(cqInsertItemsMock).not.toHaveBeenCalled();
  });

  test('400 rejects a zero or negative durationMonths', async () => {
    setupCreateMocks();

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes',
      headers: authHeader(),
      payload: createBody({ durationMonths: 0 }),
    });

    expect(res.statusCode).toBe(400);
    expect(cqInsertItemsMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/sales/client-quotes/:id/versions/:versionId/restore - duration round-trip', () => {
  test('carries a non-default snapshot durationMonths through candidate insert (issue #757)', async () => {
    cqLockCurrentByIdMock.mockResolvedValue({
      status: 'draft',
      discount: 0,
      discountType: 'percentage',
    });
    cqFindLinkedOfferIdMock.mockResolvedValue(null);
    cqFindNonDraftLinkedSaleMock.mockResolvedValue(null);
    clientsExistsByIdMock.mockResolvedValue(true);
    productsGetSnapshotsMock.mockResolvedValue(
      new Map([['p-1', { productCost: 1, productMolPercentage: null }]]),
    );
    cqDeleteDraftSalesForQuoteMock.mockResolvedValue(undefined);
    cqRestoreSnapshotQuoteMock.mockResolvedValue(SAMPLE_QUOTE);
    cqReplaceItemsMock.mockResolvedValue([SAMPLE_ITEM]);
    qvFindByIdMock.mockResolvedValue({
      ...SAMPLE_VERSION_ROW,
      snapshot: {
        schemaVersion: 2,
        quote: { ...SAMPLE_QUOTE },
        candidates: [SAMPLE_CANDIDATE],
        items: [{ ...SAMPLE_ITEM, durationMonths: 12, durationUnit: 'years' }],
      },
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/versions/qv-1/restore',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const replacedItems = cqInsertItemsMock.mock.calls[0][1];
    expect(replacedItems[0].durationMonths).toBe(12);
    expect(replacedItems[0].durationUnit).toBe('years');
    expect(replacedItems[0].position).toBe(0);
  });
});
