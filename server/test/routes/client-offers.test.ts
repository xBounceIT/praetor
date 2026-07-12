import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realClientOffersRepo from '../../repositories/clientOffersRepo.ts';
import * as realClientQuotesRepo from '../../repositories/clientQuotesRepo.ts';
import * as realClientsOrdersRepo from '../../repositories/clientsOrdersRepo.ts';
import * as realClientsRepo from '../../repositories/clientsRepo.ts';
import * as realOfferVersionsRepo from '../../repositories/offerVersionsRepo.ts';
import * as realProductsRepo from '../../repositories/productsRepo.ts';
import * as realQuoteCandidatesRepo from '../../repositories/quoteCandidatesRepo.ts';
import * as realQuoteVersionsRepo from '../../repositories/quoteVersionsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realSupplierQuotesRepo from '../../repositories/supplierQuotesRepo.ts';
import * as realSupplierQuoteVersionsRepo from '../../repositories/supplierQuoteVersionsRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realDocumentCodes from '../../services/documentCodes.ts';
import * as realAudit from '../../utils/audit.ts';
import * as realOrderIds from '../../utils/order-ids.ts';
import * as realPermissions from '../../utils/permissions.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';
import { signToken } from '../helpers/jwt.ts';
import { makeWithDbTransactionMock } from '../helpers/withDbTransactionMock.ts';

// Issue #779 (extended to offers): focused coverage of the PUT expired rules — the derived
// `effectiveStatus`, expired content-read-only-except-date, the expired status freeze, and the
// expiration-date carve-out from the non-draft lock (terminal offers stay fully frozen).

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const clientsRepoSnap = { ...realClientsRepo };
const clientOffersRepoSnap = { ...realClientOffersRepo };
const clientQuotesRepoSnap = { ...realClientQuotesRepo };
const quoteCandidatesRepoSnap = { ...realQuoteCandidatesRepo };
const quoteVersionsRepoSnap = { ...realQuoteVersionsRepo };
const clientsOrdersRepoSnap = { ...realClientsOrdersRepo };
const productsRepoSnap = { ...realProductsRepo };
const offerVersionsRepoSnap = { ...realOfferVersionsRepo };
const supplierQuotesRepoSnap = { ...realSupplierQuotesRepo };
const supplierQuoteVersionsRepoSnap = { ...realSupplierQuoteVersionsRepo };
const documentCodesSnap = { ...realDocumentCodes };
const auditSnap = { ...realAudit };
const orderIdsSnap = { ...realOrderIds };
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const coFindExistingMock = mock();
const coLockExistingByIdMock = mock();
const coFindFullForSnapshotMock = mock();
const coFindItemsForOfferMock = mock();
const coFindIdConflictMock = mock();
const coUpdateMock = mock();
const coRenameMock = mock();
const coReplaceItemsMock = mock();
const coCreateMock = mock();
const coInsertItemsMock = mock();
const coFindExistingForQuoteMock = mock();
const coFindStatusAndClientNameMock = mock();
const coFindLinkedSaleIdMock = mock();
const coDeleteByIdMock = mock();

const clientOrderFindExistingForOfferMock = mock();
const clientOrderCreateMock = mock();
const clientOrderInsertItemsMock = mock();
const clientOrderFindItemsForOrderMock = mock();
const clientOrderCreateSupplierOrderMock = mock();
const clientOrderBulkInsertSupplierOrderItemsMock = mock();
const clientOrderLinkSaleItemsToSupplierOrderMock = mock();
const clientOrderMapSaleItemsToSupplierItemsMock = mock();
const clientOrderLinkSaleItemsToSupplierOrderAndItemsMock = mock();
const generateClientOrderIdMock = mock();
const generateSupplierOrderIdMock = mock();
const allocateDocumentCodeMock = mock();

const qcListForQuoteMock = mock();
const qcReactivateAllMock = mock();
const qvInsertMock = mock();
const qvBuildSnapshotMock = mock();

const cqFindStatusAndClientNameMock = mock();
const cqFindItemSnapshotsForQuoteMock = mock();
const cqLockCurrentByIdMock = mock();
const cqFindFullForSnapshotMock = mock();
const cqUpdateMock = mock();

const sqGetQuoteItemSnapshotsMock = mock();
const sqFindByIdMock = mock();
const sqFindItemsForQuoteMock = mock();
const sqFindItemsByIdsMock = mock();
const sqFindLinkedOrderIdMock = mock();
const sqLockEffectiveStatusMock = mock();
const sqSyncItemPricingMock = mock();
const sqFindFullForSnapshotMock = mock();
const sqvInsertMock = mock();
const sqvBuildSnapshotMock = mock();

