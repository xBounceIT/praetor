import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realClientsRepo from '../../repositories/clientsRepo.ts';
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

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const supplierQuotesRepoSnap = { ...realSupplierQuotesRepo };
const supplierQuoteVersionsRepoSnap = { ...realSupplierQuoteVersionsRepo };
const clientsRepoSnap = { ...realClientsRepo };
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

const sqvInsertMock = mock();
const sqvBuildSnapshotMock = mock();

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
  }));
  mock.module('../../repositories/supplierQuoteVersionsRepo.ts', () => ({
    ...supplierQuoteVersionsRepoSnap,
    insert: sqvInsertMock,
    buildSnapshot: sqvBuildSnapshotMock,
  }));
  mock.module('../../repositories/clientsRepo.ts', () => ({
    ...clientsRepoSnap,
    findName: clientsFindNameMock,
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
  mock.module('../../repositories/supplierQuotesRepo.ts', () => supplierQuotesRepoSnap);
  mock.module(
    '../../repositories/supplierQuoteVersionsRepo.ts',
    () => supplierQuoteVersionsRepoSnap,
  );
  mock.module('../../repositories/clientsRepo.ts', () => clientsRepoSnap);
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
  resetWithDbTransactionMock();
  logAuditMock.mockImplementation(async () => undefined);
  sqvBuildSnapshotMock.mockImplementation((quote, items) => ({
    schemaVersion: 1,
    quote,
    items,
  }));
  sqFindItemsForQuoteMock.mockResolvedValue([SAMPLE_ITEM]);
  sqFindIdConflictMock.mockResolvedValue(false);
  // snapshotPreState calls findFullForSnapshot; default to the current draft so the
  // pre-save snapshot path doesn't crash on tests that update content.
  sqFindFullForSnapshotMock.mockResolvedValue({ quote: DRAFT_QUOTE, items: [SAMPLE_ITEM] });

  testApp = await buildRouteTestApp(routePlugin, '/api/sales/supplier-quotes');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('PUT /api/sales/supplier-quotes/:id', () => {
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

  test('409 rejects content edits when current status is non-draft', async () => {
    sqFindByIdMock.mockResolvedValue({ ...DRAFT_QUOTE, status: 'sent' });
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
    expect(sqReplaceItemsMock).not.toHaveBeenCalled();
  });

  test('409 rejects supplier reassignment when current status is accepted', async () => {
    sqFindByIdMock.mockResolvedValue({ ...DRAFT_QUOTE, status: 'accepted' });
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

  test('200 allows status-only transition from sent to accepted', async () => {
    sqFindByIdMock.mockResolvedValue({ ...DRAFT_QUOTE, status: 'sent' });
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue({ ...DRAFT_QUOTE, status: 'accepted' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { status: 'accepted' },
    });

    expect(res.statusCode).toBe(200);
    expect(sqUpdateMock).toHaveBeenCalledTimes(1);
    expect(sqUpdateMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ status: 'accepted' }),
    );
  });

  test('200 allows denied → draft transition (status only)', async () => {
    sqFindByIdMock.mockResolvedValue({ ...DRAFT_QUOTE, status: 'denied' });
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue({ ...DRAFT_QUOTE, status: 'draft' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { status: 'draft' },
    });

    expect(res.statusCode).toBe(200);
    expect(sqUpdateMock).toHaveBeenCalledTimes(1);
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

  // When a non-draft quote has both a non-status edit AND a conflicting id rename,
  // the status guard runs first and the response surfaces status as the reason. The
  // id-conflict 409 from the surviving idConflict branch should NEVER appear in this
  // case - asserting the response copy locks in the precedence order.
  test('409 status guard takes precedence over id-conflict on a non-draft quote', async () => {
    sqFindByIdMock.mockResolvedValue({ ...DRAFT_QUOTE, status: 'sent' });
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
    sqReplaceItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: {
        items: [{ productName: 'Service', quantity: 2, listPrice: 200, discountPercent: 10 }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(sqReplaceItemsMock).toHaveBeenCalledTimes(1);
    const itemsArg = sqReplaceItemsMock.mock.calls[0]?.[1] as Array<Record<string, unknown>>;
    expect(itemsArg[0]).toEqual(
      expect.objectContaining({ listPrice: 200, discountPercent: 10, unitPrice: 180 }),
    );
  });

  test('200 rounds list price/discount to DB scale before deriving net cost (no formula drift)', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue(DRAFT_QUOTE);
    sqReplaceItemsMock.mockResolvedValue([SAMPLE_ITEM]);

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
    const itemsArg = sqReplaceItemsMock.mock.calls[0]?.[1] as Array<Record<string, unknown>>;
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
    sqReplaceItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: { items: [{ productName: 'Service', quantity: 1, unitPrice: 42 }] },
    });

    expect(res.statusCode).toBe(200);
    const itemsArg = sqReplaceItemsMock.mock.calls[0]?.[1] as Array<Record<string, unknown>>;
    expect(itemsArg[0]).toEqual(
      expect.objectContaining({ listPrice: 42, discountPercent: 0, unitPrice: 42 }),
    );
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
    expect(sqReplaceItemsMock).not.toHaveBeenCalled();
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
    expect(sqReplaceItemsMock).not.toHaveBeenCalled();
  });

  test('200 accepts a list price at the NUMERIC(15,2) maximum (boundary is inclusive)', async () => {
    sqFindByIdMock.mockResolvedValue(DRAFT_QUOTE);
    sqFindLinkedOrderIdMock.mockResolvedValue(null);
    sqUpdateMock.mockResolvedValue(DRAFT_QUOTE);
    sqReplaceItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/sales/supplier-quotes/sq-1',
      headers: authHeader(),
      payload: {
        items: [{ productName: 'Service', quantity: 1, listPrice: 9_999_999_999_999.99 }],
      },
    });

    expect(res.statusCode).toBe(200);
    const itemsArg = sqReplaceItemsMock.mock.calls[0]?.[1] as Array<Record<string, unknown>>;
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

  test('409 rejects customer reassignment when current status is accepted', async () => {
    sqFindByIdMock.mockResolvedValue({ ...DRAFT_QUOTE, status: 'accepted' });
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
});
