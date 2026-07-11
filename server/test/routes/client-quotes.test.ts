import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realClientOffersRepo from '../../repositories/clientOffersRepo.ts';
import * as realClientQuotesRepo from '../../repositories/clientQuotesRepo.ts';
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
const cqFindCurrentMock = mock();
const cqFindAnyLinkedSaleMock = mock();
const cqFindFullForSnapshotMock = mock();
const cqFindItemsForQuoteMock = mock();
const cqFindIdConflictMock = mock();
const cqUpdateMock = mock();
const cqFindStatusAndClientNameMock = mock();
const cqDeleteByIdMock = mock();
const cqReplaceItemsMock = mock();
const cqFindItemSnapshotsForQuoteMock = mock();
const cqListAllMock = mock();
const cqListAllItemsMock = mock();
const cqCreateMock = mock();
const cqInsertItemsMock = mock();

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
    findCurrent: cqFindCurrentMock,
    findAnyLinkedSale: cqFindAnyLinkedSaleMock,
    findFullForSnapshot: cqFindFullForSnapshotMock,
    findItemsForQuote: cqFindItemsForQuoteMock,
    findIdConflict: cqFindIdConflictMock,
    update: cqUpdateMock,
    findStatusAndClientName: cqFindStatusAndClientNameMock,
    deleteById: cqDeleteByIdMock,
    replaceItems: cqReplaceItemsMock,
    findItemSnapshotsForQuote: cqFindItemSnapshotsForQuoteMock,
    listAll: cqListAllMock,
    listAllItems: cqListAllItemsMock,
    create: cqCreateMock,
    insertItems: cqInsertItemsMock,
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