const ovInsertMock = mock();
const ovBuildSnapshotMock = mock();

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
  mock.module('../../repositories/clientsRepo.ts', () => ({ ...clientsRepoSnap }));
  mock.module('../../repositories/clientOffersRepo.ts', () => ({
    ...clientOffersRepoSnap,
    findExisting: coFindExistingMock,
    lockExistingById: coLockExistingByIdMock,
    findFullForSnapshot: coFindFullForSnapshotMock,
    findItemsForOffer: coFindItemsForOfferMock,
    findIdConflict: coFindIdConflictMock,
    update: coUpdateMock,
    rename: coRenameMock,
    replaceItems: coReplaceItemsMock,
    create: coCreateMock,
    insertItems: coInsertItemsMock,
    findExistingForQuote: coFindExistingForQuoteMock,
    findStatusAndClientName: coFindStatusAndClientNameMock,
    findLinkedSaleId: coFindLinkedSaleIdMock,
    deleteById: coDeleteByIdMock,
  }));
  mock.module('../../repositories/clientQuotesRepo.ts', () => ({
    ...clientQuotesRepoSnap,
    findStatusAndClientName: cqFindStatusAndClientNameMock,
    findItemSnapshotsForQuote: cqFindItemSnapshotsForQuoteMock,
    lockCurrentById: cqLockCurrentByIdMock,
    findFullForSnapshot: cqFindFullForSnapshotMock,
    update: cqUpdateMock,
  }));
  mock.module('../../repositories/quoteCandidatesRepo.ts', () => ({
    ...quoteCandidatesRepoSnap,
    listForQuote: qcListForQuoteMock,
    reactivateAll: qcReactivateAllMock,
  }));
  mock.module('../../repositories/quoteVersionsRepo.ts', () => ({
    ...quoteVersionsRepoSnap,
    insert: qvInsertMock,
    buildSnapshot: qvBuildSnapshotMock,
  }));
  mock.module('../../repositories/clientsOrdersRepo.ts', () => ({
    ...clientsOrdersRepoSnap,
    findExistingForOffer: clientOrderFindExistingForOfferMock,
    create: clientOrderCreateMock,
    insertItems: clientOrderInsertItemsMock,
    findItemsForOrder: clientOrderFindItemsForOrderMock,
    createSupplierOrder: clientOrderCreateSupplierOrderMock,
    bulkInsertSupplierOrderItems: clientOrderBulkInsertSupplierOrderItemsMock,
    linkSaleItemsToSupplierOrder: clientOrderLinkSaleItemsToSupplierOrderMock,
    mapSaleItemsToSupplierItems: clientOrderMapSaleItemsToSupplierItemsMock,
    linkSaleItemsToSupplierOrderAndItems: clientOrderLinkSaleItemsToSupplierOrderAndItemsMock,
  }));
  mock.module('../../repositories/supplierQuotesRepo.ts', () => ({
    ...supplierQuotesRepoSnap,
    getQuoteItemSnapshots: sqGetQuoteItemSnapshotsMock,
    findById: sqFindByIdMock,
    findItemsForQuote: sqFindItemsForQuoteMock,
    findItemsByIds: sqFindItemsByIdsMock,
    findLinkedOrderId: sqFindLinkedOrderIdMock,
    lockEffectiveStatusById: sqLockEffectiveStatusMock,
    syncItemPricing: sqSyncItemPricingMock,
    findFullForSnapshot: sqFindFullForSnapshotMock,
  }));
  mock.module('../../utils/order-ids.ts', () => ({
    ...orderIdsSnap,
    generateClientOrderId: generateClientOrderIdMock,
    generateSupplierOrderId: generateSupplierOrderIdMock,
  }));
  mock.module('../../services/documentCodes.ts', () => ({
    ...documentCodesSnap,
    allocateDocumentCode: allocateDocumentCodeMock,
  }));
  mock.module('../../repositories/supplierQuoteVersionsRepo.ts', () => ({
    ...supplierQuoteVersionsRepoSnap,
    insert: sqvInsertMock,
    buildSnapshot: sqvBuildSnapshotMock,
  }));
  mock.module('../../repositories/productsRepo.ts', () => ({ ...productsRepoSnap }));
  mock.module('../../repositories/offerVersionsRepo.ts', () => ({
    ...offerVersionsRepoSnap,
    insert: ovInsertMock,
    buildSnapshot: ovBuildSnapshotMock,
  }));
  mock.module('../../utils/audit.ts', () => ({ ...auditSnap, logAudit: logAuditMock }));
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));

  routePlugin = (await import('../../routes/client-offers.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/clientsRepo.ts', () => clientsRepoSnap);
  mock.module('../../repositories/clientOffersRepo.ts', () => clientOffersRepoSnap);
  mock.module('../../repositories/clientQuotesRepo.ts', () => clientQuotesRepoSnap);
  mock.module('../../repositories/quoteCandidatesRepo.ts', () => quoteCandidatesRepoSnap);
  mock.module('../../repositories/quoteVersionsRepo.ts', () => quoteVersionsRepoSnap);
  mock.module('../../repositories/clientsOrdersRepo.ts', () => clientsOrdersRepoSnap);
  mock.module('../../repositories/supplierQuotesRepo.ts', () => supplierQuotesRepoSnap);
  mock.module('../../utils/order-ids.ts', () => orderIdsSnap);
  mock.module(
    '../../repositories/supplierQuoteVersionsRepo.ts',
    () => supplierQuoteVersionsRepoSnap,
  );
  mock.module('../../services/documentCodes.ts', () => documentCodesSnap);
  mock.module('../../repositories/productsRepo.ts', () => productsRepoSnap);
  mock.module('../../repositories/offerVersionsRepo.ts', () => offerVersionsRepoSnap);
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
  'sales.client_offers.update',
  'sales.client_offers.create',
  'sales.supplier_quotes.update',
];

// findExisting returns the ExistingOffer gate shape.
const gate = (over: Partial<ReturnType<typeof baseGate>> = {}) => ({ ...baseGate(), ...over });
const baseGate = () => ({
  id: 'off-1',
  linkedQuoteId: 'q-1',
  linkedQuoteCandidateId: null as string | null,
  clientId: 'c1',
  clientName: 'Client',
  status: 'draft',
  deliveryDate: null as string | null,
  // Far future: the effective-status guards compare against the real clock, so a near date would
  // flip these fixtures to `expired` one day and break the suite.
  expirationDate: '2999-12-31',
});

// update() returns the full mapped ClientOffer row.
const updatedOffer = (over: Record<string, unknown> = {}) => ({
  id: 'off-1',
  linkedQuoteId: 'q-1',
  clientId: 'c1',
  clientName: 'Client',
  paymentTerms: 'immediate',
  discount: 0,
  discountType: 'percentage' as const,
  status: 'draft',
  deliveryDate: null,
  expirationDate: '2999-12-31',
  notes: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...over,
});

