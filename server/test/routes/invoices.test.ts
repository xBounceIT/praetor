import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realClientsOrdersRepo from '../../repositories/clientsOrdersRepo.ts';
import * as realInvoicesRepo from '../../repositories/invoicesRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realDocumentCodes from '../../services/documentCodes.ts';
import * as realAudit from '../../utils/audit.ts';
import * as realPermissions from '../../utils/permissions.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';
import { makeDbError } from '../helpers/dbErrors.ts';
import { signToken } from '../helpers/jwt.ts';
import { TX_SENTINEL } from '../helpers/txSentinel.ts';
import { makeWithDbTransactionMock } from '../helpers/withDbTransactionMock.ts';

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const clientsOrdersRepoSnap = { ...realClientsOrdersRepo };
const invoicesRepoSnap = { ...realInvoicesRepo };
const documentCodesSnap = { ...realDocumentCodes };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const listAllWithItemsMock = mock();
const generateNextIdMock = mock();
const createMock = mock();
const insertItemsMock = mock();
const updateMock = mock();
const replaceItemsMock = mock();
const findItemsForInvoiceMock = mock();
const findDatesMock = mock();
const findTotalMock = mock();
const findAmountPaidMock = mock();
const findStatusMock = mock();
const findStatusAndClientNameMock = mock();
const findIdConflictMock = mock();
const findInvoiceForLinkedSaleMock = mock();
const renameDraftMock = mock();
const deleteByIdMock = mock();
const findClientOrderExistingMock = mock();
const findClientOrderItemsMock = mock();
const allocateDocumentCodeMock = mock();
const reserveDocumentCodeCounterFromCodeMock = mock();
const logAuditMock = mock(async () => undefined);
const { withDbTransactionMock, resetWithDbTransactionMock } = makeWithDbTransactionMock();

