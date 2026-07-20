import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realClientOffersRepo from '../../repositories/clientOffersRepo.ts';
import * as realClientQuotesRepo from '../../repositories/clientQuotesRepo.ts';
import * as realQuoteCandidatesRepo from '../../repositories/quoteCandidatesRepo.ts';
import * as realQuoteCommunicationChannelsRepo from '../../repositories/quoteCommunicationChannelsRepo.ts';
import * as realQuoteVersionsRepo from '../../repositories/quoteVersionsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realSupplierQuotesRepo from '../../repositories/supplierQuotesRepo.ts';
import * as realSupplierQuoteVersionsRepo from '../../repositories/supplierQuoteVersionsRepo.ts';
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

// Issue #779: focused coverage of the new PUT status rules (transitions, expired-frozen,
// no-op resend tolerance, the 1-to-1 supplier-quote link + conflict, and the
// expired-supplier-quote progression guard) plus the derived response fields.

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const clientOffersRepoSnap = { ...realClientOffersRepo };
const clientQuotesRepoSnap = { ...realClientQuotesRepo };
const quoteCandidatesRepoSnap = { ...realQuoteCandidatesRepo };
const quoteCommunicationChannelsRepoSnap = { ...realQuoteCommunicationChannelsRepo };
const quoteVersionsRepoSnap = { ...realQuoteVersionsRepo };
const supplierQuotesRepoSnap = { ...realSupplierQuotesRepo };
const supplierQuoteVersionsRepoSnap = { ...realSupplierQuoteVersionsRepo };
const documentCodesSnap = { ...realDocumentCodes };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const cqFindLinkedOfferIdMock = mock();
const cqFindByIdMock = mock();
const cqFindItemsForCandidateMock = mock();
const cqFindCurrentMock = mock();
const cqLockCurrentByIdMock = mock();
const cqFindAnyLinkedSaleMock = mock();
const cqFindFullForSnapshotMock = mock();
const cqFindItemsForQuoteMock = mock();
const cqFindIdConflictMock = mock();
const cqRenameMock = mock();
const cqUpdateMock = mock();
const cqFindStatusAndClientNameMock = mock();
const cqDeleteByIdMock = mock();
const cqReplaceItemsMock = mock();
const cqFindItemSnapshotsForQuoteMock = mock();
const cqFindItemTotalsMock = mock();
const cqListAllMock = mock();
const cqListAllItemsMock = mock();
const cqCreateMock = mock();
const cqInsertItemsMock = mock();

const qcListAllMock = mock();
const qcListForQuoteMock = mock();
const qcInsertMock = mock();
const qcUpdateMock = mock();
const qcDeleteMissingActiveMock = mock();
const qcFindByIdMock = mock();
const qcLockByIdMock = mock();
const qcMarkPromotedMock = mock();
const qcReactivateAllMock = mock();

const qccFindByIdMock = mock();

const coCreateMock = mock();
const coInsertItemsMock = mock();
const coLockExistingByIdMock = mock();
const coFindLinkedSaleIdMock = mock();
const coDeleteByIdMock = mock();

const sqFindEarliestExpirationByIdsMock = mock();
const sqFindBlockingExpirationsByIdsMock = mock();
const sqFindItemsByIdsMock = mock();
const sqFindLinkedOrderIdMock = mock();
const sqFindFullForSnapshotMock = mock();
const sqSyncItemPricingMock = mock();
const sqLockEffectiveStatusMock = mock();
const sqGetQuoteItemSnapshotsMock = mock();
const sqvInsertMock = mock();
const sqvBuildSnapshotMock = mock();

const qvInsertMock = mock();
const qvBuildSnapshotMock = mock();
const allocateDocumentCodeMock = mock();
const reserveDocumentCodeCounterFromCodeMock = mock();

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
  mock.module('../../repositories/clientQuotesRepo.ts', () => ({
    ...clientQuotesRepoSnap,
    findLinkedOfferId: cqFindLinkedOfferIdMock,
    findById: cqFindByIdMock,
    findItemsForCandidate: cqFindItemsForCandidateMock,
    findCurrent: cqFindCurrentMock,
    lockCurrentById: cqLockCurrentByIdMock,
    findAnyLinkedSale: cqFindAnyLinkedSaleMock,
    findFullForSnapshot: cqFindFullForSnapshotMock,
    findItemsForQuote: cqFindItemsForQuoteMock,
    findIdConflict: cqFindIdConflictMock,
    rename: cqRenameMock,
    update: cqUpdateMock,
    findStatusAndClientName: cqFindStatusAndClientNameMock,
    deleteById: cqDeleteByIdMock,
    replaceItems: cqReplaceItemsMock,
    findItemSnapshotsForQuote: cqFindItemSnapshotsForQuoteMock,
    findItemTotals: cqFindItemTotalsMock,
    listAll: cqListAllMock,
    listAllItems: cqListAllItemsMock,
    create: cqCreateMock,
    insertItems: cqInsertItemsMock,
  }));
  mock.module('../../repositories/quoteCandidatesRepo.ts', () => ({
    ...quoteCandidatesRepoSnap,
    listAll: qcListAllMock,
    listForQuote: qcListForQuoteMock,
    insert: qcInsertMock,
    update: qcUpdateMock,
    deleteMissingActive: qcDeleteMissingActiveMock,
    findById: qcFindByIdMock,
    lockById: qcLockByIdMock,
    markPromoted: qcMarkPromotedMock,
    reactivateAll: qcReactivateAllMock,
  }));
  mock.module('../../repositories/clientOffersRepo.ts', () => ({
    ...clientOffersRepoSnap,
    create: coCreateMock,
    insertItems: coInsertItemsMock,
    lockExistingById: coLockExistingByIdMock,
    findLinkedSaleId: coFindLinkedSaleIdMock,
    deleteById: coDeleteByIdMock,
  }));
  mock.module('../../repositories/quoteCommunicationChannelsRepo.ts', () => ({
    ...quoteCommunicationChannelsRepoSnap,
    findById: qccFindByIdMock,
  }));
  mock.module('../../repositories/supplierQuotesRepo.ts', () => ({
    ...supplierQuotesRepoSnap,
    findItemsByIds: sqFindItemsByIdsMock,
    findLinkedOrderId: sqFindLinkedOrderIdMock,
    findFullForSnapshot: sqFindFullForSnapshotMock,
    syncItemPricing: sqSyncItemPricingMock,
    lockEffectiveStatusById: sqLockEffectiveStatusMock,
    getQuoteItemSnapshots: sqGetQuoteItemSnapshotsMock,
    findEarliestExpirationByIds: sqFindEarliestExpirationByIdsMock,
    findBlockingExpirationsByIds: sqFindBlockingExpirationsByIdsMock,
  }));
  mock.module('../../repositories/supplierQuoteVersionsRepo.ts', () => ({
    ...supplierQuoteVersionsRepoSnap,
    insert: sqvInsertMock,
    buildSnapshot: sqvBuildSnapshotMock,
  }));
  mock.module('../../repositories/quoteVersionsRepo.ts', () => ({
    ...quoteVersionsRepoSnap,
    insert: qvInsertMock,
    buildSnapshot: qvBuildSnapshotMock,
  }));
  mock.module('../../services/documentCodes.ts', () => ({
    ...documentCodesSnap,
    allocateDocumentCode: allocateDocumentCodeMock,
    reserveDocumentCodeCounterFromCode: reserveDocumentCodeCounterFromCodeMock,
  }));
  mock.module('../../utils/audit.ts', () => ({ ...auditSnap, logAudit: logAuditMock }));
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
  mock.module('../../repositories/clientQuotesRepo.ts', () => clientQuotesRepoSnap);
  mock.module('../../repositories/quoteCandidatesRepo.ts', () => quoteCandidatesRepoSnap);
  mock.module('../../repositories/clientOffersRepo.ts', () => clientOffersRepoSnap);
  mock.module(
    '../../repositories/quoteCommunicationChannelsRepo.ts',
    () => quoteCommunicationChannelsRepoSnap,
  );
  mock.module('../../repositories/supplierQuotesRepo.ts', () => supplierQuotesRepoSnap);
  mock.module(
    '../../repositories/supplierQuoteVersionsRepo.ts',
    () => supplierQuoteVersionsRepoSnap,
  );
  mock.module('../../repositories/quoteVersionsRepo.ts', () => quoteVersionsRepoSnap);
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

// supplier_quotes.update rides along: the #779 forward sync requires it whenever a save pushes
// sourced-line edits onto a supplier quote.
const FULL_PERMS = [
  'sales.client_quotes.create',
  'sales.client_quotes.update',
  'sales.client_quotes.delete',
  'sales.client_offers.create',
  'sales.client_offers.delete',
  'sales.supplier_quotes.update',
];

// findCurrent returns the ClientQuoteGate shape.
const gate = (over: Partial<ReturnType<typeof baseGate>> = {}) => ({ ...baseGate(), ...over });
const baseGate = () => ({
  status: 'draft',
  discount: 0,
  discountType: 'percentage' as const,
  // Far future: the effective-status guards compare against the real clock, so a near date would
  // flip these fixtures to `expired` one day and break the suite (#779 second-pass review).
  expirationDate: '2999-12-31',
  linkedSupplierQuoteId: null as string | null,
  linkedSupplierQuoteExpiration: null as string | null,
});

// update() returns a mapped ClientQuote (BASE projection shape).
const updatedQuote = (over: Record<string, unknown> = {}) => ({
  id: 'q-1',
  linkedOfferId: null,
  clientId: 'c1',
  clientName: 'Client',
  paymentTerms: 'immediate',
  discount: 0,
  discountType: 'percentage' as const,
  status: 'sent',
  expirationDate: '2999-12-31',
  communicationChannelId: 'qcc_email',
  communicationChannelName: 'Email',
  notes: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  linkedSupplierQuoteId: null as string | null,
  linkedSupplierQuoteExpiration: null as string | null,
  ...over,
});

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  cqFindLinkedOfferIdMock,
  cqFindByIdMock,
  cqFindItemsForCandidateMock,
  cqFindCurrentMock,
  cqLockCurrentByIdMock,
  cqFindAnyLinkedSaleMock,
  cqFindFullForSnapshotMock,
  cqFindItemsForQuoteMock,
  cqFindIdConflictMock,
  cqRenameMock,
  cqUpdateMock,
  cqReplaceItemsMock,
  cqFindItemSnapshotsForQuoteMock,
  cqFindItemTotalsMock,
  cqListAllMock,
  cqListAllItemsMock,
  cqCreateMock,
  cqInsertItemsMock,
  qcListAllMock,
  qcListForQuoteMock,
  qcInsertMock,
  qcUpdateMock,
  qcDeleteMissingActiveMock,
  qcFindByIdMock,
  qcLockByIdMock,
  qcMarkPromotedMock,
  qcReactivateAllMock,
  qccFindByIdMock,
  coCreateMock,
  coInsertItemsMock,
  coLockExistingByIdMock,
  coFindLinkedSaleIdMock,
  coDeleteByIdMock,
  cqFindStatusAndClientNameMock,
  cqDeleteByIdMock,
  sqFindEarliestExpirationByIdsMock,
  sqFindBlockingExpirationsByIdsMock,
  sqFindItemsByIdsMock,
  sqFindLinkedOrderIdMock,
  sqFindFullForSnapshotMock,
  sqSyncItemPricingMock,
  sqLockEffectiveStatusMock,
  sqGetQuoteItemSnapshotsMock,
  sqvInsertMock,
  sqvBuildSnapshotMock,
  qvInsertMock,
  qvBuildSnapshotMock,
  allocateDocumentCodeMock,
  reserveDocumentCodeCounterFromCodeMock,
  logAuditMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(FULL_PERMS);
  resetWithDbTransactionMock();
  logAuditMock.mockImplementation(async () => undefined);
  allocateDocumentCodeMock.mockImplementation(async (moduleId: string) => {
    if (moduleId === 'client_quote') return 'PREV-2999-0001';
    if (moduleId === 'client_offer') return 'OFF-2999-0001';
    return `${moduleId}-generated`;
  });
  reserveDocumentCodeCounterFromCodeMock.mockResolvedValue(undefined);
  qvBuildSnapshotMock.mockImplementation((quote, items) => ({ schemaVersion: 1, quote, items }));
  qcListAllMock.mockResolvedValue([]);
  qcListForQuoteMock.mockResolvedValue([]);
  qcInsertMock.mockImplementation((input: Record<string, unknown>) =>
    Promise.resolve({ ...input, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 }),
  );
  qcUpdateMock.mockImplementation((_id: string, input: Record<string, unknown>) =>
    Promise.resolve({ ...input, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 }),
  );
  qcDeleteMissingActiveMock.mockResolvedValue(undefined);
  qcMarkPromotedMock.mockResolvedValue(undefined);
  qcReactivateAllMock.mockResolvedValue(undefined);

  // Sensible defaults; individual tests override what they care about.
  cqFindLinkedOfferIdMock.mockResolvedValue(null);
  cqFindByIdMock.mockResolvedValue(null);
  cqLockCurrentByIdMock.mockResolvedValue(null);
  cqFindItemsForCandidateMock.mockResolvedValue([]);
  cqFindAnyLinkedSaleMock.mockResolvedValue(null);
  cqFindIdConflictMock.mockResolvedValue(false);
  cqRenameMock.mockResolvedValue(null);
  cqFindFullForSnapshotMock.mockResolvedValue({ quote: updatedQuote(), items: [] });
  cqFindItemsForQuoteMock.mockResolvedValue([]);
  cqFindItemTotalsMock.mockResolvedValue([]);
  qvInsertMock.mockResolvedValue(undefined);
  // Line-sourced expiration guard default: nothing sourced is expired (far-future earliest).
  sqFindEarliestExpirationByIdsMock.mockResolvedValue('2999-12-31');
  sqFindBlockingExpirationsByIdsMock.mockResolvedValue(new Map());
  // Forward-sync defaults: no supplier-sourced lines touched unless a test sets them up.
  cqReplaceItemsMock.mockResolvedValue([]);
  cqFindItemSnapshotsForQuoteMock.mockResolvedValue([]);
  cqCreateMock.mockResolvedValue(updatedQuote({ status: 'draft' }));
  cqInsertItemsMock.mockResolvedValue([]);
  qccFindByIdMock.mockResolvedValue({ id: 'qcc_email', name: 'Email' });
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
    id: 'q-1-OF',
    linkedQuoteId: 'q-1',
    linkedQuoteCandidateId: 'qc-a',
    clientId: 'c1',
    clientName: 'Client',
    status: 'draft',
    deliveryDate: null,
    expirationDate: '2999-12-31',
  });
  coFindLinkedSaleIdMock.mockResolvedValue(null);
  coDeleteByIdMock.mockResolvedValue(true);
  sqFindItemsByIdsMock.mockResolvedValue([]);
  sqFindLinkedOrderIdMock.mockResolvedValue(null);
  sqFindFullForSnapshotMock.mockResolvedValue(null);
  sqSyncItemPricingMock.mockResolvedValue(undefined);
  // Unlinked live chain → derived 'draft': the sync's freeze guard stays open by default.
  sqLockEffectiveStatusMock.mockResolvedValue({
    expirationDate: '2999-12-31',
    linkedClientStatus: null,
    linkedClientQuoteExpiration: null,
    linkedOfferStatus: null,
    linkedOfferExpiration: null,
  });
  sqGetQuoteItemSnapshotsMock.mockResolvedValue(new Map());
  sqvInsertMock.mockResolvedValue(undefined);
  sqvBuildSnapshotMock.mockImplementation((quote, items) => ({ schemaVersion: 1, quote, items }));

  testApp = await buildRouteTestApp(routePlugin, '/api/sales/client-quotes');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

