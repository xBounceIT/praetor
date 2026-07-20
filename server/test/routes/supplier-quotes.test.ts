import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realClientsRepo from '../../repositories/clientsRepo.ts';
import * as realQuoteCommunicationChannelsRepo from '../../repositories/quoteCommunicationChannelsRepo.ts';
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

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const supplierQuotesRepoSnap = { ...realSupplierQuotesRepo };
const supplierQuoteVersionsRepoSnap = { ...realSupplierQuoteVersionsRepo };
const quoteCommunicationChannelsRepoSnap = { ...realQuoteCommunicationChannelsRepo };
const clientsRepoSnap = { ...realClientsRepo };
const documentCodesSnap = { ...realDocumentCodes };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const clientsFindNameMock = mock();

const sqFindByIdMock = mock();
const sqFindLinkedOrderIdMock = mock();
const sqFindIdConflictMock = mock();
const sqFindFullForSnapshotMock = mock();
const sqFindItemsForQuoteMock = mock();
const sqUpdateMock = mock();
const sqRenameMock = mock();
const sqReplaceItemsMock = mock();
const sqUpsertItemsMock = mock();
const sqIsSourcedByClientDocumentsMock = mock();
const sqFindSourcedItemIdsMock = mock();
const sqCreateMock = mock();
const sqInsertItemsMock = mock();

const qccFindByIdMock = mock();