let invoicesRoutePlugin: FastifyPluginAsync;

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
  mock.module('../../repositories/invoicesRepo.ts', () => ({
    ...invoicesRepoSnap,
    listAllWithItems: listAllWithItemsMock,
    generateNextId: generateNextIdMock,
    create: createMock,
    insertItems: insertItemsMock,
    update: updateMock,
    updateDraft: updateMock,
    replaceItems: replaceItemsMock,
    findItemsForInvoice: findItemsForInvoiceMock,
    findDates: findDatesMock,
    findTotal: findTotalMock,
    findAmountPaid: findAmountPaidMock,
    findStatus: findStatusMock,
    findStatusAndClientName: findStatusAndClientNameMock,
    findIdConflict: findIdConflictMock,
    findInvoiceForLinkedSale: findInvoiceForLinkedSaleMock,
    renameDraft: renameDraftMock,
    deleteById: deleteByIdMock,
    deleteDraftById: deleteByIdMock,
  }));
  mock.module('../../repositories/clientsOrdersRepo.ts', () => ({
    ...clientsOrdersRepoSnap,
    findExisting: findClientOrderExistingMock,
    findItemsForOrder: findClientOrderItemsMock,
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

  invoicesRoutePlugin = (await import('../../routes/invoices.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/clientsOrdersRepo.ts', () => clientsOrdersRepoSnap);
  mock.module('../../repositories/invoicesRepo.ts', () => invoicesRepoSnap);
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
  'accounting.clients_invoices.view',
  'accounting.clients_invoices.create',
  'accounting.clients_invoices.update',
  'accounting.clients_invoices.delete',
];

const SAMPLE_INVOICE = {
  id: 'inv-1',
  linkedSaleId: null,
  clientId: 'c1',
  clientName: 'Client',
  issueDate: '2025-06-01',
  dueDate: '2025-07-01',
  status: 'draft',
  subtotal: 100,
  taxTotal: 22,
  total: 122,
  amountPaid: 0,
  notes: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const SAMPLE_ITEM = {
  id: 'inv-item-1',
  invoiceId: 'inv-1',
  productId: null,
  description: 'Service',
  unitOfMeasure: 'unit' as const,
  quantity: 1,
  unitPrice: 100,
  discount: 0,
  taxRate: 22,
  pricingSemanticsVersion: 2 as const,
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  listAllWithItemsMock,
  generateNextIdMock,
  createMock,
  insertItemsMock,
  updateMock,
  replaceItemsMock,
  findItemsForInvoiceMock,
  findDatesMock,
  findTotalMock,
  findAmountPaidMock,
  findStatusMock,
  findStatusAndClientNameMock,
  findIdConflictMock,
  findInvoiceForLinkedSaleMock,
  renameDraftMock,
  deleteByIdMock,
  findClientOrderExistingMock,
  findClientOrderItemsMock,
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
  findStatusMock.mockResolvedValue('draft');
  findStatusAndClientNameMock.mockResolvedValue({ status: 'draft', clientName: 'Client' });
  findItemsForInvoiceMock.mockResolvedValue([SAMPLE_ITEM]);
  findClientOrderItemsMock.mockResolvedValue([]);
  findClientOrderExistingMock.mockResolvedValue(null);
  findInvoiceForLinkedSaleMock.mockResolvedValue(null);
  allocateDocumentCodeMock.mockResolvedValue('inv-1');
  reserveDocumentCodeCounterFromCodeMock.mockResolvedValue(false);
  resetWithDbTransactionMock();
  logAuditMock.mockImplementation(async () => undefined);

  testApp = await buildRouteTestApp(invoicesRoutePlugin, '/api/invoices');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('GET /api/invoices', () => {
  test('200 returns list', async () => {
    listAllWithItemsMock.mockResolvedValue([{ ...SAMPLE_INVOICE, items: [SAMPLE_ITEM] }]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/invoices',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('inv-1');
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/invoices' });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing view permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/invoices',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/invoices', () => {
  const validBody = {
    clientId: 'c1',
    clientName: 'Client',
    issueDate: '2025-06-01',
    dueDate: '2025-07-01',
    items: [
      {
        description: 'Service',
        unitOfMeasure: 'unit',
        quantity: 1,
        unitPrice: 100,
      },
    ],
  };

  test('201 happy path emits audit', async () => {
    generateNextIdMock.mockResolvedValue('inv-1');
    createMock.mockResolvedValue(SAMPLE_INVOICE);
    insertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: validBody,
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('inv-1');
    expect(body.items).toHaveLength(1);

    expect(allocateDocumentCodeMock).toHaveBeenCalledWith('client_invoice', {
      date: '2025-06-01',
      exec: TX_SENTINEL,
    });
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'invoice.created',
        entityType: 'invoice',
        entityId: 'inv-1',
      }),
    );
  });

  test('201 inherits the invoice code source from the linked order quote when available', async () => {
    findClientOrderExistingMock.mockResolvedValue({
      id: 'ORD_26_0045_manual',
      linkedQuoteId: 'PREV_26_0045_manual',
      linkedOfferId: 'OFF_26_0045_manual',
    });
    createMock.mockResolvedValue({ ...SAMPLE_INVOICE, linkedSaleId: 'ORD_26_0045_manual' });
    insertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: { ...validBody, linkedSaleId: 'ORD_26_0045_manual' },
    });

    expect(res.statusCode).toBe(201);
    expect(allocateDocumentCodeMock).toHaveBeenCalledWith('client_invoice', {
      date: '2025-06-01',
      exec: TX_SENTINEL,
      sourceCodes: ['PREV_26_0045_manual', 'OFF_26_0045_manual', 'ORD_26_0045_manual'],
    });
  });

  test('201 preserves legacy pricing semantics from the linked client order', async () => {
    findClientOrderItemsMock.mockResolvedValue([{ pricingSemanticsVersion: 1 }]);
    findClientOrderExistingMock.mockResolvedValue({
      id: 'ORD_26_0045_manual',
      linkedQuoteId: null,
      linkedOfferId: null,
    });
    createMock.mockResolvedValue({ ...SAMPLE_INVOICE, linkedSaleId: 'ORD_26_0045_manual' });
    insertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: {
        ...validBody,
        linkedSaleId: 'ORD_26_0045_manual',
        items: [
          {
            description: 'Historical annual service',
            unitOfMeasure: 'unit',
            quantity: 1,
            unitPrice: 10,
            durationMonths: 12,
            durationUnit: 'years',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ subtotal: 120, total: 120 }),
      TX_SENTINEL,
    );
    expect(insertItemsMock.mock.calls[0][1][0]).toEqual(
      expect.objectContaining({ pricingSemanticsVersion: 1 }),
    );
  });

  test('201 preserves each source order pricing marker in a mixed invoice', async () => {
    findClientOrderItemsMock.mockResolvedValue([
      { id: 'order-item-legacy', pricingSemanticsVersion: 1 },
      { id: 'order-item-current', pricingSemanticsVersion: 2 },
    ]);
    findClientOrderExistingMock.mockResolvedValue({
      id: 'ORD_26_0045_manual',
      linkedQuoteId: null,
      linkedOfferId: null,
    });
    createMock.mockResolvedValue({ ...SAMPLE_INVOICE, linkedSaleId: 'ORD_26_0045_manual' });
    insertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: {
        ...validBody,
        linkedSaleId: 'ORD_26_0045_manual',
        items: [
          {
            id: 'order-item-legacy',
            description: 'Legacy annual service',
            unitOfMeasure: 'unit',
            quantity: 1,
            unitPrice: 10,
            durationMonths: 12,
            durationUnit: 'years',
          },
          {
            id: 'order-item-current',
            description: 'Current annual service',
            unitOfMeasure: 'unit',
            quantity: 1,
            unitPrice: 10,
            durationMonths: 12,
            durationUnit: 'years',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ subtotal: 130, total: 130 }),
      TX_SENTINEL,
    );
    expect(
      (insertItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>).map(
        (item) => item.pricingSemanticsVersion,
      ),
    ).toEqual([1, 2]);
  });

  test('201 inherits the invoice code source from offer when the linked order quote is legacy', async () => {
    findClientOrderExistingMock.mockResolvedValue({
      id: 'ORD_26_0045_manual',
      linkedQuoteId: 'legacy-quote-id',
      linkedOfferId: 'OFF_26_0045_manual',
    });
    createMock.mockResolvedValue({ ...SAMPLE_INVOICE, linkedSaleId: 'ORD_26_0045_manual' });
    insertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: { ...validBody, linkedSaleId: 'ORD_26_0045_manual' },
    });

    expect(res.statusCode).toBe(201);
    expect(allocateDocumentCodeMock).toHaveBeenCalledWith('client_invoice', {
      date: '2025-06-01',
      exec: TX_SENTINEL,
      sourceCodes: ['legacy-quote-id', 'OFF_26_0045_manual', 'ORD_26_0045_manual'],
    });
  });

  test('201 uses sequential allocation for repeat linked order invoices', async () => {
    findInvoiceForLinkedSaleMock.mockResolvedValue('INV_26_0045');
    createMock.mockResolvedValue({ ...SAMPLE_INVOICE, linkedSaleId: 'ORD_26_0045_manual' });
    insertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: { ...validBody, linkedSaleId: 'ORD_26_0045_manual' },
    });

    expect(res.statusCode).toBe(201);
    expect(findClientOrderExistingMock).not.toHaveBeenCalled();
    expect(allocateDocumentCodeMock).toHaveBeenCalledWith('client_invoice', {
      date: '2025-06-01',
      exec: TX_SENTINEL,
    });
  });

  test('409 when automatic invoice code allocation exhausts collision retries', async () => {
    allocateDocumentCodeMock.mockRejectedValue(
      new realDocumentCodes.DocumentCodeCollisionError('client_invoice'),
    );

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: validBody,
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Unable to allocate a unique document code',
      errorCode: 'document_code_collision',
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  test('201 server-side recomputes subtotal/total from items, ignoring client-submitted values', async () => {
    // validBody has 1 item: quantity=1, unitPrice=100, no discount → computed total = 100
    generateNextIdMock.mockResolvedValue('inv-1');
    createMock.mockResolvedValue({ ...SAMPLE_INVOICE, subtotal: 100, total: 100 });
    insertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      // Client tries to submit bogus 999s - server must override.
      payload: { ...validBody, subtotal: 999, total: 999 },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ subtotal: 100, total: 100 }),
      TX_SENTINEL,
    );
  });

  test('201 default status=draft + computed totals from items', async () => {
    generateNextIdMock.mockResolvedValue('inv-1');
    createMock.mockResolvedValue({ ...SAMPLE_INVOICE, subtotal: 100, total: 100 });
    insertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: validBody,
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'draft',
        subtotal: 100,
        total: 100,
        amountPaid: 0,
      }),
      TX_SENTINEL,
    );
  });

  test('201 applies item discount in computed total', async () => {
    generateNextIdMock.mockResolvedValue('inv-1');
    createMock.mockImplementation(async (input: Record<string, unknown>) => ({
      ...SAMPLE_INVOICE,
      subtotal: input.subtotal as number,
      total: input.total as number,
    }));
    insertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: {
        ...validBody,
        items: [
          {
            description: 'Service',
            unitOfMeasure: 'unit',
            quantity: 2,
            unitPrice: 50,
            discount: 10,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    // 2 * 50 * 0.9 = 90; no taxRate sent so taxTotal = 0
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ subtotal: 90, taxTotal: 0, total: 90 }),
      TX_SENTINEL,
    );
  });

  test('201 folds a "unit" line duration into the total and persists it (Durata always applies)', async () => {
    generateNextIdMock.mockResolvedValue('inv-1');
    createMock.mockImplementation(async (input: Record<string, unknown>) => ({
      ...SAMPLE_INVOICE,
      subtotal: input.subtotal as number,
      total: input.total as number,
    }));
    insertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: {
        ...validBody,
        items: [
          {
            description: 'Widget',
            unitOfMeasure: 'unit',
            quantity: 2,
            unitPrice: 50,
            durationMonths: 12,
            durationUnit: 'years',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    // The stored 12 months are displayed as 1 year, so pricing uses multiplier 1.
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ subtotal: 100, taxTotal: 0, total: 100 }),
      TX_SENTINEL,
    );
    // ...and the persisted line keeps the multi-month duration.
    const persistedItems = insertItemsMock.mock.calls[0][1];
    expect(persistedItems[0].durationMonths).toBe(12);
    expect(persistedItems[0].durationUnit).toBe('years');
  });

  test('400 amountPaid exceeds computed total', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: { ...validBody, amountPaid: 9999 }, // computed total is 100
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'amountPaid cannot exceed total' });
    expect(createMock).not.toHaveBeenCalled();
  });

  test('201 amountPaid equal to computed total is allowed', async () => {
    generateNextIdMock.mockResolvedValue('inv-1');
    createMock.mockResolvedValue({ ...SAMPLE_INVOICE, total: 100, amountPaid: 100 });
    insertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: { ...validBody, amountPaid: 100 },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ amountPaid: 100, total: 100 }),
      TX_SENTINEL,
    );
  });

  test('400 paid status requires amountPaid to cover computed total', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: { ...validBody, status: 'paid', amountPaid: 50 },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'amountPaid must be at least total when status is paid',
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  test('400 dueDate before issueDate', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: { ...validBody, issueDate: '2025-07-01', dueDate: '2025-06-01' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'dueDate must be on or after issueDate',
    });
  });

  test('400 empty items array', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: { ...validBody, items: [] },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Items must be a non-empty array' });
  });

  test('400 invalid item field (negative quantity)', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: {
        ...validBody,
        items: [{ description: 'X', unitOfMeasure: 'unit', quantity: -5, unitPrice: 100 }],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/quantity must be greater than zero/);
  });

  test('400 discount > 100 rejected (would otherwise produce a negative line total)', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: {
        ...validBody,
        items: [
          {
            description: 'X',
            unitOfMeasure: 'unit',
            quantity: 1,
            unitPrice: 100,
            discount: 150,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/discount must be at most 100/);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('201 discount = 100 is the upper boundary (yields total 0)', async () => {
    generateNextIdMock.mockResolvedValue('inv-1');
    createMock.mockResolvedValue({ ...SAMPLE_INVOICE, subtotal: 0, total: 0 });
    insertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: {
        ...validBody,
        items: [
          {
            description: 'X',
            unitOfMeasure: 'unit',
            quantity: 1,
            unitPrice: 100,
            discount: 100,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ subtotal: 0, total: 0 }),
      TX_SENTINEL,
    );
  });

  test('201 applies per-item tax rate (22% IVA) in computed taxTotal/total', async () => {
    generateNextIdMock.mockResolvedValue('inv-1');
    createMock.mockImplementation(async (input: Record<string, unknown>) => ({
      ...SAMPLE_INVOICE,
      subtotal: input.subtotal as number,
      taxTotal: input.taxTotal as number,
      total: input.total as number,
    }));
    insertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: {
        ...validBody,
        items: [
          {
            description: 'Service',
            unitOfMeasure: 'unit',
            quantity: 2,
            unitPrice: 50,
            taxRate: 22,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    // taxable = 100, tax = 22, total = 122
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ subtotal: 100, taxTotal: 22, total: 122 }),
      TX_SENTINEL,
    );
  });

  test('201 mixed tax rates (22%, 10%, 0%) sum correctly', async () => {
    generateNextIdMock.mockResolvedValue('inv-1');
    createMock.mockImplementation(async (input: Record<string, unknown>) => ({
      ...SAMPLE_INVOICE,
      subtotal: input.subtotal as number,
      taxTotal: input.taxTotal as number,
      total: input.total as number,
    }));
    insertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: {
        ...validBody,
        items: [
          { description: 'A', unitOfMeasure: 'unit', quantity: 1, unitPrice: 100, taxRate: 22 },
          { description: 'B', unitOfMeasure: 'unit', quantity: 1, unitPrice: 200, taxRate: 10 },
          { description: 'C', unitOfMeasure: 'unit', quantity: 1, unitPrice: 50, taxRate: 0 },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    // subtotal = 350, tax = 22 + 20 + 0 = 42, total = 392
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ subtotal: 350, taxTotal: 42, total: 392 }),
      TX_SENTINEL,
    );
  });

  test('400 taxRate > 100 rejected', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: {
        ...validBody,
        items: [
          {
            description: 'X',
            unitOfMeasure: 'unit',
            quantity: 1,
            unitPrice: 100,
            taxRate: 150,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/taxRate must be at most 100/);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('201 missing taxRate defaults to 0 (legacy/pre-feature behavior preserved)', async () => {
    generateNextIdMock.mockResolvedValue('inv-1');
    createMock.mockImplementation(async (input: Record<string, unknown>) => ({
      ...SAMPLE_INVOICE,
      subtotal: input.subtotal as number,
      taxTotal: input.taxTotal as number,
      total: input.total as number,
    }));
    insertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: validBody, // no taxRate in items
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ subtotal: 100, taxTotal: 0, total: 100 }),
      TX_SENTINEL,
    );
  });

  test('409 autogenerated invoice id collision surfaces without route-level retry', async () => {
    createMock.mockRejectedValue(makeDbError('23505', 'invoices_pkey'));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: validBody,
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invoice ID already exists' });
    expect(allocateDocumentCodeMock).toHaveBeenCalledTimes(1);
    expect(withDbTransactionMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'inv-1' }), TX_SENTINEL);
    expect(insertItemsMock).not.toHaveBeenCalled();
  });

  test('409 caller-supplied invoice id collision is not retried', async () => {
    createMock.mockRejectedValue(makeDbError('23505', 'invoices_pkey'));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: { ...validBody, id: 'INV-2025-CUSTOM' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invoice ID already exists' });
    expect(allocateDocumentCodeMock).not.toHaveBeenCalled();
    expect(withDbTransactionMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'INV-2025-CUSTOM' }),
      TX_SENTINEL,
    );
    expect(insertItemsMock).not.toHaveBeenCalled();
  });

  test('400 rejects a manual invoice id that can escape its route segment', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: { ...validBody, id: '../clients-orders/ORD-1?' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Bad Request' });
    expect(createMock).not.toHaveBeenCalled();
  });

  test('403 missing create permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['accounting.clients_invoices.view']);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: validBody,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /api/invoices/:id', () => {
  test('200 partial update preserves untouched items via findItemsForInvoice', async () => {
    updateMock.mockResolvedValue({ ...SAMPLE_INVOICE, status: 'sent' });
    findItemsForInvoiceMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      payload: { status: 'sent' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      'inv-1',
      expect.objectContaining({ status: 'sent' }),
      TX_SENTINEL,
    );
    expect(findItemsForInvoiceMock).toHaveBeenCalled();
    expect(replaceItemsMock).not.toHaveBeenCalled();
  });

  test('200 with items replaces via replaceItems and recomputes totals', async () => {
    findAmountPaidMock.mockResolvedValue(0);
    updateMock.mockResolvedValue(SAMPLE_INVOICE);
    replaceItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      payload: {
        items: [{ description: 'Replaced', unitOfMeasure: 'unit', quantity: 2, unitPrice: 50 }],
        // Client tries to submit a bogus 999 - server must override.
        subtotal: 999,
        total: 999,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(replaceItemsMock).toHaveBeenCalled();
    expect(findItemsForInvoiceMock).toHaveBeenCalledWith('inv-1');
    // 2 * 50 = 100
    expect(updateMock).toHaveBeenCalledWith(
      'inv-1',
      expect.objectContaining({ subtotal: 100, total: 100 }),
      TX_SENTINEL,
    );
  });

  test('recomputes an edited historical invoice with its original year multiplier', async () => {
    findItemsForInvoiceMock.mockResolvedValue([
      { ...SAMPLE_ITEM, pricingSemanticsVersion: 1 as const },
    ]);
    findAmountPaidMock.mockResolvedValue(0);
    updateMock.mockResolvedValue(SAMPLE_INVOICE);
    replaceItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            description: 'Historical annual line',
            unitOfMeasure: 'unit',
            quantity: 1,
            unitPrice: 10,
            durationMonths: 12,
            durationUnit: 'years',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      'inv-1',
      expect.objectContaining({ subtotal: 120, total: 120 }),
      TX_SENTINEL,
    );
    expect(replaceItemsMock.mock.calls[0][1][0]).toEqual(
      expect.objectContaining({ pricingSemanticsVersion: 1 }),
    );
  });

  test('preserves each retained marker when editing a mixed invoice', async () => {
    findItemsForInvoiceMock.mockResolvedValue([
      { ...SAMPLE_ITEM, id: 'invoice-item-legacy', pricingSemanticsVersion: 1 as const },
      { ...SAMPLE_ITEM, id: 'invoice-item-current', pricingSemanticsVersion: 2 as const },
    ]);
    findAmountPaidMock.mockResolvedValue(0);
    updateMock.mockResolvedValue(SAMPLE_INVOICE);
    replaceItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      payload: {
        items: [
          {
            id: 'invoice-item-legacy',
            description: 'Legacy annual service',
            unitOfMeasure: 'unit',
            quantity: 1,
            unitPrice: 10,
            durationMonths: 12,
            durationUnit: 'years',
          },
          {
            id: 'invoice-item-current',
            description: 'Current annual service',
            unitOfMeasure: 'unit',
            quantity: 1,
            unitPrice: 10,
            durationMonths: 12,
            durationUnit: 'years',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      'inv-1',
      expect.objectContaining({ subtotal: 130, total: 130 }),
      TX_SENTINEL,
    );
    expect(
      (replaceItemsMock.mock.calls[0][1] as Array<Record<string, unknown>>).map(
        (item) => item.pricingSemanticsVersion,
      ),
    ).toEqual([1, 2]);
  });

  test('400 items replace lowers total below persisted amountPaid (no amountPaid in patch)', async () => {
    // Persisted invoice was paid 100. New items only sum to 50 - that would leave
    // amountPaid (100) > new total (50). Must reject.
    findAmountPaidMock.mockResolvedValue(100);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      payload: {
        items: [{ description: 'X', unitOfMeasure: 'unit', quantity: 1, unitPrice: 50 }],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'amountPaid cannot exceed total' });
    expect(findAmountPaidMock).toHaveBeenCalledWith('inv-1');
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('404 items replace targeting missing invoice (findAmountPaid null)', async () => {
    findAmountPaidMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/missing',
      headers: authHeader(),
      payload: {
        items: [{ description: 'X', unitOfMeasure: 'unit', quantity: 1, unitPrice: 50 }],
      },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invoice not found' });
  });

  test('200 items replace, persisted amountPaid still fits under new total', async () => {
    findAmountPaidMock.mockResolvedValue(40);
    updateMock.mockResolvedValue(SAMPLE_INVOICE);
    replaceItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      payload: {
        items: [{ description: 'X', unitOfMeasure: 'unit', quantity: 1, unitPrice: 50 }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(findAmountPaidMock).toHaveBeenCalledWith('inv-1');
  });

  test('200 partial update without items leaves totals untouched in patch', async () => {
    updateMock.mockResolvedValue({ ...SAMPLE_INVOICE, status: 'sent' });
    findItemsForInvoiceMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      // Client tries to update totals without items - both should be ignored.
      payload: { status: 'sent', subtotal: 999, total: 999 },
    });

    expect(res.statusCode).toBe(200);
    const patch = updateMock.mock.calls[0][1] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('subtotal');
    expect(patch).not.toHaveProperty('total');
  });

  test('200 explicit null notes clears invoice notes', async () => {
    updateMock.mockResolvedValue({ ...SAMPLE_INVOICE, notes: null });
    findItemsForInvoiceMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      payload: { notes: null },
    });

    expect(res.statusCode).toBe(200);
    const patch = updateMock.mock.calls[0][1] as Record<string, unknown>;
    expect(patch).toHaveProperty('notes', null);
  });

  test('400 amountPaid > computed total when items provided', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      payload: {
        items: [{ description: 'X', unitOfMeasure: 'unit', quantity: 1, unitPrice: 50 }],
        amountPaid: 9999,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'amountPaid cannot exceed total' });
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('400 amountPaid > persisted total when items not provided', async () => {
    findTotalMock.mockResolvedValue(50);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      payload: { amountPaid: 9999 },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'amountPaid cannot exceed total' });
    expect(findTotalMock).toHaveBeenCalledWith('inv-1');
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('404 when amountPaid update targets missing invoice (findTotal null)', async () => {
    findTotalMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/missing',
      headers: authHeader(),
      payload: { amountPaid: 50 },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invoice not found' });
  });

  test('200 amountPaid <= persisted total: looks up findTotal and patches amountPaid', async () => {
    findTotalMock.mockResolvedValue(100);
    updateMock.mockResolvedValue({ ...SAMPLE_INVOICE, amountPaid: 50 });
    findItemsForInvoiceMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      payload: { amountPaid: 50 },
    });

    expect(res.statusCode).toBe(200);
    expect(findTotalMock).toHaveBeenCalledWith('inv-1');
    const patch = updateMock.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.amountPaid).toBe(50);
  });

  test('400 paid status requires persisted amountPaid to cover persisted total', async () => {
    findTotalMock.mockResolvedValue(100);
    findAmountPaidMock.mockResolvedValue(0);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      payload: { status: 'paid' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'amountPaid must be at least total when status is paid',
    });
    expect(findTotalMock).toHaveBeenCalledWith('inv-1');
    expect(findAmountPaidMock).toHaveBeenCalledWith('inv-1');
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('400 paid status rejects persisted amountPaid above persisted total', async () => {
    findTotalMock.mockResolvedValue(100);
    findAmountPaidMock.mockResolvedValue(101);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      payload: { status: 'paid' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'amountPaid cannot exceed total' });
    expect(findTotalMock).toHaveBeenCalledWith('inv-1');
    expect(findAmountPaidMock).toHaveBeenCalledWith('inv-1');
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('200 status-only update skips findTotal entirely', async () => {
    updateMock.mockResolvedValue({ ...SAMPLE_INVOICE, status: 'sent' });
    findItemsForInvoiceMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      payload: { status: 'sent' },
    });

    expect(res.statusCode).toBe(200);
    expect(findTotalMock).not.toHaveBeenCalled();
    const patch = updateMock.mock.calls[0][1] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('amountPaid');
    expect(patch).not.toHaveProperty('total');
  });

  test('409 non-draft invoice with locked field updates is read-only', async () => {
    findStatusMock.mockResolvedValue('paid');

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      payload: { clientName: 'Renamed Client' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ error: 'Non-draft invoices are read-only' });
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('409 non-draft invoice status cannot be changed', async () => {
    findStatusMock.mockResolvedValue('paid');

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      payload: { status: 'draft' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ error: 'Non-draft invoices are read-only' });
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('409 non-draft invoice status cannot be re-saved', async () => {
    findStatusMock.mockResolvedValue('paid');

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      payload: { status: 'paid' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ error: 'Non-draft invoices are read-only' });
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('400 dueDate < issueDate using stored findDates for missing side', async () => {
    findDatesMock.mockResolvedValue({ issueDate: '2025-07-01', dueDate: '2025-08-01' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      payload: { dueDate: '2025-06-01' }, // earlier than persisted issueDate
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'dueDate must be on or after issueDate',
    });
  });

  test('404 when update returns null', async () => {
    updateMock.mockResolvedValue(null);
    findItemsForInvoiceMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/missing',
      headers: authHeader(),
      payload: { status: 'sent' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invoice not found' });
  });

  test('409 when invoice leaves draft before update write', async () => {
    findStatusMock.mockResolvedValueOnce('draft').mockResolvedValueOnce('sent');
    updateMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      payload: { status: 'sent' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ error: 'Non-draft invoices are read-only' });
  });

  test('404 when status lookup does not find invoice', async () => {
    findStatusMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/missing',
      headers: authHeader(),
      payload: { status: 'sent' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invoice not found' });
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('400 rejects renaming an invoice to a route-confusing id', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      payload: { id: '../clients-orders/ORD-1?' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'id can only contain letters, numbers, underscores, and hyphens',
    });
    expect(findIdConflictMock).not.toHaveBeenCalled();
    expect(renameDraftMock).not.toHaveBeenCalled();
  });

  test('409 unique violation on rename', async () => {
    findIdConflictMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      payload: { id: 'inv-existing' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invoice ID already exists' });
  });
});

describe('DELETE /api/invoices/:id', () => {
  test('204 happy path emits audit', async () => {
    deleteByIdMock.mockResolvedValue({ id: 'inv-1', clientName: 'Client' });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'invoice.deleted',
        entityType: 'invoice',
        entityId: 'inv-1',
      }),
    );
  });

  test('204 keeps an encoded legacy id inside the invoice route', async () => {
    const legacyId = '../clients-orders/ORD-1?';
    deleteByIdMock.mockResolvedValue({ id: legacyId, clientName: 'Client' });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/invoices/..%2Fclients-orders%2FORD-1%3F',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(findStatusAndClientNameMock).toHaveBeenCalledWith(legacyId);
    expect(deleteByIdMock).toHaveBeenCalledWith(legacyId);
  });

  test('404 not found', async () => {
    findStatusAndClientNameMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/invoices/missing',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invoice not found' });
    expect(deleteByIdMock).not.toHaveBeenCalled();
  });

  test('404 when invoice disappears before delete', async () => {
    deleteByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/invoices/missing',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invoice not found' });
  });

  test('409 non-draft invoice cannot be deleted', async () => {
    findStatusAndClientNameMock.mockResolvedValue({
      status: 'paid',
      clientName: 'Client',
    });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Only draft invoices can be deleted',
    });
    expect(deleteByIdMock).not.toHaveBeenCalled();
  });

  test('409 when invoice leaves draft before delete write', async () => {
    deleteByIdMock.mockResolvedValue(null);
    findStatusMock.mockResolvedValue('sent');

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Only draft invoices can be deleted',
    });
  });

  test('409 FK violation maps to referenced-by message', async () => {
    deleteByIdMock.mockImplementation(async () => {
      throw makeDbError('23503');
    });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Cannot delete invoice because it is referenced by other records',
    });
  });
});