const putStatus = (body: Record<string, unknown>) =>
  testApp.inject({
    method: 'PUT',
    url: '/api/sales/client-quotes/q-1',
    headers: authHeader(),
    payload: body,
  });

describe('PUT /api/sales/client-quotes/:id document discount validation', () => {
  test('200 allows unrelated updates to preserve a legacy percentage discount above 100', async () => {
    cqFindCurrentMock.mockResolvedValue(
      gate({ discount: 150, discountType: 'percentage' as const }),
    );
    cqUpdateMock.mockResolvedValue(
      updatedQuote({ discount: 150, discountType: 'percentage', notes: 'edited' }),
    );

    const res = await putStatus({ notes: 'edited' });

    expect(res.statusCode).toBe(200);
    expect(cqUpdateMock).toHaveBeenCalled();
  });

  test('200 allows updates that resend an unchanged legacy percentage discount above 100', async () => {
    cqFindCurrentMock.mockResolvedValue(
      gate({ discount: 150, discountType: 'percentage' as const }),
    );
    cqUpdateMock.mockResolvedValue(
      updatedQuote({ discount: 150, discountType: 'percentage', notes: 'edited' }),
    );

    const res = await putStatus({
      discount: 150,
      discountType: 'percentage',
      notes: 'edited',
    });

    expect(res.statusCode).toBe(200);
    expect(cqUpdateMock).toHaveBeenCalled();
  });
});

describe('PUT /api/sales/client-quotes/:id status rules (issue #779)', () => {
  test('200 allows draft → sent and returns derived fields', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'sent' }));

    const res = await putStatus({ status: 'sent' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('sent');
    expect(body.effectiveStatus).toBe('sent');
    expect(body).toHaveProperty('linkedSupplierQuoteId');
    expect(body.linkedSupplierQuoteExpired).toBe(false);
  });

  test('preserves notes when a flat update omits the field', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'sent', notes: 'keep me' }));

    const res = await putStatus({ status: 'sent' });

    expect(res.statusCode).toBe(200);
    expect(cqUpdateMock.mock.calls[0][1].notes).toBeUndefined();
  });

  test('mirrors supplied flat commercial fields into the primary candidate', async () => {
    const primaryCandidate = {
      id: 'qc-primary',
      quoteId: 'q-1',
      name: 'Variante A',
      position: 0,
      state: 'active' as const,
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage' as const,
      expirationDate: '2999-12-31',
      communicationChannelId: 'qcc_email',
      communicationChannelName: 'Email',
      notes: 'old notes',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    };
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'draft' }));
    cqFindItemTotalsMock.mockResolvedValue([
      { quantity: 1, unitPrice: 100, discount: 0, durationMonths: 1, durationUnit: 'na' },
    ]);
    qcListForQuoteMock.mockResolvedValue([primaryCandidate]);
    qcUpdateMock.mockResolvedValue({ ...primaryCandidate, notes: 'new notes' });

    const res = await putStatus({
      paymentTerms: '60gg',
      discount: 12,
      discountType: 'currency',
      communicationChannelId: 'qcc_email',
      notes: 'new notes',
    });

    expect(res.statusCode).toBe(200);
    expect(qcUpdateMock).toHaveBeenCalledWith(
      'q-1',
      'qc-primary',
      expect.objectContaining({
        paymentTerms: '60gg',
        discount: 12,
        discountType: 'currency',
        communicationChannelId: 'qcc_email',
        notes: 'new notes',
      }),
      expect.anything(),
    );
  });

  test('200 allows a no-op resend of the current status (draft → draft)', async () => {
    // The edit form resends the current status on every save — this must NOT trip the transition
    // rule (which would otherwise reject draft→draft as an invalid back-to-draft).
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'draft' }));

    const res = await putStatus({ status: 'draft', notes: 'edited' });
    expect(res.statusCode).toBe(200);
  });

  test('400 sent → offer must use candidate promotion', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent' }));

    const res = await putStatus({ status: 'offer' });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('candidate promotion endpoint');
    expect(coCreateMock).not.toHaveBeenCalled();
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('400 direct offer conversion is rejected before existing-offer checks', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue('existing-offer');
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent' }));

    const res = await putStatus({ status: 'offer' });

    expect(res.statusCode).toBe(400);
    expect(coCreateMock).not.toHaveBeenCalled();
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });
  test('400 linked offer → draft must use the promotion rollback endpoint', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue('q-1-OF');
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'offer' }));

    const res = await putStatus({ status: 'draft' });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('promotion rollback endpoint');
    expect(coLockExistingByIdMock).not.toHaveBeenCalled();
    expect(coDeleteByIdMock).not.toHaveBeenCalled();
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('409 rejects accepted → draft (invalid_transition)', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'accepted' }));

    const res = await putStatus({ status: 'draft' });
    expect(res.statusCode).toBe(409);
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('409 rejects accepted → sent: terminal quotes are frozen (#812)', async () => {
    // A status-only PUT must not reopen a finalized quote — downstream offers/orders can depend on
    // the terminal state. The content read-only guard does not fire (no content change), so the
    // terminal freeze in the statusChanged block must.
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'accepted' }));

    const res = await putStatus({ status: 'sent' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe('Accepted or rejected quotes are read-only');
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('400 rejects denied → offer through the direct status endpoint', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'denied' }));

    const res = await putStatus({ status: 'offer' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('candidate promotion endpoint');
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('200 allows offer → draft (back-to-draft from offer)', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'offer' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'draft' }));

    const res = await putStatus({ status: 'draft' });
    expect(res.statusCode).toBe(200);
  });

  test('400 direct accepted transition is rejected even for an expired quote', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));

    const res = await putStatus({ status: 'accepted' });
    expect(res.statusCode).toBe(400);
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('400 legacy accepted aliases must use candidate promotion', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent' }));

    for (const status of ['confirmed', 'approved']) {
      const res = await putStatus({ status });
      expect(res.statusCode).toBe(400);
    }
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('200 expired quote can be revalidated by extending the expiration date (no status change)', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'sent', expirationDate: '2027-01-01' }));

    const res = await putStatus({ expirationDate: '2027-01-01' });
    expect(res.statusCode).toBe(200);
    expect(cqUpdateMock).toHaveBeenCalled();
  });

  test('revalidating an expired family updates its primary candidate as well as the parent', async () => {
    const expiredCandidate = {
      id: 'qc-a',
      quoteId: 'q-1',
      name: 'Variante A',
      position: 0,
      state: 'active' as const,
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage' as const,
      expirationDate: '2000-01-01',
      communicationChannelId: 'qcc_email',
      communicationChannelName: 'Email',
      notes: null,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    };
    const revalidatedCandidate = { ...expiredCandidate, expirationDate: '2027-01-01' };
    const revalidatedQuote = updatedQuote({ status: 'sent', expirationDate: '2027-01-01' });
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));
    cqUpdateMock.mockResolvedValue(revalidatedQuote);
    cqFindByIdMock.mockResolvedValue(revalidatedQuote);
    qcListForQuoteMock
      .mockResolvedValueOnce([expiredCandidate])
      .mockResolvedValueOnce([expiredCandidate])
      .mockResolvedValueOnce([revalidatedCandidate]);
    qcUpdateMock.mockResolvedValue(revalidatedCandidate);

    const res = await putStatus({ expirationDate: '2027-01-01' });

    expect(res.statusCode).toBe(200);
    expect(qcUpdateMock).toHaveBeenCalledWith(
      'q-1',
      'qc-a',
      expect.objectContaining({ expirationDate: '2027-01-01' }),
      expect.anything(),
    );
    expect(JSON.parse(res.body).candidates[0].expirationDate).toBe('2027-01-01');
  });

  test('409 blocks progression to sent while a SOURCED supplier quote is expired', async () => {
    // The progression guard is line-sourced now (issue #779 follow-up). A status-only advance
    // resolves the CURRENT lines' sourced supplier quotes through the status-aware
    // findEarliestExpirationByIds (#812 round 10) — not the gate's raw-MIN
    // linkedSupplierQuoteExpiration, which would wrongly block on a terminal-frozen sourced quote.
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqFindItemSnapshotsForQuoteMock.mockResolvedValue([
      { id: 'qi-1', supplierQuoteId: 'sq-9', supplierQuoteItemId: 'sqi-9' },
    ]);
    sqFindEarliestExpirationByIdsMock.mockResolvedValue('2000-01-01');

    const res = await putStatus({ status: 'sent' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('expired');
    expect(sqFindEarliestExpirationByIdsMock).toHaveBeenCalledWith(['sq-9']);
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('200 allows a status-only advance when the helper reports no blocking expiration', async () => {
    // Terminal-frozen sourced supplier quotes are excluded inside the helper, so a null/future
    // result must let the advance through even if the raw gate value would have been past.
    cqFindCurrentMock.mockResolvedValue(
      gate({ status: 'draft', linkedSupplierQuoteExpiration: '2000-01-01' }),
    );
    cqFindItemSnapshotsForQuoteMock.mockResolvedValue([
      { id: 'qi-1', supplierQuoteId: 'sq-9', supplierQuoteItemId: 'sqi-9' },
    ]);
    sqFindEarliestExpirationByIdsMock.mockResolvedValue(null);
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'sent' }));

    const res = await putStatus({ status: 'sent' });
    expect(res.statusCode).toBe(200);
    expect(sqFindEarliestExpirationByIdsMock).toHaveBeenCalledWith(['sq-9']);
  });

  test('409 blocks progression when the REWRITTEN lines source an expired supplier quote', async () => {
    // When items change, the guard checks the new lines' sourced supplier quotes — the earliest of
    // their expirations comes from findEarliestExpirationByIds (issue #779 follow-up). Product-less
    // line + product-less snapshot so the resolver succeeds without a product lookup.
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqFindItemSnapshotsForQuoteMock.mockResolvedValue([]);
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(
      new Map([
        [
          'sqi-9',
          {
            supplierQuoteId: 'sq-9',
            supplierName: 'Acme',
            productId: null,
            unitPrice: 50,
            netCost: 50,
          },
        ],
      ]),
    );
    sqFindEarliestExpirationByIdsMock.mockResolvedValue('2000-01-01');

    const res = await putStatus({
      status: 'sent',
      items: [
        {
          id: 'qi-1',
          productId: null,
          productName: 'Service',
          supplierQuoteItemId: 'sqi-9',
          quantity: 1,
          unitPrice: 100,
          productCost: 50,
          supplierQuoteUnitPrice: 50,
          discount: 0,
          unitType: 'hours',
          durationMonths: 1,
          durationUnit: 'months',
        },
      ],
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('expired');
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('200 still allows denial while a sourced supplier quote is expired', async () => {
    // The guard only blocks sent/offer/accepted — denying a quote is always allowed.
    cqFindCurrentMock.mockResolvedValue(
      gate({ status: 'sent', linkedSupplierQuoteExpiration: '2000-01-01' }),
    );
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'denied' }));

    const res = await putStatus({ status: 'denied' });
    expect(res.statusCode).toBe(200);
  });

  test('409 expired quote rejects content edits (only the expiration date is editable)', async () => {
    // The expired-frozen rule must cover CONTENT, not just status: a PUT touching notes/items/etc.
    // (no status field) on an effectively-expired quote is rejected (issue #779).
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));

    const res = await putStatus({ notes: 'edited while expired' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Expired');
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('200 tolerates a no-op resend (no status change, no items) with a stale sourced expiration', async () => {
    // A plain re-save (e.g. notes only is blocked elsewhere, but a same-status resend with no
    // items) must NOT trip the guard even when the current sourced supplier quote is expired —
    // the guard fires only on a status advance or a line re-sourcing (issue #779 follow-up).
    cqFindCurrentMock.mockResolvedValue(
      gate({ status: 'sent', linkedSupplierQuoteExpiration: '2000-01-01' }),
    );
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'sent' }));

    const res = await putStatus({ status: 'sent' });
    expect(res.statusCode).toBe(200);
  });

  test('400 prevents a direct accepted status even when it matches a legacy stored value', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'accepted' }));

    const res = await putStatus({ status: 'accepted' });

    expect(res.statusCode).toBe(400);
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });
  test('normalizes a legacy status value on write so the tightened CHECK is never hit', async () => {
    // The request schema does not constrain status; a legacy 'quoted' must be folded to 'draft'
    // before the write (issue #779) rather than reaching the DB CHECK as-is.
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'draft' }));

    const res = await putStatus({ status: 'quoted' });
    expect(res.statusCode).toBe(200);
    expect(cqUpdateMock).toHaveBeenCalled();
    expect(cqUpdateMock.mock.calls[0][1].status).toBe('draft');
  });

  test('400 rejects an unknown status value instead of silently flooring it to draft', async () => {
    // The derived-only `expired` (or any typo) must never round-trip into a write: the old floor
    // would have demoted a sent quote to draft with a 200 (#779 second-pass review).
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent' }));

    const res = await putStatus({ status: 'expired' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('status must be one of');
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('a stale request-side isExpired field is ignored and the response value is computed', async () => {
    // The pre-#779 optimistic-restore override is gone: a body carrying only `isExpired` is a
    // no-op update (not a content edit) and the response reports the derived value.
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'sent', expirationDate: '2000-01-01' }));

    const res = await putStatus({ isExpired: false });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.isExpired).toBe(true);
    expect(body.effectiveStatus).toBe('expired');
  });
});