const storedOfferItem = (over: Record<string, unknown> = {}) => ({
  id: 'coi-1',
  offerId: 'off-1',
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
  unitType: 'hours' as const,
  note: null,
  discount: 0,
  durationMonths: 1,
  durationUnit: 'months' as const,
  ...over,
});

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  coFindExistingMock,
  coLockExistingByIdMock,
  coFindFullForSnapshotMock,
  coFindItemsForOfferMock,
  coFindIdConflictMock,
  coUpdateMock,
  coRenameMock,
  coReplaceItemsMock,
  coCreateMock,
  coInsertItemsMock,
  coFindExistingForQuoteMock,
  coFindLinkedSaleIdMock,
  coDeleteByIdMock,
  clientOrderFindExistingForOfferMock,
  clientOrderCreateMock,
  clientOrderInsertItemsMock,
  clientOrderFindItemsForOrderMock,
  clientOrderCreateSupplierOrderMock,
  clientOrderBulkInsertSupplierOrderItemsMock,
  clientOrderLinkSaleItemsToSupplierOrderMock,
  clientOrderMapSaleItemsToSupplierItemsMock,
  clientOrderLinkSaleItemsToSupplierOrderAndItemsMock,
  generateClientOrderIdMock,
  generateSupplierOrderIdMock,
  allocateDocumentCodeMock,
  qcListForQuoteMock,
  qcReactivateAllMock,
  qvInsertMock,
  qvBuildSnapshotMock,
  cqFindStatusAndClientNameMock,
  cqFindItemSnapshotsForQuoteMock,
  cqLockCurrentByIdMock,
  cqFindFullForSnapshotMock,
  cqUpdateMock,
  sqGetQuoteItemSnapshotsMock,
  sqFindByIdMock,
  sqFindItemsForQuoteMock,
  sqFindItemsByIdsMock,
  sqFindLinkedOrderIdMock,
  sqLockEffectiveStatusMock,
  sqSyncItemPricingMock,
  sqFindFullForSnapshotMock,
  sqvInsertMock,
  sqvBuildSnapshotMock,
  ovInsertMock,
  ovBuildSnapshotMock,
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
  ovBuildSnapshotMock.mockImplementation((offer, items) => ({ schemaVersion: 1, offer, items }));
  qcListForQuoteMock.mockResolvedValue([]);
  qcReactivateAllMock.mockResolvedValue(undefined);
  qvInsertMock.mockResolvedValue(undefined);
  qvBuildSnapshotMock.mockImplementation((quote, items, candidates) => ({
    schemaVersion: 2,
    quote,
    candidates,
    items,
  }));

  // Sensible defaults; individual tests override what they care about.
  coFindFullForSnapshotMock.mockResolvedValue({ offer: updatedOffer(), items: [] });
  coFindItemsForOfferMock.mockResolvedValue([]);
  coFindIdConflictMock.mockResolvedValue(false);
  ovInsertMock.mockResolvedValue(undefined);
  // Supplier resolution / forward-sync defaults: nothing linked, nothing pushed.
  coReplaceItemsMock.mockResolvedValue([]);
  clientOrderFindExistingForOfferMock.mockResolvedValue(null);
  clientOrderCreateMock.mockImplementation((input: Record<string, unknown>) =>
    Promise.resolve({
      id: input.id ?? 'ORD-2999-0001',
      linkedQuoteId: input.linkedQuoteId ?? null,
      linkedOfferId: input.linkedOfferId ?? null,
      clientId: input.clientId,
      clientName: input.clientName,
      paymentTerms: input.paymentTerms,
      discount: input.discount,
      discountType: input.discountType,
      status: input.status,
      notes: input.notes,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    }),
  );
  clientOrderInsertItemsMock.mockImplementation(
    (orderId: string, items: Array<Record<string, unknown>>) =>
      Promise.resolve(
        items.map((item, index) => ({
          id: item.id,
          orderId,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          productCost: item.productCost,
          productMolPercentage: item.productMolPercentage,
          supplierQuoteId: item.supplierQuoteId,
          supplierQuoteItemId: item.supplierQuoteItemId,
          supplierQuoteSupplierName: item.supplierQuoteSupplierName,
          supplierQuoteUnitPrice: item.supplierQuoteUnitPrice,
          supplierSaleId: null,
          supplierSaleItemId: null,
          supplierSaleSupplierName: null,
          unitType: item.unitType,
          note: item.note,
          discount: item.discount,
          durationMonths: item.durationMonths,
          durationUnit: item.durationUnit,
          ...(index === 0 ? {} : { id: `${item.id}-${index}` }),
        })),
      ),
  );
  clientOrderFindItemsForOrderMock.mockResolvedValue([]);
  clientOrderCreateSupplierOrderMock.mockResolvedValue(undefined);
  clientOrderBulkInsertSupplierOrderItemsMock.mockResolvedValue(undefined);
  clientOrderLinkSaleItemsToSupplierOrderMock.mockResolvedValue(undefined);
  clientOrderMapSaleItemsToSupplierItemsMock.mockResolvedValue(undefined);
  clientOrderLinkSaleItemsToSupplierOrderAndItemsMock.mockResolvedValue(undefined);
  generateClientOrderIdMock.mockResolvedValue('ORD-2999-0001');
  generateSupplierOrderIdMock.mockResolvedValue('SORD-2999-0001');
  allocateDocumentCodeMock.mockImplementation(async (moduleId: string) => {
    if (moduleId === 'client_offer') return 'OFF-2999-0001';
    if (moduleId === 'supplier_order') return 'SORD-2999-0001';
    return 'ORD-2999-0001';
  });
  // Linked-quote sourced lines for the fresh-link inheritance exemption (#812 round 15).
  cqFindItemSnapshotsForQuoteMock.mockResolvedValue([]);
  sqGetQuoteItemSnapshotsMock.mockResolvedValue(new Map());
  sqFindByIdMock.mockResolvedValue(null);
  sqFindItemsForQuoteMock.mockResolvedValue([]);
  sqFindItemsByIdsMock.mockResolvedValue([]);
  sqFindLinkedOrderIdMock.mockResolvedValue(null);
  // Unlinked live chain → derived 'draft': the sync's freeze guard stays open by default.
  sqLockEffectiveStatusMock.mockResolvedValue({
    expirationDate: '2999-12-31',
    linkedClientStatus: null,
    linkedClientQuoteExpiration: null,
    linkedOfferStatus: null,
    linkedOfferExpiration: null,
  });
  sqSyncItemPricingMock.mockResolvedValue(undefined);
  sqFindFullForSnapshotMock.mockResolvedValue(null);
  sqvInsertMock.mockResolvedValue(undefined);
  sqvBuildSnapshotMock.mockImplementation((quote, items) => ({ schemaVersion: 1, quote, items }));

  testApp = await buildRouteTestApp(routePlugin, '/api/sales/client-offers');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

const putOffer = (body: Record<string, unknown>) =>
  testApp.inject({
    method: 'PUT',
    url: '/api/sales/client-offers/off-1',
    headers: authHeader(),
    payload: body,
  });

