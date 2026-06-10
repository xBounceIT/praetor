import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realClientOffersRepo from '../../repositories/clientOffersRepo.ts';
import * as realClientQuotesRepo from '../../repositories/clientQuotesRepo.ts';
import * as realClientsRepo from '../../repositories/clientsRepo.ts';
import * as realOfferVersionsRepo from '../../repositories/offerVersionsRepo.ts';
import * as realProductsRepo from '../../repositories/productsRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realSupplierQuotesRepo from '../../repositories/supplierQuotesRepo.ts';
import * as realSupplierQuoteVersionsRepo from '../../repositories/supplierQuoteVersionsRepo.ts';
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

// Issue #779 (extended to offers): focused coverage of the PUT expired rules — the derived
// `effectiveStatus`, expired content-read-only-except-date, the expired status freeze, and the
// expiration-date carve-out from the non-draft lock (terminal offers stay fully frozen).

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const clientsRepoSnap = { ...realClientsRepo };
const clientOffersRepoSnap = { ...realClientOffersRepo };
const clientQuotesRepoSnap = { ...realClientQuotesRepo };
const productsRepoSnap = { ...realProductsRepo };
const offerVersionsRepoSnap = { ...realOfferVersionsRepo };
const supplierQuotesRepoSnap = { ...realSupplierQuotesRepo };
const supplierQuoteVersionsRepoSnap = { ...realSupplierQuoteVersionsRepo };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const coFindExistingMock = mock();
const coFindFullForSnapshotMock = mock();
const coFindItemsForOfferMock = mock();
const coFindIdConflictMock = mock();
const coUpdateMock = mock();
const coRenameMock = mock();
const coReplaceItemsMock = mock();
const coCreateMock = mock();
const coInsertItemsMock = mock();
const coFindExistingForQuoteMock = mock();

const cqFindStatusAndClientNameMock = mock();
const cqLockCurrentByIdMock = mock();

const sqGetQuoteItemSnapshotsMock = mock();
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
    findFullForSnapshot: coFindFullForSnapshotMock,
    findItemsForOffer: coFindItemsForOfferMock,
    findIdConflict: coFindIdConflictMock,
    update: coUpdateMock,
    rename: coRenameMock,
    replaceItems: coReplaceItemsMock,
    create: coCreateMock,
    insertItems: coInsertItemsMock,
    findExistingForQuote: coFindExistingForQuoteMock,
  }));
  mock.module('../../repositories/clientQuotesRepo.ts', () => ({
    ...clientQuotesRepoSnap,
    findStatusAndClientName: cqFindStatusAndClientNameMock,
    lockCurrentById: cqLockCurrentByIdMock,
  }));
  mock.module('../../repositories/supplierQuotesRepo.ts', () => ({
    ...supplierQuotesRepoSnap,
    getQuoteItemSnapshots: sqGetQuoteItemSnapshotsMock,
    findItemsByIds: sqFindItemsByIdsMock,
    findLinkedOrderId: sqFindLinkedOrderIdMock,
    lockEffectiveStatusById: sqLockEffectiveStatusMock,
    syncItemPricing: sqSyncItemPricingMock,
    findFullForSnapshot: sqFindFullForSnapshotMock,
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
  mock.module('../../repositories/supplierQuotesRepo.ts', () => supplierQuotesRepoSnap);
  mock.module(
    '../../repositories/supplierQuoteVersionsRepo.ts',
    () => supplierQuoteVersionsRepoSnap,
  );
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

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  coFindExistingMock,
  coFindFullForSnapshotMock,
  coFindItemsForOfferMock,
  coFindIdConflictMock,
  coUpdateMock,
  coRenameMock,
  coReplaceItemsMock,
  coCreateMock,
  coInsertItemsMock,
  coFindExistingForQuoteMock,
  cqFindStatusAndClientNameMock,
  cqLockCurrentByIdMock,
  sqGetQuoteItemSnapshotsMock,
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

  // Sensible defaults; individual tests override what they care about.
  coFindFullForSnapshotMock.mockResolvedValue({ offer: updatedOffer(), items: [] });
  coFindItemsForOfferMock.mockResolvedValue([]);
  coFindIdConflictMock.mockResolvedValue(false);
  ovInsertMock.mockResolvedValue(undefined);
  // Supplier resolution / forward-sync defaults: nothing linked, nothing pushed.
  coReplaceItemsMock.mockResolvedValue([]);
  sqGetQuoteItemSnapshotsMock.mockResolvedValue(new Map());
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

  test('200 a valid sent offer can renew its expiration date (date carved out of the lock)', async () => {
    coFindExistingMock.mockResolvedValue(gate({ status: 'sent' }));
    coUpdateMock.mockResolvedValue(updatedOffer({ status: 'sent', expirationDate: '2999-12-31' }));

    const res = await putOffer({ expirationDate: '2999-12-31' });
    expect(res.statusCode).toBe(200);
    expect(coUpdateMock).toHaveBeenCalledTimes(1);
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
});
