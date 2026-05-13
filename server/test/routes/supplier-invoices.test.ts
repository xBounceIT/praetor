import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realDrizzle from '../../db/drizzle.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realSupplierInvoicesRepo from '../../repositories/supplierInvoicesRepo.ts';
import * as realSupplierOrdersRepo from '../../repositories/supplierOrdersRepo.ts';
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
const supplierInvoicesRepoSnap = { ...realSupplierInvoicesRepo };
const supplierOrdersRepoSnap = { ...realSupplierOrdersRepo };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const listAllMock = mock();
const listAllItemsMock = mock();
const findInvoiceForLinkedSaleMock = mock();
const maxSequenceForYearMock = mock();
const createMock = mock();
const insertItemsMock = mock();
const findExistingMock = mock();
const findIdConflictMock = mock();
const updateMock = mock();
const replaceItemsMock = mock();
const findItemsForInvoiceMock = mock();
const findStatusAndSupplierNameMock = mock();
const deleteByIdMock = mock();

const findOrderByIdMock = mock();

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
  mock.module('../../repositories/supplierInvoicesRepo.ts', () => ({
    ...supplierInvoicesRepoSnap,
    listAll: listAllMock,
    listAllItems: listAllItemsMock,
    findInvoiceForLinkedSale: findInvoiceForLinkedSaleMock,
    maxSequenceForYear: maxSequenceForYearMock,
    create: createMock,
    insertItems: insertItemsMock,
    findExisting: findExistingMock,
    findIdConflict: findIdConflictMock,
    update: updateMock,
    replaceItems: replaceItemsMock,
    findItemsForInvoice: findItemsForInvoiceMock,
    findStatusAndSupplierName: findStatusAndSupplierNameMock,
    deleteById: deleteByIdMock,
  }));
  mock.module('../../repositories/supplierOrdersRepo.ts', () => ({
    ...supplierOrdersRepoSnap,
    findById: findOrderByIdMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));

  routePlugin = (await import('../../routes/supplier-invoices.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/supplierInvoicesRepo.ts', () => supplierInvoicesRepoSnap);
  mock.module('../../repositories/supplierOrdersRepo.ts', () => supplierOrdersRepoSnap);
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
  'accounting.supplier_invoices.view',
  'accounting.supplier_invoices.create',
  'accounting.supplier_invoices.update',
  'accounting.supplier_invoices.delete',
];

const SAMPLE_INVOICE = {
  id: 'SINV-2025-0001',
  linkedSaleId: null,
  supplierId: 's1',
  supplierName: 'Acme Supply',
  issueDate: '2025-06-01',
  dueDate: '2025-07-01',
  status: 'draft',
  subtotal: 100,
  total: 100,
  amountPaid: 0,
  notes: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const SAMPLE_ITEM = {
  id: 'sinv-item-1',
  invoiceId: 'SINV-2025-0001',
  productId: null,
  description: 'Widget',
  quantity: 1,
  unitPrice: 100,
  discount: 0,
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  listAllMock,
  listAllItemsMock,
  findInvoiceForLinkedSaleMock,
  maxSequenceForYearMock,
  createMock,
  insertItemsMock,
  findExistingMock,
  findIdConflictMock,
  updateMock,
  replaceItemsMock,
  findItemsForInvoiceMock,
  findStatusAndSupplierNameMock,
  deleteByIdMock,
  findOrderByIdMock,
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

  testApp = await buildRouteTestApp(routePlugin, '/api/supplier-invoices');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('GET /api/supplier-invoices', () => {
  test('200 returns list with grouped items', async () => {
    listAllMock.mockResolvedValue([SAMPLE_INVOICE]);
    listAllItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/supplier-invoices',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('SINV-2025-0001');
    expect(body[0].items).toHaveLength(1);
  });

  test('200 invoice without items has empty array', async () => {
    listAllMock.mockResolvedValue([SAMPLE_INVOICE]);
    listAllItemsMock.mockResolvedValue([]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/supplier-invoices',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body[0].items).toEqual([]);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/supplier-invoices' });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing view permission', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/supplier-invoices',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/supplier-invoices', () => {
  const validBody = {
    supplierId: 's1',
    supplierName: 'Acme Supply',
    issueDate: '2025-06-01',
    dueDate: '2025-07-01',
    items: [{ description: 'Widget', quantity: 1, unitPrice: 100 }],
  };

  test('201 creates invoice with auto-generated id', async () => {
    maxSequenceForYearMock.mockResolvedValue(0);
    createMock.mockResolvedValue(SAMPLE_INVOICE);
    insertItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/supplier-invoices',
      headers: authHeader(),
      payload: validBody,
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('SINV-2025-0001');
    expect(maxSequenceForYearMock).toHaveBeenCalledWith('2025');
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'supplier_invoice.created',
        entityType: 'supplier_invoice',
      }),
    );
  });

  test('201 uses caller-supplied id when provided', async () => {
    createMock.mockResolvedValue({ ...SAMPLE_INVOICE, id: 'CUSTOM-1' });
    insertItemsMock.mockResolvedValue([{ ...SAMPLE_ITEM, invoiceId: 'CUSTOM-1' }]);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/supplier-invoices',
      headers: authHeader(),
      payload: { ...validBody, id: 'CUSTOM-1' },
    });

    expect(res.statusCode).toBe(201);
    expect(maxSequenceForYearMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body.id).toBe('CUSTOM-1');
  });

  test('400 missing supplierId', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/supplier-invoices',
      headers: authHeader(),
      payload: { ...validBody, supplierId: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 dueDate before issueDate', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/supplier-invoices',
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
      url: '/api/supplier-invoices',
      headers: authHeader(),
      payload: { ...validBody, items: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Items must be a non-empty array' });
  });

  test('400 invalid item quantity (negative)', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/supplier-invoices',
      headers: authHeader(),
      payload: {
        ...validBody,
        items: [{ description: 'X', quantity: -1, unitPrice: 100 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  test('404 linkedSaleId points to missing source order', async () => {
    findOrderByIdMock.mockResolvedValue(null);
    findInvoiceForLinkedSaleMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/supplier-invoices',
      headers: authHeader(),
      payload: { ...validBody, linkedSaleId: 'so-missing' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Source order not found' });
  });

  test('409 source order is not in sent status', async () => {
    findOrderByIdMock.mockResolvedValue({ id: 'so-1', status: 'draft' });
    findInvoiceForLinkedSaleMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/supplier-invoices',
      headers: authHeader(),
      payload: { ...validBody, linkedSaleId: 'so-1' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Invoices can only be created from sent orders',
    });
  });

  test('409 invoice already exists for the linked order', async () => {
    findOrderByIdMock.mockResolvedValue({ id: 'so-1', status: 'sent' });
    findInvoiceForLinkedSaleMock.mockResolvedValue('SINV-EXISTING');

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/supplier-invoices',
      headers: authHeader(),
      payload: { ...validBody, linkedSaleId: 'so-1' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'An invoice already exists for this order',
    });
  });

  test('409 unique violation surfaces as Invoice ID already exists when caller-supplied id', async () => {
    withDbTransactionMock.mockImplementation(async () => {
      throw makeDbError('23505', 'supplier_invoices_pkey');
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/supplier-invoices',
      headers: authHeader(),
      payload: { ...validBody, id: 'SINV-CUSTOM' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invoice ID already exists' });
  });

  test('403 missing create permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['accounting.supplier_invoices.view']);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/supplier-invoices',
      headers: authHeader(),
      payload: validBody,
    });
    expect(res.statusCode).toBe(403);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/supplier-invoices',
      payload: validBody,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('PUT /api/supplier-invoices/:id', () => {
  test('200 partial update on draft invoice', async () => {
    findExistingMock.mockResolvedValue({
      id: 'SINV-2025-0001',
      status: 'draft',
      issueDate: '2025-06-01',
      dueDate: '2025-07-01',
    });
    updateMock.mockResolvedValue({ ...SAMPLE_INVOICE, status: 'sent' });
    findItemsForInvoiceMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/supplier-invoices/SINV-2025-0001',
      headers: authHeader(),
      payload: { status: 'sent' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalled();
    expect(replaceItemsMock).not.toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'supplier_invoice.updated' }),
    );
  });

  test('200 update with new items uses replaceItems', async () => {
    findExistingMock.mockResolvedValue({
      id: 'SINV-2025-0001',
      status: 'draft',
      issueDate: '2025-06-01',
      dueDate: '2025-07-01',
    });
    updateMock.mockResolvedValue(SAMPLE_INVOICE);
    replaceItemsMock.mockResolvedValue([SAMPLE_ITEM]);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/supplier-invoices/SINV-2025-0001',
      headers: authHeader(),
      payload: {
        items: [{ description: 'Widget', quantity: 1, unitPrice: 100 }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(replaceItemsMock).toHaveBeenCalled();
  });

  test('404 invoice not found', async () => {
    findExistingMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/supplier-invoices/missing',
      headers: authHeader(),
      payload: { status: 'sent' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invoice not found' });
  });

  test('409 non-draft invoice with locked field updates is read-only', async () => {
    findExistingMock.mockResolvedValue({
      id: 'SINV-2025-0001',
      status: 'sent',
      issueDate: '2025-06-01',
      dueDate: '2025-07-01',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/supplier-invoices/SINV-2025-0001',
      headers: authHeader(),
      payload: { supplierName: 'Renamed' },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Non-draft invoices are read-only');
  });

  test('409 id conflict on rename', async () => {
    findExistingMock.mockResolvedValue({
      id: 'SINV-2025-0001',
      status: 'draft',
      issueDate: '2025-06-01',
      dueDate: '2025-07-01',
    });
    findIdConflictMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/supplier-invoices/SINV-2025-0001',
      headers: authHeader(),
      payload: { id: 'SINV-2025-0002' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invoice ID already exists' });
  });

  test('400 dueDate before issueDate using effective dates', async () => {
    findExistingMock.mockResolvedValue({
      id: 'SINV-2025-0001',
      status: 'draft',
      issueDate: '2025-06-01',
      dueDate: '2025-07-01',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/supplier-invoices/SINV-2025-0001',
      headers: authHeader(),
      payload: { dueDate: '2025-05-01' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'dueDate must be on or after issueDate',
    });
  });

  test('400 empty items array on update', async () => {
    findExistingMock.mockResolvedValue({
      id: 'SINV-2025-0001',
      status: 'draft',
      issueDate: '2025-06-01',
      dueDate: '2025-07-01',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/supplier-invoices/SINV-2025-0001',
      headers: authHeader(),
      payload: { items: [] },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Items must be a non-empty array' });
  });

  test('404 update returns null after transaction', async () => {
    findExistingMock.mockResolvedValue({
      id: 'SINV-2025-0001',
      status: 'draft',
      issueDate: '2025-06-01',
      dueDate: '2025-07-01',
    });
    updateMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/supplier-invoices/SINV-2025-0001',
      headers: authHeader(),
      payload: { status: 'sent' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invoice not found' });
  });

  test('403 missing update permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['accounting.supplier_invoices.view']);
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/supplier-invoices/SINV-2025-0001',
      headers: authHeader(),
      payload: { status: 'sent' },
    });
    expect(res.statusCode).toBe(403);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/supplier-invoices/SINV-2025-0001',
      payload: { status: 'sent' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('DELETE /api/supplier-invoices/:id', () => {
  test('204 happy path emits audit', async () => {
    findStatusAndSupplierNameMock.mockResolvedValue({
      status: 'draft',
      supplierName: 'Acme Supply',
    });
    deleteByIdMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/supplier-invoices/SINV-2025-0001',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(deleteByIdMock).toHaveBeenCalledWith('SINV-2025-0001');
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'supplier_invoice.deleted',
        entityId: 'SINV-2025-0001',
      }),
    );
  });

  test('404 not found', async () => {
    findStatusAndSupplierNameMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/supplier-invoices/missing',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invoice not found' });
  });

  test('409 non-draft invoice cannot be deleted', async () => {
    findStatusAndSupplierNameMock.mockResolvedValue({
      status: 'sent',
      supplierName: 'Acme Supply',
    });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/supplier-invoices/SINV-2025-0001',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Only draft invoices can be deleted',
    });
    expect(deleteByIdMock).not.toHaveBeenCalled();
  });

  test('403 missing delete permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['accounting.supplier_invoices.view']);
    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/supplier-invoices/SINV-2025-0001',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/supplier-invoices/SINV-2025-0001',
    });
    expect(res.statusCode).toBe(401);
  });
});