const storedQuoteItem = (over: Record<string, unknown> = {}) => ({
  id: 'qi-1',
  quoteId: 'q-1',
  productId: 'p1',
  productName: 'Service',
  quantity: 2,
  unitPrice: 100,
  productCost: 50,
  productMolPercentage: 50,
  supplierQuoteId: 'sq-1',
  supplierQuoteItemId: 'sqi-1',
  supplierQuoteSupplierName: 'Supplier',
  supplierQuoteUnitPrice: 50,
  discount: 10,
  note: 'line note',
  unitType: 'hours',
  durationMonths: 12,
  durationUnit: 'months',
  ...over,
});

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  cqFindLinkedOfferIdMock,
  cqFindCurrentMock,
  cqFindAnyLinkedSaleMock,
  cqFindFullForSnapshotMock,
  cqFindItemsForQuoteMock,
  cqFindIdConflictMock,
  cqUpdateMock,
  cqReplaceItemsMock,
  cqFindItemSnapshotsForQuoteMock,
  cqListAllMock,
  cqListAllItemsMock,
  cqCreateMock,
  cqInsertItemsMock,
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
  qvBuildSnapshotMock.mockImplementation((quote, items) => ({ schemaVersion: 1, quote, items }));

  // Sensible defaults; individual tests override what they care about.
  cqFindLinkedOfferIdMock.mockResolvedValue(null);
  cqFindAnyLinkedSaleMock.mockResolvedValue(null);
  cqFindIdConflictMock.mockResolvedValue(false);
  cqFindFullForSnapshotMock.mockResolvedValue({ quote: updatedQuote(), items: [] });
  cqFindItemsForQuoteMock.mockResolvedValue([]);
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

  test('200 allows a no-op resend of the current status (draft → draft)', async () => {
    // The edit form resends the current status on every save — this must NOT trip the transition
    // rule (which would otherwise reject draft→draft as an invalid back-to-draft).
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'draft' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'draft' }));

    const res = await putStatus({ status: 'draft', notes: 'edited' });
    expect(res.statusCode).toBe(200);
  });

  test('200 sent → offer creates a linked draft offer with copied quote items', async () => {
    const item = storedQuoteItem();
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent' }));
    cqFindItemsForQuoteMock.mockResolvedValue([item]);
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'offer' }));

    const res = await putStatus({ status: 'offer' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('offer');
    expect(body.linkedOfferId).toBe('OFF-2999-0001');
    expect(coCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'OFF-2999-0001',
        linkedQuoteId: 'q-1',
        status: 'draft',
        expirationDate: '2999-12-31',
      }),
      expect.anything(),
    );
    const insertedOfferItems = coInsertItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(insertedOfferItems[0]).toMatchObject({
      productId: 'p1',
      productName: 'Service',
      quantity: 2,
      unitPrice: 100,
      productCost: 50,
      productMolPercentage: 50,
      supplierQuoteId: 'sq-1',
      supplierQuoteItemId: 'sqi-1',
      supplierQuoteSupplierName: 'Supplier',
      supplierQuoteUnitPrice: 50,
      discount: 10,
      note: 'line note',
      unitType: 'hours',
      durationMonths: 12,
      durationUnit: 'months',
    });
    expect(insertedOfferItems[0].id).not.toBe(item.id);
  });

  test('409 blocks a real offer conversion when an offer already exists', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue('existing-offer');
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent' }));

    const res = await putStatus({ status: 'offer' });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe('Quotes become read-only once an offer exists');
    expect(coCreateMock).not.toHaveBeenCalled();
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('200 offer → draft deletes the linked draft offer and clears the response link', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue('q-1-OF');
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'offer' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'draft' }));

    const res = await putStatus({ status: 'draft' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).linkedOfferId).toBeNull();
    expect(coLockExistingByIdMock).toHaveBeenCalledWith('q-1-OF', expect.anything());
    expect(coDeleteByIdMock).toHaveBeenCalledWith('q-1-OF', expect.anything());
  });

  test('409 rejects offer → draft when the linked offer is no longer draft', async () => {
    cqFindLinkedOfferIdMock.mockResolvedValue('q-1-OF');
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'offer' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'draft' }));
    coLockExistingByIdMock.mockResolvedValue({
      id: 'q-1-OF',
      linkedQuoteId: 'q-1',
      clientId: 'c1',
      clientName: 'Client',
      status: 'sent',
      deliveryDate: null,
      expirationDate: '2999-12-31',
    });

    const res = await putStatus({ status: 'draft' });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe(
      'Cannot revert quote while the linked offer is no longer draft',
    );
    expect(coDeleteByIdMock).not.toHaveBeenCalled();
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

  test('409 rejects denied → offer: terminal quotes are frozen (#812)', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'denied' }));

    const res = await putStatus({ status: 'offer' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe('Accepted or rejected quotes are read-only');
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('200 allows offer → draft (back-to-draft from offer)', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'offer' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'draft' }));

    const res = await putStatus({ status: 'draft' });
    expect(res.statusCode).toBe(200);
  });

  test('409 expired quote rejects a status change but the body is otherwise frozen', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));

    const res = await putStatus({ status: 'accepted' });
    expect(res.statusCode).toBe(409);
    expect(cqUpdateMock).not.toHaveBeenCalled();
  });

  test('200 expired quote can be revalidated by extending the expiration date (no status change)', async () => {
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));
    cqUpdateMock.mockResolvedValue(updatedQuote({ status: 'sent', expirationDate: '2027-01-01' }));

    const res = await putStatus({ expirationDate: '2027-01-01' });
    expect(res.statusCode).toBe(200);
    expect(cqUpdateMock).toHaveBeenCalled();
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

  test('response does not flag linkedSupplierQuoteExpired on a terminal (accepted) quote', async () => {
    // Accepted/denied are frozen and can never progress, so the "extend before progressing"
    // indicator must not show even when the linked supplier quote is past its expiration (#779).
    cqFindCurrentMock.mockResolvedValue(gate({ status: 'accepted' }));
    cqUpdateMock.mockResolvedValue(
      updatedQuote({
        status: 'accepted',
        linkedSupplierQuoteId: 'sq-9',
        linkedSupplierQuoteExpiration: '2000-01-01',
      }),
    );

    const res = await putStatus({ status: 'accepted' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).linkedSupplierQuoteExpired).toBe(false);
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
    expect(replaced[0].unitPrice).toBe(50);
  });

  test('persists an edited local MOL on a retained supplier-sourced line', async () => {
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
      items: [lineItem(2, 50, { productId: null, productMolPercentage: 35 })],
    });

    expect(res.statusCode).toBe(200);
    const replaced = cqReplaceItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(replaced[0].productMolPercentage).toBe(35);
    expect(replaced[0].unitPrice).toBe(76.92);
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
    expect(sqSyncItemPricingMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/sales/client-quotes supplier sync on create (user report after #812)', () => {
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
        expirationDate: '2999-12-31',
        communicationChannelId: 'qcc_email',
        ...over,
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
    cqCreateMock.mockResolvedValue(updatedQuote({ id: 'q-new', status: 'draft' }));
    cqInsertItemsMock.mockResolvedValue([]);
    sqFindItemsByIdsMock.mockResolvedValue([SUPPLIER_ITEM]);
    sqFindFullForSnapshotMock.mockResolvedValue({
      quote: { id: 'sq-9' },
      items: [SUPPLIER_ITEM],
    });
  };

  test('accepts the inclusive 100% line-discount boundary', async () => {
    setupCreate();

    const res = await postQuote([freshLine({ discount: 100 }), freshLine()]);

    expect(res.statusCode).toBe(201);
    const inserted = cqInsertItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(inserted[0].discount).toBe(100);
  });

  test('persists the client-quote local MOL on a supplier-sourced line', async () => {
    setupCreate();

    const res = await postQuote([freshLine({ productMolPercentage: 35 })]);

    expect(res.statusCode).toBe(201);
    const inserted = cqInsertItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(inserted[0].productMolPercentage).toBe(35);
    expect(inserted[0].unitPrice).toBe(76.92);
  });

  test('rejects a line discount above 100%', async () => {
    const res = await postQuote([freshLine({ discount: 100.01 })]);

    expect(res.statusCode).toBe(400);
    expect(cqCreateMock).not.toHaveBeenCalled();
  });

  test('a create-form cost/quantity edit away from the pick-time baseline is kept and pushed', async () => {
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
    // …and is pushed onto the supplier item, atomically, with the discount-to-us preserved.
    expect(sqSyncItemPricingMock).toHaveBeenCalledTimes(1);
    expect(sqSyncItemPricingMock.mock.calls[0][0]).toBe('sq-9');
    expect(sqSyncItemPricingMock.mock.calls[0][1]).toEqual([
      { itemId: 'sqi-9', quantity: 5, unitCost: 80, discountPercent: 20 },
    ]);
    expect(sqvInsertMock).toHaveBeenCalledTimes(1);
    const auditActions = (logAuditMock.mock.calls as unknown as Array<[{ action?: string }]>).map(
      (c) => c[0]?.action,
    );
    expect(auditActions).toContain('supplier_quote.updated');
  });

  test('creating a quote directly in offer status creates the linked draft offer', async () => {
    setupCreate();
    const item = storedQuoteItem({ quoteId: 'q-new' });
    cqCreateMock.mockResolvedValue(updatedQuote({ id: 'q-new', status: 'offer' }));
    cqInsertItemsMock.mockResolvedValue([item]);

    const res = await postQuote([freshLine()], { status: 'offer' });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('offer');
    expect(body.linkedOfferId).toBe('OFF-2999-0001');
    expect(coCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'OFF-2999-0001',
        linkedQuoteId: 'q-new',
        status: 'draft',
      }),
      expect.anything(),
    );
    const insertedOfferItems = coInsertItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(insertedOfferItems[0]).toMatchObject({
      supplierQuoteId: 'sq-1',
      supplierQuoteItemId: 'sqi-1',
      durationMonths: 12,
      durationUnit: 'months',
    });
  });

  test('creating a quote directly in offer status passes the generated quote code as offer source', async () => {
    setupCreate();
    const item = storedQuoteItem({ quoteId: 'PREV_26_0045' });
    allocateDocumentCodeMock.mockImplementation(async (moduleId: string) => {
      if (moduleId === 'client_quote') return 'PREV_26_0045';
      if (moduleId === 'client_offer') return 'OFF_26_0045';
      return `${moduleId}-generated`;
    });
    cqCreateMock.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(updatedQuote({ id: input.id, status: 'offer' })),
    );
    cqInsertItemsMock.mockResolvedValue([item]);

    const res = await postQuote([freshLine()], { id: '', status: 'offer' });

    expect(res.statusCode).toBe(201);
    expect(allocateDocumentCodeMock).toHaveBeenCalledWith('client_offer', {
      exec: expect.anything(),
      sourceCode: 'PREV_26_0045',
    });
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

  test('403 when the create-form edit needs the supplier-quote update permission', async () => {
    setupCreate();
    getRolePermissionsMock.mockResolvedValue(['sales.client_quotes.create']);

    const res = await postQuote([
      freshLine({
        supplierQuoteUnitPrice: 80,
        supplierQuoteBaseQuantity: 2,
        supplierQuoteBaseUnitPrice: 50,
      }),
    ]);

    expect(res.statusCode).toBe(403);
    expect(sqSyncItemPricingMock).not.toHaveBeenCalled();
    // The quote write rolled back together with the refused supplier write.
    expect(res.json().error).toContain('supplier quote update permission');
  });
});

describe('GET /api/sales/client-quotes list (#812 round 11)', () => {
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
});