const sqvInsertMock = mock();
const sqvBuildSnapshotMock = mock();
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
  mock.module('../../repositories/supplierQuotesRepo.ts', () => ({
    ...supplierQuotesRepoSnap,
    findById: sqFindByIdMock,
    findLinkedOrderId: sqFindLinkedOrderIdMock,
    findIdConflict: sqFindIdConflictMock,
    findFullForSnapshot: sqFindFullForSnapshotMock,
    findItemsForQuote: sqFindItemsForQuoteMock,
    update: sqUpdateMock,
    rename: sqRenameMock,
    replaceItems: sqReplaceItemsMock,
    upsertItems: sqUpsertItemsMock,
    isSourcedByClientDocuments: sqIsSourcedByClientDocumentsMock,
    findSourcedItemIds: sqFindSourcedItemIdsMock,
    create: sqCreateMock,
    insertItems: sqInsertItemsMock,
  }));
  mock.module('../../repositories/supplierQuoteVersionsRepo.ts', () => ({
    ...supplierQuoteVersionsRepoSnap,
    insert: sqvInsertMock,
    buildSnapshot: sqvBuildSnapshotMock,
  }));
  mock.module('../../repositories/quoteCommunicationChannelsRepo.ts', () => ({
    ...quoteCommunicationChannelsRepoSnap,
    findById: qccFindByIdMock,
  }));
  mock.module('../../repositories/clientsRepo.ts', () => ({
    ...clientsRepoSnap,
    findName: clientsFindNameMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));
  mock.module('../../services/documentCodes.ts', () => ({
    ...documentCodesSnap,
    allocateDocumentCode: allocateDocumentCodeMock,
    reserveDocumentCodeCounterFromCode: reserveDocumentCodeCounterFromCodeMock,
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
  mock.module('../../repositories/supplierQuotesRepo.ts', () => supplierQuotesRepoSnap);
  mock.module(
    '../../repositories/supplierQuoteVersionsRepo.ts',
    () => supplierQuoteVersionsRepoSnap,
  );
  mock.module(
    '../../repositories/quoteCommunicationChannelsRepo.ts',
    () => quoteCommunicationChannelsRepoSnap,
  );
  mock.module('../../repositories/clientsRepo.ts', () => clientsRepoSnap);
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

const FULL_PERMS = [
  'sales.supplier_quotes.view',
  'sales.supplier_quotes.create',
  'sales.supplier_quotes.update',
  'sales.supplier_quotes.delete',
];

const DRAFT_QUOTE = {
  id: 'sq-1',
  supplierId: 's1',
  supplierName: 'Acme',
  paymentTerms: 'immediate',
  status: 'draft',
  // Far future: effective-status guards compare against the real clock, so a near date would flip
  // this fixture to `expired` one day and break the suite (#779 second-pass review).
  expirationDate: '2999-12-31',
  communicationChannelId: 'qcc_email',
  communicationChannelName: 'Email',
  linkedOrderId: null,
  notes: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  // The real findById always materializes the reverse-lookup link fields (null when unlinked);
  // fixtures must too, or `linkedClientQuoteId !== null` reads `undefined !== null` → true.
  linkedClientQuoteId: null as string | null,
  linkedClientQuoteStatus: null as string | null,
  linkedClientQuoteExpiration: null as string | null,
  linkedOfferStatus: null as string | null,
  linkedOfferExpiration: null as string | null,
};

const SAMPLE_ITEM = {
  id: 'sqi-1',
  quoteId: 'sq-1',
  productId: 'p-1',
  productName: 'Service',
  quantity: 2,
  listPrice: 100,
  discountPercent: 0,
  unitPrice: 100,
  note: null,
  unitType: 'unit' as const,
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  clientsFindNameMock,
  sqFindByIdMock,
  sqFindLinkedOrderIdMock,
  sqFindIdConflictMock,
  sqFindFullForSnapshotMock,
  sqFindItemsForQuoteMock,
  sqUpdateMock,
  sqRenameMock,
  sqReplaceItemsMock,
  qccFindByIdMock,
  sqUpsertItemsMock,
  sqIsSourcedByClientDocumentsMock,
  sqFindSourcedItemIdsMock,
  sqCreateMock,
  sqInsertItemsMock,
  sqvInsertMock,
  sqvBuildSnapshotMock,
  allocateDocumentCodeMock,
  reserveDocumentCodeCounterFromCodeMock,
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
  sqvBuildSnapshotMock.mockImplementation((quote, items) => ({
    schemaVersion: 1,
    quote,
    items,
  }));
  sqFindItemsForQuoteMock.mockResolvedValue([SAMPLE_ITEM]);
  sqFindIdConflictMock.mockResolvedValue(false);
  qccFindByIdMock.mockResolvedValue({ id: 'qcc_email', name: 'Email' });
  // Default: the quote is not sourced by any client line, so item edits on a draft are allowed.
  sqIsSourcedByClientDocumentsMock.mockResolvedValue(false);
  sqFindSourcedItemIdsMock.mockResolvedValue(new Set<string>());
  sqUpsertItemsMock.mockResolvedValue([SAMPLE_ITEM]);
  sqCreateMock.mockImplementation((input: Record<string, unknown>) =>
    Promise.resolve({ ...DRAFT_QUOTE, ...input }),
  );
  sqInsertItemsMock.mockImplementation((quoteId: string) =>
    Promise.resolve([{ ...SAMPLE_ITEM, quoteId }]),
  );
  allocateDocumentCodeMock.mockResolvedValue('FORN-2999-0001');
  reserveDocumentCodeCounterFromCodeMock.mockResolvedValue(false);
  // snapshotPreState calls findFullForSnapshot; default to the current draft so the
  // pre-save snapshot path doesn't crash on tests that update content.
  sqFindFullForSnapshotMock.mockResolvedValue({ quote: DRAFT_QUOTE, items: [SAMPLE_ITEM] });

  testApp = await buildRouteTestApp(routePlugin, '/api/sales/supplier-quotes');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

const CREATE_PAYLOAD = {
  id: 'sq-new',
  supplierId: 's1',
  supplierName: 'Acme',
  clientId: null,
  expirationDate: '2026-12-31',
  communicationChannelId: 'qcc_email',
  items: [
    {
      productName: 'Service',
      quantity: 1,
      listPrice: 100,
      discountPercent: 0,
    },
  ],
};

describe('POST /api/sales/supplier-quotes', () => {
  test('400 requires communication channel on create', async () => {
    const { communicationChannelId: _omitted, ...payload } = CREATE_PAYLOAD;

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes',
      headers: authHeader(),
      payload,
    });

    expect(res.statusCode).toBe(400);
    expect(qccFindByIdMock).not.toHaveBeenCalled();
  });

  test('400 rejects unknown communication channel on create', async () => {
    qccFindByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes',
      headers: authHeader(),
      payload: { ...CREATE_PAYLOAD, communicationChannelId: 'qcc_missing' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'communicationChannelId does not reference an existing channel',
    });
  });

  test('201 auto-generates a blank quote id from the centralized template', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes',
      headers: authHeader(),
      payload: { ...CREATE_PAYLOAD, id: '' },
    });

    expect(res.statusCode).toBe(201);
    expect(allocateDocumentCodeMock).toHaveBeenCalledWith('supplier_quote', {
      exec: expect.anything(),
    });
    expect(sqCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'FORN-2999-0001' }),
      expect.anything(),
    );
    expect(JSON.parse(res.body).id).toBe('FORN-2999-0001');
  });

  test('201 reserves a caller-supplied parseable quote id', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes',
      headers: authHeader(),
      payload: { ...CREATE_PAYLOAD, id: 'FORN_26_0045_manual' },
    });

    expect(res.statusCode).toBe(201);
    expect(allocateDocumentCodeMock).not.toHaveBeenCalled();
    expect(reserveDocumentCodeCounterFromCodeMock).toHaveBeenCalledWith(
      'supplier_quote',
      'FORN_26_0045_manual',
      expect.anything(),
    );
  });

  test('201 preserves a caller-supplied quote id', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes',
      headers: authHeader(),
      payload: CREATE_PAYLOAD,
    });

    expect(res.statusCode).toBe(201);
    expect(allocateDocumentCodeMock).not.toHaveBeenCalled();
    expect(sqCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sq-new' }),
      expect.anything(),
    );
  });

  test('400 rejects a manual quote id that is unsafe in a URL path segment', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/sales/supplier-quotes',
      headers: authHeader(),
      payload: { ...CREATE_PAYLOAD, id: '../../products/prod-9' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Bad Request' });
    expect(sqCreateMock).not.toHaveBeenCalled();
  });
});