describe('DELETE /api/sales/client-quotes/:id', () => {
  const deleteQuote = (id: string) =>
    testApp.inject({
      method: 'DELETE',
      url: `/api/sales/client-quotes/${id}`,
      headers: authHeader(),
    });

  test('204 deletes a deletable quote via the slash-form URL the frontend sends', async () => {
    // Also pins the route REGISTRATION: a ':id' path (missing leading slash) would concatenate
    // under the plugin prefix to /api/sales/client-quotes:id and 404 this exact request shape,
    // which is what services/api/clientQuotes.ts sends.
    cqFindStatusAndClientNameMock.mockResolvedValue({ status: 'draft', clientName: 'Client' });
    cqDeleteByIdMock.mockResolvedValue(undefined);

    const res = await deleteQuote('q-1');
    expect(res.statusCode).toBe(204);
    expect(cqDeleteByIdMock).toHaveBeenCalledWith('q-1');
  });

  test('409 when an offer was created from the quote', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue('of-1');

    const res = await deleteQuote('q-1');
    expect(res.statusCode).toBe(409);
    expect(cqDeleteByIdMock).not.toHaveBeenCalled();
  });

  test('409 when the quote is accepted', async () => {
    cqFindStatusAndClientNameMock.mockResolvedValue({ status: 'accepted', clientName: 'Client' });

    const res = await deleteQuote('q-1');
    expect(res.statusCode).toBe(409);
    expect(cqDeleteByIdMock).not.toHaveBeenCalled();
  });

  test('404 when the quote does not exist', async () => {
    cqFindStatusAndClientNameMock.mockResolvedValue(null);

    const res = await deleteQuote('missing');
    expect(res.statusCode).toBe(404);
    expect(cqDeleteByIdMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/sales/client-quotes/:id promotion lifecycle', () => {
  const candidate = (over: Record<string, unknown> = {}) => ({
    id: 'qc-a',
    quoteId: 'q-1',
    name: 'Variante A',
    position: 0,
    state: 'active' as const,
    paymentTerms: '30gg',
    discount: 5,
    discountType: 'percentage' as const,
    expirationDate: '2999-12-31',
    communicationChannelId: 'qcc_email',
    communicationChannelName: 'Email',
    notes: 'winner',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over,
  });
  const item = () => ({
    id: 'qi-a',
    quoteId: 'q-1',
    candidateId: 'qc-a',
    productId: 'p1',
    productName: 'Service',
    quantity: 2,
    unitPrice: 100,
    productCost: 50,
    productMolPercentage: 50,
    supplierQuoteId: null,
    supplierQuoteItemId: null,
    supplierQuoteSupplierName: null,
    supplierQuoteUnitPrice: null,
    discount: 10,
    note: 'line note',
    unitType: 'hours' as const,
    durationMonths: 12,
    durationUnit: 'months' as const,
  });

  test('requires permission to create the generated offer', async () => {
    getRolePermissionsMock.mockResolvedValue(['sales.client_quotes.update']);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/promote',
      headers: authHeader(),
      payload: { candidateId: 'qc-a' },
    });

    expect(res.statusCode).toBe(403);
    expect(qcFindByIdMock).not.toHaveBeenCalled();
    expect(coCreateMock).not.toHaveBeenCalled();
  });

  test('promotes exactly the selected active candidate and archives its siblings atomically', async () => {
    const winningCandidate = candidate();
    const winningItem = { ...item(), productMolPercentage: 5 };
    cqFindByIdMock
      .mockResolvedValueOnce(updatedQuote({ status: 'sent' }))
      .mockResolvedValueOnce(updatedQuote({ status: 'offer', linkedOfferId: 'OFF-2999-0001' }));
    qcFindByIdMock.mockResolvedValue(winningCandidate);
    qcLockByIdMock.mockResolvedValue(winningCandidate);
    qcListForQuoteMock.mockResolvedValue([winningCandidate]);
    cqFindItemsForCandidateMock.mockResolvedValue([winningItem]);
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent' }));
    cqLockCurrentByIdMock.mockResolvedValue(gate({ status: 'sent' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'offer' }));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/promote',
      headers: authHeader(),
      payload: { candidateId: 'qc-a' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).offer.effectiveStatus).toBe('draft');
    expect(coCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        linkedQuoteId: 'q-1',
        linkedQuoteCandidateId: 'qc-a',
        paymentTerms: '30gg',
        discount: 5,
        notes: 'winner',
      }),
      expect.anything(),
    );
    expect(coInsertItemsMock.mock.calls[0][1][0]).toMatchObject({
      productName: 'Service',
      quantity: 2,
      unitPrice: 100,
      productMolPercentage: 50,
      durationMonths: 12,
    });
    expect(qcMarkPromotedMock).toHaveBeenCalledWith('q-1', 'qc-a', expect.anything());
    expect(cqUpdateMock).toHaveBeenCalledWith(
      'q-1',
      expect.objectContaining({ status: 'offer', discount: 5 }),
      expect.anything(),
    );
    expect(allocateDocumentCodeMock).toHaveBeenCalledWith('client_offer', {
      exec: expect.anything(),
      sourceCode: 'q-1',
    });
  });

  test('finishes locking the quote before it locks the selected candidate', async () => {
    const winningCandidate = candidate();
    const lockOrder: string[] = [];
    cqFindByIdMock
      .mockResolvedValueOnce(updatedQuote({ status: 'sent' }))
      .mockResolvedValueOnce(updatedQuote({ status: 'offer', linkedOfferId: 'OFF-2999-0001' }));
    qcFindByIdMock.mockResolvedValue(winningCandidate);
    cqLockCurrentByIdMock.mockImplementation(async () => {
      lockOrder.push('quote:start');
      await Promise.resolve();
      lockOrder.push('quote:end');
      return gate({ status: 'sent' });
    });
    qcLockByIdMock.mockImplementation(async () => {
      lockOrder.push('candidate');
      return winningCandidate;
    });
    qcListForQuoteMock.mockResolvedValue([winningCandidate]);
    cqFindItemsForCandidateMock.mockResolvedValue([item()]);
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'offer' }));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/promote',
      headers: authHeader(),
      payload: { candidateId: 'qc-a' },
    });

    expect(res.statusCode).toBe(200);
    expect(lockOrder).toEqual(['quote:start', 'quote:end', 'candidate']);
  });

  test('rejects an expired candidate before opening the transaction', async () => {
    cqFindByIdMock.mockResolvedValue(updatedQuote({ status: 'sent' }));
    qcFindByIdMock.mockResolvedValue(candidate({ expirationDate: '2000-01-01' }));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/promote',
      headers: authHeader(),
      payload: { candidateId: 'qc-a' },
    });

    expect(res.statusCode).toBe(409);
    expect(coCreateMock).not.toHaveBeenCalled();
  });

  test('rechecks candidate state under lock to serialize concurrent promotions', async () => {
    const winningCandidate = candidate();
    cqFindByIdMock.mockResolvedValue(updatedQuote({ status: 'sent' }));
    qcFindByIdMock.mockResolvedValue(winningCandidate);
    qcLockByIdMock.mockResolvedValue(candidate({ state: 'discarded' }));
    cqFindItemsForCandidateMock.mockResolvedValue([item()]);
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent' }));
    cqLockCurrentByIdMock.mockResolvedValue(gate({ status: 'sent' }));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/promote',
      headers: authHeader(),
      payload: { candidateId: 'qc-a' },
    });

    expect(res.statusCode).toBe(409);
    expect(coCreateMock).not.toHaveBeenCalled();
  });

  test('rechecks candidate expiry under lock before creating the offer', async () => {
    cqFindByIdMock.mockResolvedValue(updatedQuote({ status: 'sent' }));
    qcFindByIdMock.mockResolvedValue(candidate());
    qcLockByIdMock.mockResolvedValue(candidate({ expirationDate: '2000-01-01' }));
    cqFindItemsForCandidateMock.mockResolvedValue([item()]);
    cqLockCurrentByIdMock.mockResolvedValue(gate({ status: 'sent' }));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/promote',
      headers: authHeader(),
      payload: { candidateId: 'qc-a' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('candidate has expired');
    expect(coCreateMock).not.toHaveBeenCalled();
  });

  test('rechecks supplier expiry inside the promotion transaction', async () => {
    const sourcedItem = { ...item(), supplierQuoteId: 'sq-expired' };
    cqFindByIdMock.mockResolvedValue(updatedQuote({ status: 'sent' }));
    qcFindByIdMock.mockResolvedValue(candidate());
    qcLockByIdMock.mockResolvedValue(candidate());
    cqFindItemsForCandidateMock.mockResolvedValue([sourcedItem]);
    cqLockCurrentByIdMock.mockResolvedValue(gate({ status: 'sent' }));
    sqFindEarliestExpirationByIdsMock
      .mockResolvedValueOnce('2999-12-31')
      .mockResolvedValueOnce('2000-01-01');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/promote',
      headers: authHeader(),
      payload: { candidateId: 'qc-a' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('supplier quote sourced');
    expect(coCreateMock).not.toHaveBeenCalled();
  });

  test('copies the candidate and quote values reread after acquiring locks', async () => {
    const lockedCandidate = candidate({ paymentTerms: '60gg', discount: 8, notes: 'latest' });
    cqFindByIdMock
      .mockResolvedValueOnce(updatedQuote({ status: 'sent', clientName: 'Old client' }))
      .mockResolvedValueOnce(updatedQuote({ status: 'sent', clientName: 'Latest client' }))
      .mockResolvedValue(updatedQuote({ status: 'offer', clientName: 'Latest client' }));
    qcFindByIdMock.mockResolvedValue(candidate());
    qcLockByIdMock.mockResolvedValue(lockedCandidate);
    qcListForQuoteMock.mockResolvedValue([lockedCandidate]);
    cqFindItemsForCandidateMock.mockResolvedValue([item()]);
    cqFindItemsForQuoteMock.mockResolvedValue([item()]);
    cqLockCurrentByIdMock.mockResolvedValue(gate({ status: 'sent' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'offer' }));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/promote',
      headers: authHeader(),
      payload: { candidateId: 'qc-a' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).offer.effectiveStatus).toBe('draft');
    expect(coCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientName: 'Latest client',
        paymentTerms: '60gg',
        discount: 8,
        notes: 'latest',
      }),
      expect.anything(),
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'client_quote.candidate_promoted',
        details: expect.objectContaining({ secondaryLabel: lockedCandidate.name }),
      }),
    );
  });

  test('rolls a draft offer back to a fully active draft family', async () => {
    const selectedCandidate = candidate({ state: 'selected' });
    cqFindLinkedOfferIdMock.mockResolvedValue('OFF-2999-0001');
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'offer' }));
    cqLockCurrentByIdMock.mockResolvedValue(gate({ status: 'offer' }));
    qcListForQuoteMock.mockResolvedValue([selectedCandidate]);
    cqFindByIdMock.mockResolvedValue(updatedQuote({ status: 'draft', linkedOfferId: null }));
    cqFindItemsForCandidateMock.mockResolvedValue([item()]);
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'draft' }));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/promotion/rollback',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(coDeleteByIdMock).toHaveBeenCalledWith('OFF-2999-0001', expect.anything());
    expect(qcReactivateAllMock).toHaveBeenCalledWith('q-1', expect.anything());
    expect(cqUpdateMock).toHaveBeenCalledWith(
      'q-1',
      expect.objectContaining({ status: 'draft', paymentTerms: '30gg' }),
      expect.anything(),
    );
  });

  test('requires permission to delete the rolled-back offer', async () => {
    getRolePermissionsMock.mockResolvedValue(['sales.client_quotes.update']);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/promotion/rollback',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(403);
    expect(cqFindLinkedOfferIdMock).not.toHaveBeenCalled();
    expect(coDeleteByIdMock).not.toHaveBeenCalled();
  });

  test('blocks dedicated rollback when the linked offer is no longer draft', async () => {
    const selectedCandidate = candidate({ state: 'selected' });
    cqFindLinkedOfferIdMock.mockResolvedValue('OFF-2999-0001');
    cqLockCurrentByIdMock.mockResolvedValue(gate({ status: 'offer' }));
    coLockExistingByIdMock.mockResolvedValue({
      id: 'OFF-2999-0001',
      linkedQuoteId: 'q-1',
      linkedQuoteCandidateId: 'qc-a',
      clientId: 'c1',
      clientName: 'Client',
      status: 'sent',
      deliveryDate: null,
      expirationDate: '2999-12-31',
    });
    qcListForQuoteMock.mockResolvedValue([selectedCandidate]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/promotion/rollback',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('no longer a candidate draft');
    expect(coDeleteByIdMock).not.toHaveBeenCalled();
    expect(qcReactivateAllMock).not.toHaveBeenCalled();
  });

  test('blocks rollback when the draft offer already has an order', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue('OFF-2999-0001');
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'offer' }));
    cqLockCurrentByIdMock.mockResolvedValue(gate({ status: 'offer' }));
    qcListForQuoteMock.mockResolvedValue([candidate({ state: 'selected' })]);
    coFindLinkedSaleIdMock.mockResolvedValue('order-1');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes/q-1/promotion/rollback',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(coDeleteByIdMock).not.toHaveBeenCalled();
    expect(qcReactivateAllMock).not.toHaveBeenCalled();
  });
});
describe('PUT /api/sales/client-quotes/:id supplier-item forward sync (#779)', () => {
  // findItemSnapshotsForQuote shape: the stored snapshot of the line being edited. quantity 2 /
  // cost 50 matches SUPPLIER_ITEM — the baseline state is in sync.
  const EXISTING_SNAP = {
    id: 'qi-1',
    productId: 'p-1',
    quantity: 2,
    productCost: 50,
    productMolPercentage: null,
    supplierQuoteId: 'sq-9',
    supplierQuoteItemId: 'sqi-9',
    supplierQuoteSupplierName: 'Acme',
    supplierQuoteUnitPrice: 50,
    unitType: 'hours',
    pricingSemanticsVersion: 2,
  };
  const SUPPLIER_ITEM = {
    id: 'sqi-9',
    quoteId: 'sq-9',
    productId: 'p-1',
    productName: 'Service',
    quantity: 2,
    listPrice: 62.5,
    discountPercent: 20,
    unitPrice: 50,
    note: null,
    unitType: 'hours',
    durationMonths: 1,
    durationUnit: 'months',
    pricingSemanticsVersion: 2,
  };
  const lineItem = (quantity: number, cost: number, over: Record<string, unknown> = {}) => ({
    id: 'qi-1',
    productId: 'p-1',
    productName: 'Service',
    supplierQuoteItemId: 'sqi-9',
    quantity,
    unitPrice: 100,
    productCost: 50,
    productMolPercentage: null,
    supplierQuoteUnitPrice: cost,
    discount: 0,
    unitType: 'hours',
    durationMonths: 1,
    durationUnit: 'months',
    ...over,
  });
  const linePayload = (quantity: number, cost: number) => ({ items: [lineItem(quantity, cost)] });

  const setupDraftQuote = () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqFindLinkedOfferIdMock.mockResolvedValue(null);
    cqFindByIdMock.mockResolvedValue(null);
    cqLockCurrentByIdMock.mockResolvedValue(null);
    cqFindItemsForCandidateMock.mockResolvedValue([]);
    cqFindItemSnapshotsForQuoteMock.mockResolvedValue([EXISTING_SNAP]);
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'draft' }));
    sqFindItemsByIdsMock.mockResolvedValue([SUPPLIER_ITEM]);
    sqFindFullForSnapshotMock.mockResolvedValue({
      quote: { id: 'sq-9' },
      items: [SUPPLIER_ITEM],
    });
  };

  test('pushes a genuine quantity/cost edit onto the supplier item, with a pre-state snapshot and post-commit audit', async () => {
    setupDraftQuote();

    const res = await putStatus(linePayload(5, 80));
    expect(res.statusCode).toBe(200);
    expect(sqSyncItemPricingMock).toHaveBeenCalledTimes(1);
    expect(sqSyncItemPricingMock.mock.calls[0][0]).toBe('sq-9');
    // The discount-to-us is preserved; the repo recomputes the list price from it.
    expect(sqSyncItemPricingMock.mock.calls[0][1]).toEqual([
      { itemId: 'sqi-9', quantity: 5, unitCost: 80, discountPercent: 20 },
    ]);
    expect(sqvInsertMock).toHaveBeenCalledTimes(1);
    // The write serializes on the supplier quote row (FOR UPDATE) before deciding.
    expect(sqLockEffectiveStatusMock).toHaveBeenCalledWith('sq-9', expect.anything());
    const auditActions = (logAuditMock.mock.calls as unknown as Array<[{ action?: string }]>).map(
      (c) => c[0]?.action,
    );
    expect(auditActions).toContain('supplier_quote.updated');
  });

  test('409s instead of writing when the supplier quote already has a linked order', async () => {
    setupDraftQuote();
    sqFindLinkedOrderIdMock.mockResolvedValue('sso-1');

    const res = await putStatus(linePayload(5, 80));
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('pricing is final');
    expect(sqSyncItemPricingMock).not.toHaveBeenCalled();
    expect(sqvInsertMock).not.toHaveBeenCalled();
  });

  test('409s when the supplier quote derives a frozen status (accepted via another chain)', async () => {
    setupDraftQuote();
    sqLockEffectiveStatusMock.mockResolvedValue({
      expirationDate: '2999-12-31',
      linkedClientStatus: 'accepted',
      linkedClientQuoteExpiration: '2999-12-31',
      linkedOfferStatus: null,
      linkedOfferExpiration: null,
    });

    const res = await putStatus(linePayload(5, 80));
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('read-only');
    expect(sqSyncItemPricingMock).not.toHaveBeenCalled();
  });

  test('403s without the supplier-quote update permission when a push is needed', async () => {
    setupDraftQuote();
    getRolePermissionsMock.mockResolvedValue(['sales.client_quotes.update']);

    const res = await putStatus(linePayload(5, 80));
    expect(res.statusCode).toBe(403);
    expect(sqSyncItemPricingMock).not.toHaveBeenCalled();
    // But a save WITHOUT a sourced-line edit must not require the permission.
    const noEdit = await putStatus(linePayload(2, 50));
    expect(noEdit.statusCode).toBe(200);
  });

  test('no-ops when the line already matches the supplier item', async () => {
    setupDraftQuote();

    const res = await putStatus(linePayload(2, 50));
    expect(res.statusCode).toBe(200);
    expect(sqSyncItemPricingMock).not.toHaveBeenCalled();
    const replaced = cqReplaceItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(replaced[0].unitPrice).toBe(100);
    expect(replaced[0].productMolPercentage).toBe(50);
  });

  test('ignores a stale submitted MOL without reloading unchanged line snapshots', async () => {
    setupDraftQuote();

    const res = await putStatus({
      items: [lineItem(2, 50, { productMolPercentage: 20 })],
    });

    expect(res.statusCode).toBe(200);
    // The resolver may still invoke the repository's empty-input fast path, but it must not load
    // the unchanged supplier item merely because the submitted derived MOL is stale.
    expect(sqGetQuoteItemSnapshotsMock).not.toHaveBeenCalledWith(['sqi-9']);
    const replaced = cqReplaceItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(replaced[0].productMolPercentage).toBe(50);
  });

  test('does not convert product cost before deriving a current day-line MOL', async () => {
    setupDraftQuote();
    cqFindItemSnapshotsForQuoteMock.mockResolvedValue([
      {
        id: 'qi-day',
        productId: 'p-1',
        quantity: 1,
        productCost: 10,
        productMolPercentage: 0,
        supplierQuoteId: null,
        supplierQuoteItemId: null,
        supplierQuoteSupplierName: null,
        supplierQuoteUnitPrice: null,
        unitType: 'days',
        pricingSemanticsVersion: 2,
      },
    ]);

    const res = await putStatus({
      items: [
        {
          id: 'qi-day',
          productId: 'p-1',
          productName: 'Consulting day',
          supplierQuoteItemId: null,
          quantity: 1,
          unitPrice: 10,
          productCost: 10,
          productMolPercentage: 0,
          supplierQuoteUnitPrice: null,
          discount: 0,
          unitType: 'days',
          durationMonths: 1,
          durationUnit: 'months',
        },
      ],
    });

    expect(res.statusCode).toBe(200);
    const replaced = cqReplaceItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(replaced[0].unitPrice).toBe(10);
    expect(replaced[0].productMolPercentage).toBe(0);
  });

  test('makes a new day line inherit the historical document pricing contract', async () => {
    setupDraftQuote();
    cqFindItemSnapshotsForQuoteMock.mockResolvedValue([
      {
        id: 'qi-legacy',
        productId: 'p-1',
        productCost: 10,
        productMolPercentage: null,
        supplierQuoteId: null,
        supplierQuoteItemId: null,
        supplierQuoteSupplierName: null,
        supplierQuoteUnitPrice: null,
        unitType: 'days',
        pricingSemanticsVersion: 1,
      },
    ]);
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(
      new Map([
        [
          'sqi-9',
          {
            supplierQuoteId: 'sq-9',
            supplierName: 'Acme',
            productId: null,
            netCost: 10,
            sourceable: true,
          },
        ],
      ]),
    );

    const res = await putStatus({
      items: [
        {
          id: 'qi-new',
          productId: null,
          productName: 'Consulting day',
          supplierQuoteItemId: 'sqi-9',
          quantity: 1,
          unitPrice: 100,
          productCost: 10,
          productMolPercentage: 0,
          supplierQuoteUnitPrice: 10,
          discount: 0,
          unitType: 'days',
          durationMonths: 1,
          durationUnit: 'months',
        },
      ],
    });

    expect(res.statusCode).toBe(200);
    const replaced = cqReplaceItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(replaced[0].pricingSemanticsVersion).toBe(1);
    expect(replaced[0].productMolPercentage).toBe(90);
  });

  test('derives MOL from an edited sale price on a retained supplier-sourced line', async () => {
    setupDraftQuote();
    cqFindItemSnapshotsForQuoteMock.mockResolvedValue([
      { ...EXISTING_SNAP, productId: null, productMolPercentage: 20 },
    ]);
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(
      new Map([
        [
          'sqi-9',
          {
            supplierQuoteId: 'sq-9',
            supplierName: 'Acme',
            productId: null,
            unitPrice: 50,
            netCost: 50,
            sourceable: true,
          },
        ],
      ]),
    );

    const res = await putStatus({
      items: [lineItem(2, 50, { productId: null, unitPrice: 80, productMolPercentage: 35 })],
    });

    expect(res.statusCode).toBe(200);
    const replaced = cqReplaceItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(replaced[0].productMolPercentage).toBe(37.5);
    expect(replaced[0].unitPrice).toBe(80);
  });

  test('re-saving a STALE snapshot does not revert direct supplier-side edits', async () => {
    // The line still stores cost 40 from before the supplier raised the item to 50; a
    // notes-only style re-save resends the stored values unchanged — NOT a client edit.
    setupDraftQuote();
    cqFindItemSnapshotsForQuoteMock.mockResolvedValue([
      { ...EXISTING_SNAP, supplierQuoteUnitPrice: 40 },
    ]);

    const res = await putStatus(linePayload(2, 40));
    expect(res.statusCode).toBe(200);
    expect(sqSyncItemPricingMock).not.toHaveBeenCalled();
    expect(sqvInsertMock).not.toHaveBeenCalled();
  });

  test('a FRESH link never pushes and stores the server-resolved supplier cost', async () => {
    setupDraftQuote();
    // No previous line carries this link — the client-sent cost 80 could be a stale cache.
    // Product-less on both sides so the resolver skips the (unmocked) products repo.
    cqFindItemSnapshotsForQuoteMock.mockResolvedValue([]);
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(
      new Map([
        [
          'sqi-9',
          {
            supplierQuoteId: 'sq-9',
            supplierName: 'Acme',
            productId: null,
            unitPrice: 50,
            netCost: 50,
          },
        ],
      ]),
    );
    cqReplaceItemsMock.mockResolvedValue([]);

    const res = await putStatus({ items: [lineItem(5, 80, { productId: null })] });
    expect(res.statusCode).toBe(200);
    expect(sqSyncItemPricingMock).not.toHaveBeenCalled();
    // The stored line takes the live supplier value, not the client's copy.
    const inserted = cqReplaceItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(inserted[0].supplierQuoteUnitPrice).toBe(50);
  });

  test('409s when two lines push conflicting edits to the same supplier item', async () => {
    setupDraftQuote();
    cqFindItemSnapshotsForQuoteMock.mockResolvedValue([
      EXISTING_SNAP,
      { ...EXISTING_SNAP, id: 'qi-2' },
    ]);

    const res = await putStatus({
      items: [lineItem(5, 80), lineItem(7, 80, { id: 'qi-2' })],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('different quantities or costs');
    expect(sqSyncItemPricingMock).not.toHaveBeenCalled();
  });

  test('a re-save of duplicate sourced lines with differing stored values pushes nothing (#812 round 21)', async () => {
    // Two lines source the same supplier item with different quantities. Re-sending both
    // unchanged must NOT look like a genuine edit: diffing each line against only the FIRST
    // previous row made the second line a phantom edit that pushed its quantity onto the
    // supplier item (or tripped the permission/read-only guards) on a notes-only save.
    setupDraftQuote();
    cqFindItemSnapshotsForQuoteMock.mockResolvedValue([
      EXISTING_SNAP,
      { ...EXISTING_SNAP, id: 'qi-2', quantity: 5 },
    ]);

    const res = await putStatus({
      items: [lineItem(2, 50), lineItem(5, 50, { id: 'qi-2' })],
    });
    expect(res.statusCode).toBe(200);
    const replacedItems = cqReplaceItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(replacedItems.map((item) => item.position)).toEqual([0, 1]);
    expect(sqSyncItemPricingMock).not.toHaveBeenCalled();
  });
});