describe('PUT /api/sales/client-offers/:id expired rules (issue #779)', () => {
  test('200 extends an expired sent offer via its expiration date and derives effectiveStatus', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));
    coUpdateMock.mockResolvedValue(updatedOffer({ status: 'sent', expirationDate: '2999-12-31' }));

    const res = await putOffer({ expirationDate: '2999-12-31' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.effectiveStatus).toBe('sent');
    expect(coUpdateMock).toHaveBeenCalledTimes(1);
  });

  test('409 expired offer rejects content edits (only the expiration date is editable)', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'draft', expirationDate: '2000-01-01' }));

    const res = await putOffer({ notes: 'edited while expired' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Expired');
    expect(coUpdateMock).not.toHaveBeenCalled();
  });

  test('409 expired offer rejects a status change (extend the date instead)', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));

    const res = await putOffer({ status: 'accepted' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('cannot change status');
    expect(coUpdateMock).not.toHaveBeenCalled();
  });

  test('200 tolerates a no-op resend of the stored status on an expired offer', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));
    coUpdateMock.mockResolvedValue(updatedOffer({ status: 'sent', expirationDate: '2000-01-01' }));

    const res = await putOffer({ status: 'sent' });
    expect(res.statusCode).toBe(200);
  });

  test('409 non-draft content edits stay blocked (pre-existing rule)', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'sent' }));

    const res = await putOffer({ notes: 'edited while sent' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Non-draft');
    expect(coUpdateMock).not.toHaveBeenCalled();
  });

  test('200 reverts a valid sent offer to draft with snapshot and audit', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'sent', deliveryDate: '2026-05-14' }));
    coFindFullForSnapshotMock.mockResolvedValue({
      offer: updatedOffer({ status: 'sent', deliveryDate: '2026-05-14' }),
      items: [],
    });
    coUpdateMock.mockResolvedValue(updatedOffer({ status: 'draft', deliveryDate: '2026-05-14' }));

    const res = await putOffer({ status: 'draft' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      status: 'draft',
      effectiveStatus: 'draft',
      deliveryDate: '2026-05-14',
    });
    expect(coUpdateMock).toHaveBeenCalledWith(
      'off-1',
      expect.objectContaining({ status: 'draft' }),
      expect.anything(),
    );
    expect(ovInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ offerId: 'off-1', reason: 'update' }),
      expect.anything(),
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'client_offer.updated',
        details: expect.objectContaining({ fromValue: 'sent', toValue: 'draft' }),
      }),
    );
  });

  test('200 a valid sent offer can renew its expiration date (date carved out of the lock)', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'sent' }));
    coUpdateMock.mockResolvedValue(updatedOffer({ status: 'sent', expirationDate: '2999-12-31' }));

    const res = await putOffer({ expirationDate: '2999-12-31' });
    expect(res.statusCode).toBe(200);
    expect(coUpdateMock).toHaveBeenCalledTimes(1);
  });

  test('200 accepting an offer auto-creates the linked draft client order', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'sent' }));
    coUpdateMock.mockResolvedValue(updatedOffer({ status: 'accepted' }));
    coFindItemsForOfferMock.mockResolvedValue([storedOfferItem({ discount: 12.5 })]);

    const res = await putOffer({ status: 'accepted' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).autoCreated).toEqual({
      clientOrder: { id: 'ORD-2999-0001' },
      supplierOrders: [],
    });
    expect(clientOrderFindExistingForOfferMock).toHaveBeenCalledWith(
      'off-1',
      null,
      expect.anything(),
    );
    expect(clientOrderCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ORD-2999-0001',
        linkedQuoteId: 'q-1',
        linkedOfferId: 'off-1',
        clientId: 'c1',
        clientName: 'Client',
        status: 'draft',
      }),
      expect.anything(),
    );
    const orderItems = clientOrderInsertItemsMock.mock.calls[0][1] as Array<
      Record<string, unknown>
    >;
    expect(orderItems[0]).toMatchObject({
      productId: 'p-1',
      productName: 'Service',
      quantity: 2,
      unitPrice: 100,
      productCost: 50,
      supplierQuoteId: null,
      discount: 12.5,
      durationMonths: 1,
      durationUnit: 'months',
    });
  });

  test('409 accepting an offer with an existing sale order blocks auto-create cleanly', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'sent' }));
    coUpdateMock.mockResolvedValue(updatedOffer({ status: 'accepted' }));
    coFindItemsForOfferMock.mockResolvedValue([storedOfferItem()]);
    clientOrderFindExistingForOfferMock.mockResolvedValue({ id: 'ORD-2999-0001' });

    const res = await putOffer({ status: 'accepted' });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe('A sale order already exists for this offer');
    expect(clientOrderCreateMock).not.toHaveBeenCalled();
  });

  test('200 accepting a supplier-sourced offer still auto-creates the supplier order', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'sent' }));
    coUpdateMock.mockResolvedValue(updatedOffer({ status: 'accepted' }));
    coFindItemsForOfferMock.mockResolvedValue([
      storedOfferItem({
        supplierQuoteId: 'sq-1',
        supplierQuoteItemId: 'sqi-1',
        supplierQuoteSupplierName: 'Supplier Co',
        supplierQuoteUnitPrice: 50,
      }),
    ]);
    sqFindByIdMock.mockResolvedValue({
      id: 'sq-1',
      supplierId: 'sup-1',
      supplierName: 'Supplier Co',
      paymentTerms: '30 days',
      expirationDate: '2999-12-31',
      linkedClientQuoteStatus: 'offer',
      linkedClientQuoteExpiration: '2999-12-31',
      linkedOfferStatus: 'accepted',
      linkedOfferExpiration: '2999-12-31',
      notes: 'supplier notes',
    });
    sqLockEffectiveStatusMock.mockResolvedValue({
      expirationDate: '2999-12-31',
      linkedClientStatus: 'offer',
      linkedClientQuoteExpiration: '2999-12-31',
      linkedOfferStatus: 'accepted',
      linkedOfferExpiration: '2999-12-31',
    });
    sqFindItemsForQuoteMock.mockResolvedValue([
      {
        id: 'sqi-1',
        productId: 'p-1',
        productName: 'Service',
        quantity: 2,
        unitType: 'days',
        listPrice: 62.5,
        discountPercent: 20,
        unitPrice: 50,
        note: null,
        durationMonths: 1,
        durationUnit: 'months',
      },
    ]);

    const res = await putOffer({ status: 'accepted' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).autoCreated).toEqual({
      clientOrder: { id: 'ORD-2999-0001' },
      supplierOrders: [
        { id: 'SORD-2999-0001', supplierQuoteId: 'sq-1', supplierName: 'Supplier Co' },
      ],
    });
    expect(clientOrderCreateSupplierOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'SORD-2999-0001',
        linkedQuoteId: 'sq-1',
        supplierId: 'sup-1',
        supplierName: 'Supplier Co',
      }),
      expect.anything(),
    );
    expect(clientOrderBulkInsertSupplierOrderItemsMock).toHaveBeenCalledWith(
      'SORD-2999-0001',
      [expect.objectContaining({ unitPrice: 62.5, discount: 20, unitType: 'days' })],
      expect.anything(),
    );
    expect(clientOrderLinkSaleItemsToSupplierOrderAndItemsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'ORD-2999-0001',
        supplierQuoteId: 'sq-1',
        supplierOrderId: 'SORD-2999-0001',
        supplierName: 'Supplier Co',
      }),
      expect.anything(),
    );
  });

  test('200 accepting a supplier-sourced offer returns a warning when supplier-order code allocation collides', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'sent' }));
    coUpdateMock.mockResolvedValue(updatedOffer({ status: 'accepted' }));
    coFindItemsForOfferMock.mockResolvedValue([
      storedOfferItem({
        supplierQuoteId: 'sq-1',
        supplierQuoteItemId: 'sqi-1',
        supplierQuoteSupplierName: 'Supplier Co',
        supplierQuoteUnitPrice: 50,
      }),
    ]);
    sqFindByIdMock.mockResolvedValue({
      id: 'sq-1',
      supplierId: 'sup-1',
      supplierName: 'Supplier Co',
      paymentTerms: '30 days',
      expirationDate: '2999-12-31',
      linkedClientQuoteStatus: 'offer',
      linkedClientQuoteExpiration: '2999-12-31',
      linkedOfferStatus: 'accepted',
      linkedOfferExpiration: '2999-12-31',
      notes: 'supplier notes',
    });
    sqLockEffectiveStatusMock.mockResolvedValue({
      expirationDate: '2999-12-31',
      linkedClientStatus: 'offer',
      linkedClientQuoteExpiration: '2999-12-31',
      linkedOfferStatus: 'accepted',
      linkedOfferExpiration: '2999-12-31',
    });
    sqFindItemsForQuoteMock.mockResolvedValue([
      {
        id: 'sqi-1',
        productId: 'p-1',
        productName: 'Service',
        quantity: 2,
        unitPrice: 50,
        note: null,
        durationMonths: 1,
        durationUnit: 'months',
      },
    ]);
    allocateDocumentCodeMock.mockImplementation(async (moduleId: string) => {
      if (moduleId === 'client_order') return 'ORD-2999-0001';
      if (moduleId === 'supplier_order') {
        throw new realDocumentCodes.DocumentCodeCollisionError('supplier_order');
      }
      return 'OFF-2999-0001';
    });

    const res = await putOffer({ status: 'accepted' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).autoCreated).toEqual({
      clientOrder: { id: 'ORD-2999-0001' },
      supplierOrders: [],
    });
    expect(JSON.parse(res.body).warnings).toEqual([
      'Supplier order not created for supplier quote sq-1: unable to allocate a unique supplier order code',
    ]);
    expect(clientOrderCreateSupplierOrderMock).not.toHaveBeenCalled();
  });

  test('409 terminal offers keep the expiration date locked (they never expire)', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'accepted' }));

    const res = await putOffer({ expirationDate: '2999-12-31' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Non-draft');
    expect(coUpdateMock).not.toHaveBeenCalled();
  });

  test('terminal accepted offers never report expired even with a past date', async () => {
    coFindExistingMock.mockResolvedValue(
      gate({ status: 'accepted', expirationDate: '2000-01-01' }),
    );
    coUpdateMock.mockResolvedValue(
      updatedOffer({ status: 'accepted', expirationDate: '2000-01-01' }),
    );

    const res = await putOffer({ status: 'accepted' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).effectiveStatus).toBe('accepted');
  });

  test('400 rejects an unknown status spelling instead of hitting the DB CHECK constraint', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'draft' }));

    const res = await putOffer({ status: 'bogus' });
    expect(res.statusCode).toBe(400);
    expect(coUpdateMock).not.toHaveBeenCalled();
  });

  test("400 rejects the derived-only 'expired' round-tripped from a GET response", async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'draft' }));

    const res = await putOffer({ status: 'expired' });
    expect(res.statusCode).toBe(400);
    expect(coUpdateMock).not.toHaveBeenCalled();
  });

  test("400 rejects 'offer' (quote-pipeline-only status)", async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'draft' }));

    const res = await putOffer({ status: 'offer' });
    expect(res.statusCode).toBe(400);
    expect(coUpdateMock).not.toHaveBeenCalled();
  });

  test('200 folds a legacy spelling to canonical before the write', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'sent' }));
    coUpdateMock.mockResolvedValue(updatedOffer({ status: 'denied' }));

    const res = await putOffer({ status: 'rejected' });
    expect(res.statusCode).toBe(200);
    const patch = coUpdateMock.mock.calls[0][1] as { status: string | null };
    expect(patch.status).toBe('denied');
  });

  test('200 a legacy no-op resend on an expired offer writes the CANONICAL value, not the raw one', async () => {
    // 'received' normalizes to 'sent' — the freeze tolerates it as a no-op, and the write must
    // store the folded value or the CHECK constraint would 500.
    coFindExistingMock.mockResolvedValue(gate({ status: 'sent', expirationDate: '2000-01-01' }));
    coUpdateMock.mockResolvedValue(updatedOffer({ status: 'sent', expirationDate: '2000-01-01' }));

    const res = await putOffer({ status: 'received' });
    expect(res.statusCode).toBe(200);
    const patch = coUpdateMock.mock.calls[0][1] as { status: string | null };
    expect(patch.status).toBe('sent');
  });

  test('409 terminal accepted offers cannot flip to denied via a plain status PUT', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'accepted' }));

    const res = await putOffer({ status: 'denied' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('revert-to-draft');
    expect(coUpdateMock).not.toHaveBeenCalled();
  });

  test('409 terminal accepted offers cannot walk back to sent (two-step draft bypass)', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'accepted' }));

    const res = await putOffer({ status: 'sent' });
    expect(res.statusCode).toBe(409);
    expect(coUpdateMock).not.toHaveBeenCalled();
  });
});