describe('PUT /api/sales/supplier-quotes/:id', () => {
  test('400 rejects an explicitly blank communication channel on update', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { communicationChannelId: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'communicationChannelId is required' });
    expect(qccFindByIdMock).not.toHaveBeenCalled();
    expect(sqUpdateMock).not.toHaveBeenCalled();
  });

  test('200 updates a draft quote with content edits', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue({ ...DRAFT_QUOTE, paymentTerms: '30 days' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { paymentTerms: '30 days' },
    });

    expect(res.statusCode).toBe(200);
    expect(sqUpdateMock).toHaveBeenCalledTimes(1);
    expect(sqUpdateMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ paymentTerms: '30 days' }),
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'supplier_quote.updated' }),
    );
  });

  test('409 rejects content edits when the derived status is non-draft', async () => {
    // Status is fully derived (#779): only a LINKED quote can be non-draft.
    sqFindByIdMock.mockResolvedValue({
      ...DRAFT_QUOTE,
      linkedClientQuoteId: 'q-1',
      linkedClientQuoteStatus: 'sent',
    });
    sqFindLinkedOrderIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            productName: 'Service',
            quantity: 3,
            unitPrice: 50,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Non-draft supplier quotes are read-only',
    });
    expect(sqUpdateMock).not.toHaveBeenCalled();
    expect(sqUpsertItemsMock).not.toHaveBeenCalled();
  });

  test('200 allows an in-place pricing edit of a sourced item — the id is preserved (user report after #812)', async () => {
    // The original #812 guard refused ANY items payload on a sourced quote, which also blocked a
    // plain cost edit. Identity-preserving updates keep the persisted item id (the client lines'
    // soft references stay attached), so the edit goes through upsertItems instead.
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqFindSourcedItemIdsMock.mockResolvedValue(new Set(['sqi-1']));
    sqUpdateMock.mockResolvedValue(DRAFT_QUOTE);
    sqUpsertItemsMock.mockResolvedValue([{ ...SAMPLE_ITEM, unitPrice: 120, listPrice: 120 }]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: {
        items: [
          { id: 'sqi-1', productId: 'p-1', productName: 'Service', quantity: 2, unitPrice: 120 },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(sqUpsertItemsMock).toHaveBeenCalledTimes(1);
    const upserted = sqUpsertItemsMock.mock.calls[0]?.[1];
    expect(upserted).toHaveLength(1);
    expect(upserted[0]).toEqual(
      expect.objectContaining({ id: 'sqi-1', unitPrice: 120, productId: 'p-1' }),
    );
    expect(sqReplaceItemsMock).not.toHaveBeenCalled();
  });

  test('re-mints a foreign or placeholder incoming item id instead of trusting it', async () => {
    // tmp-* form placeholders (and ids belonging to other quotes) must not be persisted verbatim:
    // only ids matching one of THIS quote's items keep their identity.
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue(DRAFT_QUOTE);
    sqUpsertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: {
        items: [
          { id: 'sqi-1', productId: 'p-1', productName: 'Service', quantity: 2, unitPrice: 100 },
          { id: 'tmp-1749600000000', productName: 'New line', quantity: 1, unitPrice: 10 },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const upserted = sqUpsertItemsMock.mock.calls[0]?.[1];
    expect(upserted[0].id).toBe('sqi-1');
    expect(upserted[1].id).not.toBe('tmp-1749600000000');
    expect(upserted[1].id).toBeTruthy();
  });

  test('409 blocks removing an item that client lines reference (#779)', async () => {
    // Deleting a referenced supplier_quote_items row would strand the client lines' soft
    // supplierQuoteItemId references — the one items shape (besides a product repoint) that is
    // still refused, mirroring the DELETE route's guard.
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqFindSourcedItemIdsMock.mockResolvedValue(new Set(['sqi-1']));

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { items: [{ productName: 'Service', quantity: 3, unitPrice: 50 }] },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Cannot remove supplier quote items that are used by client quotes, offers or orders',
    });
    expect(sqFindSourcedItemIdsMock).toHaveBeenCalledWith('sq-1');
    expect(sqUpsertItemsMock).not.toHaveBeenCalled();
    expect(sqReplaceItemsMock).not.toHaveBeenCalled();
    expect(sqUpdateMock).not.toHaveBeenCalled();
  });

  test('200 allows removing an UNREFERENCED item while a referenced one is kept', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqFindItemsForQuoteMock.mockResolvedValue([
      SAMPLE_ITEM,
      { ...SAMPLE_ITEM, id: 'sqi-2', productName: 'Extra' },
    ]);
    sqFindSourcedItemIdsMock.mockResolvedValue(new Set(['sqi-1']));
    sqUpdateMock.mockResolvedValue(DRAFT_QUOTE);
    sqUpsertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: {
        items: [
          { id: 'sqi-1', productId: 'p-1', productName: 'Service', quantity: 2, unitPrice: 100 },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(sqUpsertItemsMock).toHaveBeenCalledTimes(1);
  });

  test('409 blocks repointing a referenced item to a different product', async () => {
    // The client-line snapshot resolver hard-fails on a product mismatch, so changing the product
    // of a referenced item would poison the next edit of every client document using it.
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqFindSourcedItemIdsMock.mockResolvedValue(new Set(['sqi-1']));

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            id: 'sqi-1',
            productId: 'p-OTHER',
            productName: 'Service',
            quantity: 2,
            unitPrice: 100,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error:
        'Cannot change the product of supplier quote items that are used by client quotes, offers or orders',
    });
    expect(sqUpsertItemsMock).not.toHaveBeenCalled();
    expect(sqUpdateMock).not.toHaveBeenCalled();
  });

  test('200 allows header-only edits on a sourced quote and skips the sourcing lookup', async () => {
    // Header edits (payment terms, notes, expiration, client) never touch supplier_quote_items
    // ids, so they stay allowed even when sourced — and the route skips the lookup entirely.
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqIsSourcedByClientDocumentsMock.mockResolvedValue(true);
    sqUpdateMock.mockResolvedValue({ ...DRAFT_QUOTE, paymentTerms: '30 days' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { paymentTerms: '30 days' },
    });

    expect(res.statusCode).toBe(200);
    expect(sqIsSourcedByClientDocumentsMock).not.toHaveBeenCalled();
    expect(sqUpdateMock).toHaveBeenCalledTimes(1);
  });

  test('409 blocks an id rename of a sourced quote (#812)', async () => {
    // A pure id rename (no items) must also be refused on a sourced quote: quote_items'
    // supplier_quote_id is a soft, FK-less reference that would not follow the rename, stranding
    // the client lines from the derived-status and progression/expiration guards.
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqFindIdConflictMock.mockResolvedValue(false);
    sqIsSourcedByClientDocumentsMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { id: 'sq-renamed' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe(
      'Cannot change the id of a supplier quote whose items are used by client quotes, offers or orders',
    );
    expect(sqIsSourcedByClientDocumentsMock).toHaveBeenCalledWith('sq-1');
    expect(sqRenameMock).not.toHaveBeenCalled();
    expect(sqUpdateMock).not.toHaveBeenCalled();
  });

  test('200 reserves a parseable renamed quote id', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqFindIdConflictMock.mockResolvedValue(false);
    sqIsSourcedByClientDocumentsMock.mockResolvedValue(false);
    sqRenameMock.mockResolvedValue({ ...DRAFT_QUOTE, id: 'FORN_26_0046_manual' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { id: 'FORN_26_0046_manual' },
    });

    expect(res.statusCode).toBe(200);
    expect(reserveDocumentCodeCounterFromCodeMock).toHaveBeenCalledWith(
      'supplier_quote',
      'FORN_26_0046_manual',
      expect.anything(),
    );
  });

  test('400 rejects renaming a quote to an id that is unsafe in a URL path segment', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { id: '../products/prod-9' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'id can only contain letters, numbers, underscores, and hyphens',
    });
    expect(sqFindByIdMock).not.toHaveBeenCalled();
    expect(sqRenameMock).not.toHaveBeenCalled();
  });

  test('200 keeps an unchanged legacy quote id operable through an encoded path segment', async () => {
    const legacyId = 'legacy/../supplier-quote';
    const legacyQuote = { ...DRAFT_QUOTE, id: legacyId };
    sqFindByIdMock.mockResolvedValue(legacyQuote);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue({ ...legacyQuote, notes: 'updated' });
    sqFindItemsForQuoteMock.mockResolvedValue([{ ...SAMPLE_ITEM, quoteId: legacyId }]);

    const res = await testApp.inject({
      method: 'PUT',
      url: `/api/sales/supplier-quotes/${encodeURIComponent(legacyId)}`,
      headers: authHeader(),
      payload: { id: legacyId, notes: 'updated' },
    });

    expect(res.statusCode).toBe(200);
    expect(sqFindByIdMock).toHaveBeenCalledWith(legacyId);
    expect(sqRenameMock).not.toHaveBeenCalled();
  });

  test('200 keeps dot-only and marker-like legacy ids distinct and operable', async () => {
    for (const [legacyId, routeSegment] of [
      ['..', '@..'],
      ['@..', '@@..'],
    ] as const) {
      const legacyQuote = { ...DRAFT_QUOTE, id: legacyId };
      sqFindByIdMock.mockClear();
      sqFindByIdMock.mockResolvedValue(legacyQuote);
      sqFindLinkedOrderIdMock.mockResolvedValue(null);
      sqUpdateMock.mockResolvedValue({ ...legacyQuote, notes: 'updated' });
      sqFindItemsForQuoteMock.mockResolvedValue([{ ...SAMPLE_ITEM, quoteId: legacyId }]);

      const res = await testApp.inject({
        method: 'PUT',
        url: `/api/sales/supplier-quotes/${encodeURIComponent(routeSegment)}`,
        headers: authHeader(),
        payload: { id: legacyId, notes: 'updated' },
      });

      expect(res.statusCode).toBe(200);
      expect(sqFindByIdMock).toHaveBeenCalledWith(legacyId);
      expect(sqRenameMock).not.toHaveBeenCalled();
    }
  });

  test('409 rejects supplier reassignment when the derived status is accepted', async () => {
    sqFindByIdMock.mockResolvedValue({
      ...DRAFT_QUOTE,
      linkedClientQuoteId: 'q-1',
      linkedClientQuoteStatus: 'accepted',
    });
    sqFindLinkedOrderIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { supplierId: 's-other', supplierName: 'Other Co' },
    });

    expect(res.statusCode).toBe(409);
    expect(sqUpdateMock).not.toHaveBeenCalled();
  });

  test('200 ignores a client-sent status entirely — the status is fully derived (#779)', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindItemsForQuoteMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { status: 'accepted' },
    });

    expect(res.statusCode).toBe(200);
    // Nothing written, nothing snapshotted: status is not a content field anymore.
    expect(sqUpdateMock.mock.calls[0]?.[1]).toEqual({});
    expect(sqvInsertMock).not.toHaveBeenCalled();
    // The response carries the DERIVED status: unlinked → draft.
    expect(JSON.parse(res.body).status).toBe('draft');
  });

  test('200 a linked quote ignores status too — no more synced-status 409 (#779)', async () => {
    sqFindByIdMock.mockResolvedValue({
      ...DRAFT_QUOTE,
      linkedClientQuoteId: 'q-1',
      linkedClientQuoteStatus: 'sent',
    });
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindItemsForQuoteMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { status: 'draft' },
    });

    expect(res.statusCode).toBe(200);
    expect(sqUpdateMock.mock.calls[0]?.[1]).toEqual({});
    expect(JSON.parse(res.body).status).toBe('sent');
  });

  test('409 rejects ID rename when a linked order exists', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue('ss-1');

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { id: 'sq-renamed' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Quotes become read-only once an order exists',
    });
    expect(sqUpdateMock).not.toHaveBeenCalled();
  });

  test('409 rejects content edits when a linked order exists', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue('ss-1');

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { paymentTerms: '30 days' },
    });

    expect(res.statusCode).toBe(409);
    expect(sqUpdateMock).not.toHaveBeenCalled();
  });

  // When a non-draft quote has both a content edit AND a conflicting id rename, the
  // read-only guard runs first and the response surfaces that as the reason. The
  // id-conflict 409 from the surviving idConflict branch should NEVER appear in this
  // case - asserting the response copy locks in the precedence order.
  test('409 read-only guard takes precedence over id-conflict on a non-draft quote', async () => {
    sqFindByIdMock.mockResolvedValue({
      ...DRAFT_QUOTE,
      linkedClientQuoteId: 'q-1',
      linkedClientQuoteStatus: 'sent',
    });
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqFindIdConflictMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { id: 'sq-other', paymentTerms: '30 days' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Non-draft supplier quotes are read-only',
    });
    expect(sqUpdateMock).not.toHaveBeenCalled();
  });

  test('404 when quote does not exist', async () => {
    sqFindByIdMock.mockResolvedValue(null);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/missing',
      headers: authHeader(),
      payload: { paymentTerms: '30 days' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Supplier quote not found' });
    expect(sqUpdateMock).not.toHaveBeenCalled();
  });

  test('200 derives net unit cost (Costo unitario) from list price and discount', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue(DRAFT_QUOTE);
    sqUpsertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: {
        items: [{ productName: 'Service', quantity: 2, listPrice: 200, discountPercent: 10 }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(sqUpsertItemsMock).toHaveBeenCalledTimes(1);
    const itemsArg = sqUpsertItemsMock.mock.calls[0]?.[1] as Array<Record<string, unknown>>;
    expect(itemsArg[0]).toEqual(
      expect.objectContaining({ listPrice: 200, discountPercent: 10, unitPrice: 180 }),
    );
  });

  test('200 rounds list price/discount to DB scale before deriving net cost (no formula drift)', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue(DRAFT_QUOTE);
    sqUpsertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    // listPrice 10.005 would persist as 10.01 in NUMERIC(_, 2); deriving the net cost from the raw
    // 10.005 (→ 9.00) would leave the stored row violating unitPrice = listPrice × (1 − discount/100).
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: {
        items: [{ productName: 'Service', quantity: 1, listPrice: 10.005, discountPercent: 10 }],
      },
    });

    expect(res.statusCode).toBe(200);
    const itemsArg = sqUpsertItemsMock.mock.calls[0]?.[1] as Array<Record<string, unknown>>;
    const item = itemsArg[0] as { listPrice: number; discountPercent: number; unitPrice: number };
    // Inputs are rounded to the persisted scale, and the net cost is derived from those rounded
    // values: 10.01 × (1 − 10/100) = 9.009 → 9.01.
    expect(item).toEqual(
      expect.objectContaining({ listPrice: 10.01, discountPercent: 10, unitPrice: 9.01 }),
    );
    // The persisted row must satisfy the pricing formula at DB scale.
    const expectedNet = Math.round(item.listPrice * (1 - item.discountPercent / 100) * 100) / 100;
    expect(item.unitPrice).toBe(expectedNet);
  });

  test('200 falls back to legacy unitPrice as list price when no list price is sent', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue(DRAFT_QUOTE);
    sqUpsertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { items: [{ productName: 'Service', quantity: 1, unitPrice: 42 }] },
    });

    expect(res.statusCode).toBe(200);
    const itemsArg = sqUpsertItemsMock.mock.calls[0]?.[1] as Array<Record<string, unknown>>;
    expect(itemsArg[0]).toEqual(
      expect.objectContaining({ listPrice: 42, discountPercent: 0, unitPrice: 42 }),
    );
  });

  test('200 persists a line item duration on a time-based line (issue #776)', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue(DRAFT_QUOTE);
    sqUpsertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            productName: 'Service',
            quantity: 2,
            listPrice: 100,
            discountPercent: 0,
            unitType: 'days',
            durationMonths: 3,
            durationUnit: 'months',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const itemsArg = sqUpsertItemsMock.mock.calls[0]?.[1] as Array<Record<string, unknown>>;
    expect(itemsArg[0]).toEqual(
      expect.objectContaining({ durationMonths: 3, durationUnit: 'months' }),
    );
  });

  test('200 keeps a years duration on a time-based line (issue #776)', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue(DRAFT_QUOTE);
    sqUpsertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            productName: 'Service',
            quantity: 1,
            listPrice: 100,
            unitType: 'days',
            durationMonths: 24,
            durationUnit: 'years',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const itemsArg = sqUpsertItemsMock.mock.calls[0]?.[1] as Array<Record<string, unknown>>;
    expect(itemsArg[0]).toEqual(
      expect.objectContaining({ durationMonths: 24, durationUnit: 'years' }),
    );
  });

  test('200 passes a line duration through verbatim — no unit-line coercion (issue #775)', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue(DRAFT_QUOTE);
    sqUpsertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    // Duration applies to every line type now (issue #775); the route no longer forces a unit line
    // to a single month — it persists exactly what the client submitted.
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            productName: 'Widget',
            quantity: 4,
            listPrice: 100,
            unitType: 'unit',
            durationMonths: 5,
            durationUnit: 'years',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const itemsArg = sqUpsertItemsMock.mock.calls[0]?.[1] as Array<Record<string, unknown>>;
    expect(itemsArg[0]).toEqual(
      expect.objectContaining({ durationMonths: 5, durationUnit: 'years' }),
    );
  });

  test('200 accepts the "na" duration unit (issue #775)', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue(DRAFT_QUOTE);
    sqUpsertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            productName: 'Service',
            quantity: 2,
            listPrice: 100,
            unitType: 'days',
            durationMonths: 3,
            durationUnit: 'na',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const itemsArg = sqUpsertItemsMock.mock.calls[0]?.[1] as Array<Record<string, unknown>>;
    expect(itemsArg[0]).toEqual(expect.objectContaining({ durationUnit: 'na' }));
  });

  test('200 defaults the line duration to one month when omitted (issue #776)', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue(DRAFT_QUOTE);
    sqUpsertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: {
        items: [{ productName: 'Service', quantity: 1, listPrice: 50, unitType: 'days' }],
      },
    });

    expect(res.statusCode).toBe(200);
    const itemsArg = sqUpsertItemsMock.mock.calls[0]?.[1] as Array<Record<string, unknown>>;
    expect(itemsArg[0]).toEqual(
      expect.objectContaining({ durationMonths: 1, durationUnit: 'months' }),
    );
  });

  test('400 rejects a non-integer durationMonths (issue #776)', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            productName: 'Service',
            quantity: 1,
            listPrice: 10,
            unitType: 'days',
            durationMonths: 1.5,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(sqUpsertItemsMock).not.toHaveBeenCalled();
  });

  test('400 rejects a durationMonths below 1 (issue #776)', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            productName: 'Service',
            quantity: 1,
            listPrice: 10,
            unitType: 'days',
            durationMonths: 0,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(sqUpsertItemsMock).not.toHaveBeenCalled();
  });

  test('400 rejects an unknown durationUnit (issue #776)', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            productName: 'Service',
            quantity: 1,
            listPrice: 10,
            unitType: 'days',
            durationUnit: 'weeks',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(sqUpsertItemsMock).not.toHaveBeenCalled();
  });

  test('400 rejects an item discount above 100', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: {
        items: [{ productName: 'Service', quantity: 1, listPrice: 100, discountPercent: 150 }],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(sqUpsertItemsMock).not.toHaveBeenCalled();
  });

  test('400 rejects a list price that would overflow NUMERIC(15,2) (clean 400, not a DB 500)', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);

    // 1e13 has 14 integer digits and exceeds the NUMERIC(15,2) max of 9999999999999.99.
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: {
        items: [{ productName: 'Service', quantity: 1, listPrice: 10_000_000_000_000 }],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(sqUpsertItemsMock).not.toHaveBeenCalled();
  });

  test('200 accepts a list price at the NUMERIC(15,2) maximum (boundary is inclusive)', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue(DRAFT_QUOTE);
    sqUpsertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: {
        items: [{ productName: 'Service', quantity: 1, listPrice: 9_999_999_999_999.99 }],
      },
    });

    expect(res.statusCode).toBe(200);
    const itemsArg = sqUpsertItemsMock.mock.calls[0]?.[1] as Array<Record<string, unknown>>;
    expect(itemsArg[0]).toEqual(
      expect.objectContaining({
        listPrice: 9_999_999_999_999.99,
        discountPercent: 0,
        unitPrice: 9_999_999_999_999.99,
      }),
    );
  });

  test('200 links a customer, resolving clientName server-side from clientId (issue #759)', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    clientsFindNameMock.mockResolvedValue('Globex Corp');
    sqUpdateMock.mockResolvedValue({
      ...DRAFT_QUOTE,
      clientId: 'cli-1',
      clientName: 'Globex Corp',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      // Note: a stale clientName in the body is ignored; the server resolves it from clientId.
      payload: { clientId: 'cli-1', clientName: 'STALE NAME' },
    });

    expect(res.statusCode).toBe(200);
    expect(clientsFindNameMock).toHaveBeenCalledWith('cli-1');
    expect(sqUpdateMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ clientId: 'cli-1', clientName: 'Globex Corp' }),
    );
  });

  test('200 clears the customer link when clientId is empty', async () => {
    sqFindByIdMock.mockResolvedValue({
      ...DRAFT_QUOTE,
      clientId: 'cli-1',
      clientName: 'Globex Corp',
    });
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue({ ...DRAFT_QUOTE, clientId: null, clientName: null });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { clientId: '' },
    });

    expect(res.statusCode).toBe(200);
    // No client lookup for a cleared link.
    expect(clientsFindNameMock).not.toHaveBeenCalled();
    expect(sqUpdateMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ clientId: null, clientName: null }),
    );
  });

  test('200 preserves the stored clientName when an edit resubmits the unchanged clientId (#759)', async () => {
    // Quote linked to cli-1 with a name captured before the client was later renamed. The edit
    // form resubmits the unchanged clientId alongside the real change (notes).
    sqFindByIdMock.mockResolvedValue({
      ...DRAFT_QUOTE,
      clientId: 'cli-1',
      clientName: 'Name At Link Time',
    });
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue({
      ...DRAFT_QUOTE,
      clientId: 'cli-1',
      clientName: 'Name At Link Time',
      notes: 'edited',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { clientId: 'cli-1', notes: 'edited' },
    });

    expect(res.statusCode).toBe(200);
    // Unchanged link → no client lookup and no clientName/clientId in the patch, so the repo
    // leaves the denormalized name untouched.
    expect(clientsFindNameMock).not.toHaveBeenCalled();
    const patch = sqUpdateMock.mock.calls[0]?.[1];
    expect(patch).toEqual(expect.objectContaining({ notes: 'edited' }));
    expect(patch).not.toHaveProperty('clientId');
    expect(patch).not.toHaveProperty('clientName');
  });

  test('400 when clientId does not reference an existing client', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    clientsFindNameMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { clientId: 'ghost' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'clientId does not reference an existing client',
    });
    expect(sqUpdateMock).not.toHaveBeenCalled();
  });

  test('409 rejects customer reassignment when the derived status is accepted', async () => {
    sqFindByIdMock.mockResolvedValue({
      ...DRAFT_QUOTE,
      linkedClientQuoteId: 'q-1',
      linkedClientQuoteStatus: 'accepted',
    });
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    clientsFindNameMock.mockResolvedValue('Globex Corp');

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { clientId: 'cli-1' },
    });

    expect(res.statusCode).toBe(409);
    expect(sqUpdateMock).not.toHaveBeenCalled();
  });

  test('any status spelling is ignored, never written (#779 fully derived)', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindItemsForQuoteMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { status: 'received' },
    });

    expect(res.statusCode).toBe(200);
    expect(sqUpdateMock.mock.calls[0]?.[1]).toEqual({});
  });

  test('409 expired unlinked quote stays content-read-only (only the date can change)', async () => {
    // Unlinked → effective draft, but a past own date overlays `expired`, which is non-draft —
    // so content edits stay locked until the date is extended (#779).
    sqFindByIdMock.mockResolvedValue({
      ...DRAFT_QUOTE,
      expirationDate: '2000-01-01',
    });
    sqFindLinkedOrderIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { paymentTerms: '30 days' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Non-draft');
    expect(sqUpdateMock).not.toHaveBeenCalled();
  });

  test('200 expired quote can still be revalidated by extending the expiration date', async () => {
    sqFindByIdMock.mockResolvedValue({
      ...DRAFT_QUOTE,
      expirationDate: '2000-01-01',
    });
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue({
      ...DRAFT_QUOTE,
      status: 'sent',
      expirationDate: '2999-12-31',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { expirationDate: '2999-12-31' },
    });

    expect(res.statusCode).toBe(200);
    expect(sqUpdateMock).toHaveBeenCalledTimes(1);
  });

  test('response status derives through the linked OFFER chain (#779)', async () => {
    sqFindByIdMock.mockResolvedValue({
      ...DRAFT_QUOTE,
      linkedClientQuoteId: 'cq-1',
      linkedClientQuoteStatus: 'offer',
      linkedClientQuoteExpiration: '2999-12-31',
      linkedOfferStatus: 'accepted',
      linkedOfferExpiration: '2000-01-01',
    });
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue({ ...DRAFT_QUOTE, expirationDate: '2999-12-30' });
    sqFindItemsForQuoteMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { expirationDate: '2999-12-30' },
    });

    expect(res.statusCode).toBe(200);
    // The accepted OFFER drives the supplier quote: terminal, frozen — even though the offer's
    // own date has long passed.
    expect(JSON.parse(res.body).status).toBe('accepted');
  });

  test('PUT response carries the synced link fields, not just the bare update() row', async () => {
    // update() uses a bare .returning() that omits the reverse-lookup link fields; the route must
    // carry them over from the pre-read `current` row so the response reports the synced status
    // (issue #779).
    sqFindByIdMock.mockResolvedValue({
      ...DRAFT_QUOTE,
      status: 'draft',
      linkedClientQuoteId: 'cq-1',
      linkedClientQuoteStatus: 'sent',
    });
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue({
      ...DRAFT_QUOTE,
      status: 'draft',
      linkedClientQuoteId: null,
      linkedClientQuoteStatus: null,
      expirationDate: '2027-06-30',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { expirationDate: '2027-06-30' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.isStatusSynced).toBe(true);
    expect(body.status).toBe('sent');
  });
});