describe('client quote candidate-family create and update', () => {
  // Live supplier item the fresh pick references: quantity 2, cost 50, discount-to-us 20%.
  const SUPPLIER_ITEM = {
    id: 'sqi-9',
    quoteId: 'sq-9',
    productId: null,
    productName: 'Service',
    quantity: 2,
    listPrice: 62.5,
    discountPercent: 20,
    unitPrice: 50,
    note: null,
    unitType: 'hours',
    durationMonths: 1,
    durationUnit: 'months',
  };
  // Product-less on both sides so the resolver skips the (unmocked) products repo.
  const freshLine = (over: Record<string, unknown> = {}) => ({
    productId: null,
    productName: 'Service',
    supplierQuoteItemId: 'sqi-9',
    quantity: 2,
    unitPrice: 100,
    productCost: 50,
    productMolPercentage: null,
    supplierQuoteUnitPrice: 50,
    discount: 0,
    unitType: 'hours',
    durationMonths: 1,
    durationUnit: 'months',
    ...over,
  });
  const activeCandidate = (over: Record<string, unknown> = {}) => ({
    id: 'qc-local',
    quoteId: 'q-1',
    name: 'Variante A',
    position: 0,
    state: 'active' as const,
    paymentTerms: 'immediate',
    discount: 0,
    discountType: 'percentage' as const,
    expirationDate: '2999-12-31',
    communicationChannelId: 'qcc_email',
    communicationChannelName: 'Email',
    notes: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over,
  });
  const installCandidateNameConstraint = (candidates: ReturnType<typeof activeCandidate>[]) => {
    const names = new Map(candidates.map((candidate) => [candidate.id, candidate.name]));
    qcDeleteMissingActiveMock.mockImplementation(
      async (_quoteId: string, retainedIds: string[]) => {
        const retained = new Set(retainedIds);
        for (const candidateId of names.keys()) {
          if (!retained.has(candidateId)) names.delete(candidateId);
        }
      },
    );
    qcUpdateMock.mockImplementation(
      async (_quoteId: string, candidateId: string, input: Record<string, unknown>) => {
        const nextName = String(input.name);
        const collision = Array.from(names).some(
          ([otherId, name]) =>
            otherId !== candidateId && name.toLocaleLowerCase() === nextName.toLocaleLowerCase(),
        );
        if (collision) {
          throw { code: '23505', constraint: 'idx_quote_candidates_quote_name_unique' };
        }
        names.set(candidateId, nextName);
        return { ...candidates.find((candidate) => candidate.id === candidateId), ...input };
      },
    );
    return names;
  };
  const postQuote = (items: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) =>
    testApp.inject({
      method: 'POST',
      url: '/api/sales/client-quotes',
      headers: authHeader(),
      payload: {
        id: 'q-new',
        clientId: 'c1',
        clientName: 'Client',
        items,
        candidates: [
          {
            name: 'Variante A',
            items,
            expirationDate: '2999-12-31',
            communicationChannelId: 'qcc_email',
          },
        ],
        expirationDate: '2999-12-31',
        communicationChannelId: 'qcc_email',
        ...over,
      },
    });
  const putCandidateFamily = (discount: number, itemOverrides: Record<string, unknown> = {}) =>
    testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Client',
        status: 'draft',
        candidates: [
          {
            id: 'qc-local',
            name: 'Variante A',
            items: [freshLine({ id: 'qi-local', ...itemOverrides })],
            paymentTerms: 'immediate',
            discount,
            discountType: 'percentage',
            expirationDate: '2999-12-31',
            communicationChannelId: 'qcc_email',
            notes: 'edited',
          },
        ],
      },
    });

  const setupCreate = (netCost = 50) => {
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(
      new Map([
        [
          'sqi-9',
          {
            supplierQuoteId: 'sq-9',
            supplierName: 'Acme',
            productId: null,
            unitPrice: netCost,
            netCost,
            sourceable: true,
          },
        ],
      ]),
    );
    const createdQuote = updatedQuote({ id: 'q-new', status: 'draft' });
    cqCreateMock.mockResolvedValue(createdQuote);
    cqFindByIdMock.mockResolvedValue(createdQuote);
    qcListForQuoteMock.mockResolvedValue([
      {
        id: 'q-new',
        quoteId: 'q-new',
        name: 'Variante A',
        position: 0,
        state: 'active',
        paymentTerms: 'immediate',
        discount: 0,
        discountType: 'percentage',
        expirationDate: '2999-12-31',
        communicationChannelId: 'qcc_email',
        communicationChannelName: 'Email',
        notes: null,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      },
    ]);
    cqFindItemsForQuoteMock.mockResolvedValue([]);
    cqInsertItemsMock.mockResolvedValue([]);
    sqFindItemsByIdsMock.mockResolvedValue([SUPPLIER_ITEM]);
    sqFindFullForSnapshotMock.mockResolvedValue({
      quote: { id: 'sq-9' },
      items: [SUPPLIER_ITEM],
    });
  };

  const setupLegacyCandidateUpdate = () => {
    setupCreate();
    const legacyCandidate = activeCandidate({ discount: 150 });
    const current = gate({ status: 'draft', discount: 150, discountType: 'percentage' as const });
    const updated = updatedQuote({ id: 'q-1', discount: 150, notes: 'edited' });
    const existingItem = {
      id: 'qi-local',
      quoteId: 'q-1',
      candidateId: 'qc-local',
      productId: '',
      productName: 'Service',
      quantity: 2,
      unitPrice: 100,
      productCost: 50,
      productMolPercentage: 50,
      supplierQuoteId: 'sq-9',
      supplierQuoteItemId: 'sqi-9',
      supplierQuoteSupplierName: 'Acme',
      supplierQuoteUnitPrice: 50,
      discount: 0,
      note: null,
      unitType: 'hours' as const,
      durationMonths: 1,
      durationUnit: 'months' as const,
    };
    cqFindCurrentMock.mockResolvedValue(current);
    cqLockCurrentByIdMock.mockResolvedValue(current);
    cqUpdateMock.mockResolvedValue(updated);
    cqFindByIdMock.mockResolvedValue(updated);
    cqFindItemsForQuoteMock.mockResolvedValue([existingItem]);
    cqFindItemSnapshotsForQuoteMock.mockResolvedValue([
      {
        id: existingItem.id,
        candidateId: existingItem.candidateId,
        productId: existingItem.productId,
        quantity: existingItem.quantity,
        productCost: existingItem.productCost,
        productMolPercentage: existingItem.productMolPercentage,
        supplierQuoteId: existingItem.supplierQuoteId,
        supplierQuoteItemId: existingItem.supplierQuoteItemId,
        supplierQuoteSupplierName: existingItem.supplierQuoteSupplierName,
        supplierQuoteUnitPrice: existingItem.supplierQuoteUnitPrice,
        unitType: existingItem.unitType,
      },
    ]);
    qcListForQuoteMock.mockResolvedValue([legacyCandidate]);
    qcUpdateMock.mockResolvedValue({ ...legacyCandidate, notes: 'edited' });
  };

  test('creates multiple nested candidates without consuming additional document codes', async () => {
    setupCreate();
    const candidates = [
      {
        name: 'Variante A',
        items: [freshLine()],
        expirationDate: '2999-12-31',
        communicationChannelId: 'qcc_email',
      },
      {
        name: 'Variante B',
        items: [freshLine({ quantity: 3 })],
        expirationDate: '2999-12-31',
        communicationChannelId: 'qcc_email',
      },
    ];

    const res = await postQuote([freshLine()], { id: '', candidates });

    expect(res.statusCode).toBe(201);
    expect(qcInsertMock).toHaveBeenCalledTimes(2);
    expect(cqInsertItemsMock).toHaveBeenCalledTimes(2);
    expect(allocateDocumentCodeMock).toHaveBeenCalledTimes(1);
    expect(allocateDocumentCodeMock).toHaveBeenCalledWith('client_quote', {
      exec: expect.anything(),
    });
  });

  test('generates a collision-safe id for the primary candidate', async () => {
    setupCreate();

    const res = await postQuote([freshLine()]);

    expect(res.statusCode).toBe(201);
    const primaryCandidate = qcInsertMock.mock.calls[0][0] as { id: string; quoteId: string };
    expect(primaryCandidate.quoteId).toBe('q-new');
    expect(primaryCandidate.id).toStartWith('qc-');
    expect(primaryCandidate.id).not.toBe(primaryCandidate.quoteId);
    expect(cqInsertItemsMock.mock.calls[0][3]).toBe(primaryCandidate.id);
  });

  test('uses the first nested candidate as the commercial source of truth', async () => {
    setupCreate();
    const res = await postQuote([freshLine()], {
      discount: 99,
      candidates: [
        {
          name: 'Variante A',
          items: [freshLine()],
          paymentTerms: '60gg',
          discount: 7,
          discountType: 'percentage',
          expirationDate: '2999-11-30',
          communicationChannelId: 'qcc_email',
          notes: 'nested values',
        },
      ],
    });

    expect(res.statusCode).toBe(201);
    expect(cqCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentTerms: '60gg',
        discount: 7,
        expirationDate: '2999-11-30',
        notes: 'nested values',
      }),
      expect.anything(),
    );
  });

  test('rejects an over-100 percentage discount on a new candidate', async () => {
    const res = await postQuote([freshLine()], {
      candidates: [
        {
          name: 'Variante A',
          items: [freshLine()],
          discount: 100.01,
          discountType: 'percentage',
          expirationDate: '2999-12-31',
          communicationChannelId: 'qcc_email',
        },
      ],
    });

    expect(res.statusCode).toBe(400);
    expect(cqCreateMock).not.toHaveBeenCalled();
  });

  test('preserves an unchanged legacy candidate discount during an unrelated family update', async () => {
    setupLegacyCandidateUpdate();

    const res = await putCandidateFamily(150);

    expect(res.statusCode).toBe(200);
    expect(qcUpdateMock).toHaveBeenCalled();
  });

  test('keeps the total guard when a legacy candidate resubmits changed zero-total items', async () => {
    setupLegacyCandidateUpdate();

    const res = await putCandidateFamily(150, { unitPrice: 0 });

    expect(res.statusCode).toBe(400);
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('rejects changing an existing legacy candidate to another over-100 percentage', async () => {
    setupLegacyCandidateUpdate();

    const res = await putCandidateFamily(151);

    expect(res.statusCode).toBe(400);
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('rejects duplicate candidate names case-insensitively', async () => {
    const duplicate = {
      items: [freshLine()],
      expirationDate: '2999-12-31',
      communicationChannelId: 'qcc_email',
    };
    const res = await postQuote([freshLine()], {
      candidates: [
        { ...duplicate, name: 'Variante A' },
        { ...duplicate, name: 'variante a' },
      ],
    });

    expect(res.statusCode).toBe(400);
    expect(cqCreateMock).not.toHaveBeenCalled();
  });

  test('rejects candidate names longer than the database column before starting a write', async () => {
    const res = await postQuote([freshLine()], {
      candidates: [
        {
          name: 'V'.repeat(101),
          items: [freshLine()],
          expirationDate: '2999-12-31',
          communicationChannelId: 'qcc_email',
        },
      ],
    });

    expect(res.statusCode).toBe(400);
    expect(cqCreateMock).not.toHaveBeenCalled();
  });

  test('rejects a supplied candidate id that belongs to another quote family', async () => {
    setupCreate();
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    qcListForQuoteMock.mockResolvedValue([
      {
        id: 'qc-local',
        quoteId: 'q-1',
        name: 'Variante A',
        position: 0,
        state: 'active',
      },
    ]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Client',
        status: 'draft',
        candidates: [
          {
            id: 'qc-foreign',
            name: 'Variante A',
            items: [freshLine()],
            expirationDate: '2999-12-31',
            communicationChannelId: 'qcc_email',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('does not belong');
    expect(qcUpdateMock).not.toHaveBeenCalled();
  });

  test('rejects adding an id-less candidate after the quote has been sent', async () => {
    setupCreate();
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent' }));
    qcListForQuoteMock.mockResolvedValue([activeCandidate()]);
    const candidateBody = {
      items: [freshLine()],
      expirationDate: '2999-12-31',
      communicationChannelId: 'qcc_email',
    };

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Client',
        status: 'sent',
        candidates: [
          { ...candidateBody, id: 'qc-local', name: 'Variante A' },
          { ...candidateBody, name: 'Variante B' },
        ],
      },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('only be added or removed while');
    expect(qcInsertMock).not.toHaveBeenCalled();
    expect(qcUpdateMock).not.toHaveBeenCalled();
  });

  test('rejects a line id that belongs to a different candidate', async () => {
    setupCreate();
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    qcListForQuoteMock.mockResolvedValue([
      activeCandidate({ id: 'qc-a', name: 'Variante A' }),
      activeCandidate({ id: 'qc-b', name: 'Variante B', position: 1 }),
    ]);
    cqFindItemSnapshotsForQuoteMock.mockResolvedValue([
      {
        id: 'qi-a',
        candidateId: 'qc-a',
        productId: null,
        quantity: 2,
        productCost: 50,
        productMolPercentage: null,
        supplierQuoteId: 'sq-9',
        supplierQuoteItemId: 'sqi-9',
        supplierQuoteSupplierName: 'Acme',
        supplierQuoteUnitPrice: 50,
        unitType: 'hours',
      },
    ]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Client',
        status: 'draft',
        candidates: [
          {
            id: 'qc-b',
            name: 'Variante B',
            items: [freshLine({ id: 'qi-a' })],
            expirationDate: '2999-12-31',
            communicationChannelId: 'qcc_email',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('does not belong to candidate');
    expect(sqGetQuoteItemSnapshotsMock).not.toHaveBeenCalled();
    expect(cqReplaceItemsMock).not.toHaveBeenCalled();
  });

  test('returns supplier eligibility and records an audit after a candidate-family save', async () => {
    setupCreate();
    const existingCandidate = activeCandidate();
    const storedItem = {
      id: 'qi-local',
      quoteId: 'q-1',
      candidateId: 'qc-local',
      productId: null,
      productName: 'Service',
      quantity: 2,
      unitPrice: 100,
      productCost: 50,
      productMolPercentage: null,
      supplierQuoteId: 'sq-9',
      supplierQuoteItemId: 'sqi-9',
      supplierQuoteSupplierName: 'Acme',
      supplierQuoteUnitPrice: 50,
      discount: 0,
      note: null,
      unitType: 'hours' as const,
      durationMonths: 1,
      durationUnit: 'months' as const,
      position: 0,
    };
    const quote = updatedQuote({ id: 'q-1', status: 'draft' });
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqLockCurrentByIdMock.mockResolvedValue(gate({ status: 'draft' }));
    cqUpdateMock.mockResolvedValue(quote);
    cqFindByIdMock.mockResolvedValue(quote);
    qcListForQuoteMock.mockResolvedValue([existingCandidate]);
    qcUpdateMock.mockResolvedValue(existingCandidate);
    cqFindItemsForQuoteMock.mockResolvedValue([storedItem]);
    sqFindBlockingExpirationsByIdsMock.mockResolvedValue(new Map([['sq-9', '2000-01-01']]));

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Client',
        status: 'draft',
        candidates: [
          {
            id: 'qc-local',
            name: 'Variante A',
            items: [freshLine()],
            expirationDate: '2999-12-31',
            communicationChannelId: 'qcc_email',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).candidates[0].linkedSupplierQuoteExpired).toBe(true);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'client_quote.updated', entityId: 'q-1' }),
    );
  });

  test('accepts null notes when sending an existing candidate family', async () => {
    setupCreate();
    const existingCandidate = activeCandidate();
    const sentQuote = updatedQuote({ id: 'q-1', status: 'sent' });
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqLockCurrentByIdMock.mockResolvedValue(gate({ status: 'draft' }));
    cqUpdateMock.mockResolvedValue(sentQuote);
    cqFindByIdMock.mockResolvedValue(sentQuote);
    qcListForQuoteMock.mockResolvedValue([existingCandidate]);
    qcUpdateMock.mockResolvedValue(existingCandidate);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Client',
        status: 'sent',
        candidates: [
          {
            id: 'qc-local',
            name: 'Variante A',
            items: [freshLine()],
            expirationDate: '2999-12-31',
            communicationChannelId: 'qcc_email',
            notes: null,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(cqUpdateMock).toHaveBeenCalledWith(
      'q-1',
      expect.objectContaining({ notes: null }),
      expect.anything(),
    );
  });

  test('blocks sending a candidate family sourced from an expired supplier quote', async () => {
    setupCreate();
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    qcListForQuoteMock.mockResolvedValue([activeCandidate()]);
    sqFindEarliestExpirationByIdsMock.mockResolvedValue('2000-01-01');

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Client',
        status: 'sent',
        candidates: [
          {
            id: 'qc-local',
            name: 'Variante A',
            items: [freshLine()],
            expirationDate: '2999-12-31',
            communicationChannelId: 'qcc_email',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('expired');
    expect(sqFindEarliestExpirationByIdsMock).toHaveBeenCalledWith(['sq-9']);
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('returns the complete family after a status-only update', async () => {
    const existingCandidate = activeCandidate();
    const deniedQuote = updatedQuote({ id: 'q-1', status: 'denied' });
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent' }));
    cqUpdateMock.mockResolvedValue(deniedQuote);
    cqFindByIdMock.mockResolvedValue(deniedQuote);
    qcListForQuoteMock.mockResolvedValue([existingCandidate]);
    cqFindItemsForQuoteMock.mockResolvedValue([
      {
        ...freshLine({ id: 'qi-local' }),
        quoteId: 'q-1',
        candidateId: 'qc-local',
        supplierQuoteId: 'sq-9',
        position: 0,
      },
    ]);

    const res = await putStatus({ status: 'denied' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      status: 'denied',
      candidates: [{ id: 'qc-local', name: 'Variante A' }],
    });
  });

  test('rejects candidate edits when every active variant is expired', async () => {
    setupCreate();
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));
    cqLockCurrentByIdMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));
    cqFindByIdMock.mockResolvedValue(
      updatedQuote({ status: 'sent', expirationDate: '2000-01-01' }),
    );
    qcListForQuoteMock.mockResolvedValue([
      activeCandidate({ expirationDate: '2000-01-01' }),
      activeCandidate({ id: 'qc-b', name: 'Variante B', expirationDate: '2000-02-01' }),
    ]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Client',
        status: 'sent',
        candidates: [
          {
            id: 'qc-local',
            name: 'Variante A',
            items: [freshLine()],
            expirationDate: '2999-12-31',
            communicationChannelId: 'qcc_email',
          },
          {
            id: 'qc-b',
            name: 'Variante B',
            items: [freshLine()],
            expirationDate: '2999-12-31',
            communicationChannelId: 'qcc_email',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Expired quotes are read-only');
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('revalidates an expired candidate family when only expiration dates are extended', async () => {
    const expiredCandidate = activeCandidate({ expirationDate: '2000-01-01' });
    const revalidatedCandidate = activeCandidate({ expirationDate: '2999-12-31' });
    const expiredParent = updatedQuote({ status: 'sent', expirationDate: '2000-01-01' });
    const revalidatedParent = updatedQuote({ status: 'sent', expirationDate: '2999-12-31' });
    const existingItem = {
      id: 'qi-local',
      quoteId: 'q-1',
      candidateId: 'qc-local',
      productId: '',
      productName: 'Service',
      quantity: 2,
      unitPrice: 50,
      productCost: 50,
      productMolPercentage: null,
      supplierQuoteId: 'sq-9',
      supplierQuoteItemId: 'sqi-9',
      supplierQuoteSupplierName: 'Acme',
      supplierQuoteUnitPrice: 50,
      discount: 0,
      note: null,
      unitType: 'hours' as const,
      durationMonths: 1,
      durationUnit: 'months' as const,
    };

    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));
    cqLockCurrentByIdMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));
    cqFindByIdMock.mockResolvedValueOnce(expiredParent).mockResolvedValue(revalidatedParent);
    cqFindItemsForQuoteMock.mockResolvedValue([existingItem]);
    cqFindItemSnapshotsForQuoteMock.mockResolvedValue([
      {
        id: 'qi-local',
        candidateId: 'qc-local',
        productId: '',
        quantity: 2,
        productCost: 50,
        productMolPercentage: null,
        supplierQuoteId: 'sq-9',
        supplierQuoteItemId: 'sqi-9',
        supplierQuoteSupplierName: 'Acme',
        supplierQuoteUnitPrice: 50,
        unitType: 'hours',
      },
    ]);
    qcListForQuoteMock
      .mockResolvedValueOnce([expiredCandidate])
      .mockResolvedValueOnce([expiredCandidate])
      .mockResolvedValueOnce([revalidatedCandidate]);
    qcUpdateMock.mockResolvedValue(revalidatedCandidate);
    cqUpdateMock.mockResolvedValue(revalidatedParent);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Client',
        status: 'sent',
        candidates: [
          {
            id: 'qc-local',
            name: 'Variante A',
            items: [freshLine({ id: 'qi-local', productId: '', unitPrice: 50 })],
            expirationDate: '2999-12-31',
            communicationChannelId: 'qcc_email',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(cqUpdateMock).toHaveBeenCalledWith(
      'q-1',
      expect.objectContaining({ expirationDate: '2999-12-31' }),
      expect.anything(),
    );
    expect(JSON.parse(res.body).effectiveStatus).toBe('sent');
  });

  test('allows candidate edits while at least one active variant is still valid', async () => {
    setupCreate();
    const expiredCandidate = activeCandidate({ expirationDate: '2000-01-01' });
    const validCandidate = activeCandidate({
      id: 'qc-b',
      name: 'Variante B',
      position: 1,
      expirationDate: '2999-12-31',
    });
    const quote = updatedQuote({ id: 'q-1', status: 'draft', expirationDate: '2000-01-01' });
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft', expirationDate: '2000-01-01' }));
    cqLockCurrentByIdMock.mockResolvedValue(
      gate({ status: 'draft', expirationDate: '2000-01-01' }),
    );
    cqUpdateMock.mockResolvedValue(quote);
    cqFindByIdMock.mockResolvedValue(quote);
    qcListForQuoteMock.mockResolvedValue([expiredCandidate, validCandidate]);
    qcUpdateMock.mockImplementation(
      async (_quoteId: string, _candidateId: string, input: Record<string, unknown>) => input,
    );

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Client',
        status: 'draft',
        candidates: [
          {
            id: 'qc-local',
            name: 'Variante A',
            items: [freshLine()],
            expirationDate: '2000-01-01',
            communicationChannelId: 'qcc_email',
          },
          {
            id: 'qc-b',
            name: 'Variante B',
            items: [freshLine()],
            expirationDate: '2999-12-31',
            communicationChannelId: 'qcc_email',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(cqUpdateMock).toHaveBeenCalled();
  });

  test('rejects a candidate save when the family expires while waiting for its lock', async () => {
    setupCreate();
    const validCandidate = activeCandidate({ expirationDate: '2999-12-31' });
    const expiredCandidate = activeCandidate({ expirationDate: '2000-01-01' });
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent' }));
    cqLockCurrentByIdMock.mockResolvedValue(gate({ status: 'sent' }));
    qcListForQuoteMock
      .mockResolvedValueOnce([validCandidate])
      .mockResolvedValueOnce([expiredCandidate]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Client',
        status: 'sent',
        candidates: [
          {
            id: 'qc-local',
            name: 'Variante A',
            items: [freshLine()],
            expirationDate: '2999-12-31',
            communicationChannelId: 'qcc_email',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Expired quotes are read-only');
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('keeps a retained candidate supplier snapshot isolated when the source is no longer pickable', async () => {
    setupCreate();
    const existingCandidate = activeCandidate();
    const quote = updatedQuote({ id: 'q-1', status: 'sent' });
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent' }));
    cqLockCurrentByIdMock.mockResolvedValue(gate({ status: 'sent' }));
    cqUpdateMock.mockResolvedValue(quote);
    cqFindByIdMock.mockResolvedValue(quote);
    qcListForQuoteMock.mockResolvedValue([existingCandidate]);
    qcUpdateMock.mockResolvedValue(existingCandidate);
    cqFindItemSnapshotsForQuoteMock.mockResolvedValue([
      {
        id: 'qi-local',
        candidateId: 'qc-local',
        productId: null,
        quantity: 2,
        productCost: 50,
        productMolPercentage: null,
        supplierQuoteId: 'sq-9',
        supplierQuoteItemId: 'sqi-9',
        supplierQuoteSupplierName: 'Acme',
        supplierQuoteUnitPrice: 50,
        unitType: 'hours',
      },
    ]);
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(
      new Map([
        [
          'sqi-9',
          {
            supplierQuoteId: 'sq-9',
            supplierName: 'Acme',
            productId: null,
            unitPrice: 80,
            netCost: 80,
            sourceable: false,
          },
        ],
      ]),
    );

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Client',
        status: 'sent',
        candidates: [
          {
            id: 'qc-local',
            name: 'Variante A',
            items: [freshLine({ id: 'qi-local' })],
            expirationDate: '2999-12-31',
            communicationChannelId: 'qcc_email',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const replaced = cqReplaceItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(replaced[0].supplierQuoteUnitPrice).toBe(50);
    expect(sqSyncItemPricingMock).not.toHaveBeenCalled();
  });

  test('keeps genuine supplier-linked edits local until a candidate is promoted', async () => {
    setupCreate();
    const existingCandidate = activeCandidate();
    const quote = updatedQuote({ id: 'q-1', status: 'sent' });
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent' }));
    cqLockCurrentByIdMock.mockResolvedValue(gate({ status: 'sent' }));
    cqUpdateMock.mockResolvedValue(quote);
    cqFindByIdMock.mockResolvedValue(quote);
    qcListForQuoteMock.mockResolvedValue([existingCandidate]);
    qcUpdateMock.mockResolvedValue(existingCandidate);
    cqFindItemSnapshotsForQuoteMock.mockResolvedValue([
      {
        id: 'qi-local',
        candidateId: 'qc-local',
        productId: null,
        quantity: 2,
        productCost: 50,
        productMolPercentage: null,
        supplierQuoteId: 'sq-9',
        supplierQuoteItemId: 'sqi-9',
        supplierQuoteSupplierName: 'Acme',
        supplierQuoteUnitPrice: 50,
        unitType: 'hours',
      },
    ]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Client',
        status: 'sent',
        candidates: [
          {
            id: 'qc-local',
            name: 'Variante A',
            items: [
              freshLine({
                id: 'qi-local',
                quantity: 3,
                productCost: 70,
                supplierQuoteUnitPrice: 70,
              }),
            ],
            expirationDate: '2999-12-31',
            communicationChannelId: 'qcc_email',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(cqReplaceItemsMock.mock.calls[0][1]).toEqual([
      expect.objectContaining({
        quantity: 3,
        unitPrice: 100,
        productMolPercentage: 30,
        supplierQuoteUnitPrice: 70,
      }),
    ]);
    expect(sqSyncItemPricingMock).not.toHaveBeenCalled();
  });

  test('renames the parent code atomically when saving a candidate family', async () => {
    setupCreate();
    const existingCandidate = activeCandidate();
    const currentQuote = updatedQuote({ id: 'q-1', status: 'draft' });
    const renamedQuote = updatedQuote({ id: 'q-renamed', status: 'draft' });
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqLockCurrentByIdMock.mockResolvedValue(gate({ status: 'draft' }));
    cqUpdateMock.mockResolvedValue(currentQuote);
    cqRenameMock.mockResolvedValue(renamedQuote);
    cqFindByIdMock.mockResolvedValue(renamedQuote);
    qcListForQuoteMock.mockResolvedValue([existingCandidate]);
    qcUpdateMock.mockResolvedValue(existingCandidate);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: {
        id: 'q-renamed',
        clientId: 'c1',
        clientName: 'Client',
        status: 'draft',
        candidates: [
          {
            id: 'qc-local',
            name: 'Variante A',
            items: [freshLine()],
            expirationDate: '2999-12-31',
            communicationChannelId: 'qcc_email',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(cqRenameMock).toHaveBeenCalledWith('q-1', 'q-renamed', expect.anything());
    expect(reserveDocumentCodeCounterFromCodeMock).toHaveBeenCalledWith(
      'client_quote',
      'q-renamed',
      expect.anything(),
    );
    expect(JSON.parse(res.body).id).toBe('q-renamed');
  });

  test('stages existing names so two candidates can swap names atomically', async () => {
    setupCreate();
    const candidateA = activeCandidate();
    const candidateB = activeCandidate({ id: 'qc-b', name: 'Variante B', position: 1 });
    const currentQuote = updatedQuote({ id: 'q-1', status: 'draft' });
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqLockCurrentByIdMock.mockResolvedValue(gate({ status: 'draft' }));
    cqUpdateMock.mockResolvedValue(currentQuote);
    cqFindByIdMock.mockResolvedValue(currentQuote);
    qcListForQuoteMock.mockResolvedValue([candidateA, candidateB]);
    const names = installCandidateNameConstraint([candidateA, candidateB]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Client',
        status: 'draft',
        candidates: [
          {
            id: 'qc-local',
            name: 'Variante B',
            items: [freshLine()],
            expirationDate: '2999-12-31',
            communicationChannelId: 'qcc_email',
          },
          {
            id: 'qc-b',
            name: 'Variante A',
            items: [freshLine()],
            expirationDate: '2999-12-31',
            communicationChannelId: 'qcc_email',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(names).toEqual(
      new Map([
        ['qc-local', 'Variante B'],
        ['qc-b', 'Variante A'],
      ]),
    );
  });

  test('deletes removed candidates before reusing one of their names', async () => {
    setupCreate();
    const candidateA = activeCandidate();
    const candidateB = activeCandidate({ id: 'qc-b', name: 'Variante B', position: 1 });
    const currentQuote = updatedQuote({ id: 'q-1', status: 'draft' });
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqLockCurrentByIdMock.mockResolvedValue(gate({ status: 'draft' }));
    cqUpdateMock.mockResolvedValue(currentQuote);
    cqFindByIdMock.mockResolvedValue(currentQuote);
    qcListForQuoteMock.mockResolvedValue([candidateA, candidateB]);
    const names = installCandidateNameConstraint([candidateA, candidateB]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Client',
        status: 'draft',
        candidates: [
          {
            id: 'qc-local',
            name: 'Variante B',
            items: [freshLine()],
            expirationDate: '2999-12-31',
            communicationChannelId: 'qcc_email',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(names).toEqual(new Map([['qc-local', 'Variante B']]));
  });

  test('maps a concurrent candidate-name collision to a conflict instead of a server error', async () => {
    setupCreate();
    const existingCandidate = activeCandidate();
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqLockCurrentByIdMock.mockResolvedValue(gate({ status: 'draft' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ id: 'q-1', status: 'draft' }));
    qcListForQuoteMock.mockResolvedValue([existingCandidate]);
    qcUpdateMock.mockRejectedValue({
      code: '23505',
      constraint: 'idx_quote_candidates_quote_name_unique',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Client',
        status: 'draft',
        candidates: [
          {
            id: 'qc-local',
            name: 'Variante A',
            items: [freshLine()],
            expirationDate: '2999-12-31',
            communicationChannelId: 'qcc_email',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('unique');
  });

  test('rejects a candidate save that resumes after the family was promoted', async () => {
    setupCreate();
    const existingCandidate = activeCandidate();
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent' }));
    qcListForQuoteMock.mockResolvedValue([existingCandidate]);
    // Simulates a promotion committing after the request preflight but before its transaction lock.
    cqLockCurrentByIdMock.mockResolvedValue(gate({ status: 'offer' }));

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Client',
        status: 'sent',
        candidates: [
          {
            id: 'qc-local',
            name: 'Variante A',
            items: [freshLine()],
            expirationDate: '2999-12-31',
            communicationChannelId: 'qcc_email',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('changed');
    expect(cqUpdateMock).not.toHaveBeenCalled();
    expect(qcUpdateMock).not.toHaveBeenCalled();
    expect(qvInsertMock).not.toHaveBeenCalled();
  });
  test('rejects an unknown status instead of silently keeping the current family status', async () => {
    setupCreate();
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    qcListForQuoteMock.mockResolvedValue([
      {
        id: 'qc-local',
        quoteId: 'q-1',
        name: 'Variante A',
        position: 0,
        state: 'active',
      },
    ]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
      payload: {
        clientId: 'c1',
        clientName: 'Client',
        status: 'unexpected',
        candidates: [
          {
            id: 'qc-local',
            name: 'Variante A',
            items: [freshLine()],
            expirationDate: '2999-12-31',
            communicationChannelId: 'qcc_email',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('status must be one of');
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('accepts the inclusive 100% line-discount boundary', async () => {
    setupCreate();

    const res = await postQuote([freshLine({ discount: 100 }), freshLine()]);

    expect(res.statusCode).toBe(201);
    const inserted = cqInsertItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(inserted[0].discount).toBe(100);
  });

  test('derives the client-quote local MOL from cost and sale price', async () => {
    setupCreate();

    const res = await postQuote([freshLine({ productMolPercentage: 35 })]);

    expect(res.statusCode).toBe(201);
    const inserted = cqInsertItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(inserted[0].productMolPercentage).toBe(50);
    expect(inserted[0].unitPrice).toBe(100);
  });

  test('replaces a stale submitted MOL with the value derived from cost and sale price', async () => {
    setupCreate();
    const res = await postQuote([freshLine({ productMolPercentage: 100 })]);

    expect(res.statusCode).toBe(201);
    const inserted = cqInsertItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(inserted[0].productMolPercentage).toBe(50);
  });

  test('rejects a line discount above 100%', async () => {
    const res = await postQuote([freshLine({ discount: 100.01 })]);

    expect(res.statusCode).toBe(400);
    expect(cqCreateMock).not.toHaveBeenCalled();
  });

  test('a create-form cost/quantity edit is kept as an isolated candidate snapshot', async () => {
    setupCreate();

    const res = await postQuote([
      freshLine({
        quantity: 5,
        supplierQuoteUnitPrice: 80,
        supplierQuoteBaseQuantity: 2,
        supplierQuoteBaseUnitPrice: 50,
      }),
    ]);

    expect(res.statusCode).toBe(201);
    // The deliberately edited cost survives onto the stored line…
    const inserted = cqInsertItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(inserted[0].supplierQuoteUnitPrice).toBe(80);
    // Draft candidates keep their own supplier snapshot; only promotion syncs the winner.
    expect(sqSyncItemPricingMock).not.toHaveBeenCalled();
    expect(sqvInsertMock).not.toHaveBeenCalled();
  });

  test('creating a quote directly in offer status is rejected', async () => {
    setupCreate();

    const res = await postQuote([freshLine()], { status: 'offer' });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('candidate promotion endpoint');
    expect(cqCreateMock).not.toHaveBeenCalled();
    expect(coCreateMock).not.toHaveBeenCalled();
  });

  test('direct offer creation is rejected before allocating document codes', async () => {
    setupCreate();

    const res = await postQuote([freshLine()], { id: '', status: 'offer' });

    expect(res.statusCode).toBe(400);
    expect(allocateDocumentCodeMock).not.toHaveBeenCalled();
  });
  test('blank quote id auto-generates from the centralized template', async () => {
    setupCreate();

    const res = await postQuote([freshLine()], { id: '' });

    expect(res.statusCode).toBe(201);
    expect(allocateDocumentCodeMock).toHaveBeenCalledWith('client_quote', {
      exec: expect.anything(),
    });
    expect(cqCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'PREV-2999-0001' }),
      expect.anything(),
    );
  });

  test('an untouched line (cost == baseline) takes the live supplier value and pushes nothing', async () => {
    // The supplier item moved to 60 after the user picked at 50 — a stale, untouched line must
    // not revert it: server values win, exactly like the PUT fresh-link rule.
    setupCreate(60);
    sqFindItemsByIdsMock.mockResolvedValue([{ ...SUPPLIER_ITEM, unitPrice: 60 }]);

    const res = await postQuote([
      freshLine({ supplierQuoteBaseQuantity: 2, supplierQuoteBaseUnitPrice: 50 }),
    ]);

    expect(res.statusCode).toBe(201);
    const inserted = cqInsertItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(inserted[0].supplierQuoteUnitPrice).toBe(60);
    expect(sqSyncItemPricingMock).not.toHaveBeenCalled();
    expect(sqvInsertMock).not.toHaveBeenCalled();
  });

  test('without a baseline the legacy rule holds: server value stored, nothing pushed', async () => {
    setupCreate();

    const res = await postQuote([freshLine({ supplierQuoteUnitPrice: 80 })]);

    expect(res.statusCode).toBe(201);
    const inserted = cqInsertItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(inserted[0].supplierQuoteUnitPrice).toBe(50);
    expect(sqSyncItemPricingMock).not.toHaveBeenCalled();
  });

  test('creation does not need supplier update permission before promotion', async () => {
    setupCreate();
    getRolePermissionsMock.mockResolvedValue(['sales.client_quotes.create']);

    const res = await postQuote([
      freshLine({
        supplierQuoteUnitPrice: 80,
        supplierQuoteBaseQuantity: 2,
        supplierQuoteBaseUnitPrice: 50,
      }),
    ]);

    expect(res.statusCode).toBe(201);
    expect(sqSyncItemPricingMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/sales/client-quotes list (#812 round 11)', () => {
  test('terminal families never expose the legacy expired flag', async () => {
    getRolePermissionsMock.mockResolvedValue(['sales.client_quotes.view']);
    cqListAllMock.mockResolvedValue([
      updatedQuote({ id: 'q-denied', status: 'denied', expirationDate: '2000-01-01' }),
    ]);
    qcListAllMock.mockResolvedValue([
      {
        id: 'qc-denied',
        quoteId: 'q-denied',
        name: 'Variante A',
        position: 0,
        state: 'active',
        paymentTerms: 'immediate',
        discount: 0,
        discountType: 'percentage',
        expirationDate: '2000-01-01',
        communicationChannelId: 'qcc_email',
        communicationChannelName: 'Email',
        notes: null,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      },
    ]);
    cqListAllItemsMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/client-quotes',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)[0]).toMatchObject({
      status: 'denied',
      effectiveStatus: 'denied',
      isExpired: false,
    });
  });

  test('promoted families leave expiry to the generated offer', async () => {
    getRolePermissionsMock.mockResolvedValue(['sales.client_quotes.view']);
    cqListAllMock.mockResolvedValue([
      updatedQuote({ id: 'q-offer', status: 'offer', expirationDate: '2000-01-01' }),
    ]);
    qcListAllMock.mockResolvedValue([
      {
        id: 'qc-selected',
        quoteId: 'q-offer',
        name: 'Variante A',
        position: 0,
        state: 'selected',
        paymentTerms: 'immediate',
        discount: 0,
        discountType: 'percentage',
        expirationDate: '2000-01-01',
        communicationChannelId: 'qcc_email',
        communicationChannelName: 'Email',
        notes: null,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      },
    ]);
    cqListAllItemsMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/client-quotes',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)[0]).toMatchObject({
      status: 'offer',
      effectiveStatus: 'offer',
      isExpired: false,
      candidates: [{ id: 'qc-selected', isExpired: true }],
    });
  });

  test('linkedSupplierQuoteExpired comes from the status-aware blocking map, not the raw projection', async () => {
    // q-1 sources a terminal-frozen supplier quote (excluded from the map) — its raw
    // linkedSupplierQuoteExpiration is past, but the flag must stay false so the UI does not
    // disable a transition the server-side guard allows. q-2 sources a live expired one → true.
    getRolePermissionsMock.mockResolvedValue(['sales.client_quotes.view']);
    cqListAllMock.mockResolvedValue([
      updatedQuote({ id: 'q-1', status: 'sent', linkedSupplierQuoteExpiration: '2000-01-01' }),
      updatedQuote({ id: 'q-2', status: 'sent', linkedSupplierQuoteExpiration: '2000-01-01' }),
    ]);
    const item = (id: string, quoteId: string, supplierQuoteId: string) => ({
      id,
      quoteId,
      productId: null,
      productName: 'Service',
      quantity: 1,
      unitPrice: 100,
      productCost: 50,
      productMolPercentage: null,
      discount: 0,
      note: null,
      supplierQuoteId,
      supplierQuoteItemId: `${supplierQuoteId}-item`,
      supplierQuoteSupplierName: 'Acme',
      supplierQuoteUnitPrice: 50,
      unitType: 'hours',
      durationMonths: 1,
      durationUnit: 'months',
    });
    cqListAllItemsMock.mockResolvedValue([
      item('qi-1', 'q-1', 'sq-frozen'),
      item('qi-2', 'q-2', 'sq-live'),
    ]);
    sqFindBlockingExpirationsByIdsMock.mockResolvedValue(new Map([['sq-live', '2000-01-01']]));

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/client-quotes',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Array<Record<string, unknown>>;
    expect(body.find((q) => q.id === 'q-1')?.linkedSupplierQuoteExpired).toBe(false);
    expect(body.find((q) => q.id === 'q-2')?.linkedSupplierQuoteExpired).toBe(true);
    const askedIds = sqFindBlockingExpirationsByIdsMock.mock.calls[0]?.[0] as string[];
    expect(askedIds).toContain('sq-frozen');
    expect(askedIds).toContain('sq-live');
  });

  test('family supplier-expired flag includes every active candidate', async () => {
    getRolePermissionsMock.mockResolvedValue(['sales.client_quotes.view']);
    cqListAllMock.mockResolvedValue([updatedQuote({ id: 'q-family', status: 'draft' })]);
    const candidate = (id: string, position: number) => ({
      id,
      quoteId: 'q-family',
      name: `Variante ${position + 1}`,
      position,
      state: 'active',
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage',
      expirationDate: '2999-12-31',
      communicationChannelId: 'qcc_email',
      communicationChannelName: 'Email',
      notes: null,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    qcListAllMock.mockResolvedValue([candidate('qc-a', 0), candidate('qc-b', 1)]);
    const item = (id: string, candidateId: string, supplierQuoteId: string | null) => ({
      id,
      quoteId: 'q-family',
      candidateId,
      productId: null,
      productName: 'Service',
      quantity: 1,
      unitPrice: 100,
      productCost: 50,
      productMolPercentage: null,
      discount: 0,
      note: null,
      supplierQuoteId,
      supplierQuoteItemId: supplierQuoteId ? `${supplierQuoteId}-item` : null,
      supplierQuoteSupplierName: supplierQuoteId ? 'Acme' : null,
      supplierQuoteUnitPrice: supplierQuoteId ? 50 : null,
      unitType: 'hours',
      durationMonths: 1,
      durationUnit: 'months',
    });
    cqListAllItemsMock.mockResolvedValue([
      item('qi-a', 'qc-a', null),
      item('qi-b', 'qc-b', 'sq-expired'),
    ]);
    sqFindBlockingExpirationsByIdsMock.mockResolvedValue(new Map([['sq-expired', '2000-01-01']]));

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/client-quotes',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const [family] = JSON.parse(res.body);
    expect(family.linkedSupplierQuoteExpired).toBe(true);
    expect(family.candidates.find((entry: { id: string }) => entry.id === 'qc-a')).toHaveProperty(
      'linkedSupplierQuoteExpired',
      false,
    );
    expect(family.candidates.find((entry: { id: string }) => entry.id === 'qc-b')).toHaveProperty(
      'linkedSupplierQuoteExpired',
      true,
    );
  });

  test('flags legacy item-only sourced rows too (#812 rounds 20-21)', async () => {
    // The stored line carries only supplierQuoteItemId — the list must resolve it to its supplier
    // quote (one batched lookup) so the flag matches what the update guard would block.
    getRolePermissionsMock.mockResolvedValue(['sales.client_quotes.view']);
    cqListAllMock.mockResolvedValue([updatedQuote({ id: 'q-3', status: 'sent' })]);
    cqListAllItemsMock.mockResolvedValue([
      {
        id: 'qi-legacy',
        quoteId: 'q-3',
        productId: null,
        productName: 'Service',
        quantity: 1,
        unitPrice: 100,
        productCost: 50,
        productMolPercentage: null,
        discount: 0,
        note: null,
        supplierQuoteId: null,
        supplierQuoteItemId: 'sqi-legacy',
        supplierQuoteSupplierName: 'Acme',
        supplierQuoteUnitPrice: 50,
        unitType: 'hours',
        durationMonths: 1,
        durationUnit: 'months',
      },
    ]);
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(
      new Map([
        [
          'sqi-legacy',
          {
            supplierQuoteId: 'sq-legacy',
            supplierName: 'Acme',
            productId: null,
            unitPrice: 50,
            netCost: 50,
            sourceable: true,
          },
        ],
      ]),
    );
    sqFindBlockingExpirationsByIdsMock.mockResolvedValue(new Map([['sq-legacy', '2000-01-01']]));

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/sales/client-quotes',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Array<Record<string, unknown>>;
    expect(body[0]?.linkedSupplierQuoteExpired).toBe(true);
    expect(sqGetQuoteItemSnapshotsMock).toHaveBeenCalledWith(['sqi-legacy']);
    expect(sqFindBlockingExpirationsByIdsMock).toHaveBeenCalledWith(['sq-legacy']);
  });
});

describe('PUT /api/sales/client-quotes/:id fresh-link sourceable guard (#812 round 15)', () => {
  const sourcedLine = (over: Record<string, unknown> = {}) => ({
    id: 'qi-9',
    productId: null,
    productName: 'Service',
    supplierQuoteItemId: 'sqi-9',
    quantity: 1,
    unitPrice: 100,
    productCost: 50,
    supplierQuoteUnitPrice: 50,
    discount: 0,
    unitType: 'hours',
    durationMonths: 1,
    durationUnit: 'months',
    ...over,
  });
  const snapshot = (sourceable: boolean) =>
    new Map([
      [
        'sqi-9',
        {
          supplierQuoteId: 'sq-9',
          supplierName: 'Acme',
          productId: null,
          unitPrice: 50,
          netCost: 50,
          sourceable,
        },
      ],
    ]);

  test('400 when a FRESH link references a quote no longer offered for sourcing', async () => {
    // The picker only offers draft-derived, order-free supplier quotes; a stale tab or raw API
    // client must not newly source a frozen/order-locked one.
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqFindItemSnapshotsForQuoteMock.mockResolvedValue([]);
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(snapshot(false));

    const res = await putStatus({ items: [sourcedLine()] });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('no longer available for new sourcing');
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('200 keeps a RETAINED link re-saving even when the quote left the pickable set', async () => {
    // The supplier quote legitimately progresses after sourcing; only NEW picks are gated.
    // A changed productCost forces the recalc path so the guard is actually evaluated.
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqFindItemSnapshotsForQuoteMock.mockResolvedValue([
      {
        id: 'qi-9',
        productId: null,
        quantity: 1,
        productCost: 40,
        productMolPercentage: null,
        supplierQuoteId: 'sq-9',
        supplierQuoteItemId: 'sqi-9',
        supplierQuoteSupplierName: 'Acme',
        supplierQuoteUnitPrice: 50,
        unitType: 'hours',
      },
    ]);
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(snapshot(false));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'draft' }));
    cqReplaceItemsMock.mockResolvedValue([]);
    sqFindItemsByIdsMock.mockResolvedValue([]);

    const res = await putStatus({ items: [sourcedLine()] });
    expect(res.statusCode).toBe(200);
  });
});

describe('sourced-id resolution for legacy item-only lines (#812 round 20)', () => {
  test('409 blocks a status-only advance when an item-only line sources an expired quote', async () => {
    // The stored line carries only supplierQuoteItemId (null denormalized supplierQuoteId) —
    // the guard must resolve the supplier quote through the live item, like the repo's
    // candidate predicate does, instead of silently skipping the line.
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqFindItemSnapshotsForQuoteMock.mockResolvedValue([
      { id: 'qi-1', supplierQuoteId: null, supplierQuoteItemId: 'sqi-9' },
    ]);
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(
      new Map([
        [
          'sqi-9',
          {
            supplierQuoteId: 'sq-9',
            supplierName: 'Acme',
            productId: null,
            unitPrice: 50,
            netCost: 50,
            sourceable: true,
          },
        ],
      ]),
    );
    sqFindEarliestExpirationByIdsMock.mockResolvedValue('2000-01-01');

    const res = await putStatus({ status: 'sent' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('expired');
    expect(sqGetQuoteItemSnapshotsMock).toHaveBeenCalledWith(['sqi-9'], undefined);
    expect(sqFindEarliestExpirationByIdsMock).toHaveBeenCalledWith(['sq-9']);
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/sales/client-quotes/:id expired guard (#812 round 25)', () => {
  test('409 when a draft quote is effectively expired (read-only model)', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue(null);
    cqFindByIdMock.mockResolvedValue(null);
    cqLockCurrentByIdMock.mockResolvedValue(null);
    cqFindItemsForCandidateMock.mockResolvedValue([]);
    cqFindStatusAndClientNameMock.mockResolvedValue({
      status: 'draft',
      clientName: 'Client',
      expirationDate: '2000-01-01',
    });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Expired quotes are read-only');
    expect(cqDeleteByIdMock).not.toHaveBeenCalled();
  });

  test('204 when the primary candidate is expired but another active variant is valid', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue(null);
    cqFindStatusAndClientNameMock.mockResolvedValue({
      status: 'draft',
      clientName: 'Client',
      expirationDate: '2000-01-01',
    });
    qcListForQuoteMock.mockResolvedValue([
      { id: 'qc-a', state: 'active', expirationDate: '2000-01-01' },
      { id: 'qc-b', state: 'active', expirationDate: '2999-12-31' },
    ]);
    cqDeleteByIdMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(cqDeleteByIdMock).toHaveBeenCalledWith('q-1');
  });

  test('409 when every active candidate is expired even if the parent date is still valid', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue(null);
    cqFindStatusAndClientNameMock.mockResolvedValue({
      status: 'draft',
      clientName: 'Client',
      expirationDate: '2999-12-31',
    });
    qcListForQuoteMock.mockResolvedValue([
      { id: 'qc-a', state: 'active', expirationDate: '2000-01-01' },
      { id: 'qc-b', state: 'active', expirationDate: '2000-02-01' },
    ]);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/sales/client-quotes/q-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Expired quotes are read-only');
    expect(cqDeleteByIdMock).not.toHaveBeenCalled();
  });
});