describe('client-offers supplier-link resolution + forward sync (#779)', () => {
  const SUPPLIER_SNAPSHOT = new Map([
    [
      'sqi-9',
      {
        supplierQuoteId: 'sq-9',
        supplierName: 'Snapshot Co',
        productId: null,
        unitPrice: 50,
        netCost: 50,
      },
    ],
  ]);
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
  // The stored offer line whose link is being retained (qty 2 / cost 50 = in sync).
  const EXISTING_OFFER_ITEM = {
    id: 'oi-1',
    offerId: 'off-1',
    productId: null,
    productName: 'Service',
    quantity: 2,
    unitPrice: 100,
    productCost: 50,
    productMolPercentage: null,
    supplierQuoteId: 'sq-9',
    supplierQuoteItemId: 'sqi-9',
    supplierQuoteSupplierName: 'Snapshot Co',
    supplierQuoteUnitPrice: 50,
    unitType: 'hours',
    note: null,
    discount: 0,
    durationMonths: 1,
    durationUnit: 'months',
  };
  const lineItem = (quantity: number, cost: number | null, over: Record<string, unknown> = {}) => ({
    productName: 'Service',
    quantity,
    unitPrice: 100,
    productCost: 50,
    productMolPercentage: null,
    supplierQuoteId: 'sq-client-says',
    supplierQuoteItemId: 'sqi-9',
    supplierQuoteSupplierName: 'Client Says Co',
    supplierQuoteUnitPrice: cost,
    unitType: 'hours',
    discount: 0,
    durationMonths: 1,
    durationUnit: 'months',
    ...over,
  });

  const setupDraftOffer = () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'draft' }));
    coUpdateMock.mockResolvedValue(updatedOffer());
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(SUPPLIER_SNAPSHOT);
    sqFindItemsByIdsMock.mockResolvedValue([SUPPLIER_ITEM]);
    sqFindFullForSnapshotMock.mockResolvedValue({ quote: { id: 'sq-9' }, items: [SUPPLIER_ITEM] });
  };

  test('PUT: accepts the inclusive 100% line-discount boundary', async () => {
    setupDraftOffer();
    coFindItemsForOfferMock.mockResolvedValue([]);

    const res = await putOffer({ items: [lineItem(5, 80, { discount: 100 })] });

    expect(res.statusCode).toBe(200);
    const inserted = coReplaceItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(inserted[0].discount).toBe(100);
  });

  test('PUT: rejects a line discount above 100%', async () => {
    const res = await putOffer({ items: [lineItem(5, 80, { discount: 100.01 })] });

    expect(res.statusCode).toBe(400);
    expect(coReplaceItemsMock).not.toHaveBeenCalled();
  });

  test('PUT: a FRESH link stores server-resolved supplier values and never pushes', async () => {
    setupDraftOffer();
    coFindItemsForOfferMock.mockResolvedValue([]);

    const res = await putOffer({ items: [lineItem(5, 80)] });
    expect(res.statusCode).toBe(200);
    // Stored line takes the live supplier cost/metadata, not the client copy (stale cache).
    const inserted = coReplaceItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(inserted[0].supplierQuoteUnitPrice).toBe(50);
    expect(inserted[0].supplierQuoteId).toBe('sq-9');
    expect(inserted[0].supplierQuoteSupplierName).toBe('Snapshot Co');
    expect(sqSyncItemPricingMock).not.toHaveBeenCalled();
  });

  test('PUT: 400 when a NEW link does not resolve to a live supplier item', async () => {
    setupDraftOffer();
    coFindItemsForOfferMock.mockResolvedValue([]);
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(new Map());

    const res = await putOffer({ items: [lineItem(5, 80)] });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain(
      'does not reference an existing supplier quote item',
    );
    expect(coReplaceItemsMock).not.toHaveBeenCalled();
  });

  test('PUT: a genuine edit on a RETAINED link pushes onto the supplier item with a snapshot', async () => {
    setupDraftOffer();
    coFindItemsForOfferMock.mockResolvedValue([EXISTING_OFFER_ITEM]);

    const res = await putOffer({ items: [lineItem(5, 80)] });
    expect(res.statusCode).toBe(200);
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

  test('PUT: 400 when a retained link sends a negative supplierQuoteUnitPrice (#812)', async () => {
    // normalizeItems must reject a negative supplier cost up front; otherwise the #779 forward sync
    // would write it back onto the supplier quote item (negative supplier unit/list prices).
    setupDraftOffer();
    coFindItemsForOfferMock.mockResolvedValue([EXISTING_OFFER_ITEM]);

    const res = await putOffer({ items: [lineItem(5, -10)] });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('supplierQuoteUnitPrice');
    expect(coReplaceItemsMock).not.toHaveBeenCalled();
    expect(sqSyncItemPricingMock).not.toHaveBeenCalled();
  });

  test('PUT: re-saving a STALE snapshot does not revert direct supplier-side edits', async () => {
    // Supplier raised the item to 50 while the offer line still stores 40; resending the
    // stored values unchanged is NOT a client edit.
    setupDraftOffer();
    coFindItemsForOfferMock.mockResolvedValue([
      { ...EXISTING_OFFER_ITEM, supplierQuoteUnitPrice: 40 },
    ]);

    const res = await putOffer({ items: [lineItem(2, 40)] });
    expect(res.statusCode).toBe(200);
    expect(sqSyncItemPricingMock).not.toHaveBeenCalled();
    expect(sqvInsertMock).not.toHaveBeenCalled();
  });

  test('POST: create resolves fresh links from the live supplier item', async () => {
    cqFindStatusAndClientNameMock.mockResolvedValue({ status: 'accepted', clientName: 'Client' });
    cqLockCurrentByIdMock.mockResolvedValue({ status: 'accepted' });
    coFindExistingForQuoteMock.mockResolvedValue(null);
    coCreateMock.mockResolvedValue(updatedOffer());
    coInsertItemsMock.mockResolvedValue([]);
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(SUPPLIER_SNAPSHOT);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers',
      headers: authHeader(),
      payload: {
        id: 'off-1',
        linkedQuoteId: 'q-1',
        clientId: 'c1',
        clientName: 'Client',
        expirationDate: '2999-12-31',
        items: [lineItem(5, 80)],
      },
    });
    expect(res.statusCode).toBe(201);
    const inserted = coInsertItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(inserted[0].supplierQuoteUnitPrice).toBe(50);
    expect(inserted[0].supplierQuoteId).toBe('sq-9');
    expect(inserted[0].supplierQuoteSupplierName).toBe('Snapshot Co');
    expect(sqSyncItemPricingMock).not.toHaveBeenCalled();
  });

  test('POST: an accepted legacy single candidate can still create its first offer', async () => {
    const legacyCandidate = {
      id: 'q-1',
      quoteId: 'q-1',
      name: 'Variante A',
      position: 0,
      state: 'active',
      expirationDate: '2999-12-31',
    };
    cqFindStatusAndClientNameMock.mockResolvedValue({ status: 'accepted', clientName: 'Client' });
    cqLockCurrentByIdMock.mockResolvedValue({ status: 'accepted' });
    qcListForQuoteMock.mockResolvedValue([legacyCandidate]);
    coFindExistingForQuoteMock.mockResolvedValue(null);
    coCreateMock.mockResolvedValue(updatedOffer());
    coInsertItemsMock.mockResolvedValue([]);
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(SUPPLIER_SNAPSHOT);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers',
      headers: authHeader(),
      payload: {
        id: 'off-1',
        linkedQuoteId: 'q-1',
        clientId: 'c1',
        clientName: 'Client',
        expirationDate: '2999-12-31',
        items: [lineItem(5, 80)],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(coCreateMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ linkedQuoteCandidateId: expect.anything() }),
      expect.anything(),
    );
  });

  test('POST: a new multi-candidate family cannot bypass candidate promotion', async () => {
    cqFindStatusAndClientNameMock.mockResolvedValue({ status: 'accepted', clientName: 'Client' });
    qcListForQuoteMock.mockResolvedValue([
      { id: 'qc-a', quoteId: 'q-1', state: 'active' },
      { id: 'qc-b', quoteId: 'q-1', state: 'active' },
    ]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers',
      headers: authHeader(),
      payload: {
        id: 'off-1',
        linkedQuoteId: 'q-1',
        clientId: 'c1',
        clientName: 'Client',
        expirationDate: '2999-12-31',
        items: [lineItem(5, 80)],
      },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('candidate promotion');
    expect(coCreateMock).not.toHaveBeenCalled();
  });

  test('POST: blank offer id auto-generates from the centralized template', async () => {
    cqFindStatusAndClientNameMock.mockResolvedValue({ status: 'accepted', clientName: 'Client' });
    cqLockCurrentByIdMock.mockResolvedValue({ status: 'accepted' });
    coFindExistingForQuoteMock.mockResolvedValue(null);
    coCreateMock.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(updatedOffer({ id: input.id })),
    );
    coInsertItemsMock.mockResolvedValue([]);
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(SUPPLIER_SNAPSHOT);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers',
      headers: authHeader(),
      payload: {
        id: '',
        linkedQuoteId: 'q-1',
        clientId: 'c1',
        clientName: 'Client',
        expirationDate: '2999-12-31',
        items: [lineItem(5, 80)],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(allocateDocumentCodeMock).toHaveBeenCalledWith('client_offer', {
      exec: expect.anything(),
      sourceCode: 'q-1',
    });
    expect(coCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'OFF-2999-0001' }),
      expect.anything(),
    );
    expect(JSON.parse(res.body).id).toBe('OFF-2999-0001');
  });

  test('POST: blank offer id inherits the parseable source quote counter', async () => {
    cqFindStatusAndClientNameMock.mockResolvedValue({ status: 'accepted', clientName: 'Client' });
    cqLockCurrentByIdMock.mockResolvedValue({ status: 'accepted' });
    coFindExistingForQuoteMock.mockResolvedValue(null);
    coCreateMock.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(updatedOffer({ id: input.id, linkedQuoteId: input.linkedQuoteId })),
    );
    coInsertItemsMock.mockResolvedValue([]);
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(SUPPLIER_SNAPSHOT);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers',
      headers: authHeader(),
      payload: {
        id: '',
        linkedQuoteId: 'PREV_26_0045_manual',
        clientId: 'c1',
        clientName: 'Client',
        expirationDate: '2999-12-31',
        items: [lineItem(5, 80)],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(allocateDocumentCodeMock).toHaveBeenCalledWith('client_offer', {
      exec: expect.anything(),
      sourceCode: 'PREV_26_0045_manual',
    });
  });

  test('POST: a create-form edit away from the pick-time baseline is kept and pushed (user report after #812)', async () => {
    cqFindStatusAndClientNameMock.mockResolvedValue({ status: 'accepted', clientName: 'Client' });
    cqLockCurrentByIdMock.mockResolvedValue({ status: 'accepted' });
    coFindExistingForQuoteMock.mockResolvedValue(null);
    coCreateMock.mockResolvedValue(updatedOffer());
    coInsertItemsMock.mockResolvedValue([]);
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(SUPPLIER_SNAPSHOT);
    sqFindItemsByIdsMock.mockResolvedValue([SUPPLIER_ITEM]);
    sqFindFullForSnapshotMock.mockResolvedValue({ quote: { id: 'sq-9' }, items: [SUPPLIER_ITEM] });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/client-offers',
      headers: authHeader(),
      payload: {
        id: 'off-1',
        linkedQuoteId: 'q-1',
        clientId: 'c1',
        clientName: 'Client',
        expirationDate: '2999-12-31',
        items: [lineItem(5, 80, { supplierQuoteBaseQuantity: 2, supplierQuoteBaseUnitPrice: 50 })],
      },
    });
    expect(res.statusCode).toBe(201);
    // The deliberately edited cost survives onto the stored line and pushes onto the supplier
    // item atomically, mirroring the client-quotes create path.
    const inserted = coInsertItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(inserted[0].supplierQuoteUnitPrice).toBe(80);
    expect(sqSyncItemPricingMock).toHaveBeenCalledTimes(1);
    expect(sqSyncItemPricingMock.mock.calls[0][0]).toBe('sq-9');
    expect(sqSyncItemPricingMock.mock.calls[0][1]).toEqual([
      { itemId: 'sqi-9', quantity: 5, unitCost: 80, discountPercent: 20 },
    ]);
    expect(sqvInsertMock).toHaveBeenCalledTimes(1);
  });
});

