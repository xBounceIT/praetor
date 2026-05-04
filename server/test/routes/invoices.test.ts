import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realInvoicesRepo from '../../repositories/invoicesRepo.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realAudit from '../../utils/audit.ts';
import * as realPermissions from '../../utils/permissions.ts';
import {
  installAuthMiddlewareMock,
  restoreAuthMiddlewareMock,
} from '../helpers/authMiddlewareMock.ts';
import { buildRouteTestApp } from '../helpers/buildRouteTestApp.ts';
import { makeDbError } from '../helpers/dbErrors.ts';
import { signToken } from '../helpers/jwt.ts';

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const invoicesRepoSnap = { ...realInvoicesRepo };
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
const findIdConflictMock = mock();
const deleteByIdMock = mock();
const logAuditMock = mock(async () => undefined);
const withDbTransactionMock = mock(async (cb: (tx: unknown) => unknown) => cb(undefined));

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
    replaceItems: replaceItemsMock,
    findItemsForInvoice: findItemsForInvoiceMock,
    findDates: findDatesMock,
    findTotal: findTotalMock,
    findIdConflict: findIdConflictMock,
    deleteById: deleteByIdMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
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
  mock.module('../../repositories/invoicesRepo.ts', () => invoicesRepoSnap);
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
  findIdConflictMock,
  deleteByIdMock,
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

    expect(generateNextIdMock).toHaveBeenCalledWith('2025');
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'invoice.created',
        entityType: 'invoice',
        entityId: 'inv-1',
      }),
    );
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
      // Client tries to submit bogus 999s — server must override.
      payload: { ...validBody, subtotal: 999, total: 999 },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ subtotal: 100, total: 100 }),
      undefined,
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
      undefined,
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
    // 2 * 50 * 0.9 = 90
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ subtotal: 90, total: 90 }),
      undefined,
    );
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
      undefined,
    );
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
      undefined,
    );
  });

  test('409 unique violation surfaces as Invoice ID already exists', async () => {
    generateNextIdMock.mockResolvedValue('inv-1');
    withDbTransactionMock.mockImplementation(async () => {
      throw makeDbError('23505', 'invoices_pkey');
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: validBody,
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invoice ID already exists' });
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
      undefined,
    );
    expect(findItemsForInvoiceMock).toHaveBeenCalled();
    expect(replaceItemsMock).not.toHaveBeenCalled();
  });

  test('200 with items replaces via replaceItems and recomputes totals', async () => {
    updateMock.mockResolvedValue(SAMPLE_INVOICE);
    replaceItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      payload: {
        items: [{ description: 'Replaced', unitOfMeasure: 'unit', quantity: 2, unitPrice: 50 }],
        // Client tries to submit a bogus 999 — server must override.
        subtotal: 999,
        total: 999,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(replaceItemsMock).toHaveBeenCalled();
    expect(findItemsForInvoiceMock).not.toHaveBeenCalled();
    // 2 * 50 = 100
    expect(updateMock).toHaveBeenCalledWith(
      'inv-1',
      expect.objectContaining({ subtotal: 100, total: 100 }),
      undefined,
    );
  });

  test('200 partial update without items leaves totals untouched in patch', async () => {
    updateMock.mockResolvedValue({ ...SAMPLE_INVOICE, status: 'sent' });
    findItemsForInvoiceMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/invoices/inv-1',
      headers: authHeader(),
      // Client tries to update totals without items — both should be ignored.
      payload: { status: 'sent', subtotal: 999, total: 999 },
    });

    expect(res.statusCode).toBe(200);
    const patch = updateMock.mock.calls[0][1] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('subtotal');
    expect(patch).not.toHaveProperty('total');
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

  test('404 not found', async () => {
    deleteByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/invoices/missing',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invoice not found' });
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