describe('PUT /api/sales/client-offers/:id fresh-link sourceable guard (#812 round 15)', () => {
  const FROZEN_SNAPSHOT = new Map([
    [
      'sqi-9',
      {
        supplierQuoteId: 'sq-9',
        supplierName: 'Snapshot Co',
        productId: null,
        unitPrice: 50,
        netCost: 50,
        sourceable: false,
      },
    ],
  ]);
  const sourcedLine = () => ({
    productName: 'Service',
    quantity: 1,
    unitPrice: 100,
    productCost: 50,
    supplierQuoteItemId: 'sqi-9',
    supplierQuoteUnitPrice: 50,
    discount: 0,
    unitType: 'hours',
    durationMonths: 1,
    durationUnit: 'months',
  });

  test('400 when a FRESH link references a quote no longer offered for sourcing', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'draft' }));
    coFindItemsForOfferMock.mockResolvedValue([]);
    cqFindItemSnapshotsForQuoteMock.mockResolvedValue([]);
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(FROZEN_SNAPSHOT);

    const res = await putOffer({ items: [sourcedLine()] });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('no longer available for new sourcing');
    expect(coReplaceItemsMock).not.toHaveBeenCalled();
  });

  test('200 when the link is INHERITED from the linked quote (conversion copy)', async () => {
    // Offers are created by converting a quote whose supplier quote already derives
    // offer/accepted; re-adding a line the linked quote sources must keep working.
    coFindExistingMock.mockResolvedValue(gate({ status: 'draft' }));
    coFindItemsForOfferMock.mockResolvedValue([]);
    cqFindItemSnapshotsForQuoteMock.mockResolvedValue([
      { id: 'qi-1', supplierQuoteId: 'sq-9', supplierQuoteItemId: 'sqi-9' },
    ]);
    sqGetQuoteItemSnapshotsMock.mockResolvedValue(FROZEN_SNAPSHOT);
    coUpdateMock.mockResolvedValue(updatedOffer());
    coReplaceItemsMock.mockResolvedValue([]);

    const res = await putOffer({ items: [sourcedLine()] });
    expect(res.statusCode).toBe(200);
    expect(coReplaceItemsMock).toHaveBeenCalled();
  });
});

describe('DELETE /api/sales/client-offers/:id expired guard (#812 round 25)', () => {
  const deleteOffer = () =>
    testApp.inject({
      method: 'DELETE',
      url: '/api/sales/client-offers/off-1',
      headers: authHeader(),
    });

  test('409 when a draft offer is effectively expired (read-only model)', async () => {
    getRolePermissionsMock.mockResolvedValue(['sales.client_offers.delete']);
    coFindLinkedSaleIdMock.mockResolvedValue(null);
    const expiredOffer = gate({ status: 'draft', expirationDate: '2000-01-01' });
    coFindExistingMock.mockResolvedValue(expiredOffer);
    coLockExistingByIdMock.mockResolvedValue(expiredOffer);

    const res = await deleteOffer();
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Expired offers are read-only');
  });

  test('204 deletes a live draft offer', async () => {
    getRolePermissionsMock.mockResolvedValue(['sales.client_offers.delete']);
    coFindLinkedSaleIdMock.mockResolvedValue(null);
    coFindExistingMock.mockResolvedValue(gate({ status: 'draft', expirationDate: '2999-12-31' }));
    coLockExistingByIdMock.mockResolvedValue(
      gate({ status: 'draft', expirationDate: '2999-12-31' }),
    );
    coDeleteByIdMock.mockResolvedValue(true);

    const res = await deleteOffer();
    expect(res.statusCode).toBe(204);
  });

  test('204 deleting a candidate-linked draft offer rolls the quote family back atomically', async () => {
    getRolePermissionsMock.mockResolvedValue(['sales.client_offers.delete']);
    const candidateOffer = gate({ linkedQuoteCandidateId: 'qc-a' });
    const selectedCandidate = {
      id: 'qc-a',
      quoteId: 'q-1',
      name: 'Variante A',
      position: 0,
      state: 'selected',
      paymentTerms: '60gg',
      discount: 5,
      discountType: 'percentage',
      expirationDate: '2999-12-31',
      communicationChannelId: 'qcc_email',
      communicationChannelName: 'Email',
      notes: 'winner',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    };
    coFindExistingMock.mockResolvedValue(candidateOffer);
    coLockExistingByIdMock.mockResolvedValue(candidateOffer);
    coFindLinkedSaleIdMock.mockResolvedValue(null);
    cqLockCurrentByIdMock.mockResolvedValue({ status: 'offer' });
    cqFindFullForSnapshotMock.mockResolvedValue({
      quote: { id: 'q-1', status: 'offer' },
      items: [],
    });
    qcListForQuoteMock.mockResolvedValue([selectedCandidate]);
    cqUpdateMock.mockResolvedValue({ id: 'q-1', status: 'draft' });
    coDeleteByIdMock.mockResolvedValue(true);

    const res = await deleteOffer();

    expect(res.statusCode).toBe(204);
    expect(qvInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ quoteId: 'q-1', reason: 'update', createdByUserId: 'u1' }),
      expect.anything(),
    );
    expect(qcReactivateAllMock).toHaveBeenCalledWith('q-1', expect.anything());
    expect(cqUpdateMock).toHaveBeenCalledWith(
      'q-1',
      expect.objectContaining({ status: 'draft', paymentTerms: '60gg' }),
      expect.anything(),
    );
  });

  test('409 deleting an expired candidate-linked offer does not roll the family back', async () => {
    getRolePermissionsMock.mockResolvedValue(['sales.client_offers.delete']);
    const expiredCandidateOffer = gate({
      linkedQuoteCandidateId: 'qc-a',
      expirationDate: '2000-01-01',
    });
    coFindExistingMock.mockResolvedValue(expiredCandidateOffer);
    coLockExistingByIdMock.mockResolvedValue(expiredCandidateOffer);
    cqLockCurrentByIdMock.mockResolvedValue({ status: 'offer' });

    const res = await deleteOffer();

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Expired offers are read-only');
    expect(coDeleteByIdMock).not.toHaveBeenCalled();
    expect(qcReactivateAllMock).not.toHaveBeenCalled();
  });

  test('409 candidate rollback rechecks linked orders after locking the offer', async () => {
    getRolePermissionsMock.mockResolvedValue(['sales.client_offers.delete']);
    const candidateOffer = gate({ linkedQuoteCandidateId: 'qc-a' });
    coFindExistingMock.mockResolvedValue(candidateOffer);
    coLockExistingByIdMock.mockResolvedValue(candidateOffer);
    cqLockCurrentByIdMock.mockResolvedValue({ status: 'offer' });
    coFindLinkedSaleIdMock.mockResolvedValue('order-1');

    const res = await deleteOffer();

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('sale order');
    expect(coDeleteByIdMock).not.toHaveBeenCalled();
    expect(qcReactivateAllMock).not.toHaveBeenCalled();
  });
});
