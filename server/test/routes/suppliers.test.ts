import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realSuppliersRepo from '../../repositories/suppliersRepo.ts';
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
const suppliersRepoSnap = { ...realSuppliersRepo };
const auditSnap = { ...realAudit };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

const listAllMock = mock();
const findByIdMock = mock();
const findExistingCodesMock = mock();
const createMock = mock();
const updateMock = mock();
const deleteByIdMock = mock();
const logAuditMock = mock(async () => undefined);

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
  mock.module('../../repositories/suppliersRepo.ts', () => ({
    ...suppliersRepoSnap,
    listAll: listAllMock,
    findById: findByIdMock,
    findExistingCodes: findExistingCodesMock,
    create: createMock,
    update: updateMock,
    deleteById: deleteByIdMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));

  routePlugin = (await import('../../routes/suppliers.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/suppliersRepo.ts', () => suppliersRepoSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
});

const HAPPY_USER = {
  id: 'u1',
  name: 'Alice',
  username: 'alice',
  role: 'top_manager',
  avatarInitials: 'AL',
  isDisabled: false,
  sessionVersion: 1,
};

const ALL_PERMS = [
  'crm.suppliers.view',
  'crm.suppliers_all.view',
  'crm.suppliers_all.create',
  'crm.suppliers_all.update',
  'crm.suppliers_all.delete',
  'crm.suppliers.create',
  'crm.suppliers.update',
  'crm.suppliers.delete',
];

const SAMPLE_SUPPLIER = {
  id: 's-1',
  name: 'ACME',
  isDisabled: false,
  supplierCode: 'ACM',
  contacts: [{ fullName: 'Jane', role: 'Buyer', email: 'jane@acme.test', phone: '+1-555-0100' }],
  contactName: 'Jane',
  email: 'jane@acme.test',
  phone: '+1-555-0100',
  address: '1 Main St',
  vatNumber: 'IT123',
  taxCode: 'TAX1',
  paymentTerms: '30 days',
  notes: null,
  createdAt: 1_700_000_000_000,
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  listAllMock,
  findByIdMock,
  findExistingCodesMock,
  createMock,
  updateMock,
  deleteByIdMock,
  logAuditMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(ALL_PERMS);
  findByIdMock.mockResolvedValue(SAMPLE_SUPPLIER);
  findExistingCodesMock.mockResolvedValue(new Set());
  logAuditMock.mockImplementation(async () => undefined);

  testApp = await buildRouteTestApp(routePlugin, '/api/suppliers');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

describe('GET /api/suppliers', () => {
  test('200 returns list', async () => {
    listAllMock.mockResolvedValue([SAMPLE_SUPPLIER]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/suppliers',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([SAMPLE_SUPPLIER]);
    expect(listAllMock).toHaveBeenCalledTimes(1);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/suppliers' });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing all view permissions', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/suppliers',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/suppliers', () => {
  test('201 creates supplier with audit', async () => {
    createMock.mockResolvedValue(SAMPLE_SUPPLIER);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/suppliers',
      headers: authHeader(),
      payload: {
        name: 'ACME',
        vatNumber: 'IT123',
        supplierCode: 'ACM',
        email: 'jane@acme.test',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'supplier.created',
        entityType: 'supplier',
      }),
    );
  });
  test('201 stores multiple contacts and mirrors the first contact into legacy fields', async () => {
    createMock.mockImplementation(async (input: Record<string, unknown>) => ({
      ...SAMPLE_SUPPLIER,
      ...input,
    }));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/suppliers',
      headers: authHeader(),
      payload: {
        name: 'ACME',
        vatNumber: 'IT123',
        contactName: 'Stale legacy name',
        email: 'stale@example.test',
        phone: '999',
        contacts: [
          {
            fullName: ' Jane ',
            role: ' Buyer ',
            email: ' jane@acme.test ',
            phone: ' +1-555-0100 ',
          },
          { fullName: 'Bob' },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const input = createMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.contacts).toEqual([
      {
        fullName: 'Jane',
        role: 'Buyer',
        email: 'jane@acme.test',
        phone: '+1-555-0100',
      },
      { fullName: 'Bob', role: undefined, email: undefined, phone: undefined },
    ]);
    expect(input.contactName).toBe('Jane');
    expect(input.email).toBe('jane@acme.test');
    expect(input.phone).toBe('+1-555-0100');
  });

  test('400 rejects a contact without a full name', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/suppliers',
      headers: authHeader(),
      payload: {
        name: 'ACME',
        vatNumber: 'IT123',
        contacts: [{ fullName: '   ', phone: '123' }],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('400 rejects an invalid contact email', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/suppliers',
      headers: authHeader(),
      payload: {
        name: 'ACME',
        vatNumber: 'IT123',
        contacts: [{ fullName: 'Jane', email: 'not-an-email' }],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('201 generates unique ids for same-millisecond supplier creates', async () => {
    const fixedNow = 1_700_000_000_000;
    const dateNowSpy = spyOn(Date, 'now').mockReturnValue(fixedNow);
    createMock.mockImplementation(async (input: Record<string, unknown>) => ({
      ...SAMPLE_SUPPLIER,
      ...input,
    }));

    try {
      const [firstRes, secondRes] = await Promise.all([
        testApp.inject({
          method: 'POST',
          url: '/api/suppliers',
          headers: authHeader(),
          payload: { name: 'ACME 1', vatNumber: 'IT123' },
        }),
        testApp.inject({
          method: 'POST',
          url: '/api/suppliers',
          headers: authHeader(),
          payload: { name: 'ACME 2', vatNumber: 'IT456' },
        }),
      ]);

      expect(firstRes.statusCode).toBe(201);
      expect(secondRes.statusCode).toBe(201);
      expect(createMock).toHaveBeenCalledTimes(2);

      const firstInput = createMock.mock.calls[0]?.[0] as { id: string; createdAt: number };
      const secondInput = createMock.mock.calls[1]?.[0] as { id: string; createdAt: number };

      expect(firstInput.id).toMatch(/^s-/);
      expect(secondInput.id).toMatch(/^s-/);
      expect(firstInput.id).not.toBe(secondInput.id);
      expect(firstInput.createdAt).toBe(fixedNow);
      expect(secondInput.createdAt).toBe(fixedNow);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  test('201 accepts crm.suppliers_all.create without base create', async () => {
    getRolePermissionsMock.mockResolvedValue(['crm.suppliers_all.create']);
    createMock.mockResolvedValue(SAMPLE_SUPPLIER);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/suppliers',
      headers: authHeader(),
      payload: {
        name: 'ACME',
        vatNumber: 'IT123',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  test('400 missing name', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/suppliers',
      headers: authHeader(),
      payload: { name: '   ', vatNumber: 'IT123' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 missing vatNumber', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/suppliers',
      headers: authHeader(),
      payload: { name: 'ACME' },
    });
    // Schema enforces vatNumber required
    expect(res.statusCode).toBe(400);
  });

  test('400 invalid email', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/suppliers',
      headers: authHeader(),
      payload: { name: 'ACME', vatNumber: 'IT123', email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/suppliers',
      payload: { name: 'ACME', vatNumber: 'IT123' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing create permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['crm.suppliers.view']);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/suppliers',
      headers: authHeader(),
      payload: { name: 'ACME', vatNumber: 'IT123' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/suppliers/bulk', () => {
  const validSupplier = (supplierCode: string, name = supplierCode) => ({
    supplierCode,
    name,
    vatNumber: `IT-${supplierCode}`,
  });

  test('creates valid rows in order, normalizes values, and stores one primary contact', async () => {
    createMock.mockImplementation(async (input: Record<string, unknown>) => ({
      ...SAMPLE_SUPPLIER,
      ...input,
    }));

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/suppliers/bulk',
      headers: authHeader(),
      payload: {
        suppliers: [
          {
            supplierCode: ' SUP-001 ',
            name: ' First Supplier ',
            vatNumber: ' IT123 ',
            contactName: ' Jane Doe ',
            contactRole: ' Buyer ',
            email: ' jane@example.test ',
            phone: ' 123 ',
          },
          validSupplier('SUP-002', 'Second Supplier'),
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.summary).toEqual({ total: 2, succeeded: 2, failed: 0 });
    expect(body.results.map((result: { index: number }) => result.index)).toEqual([0, 1]);
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        supplierCode: 'SUP-001',
        name: 'First Supplier',
        vatNumber: 'IT123',
        contacts: [
          {
            fullName: 'Jane Doe',
            role: 'Buyer',
            email: 'jane@example.test',
            phone: '123',
          },
        ],
        contactName: 'Jane Doe',
        email: 'jane@example.test',
        phone: '123',
      }),
    );
    expect(logAuditMock).toHaveBeenCalledTimes(2);
  });

  test('returns partial results for invalid rows, duplicates, and creation failures', async () => {
    findExistingCodesMock.mockResolvedValue(new Set(['existing']));
    createMock.mockImplementation(async (input: Record<string, unknown>) => {
      if (input.supplierCode === 'FAIL') throw new Error('database failure');
      return { ...SAMPLE_SUPPLIER, ...input };
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/suppliers/bulk',
      headers: authHeader(),
      payload: {
        suppliers: [
          validSupplier('DUP'),
          validSupplier('dup'),
          validSupplier('EXISTING'),
          { ...validSupplier('DETAILS'), phone: '123' },
          validSupplier('FAIL'),
          validSupplier('OK'),
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.summary).toEqual({ total: 6, succeeded: 1, failed: 5 });
    expect(body.results.map((result: { success: boolean }) => result.success)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(body.results[0].errors).toContainEqual(
      expect.objectContaining({ field: 'supplierCode', code: 'duplicate' }),
    );
    expect(body.results[2].errors).toContainEqual(
      expect.objectContaining({ field: 'supplierCode', code: 'duplicate' }),
    );
    expect(body.results[3].errors).toContainEqual(
      expect.objectContaining({ field: 'contactName', code: 'required' }),
    );
    expect(body.results[4].errors).toContainEqual(
      expect.objectContaining({ code: 'creation_failed' }),
    );
    expect(logAuditMock).toHaveBeenCalledTimes(1);
  });

  test('never runs more than ten creations concurrently', async () => {
    let active = 0;
    let maxActive = 0;
    createMock.mockImplementation(async (input: Record<string, unknown>) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { ...SAMPLE_SUPPLIER, ...input };
    });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/suppliers/bulk',
      headers: authHeader(),
      payload: {
        suppliers: Array.from({ length: 25 }, (_, index) => validSupplier(`SUP-${index}`)),
      },
    });

    expect(res.statusCode).toBe(200);
    expect(maxActive).toBeLessThanOrEqual(10);
    expect(maxActive).toBe(10);
  });

  test('requires authentication and create permission', async () => {
    const unauthorized = await testApp.inject({
      method: 'POST',
      url: '/api/suppliers/bulk',
      payload: { suppliers: [validSupplier('SUP-001')] },
    });
    expect(unauthorized.statusCode).toBe(401);

    getRolePermissionsMock.mockResolvedValue(['crm.suppliers.view']);
    const forbidden = await testApp.inject({
      method: 'POST',
      url: '/api/suppliers/bulk',
      headers: authHeader(),
      payload: { suppliers: [validSupplier('SUP-001')] },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  test('rejects empty and oversized batches before repository access', async () => {
    const empty = await testApp.inject({
      method: 'POST',
      url: '/api/suppliers/bulk',
      headers: authHeader(),
      payload: { suppliers: [] },
    });
    expect(empty.statusCode).toBe(400);

    const oversized = await testApp.inject({
      method: 'POST',
      url: '/api/suppliers/bulk',
      headers: authHeader(),
      payload: {
        suppliers: Array.from({ length: 501 }, (_, index) => validSupplier(`SUP-${index}`)),
      },
    });
    expect(oversized.statusCode).toBe(400);
    expect(findExistingCodesMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe('PUT /api/suppliers/:id', () => {
  test('200 updates supplier with supplier.updated audit', async () => {
    updateMock.mockResolvedValue({ ...SAMPLE_SUPPLIER, name: 'ACME 2' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/suppliers/s-1',
      headers: authHeader(),
      payload: { name: 'ACME 2' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith('s-1', expect.objectContaining({ name: 'ACME 2' }));
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'supplier.updated' }),
    );
  });

  test('200 isDisabled=true alone audits as supplier.disabled', async () => {
    updateMock.mockResolvedValue({ ...SAMPLE_SUPPLIER, isDisabled: true });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/suppliers/s-1',
      headers: authHeader(),
      payload: { isDisabled: true },
    });

    expect(res.statusCode).toBe(200);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'supplier.disabled' }),
    );
  });

  test('200 isDisabled=false alone audits as supplier.enabled', async () => {
    updateMock.mockResolvedValue({ ...SAMPLE_SUPPLIER, isDisabled: false });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/suppliers/s-1',
      headers: authHeader(),
      payload: { isDisabled: false },
    });

    expect(res.statusCode).toBe(200);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'supplier.enabled' }),
    );
  });

  test('400 invalid isDisabled value does not update supplier', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/suppliers/s-1',
      headers: authHeader(),
      payload: { isDisabled: 'ture' } as unknown as Record<string, unknown>,
    });

    expect(res.statusCode).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('200 accepts crm.suppliers_all.update without base update', async () => {
    getRolePermissionsMock.mockResolvedValue(['crm.suppliers_all.update']);
    updateMock.mockResolvedValue({ ...SAMPLE_SUPPLIER, name: 'ACME 2' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/suppliers/s-1',
      headers: authHeader(),
      payload: { name: 'ACME 2' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith('s-1', expect.objectContaining({ name: 'ACME 2' }));
  });

  test('200 clears optional fields when sent as empty strings', async () => {
    updateMock.mockResolvedValue({
      ...SAMPLE_SUPPLIER,
      email: null,
      phone: null,
      address: null,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/suppliers/s-1',
      headers: authHeader(),
      payload: { email: '', phone: '', address: '' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      's-1',
      expect.objectContaining({ email: null, phone: null, address: null }),
    );
  });

  test('200 clearing one field leaves others untouched (only the listed field is in the patch)', async () => {
    findByIdMock.mockResolvedValue({ ...SAMPLE_SUPPLIER, contacts: [] });
    updateMock.mockResolvedValue({ ...SAMPLE_SUPPLIER, email: null });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/suppliers/s-1',
      headers: authHeader(),
      payload: { email: '' },
    });

    expect(res.statusCode).toBe(200);
    const patch = updateMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(patch).toEqual({ email: null });
  });
  test('200 keeps the primary contact JSON in sync for legacy alias updates', async () => {
    updateMock.mockResolvedValue({
      ...SAMPLE_SUPPLIER,
      contacts: [{ ...SAMPLE_SUPPLIER.contacts[0], email: 'new@example.test' }],
      email: 'new@example.test',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/suppliers/s-1',
      headers: authHeader(),
      payload: { email: ' new@example.test ' },
    });

    expect(res.statusCode).toBe(200);
    expect(findByIdMock).toHaveBeenCalledWith('s-1');
    expect(updateMock).toHaveBeenCalledWith('s-1', {
      contacts: [
        {
          fullName: 'Jane',
          role: 'Buyer',
          email: 'new@example.test',
          phone: '+1-555-0100',
        },
      ],
      contactName: 'Jane',
      email: 'new@example.test',
      phone: '+1-555-0100',
    });
  });

  test('200 clearing the legacy contact name promotes the next contact', async () => {
    findByIdMock.mockResolvedValue({
      ...SAMPLE_SUPPLIER,
      contacts: [
        SAMPLE_SUPPLIER.contacts[0],
        { fullName: 'Bob', role: 'Support', email: 'bob@example.test' },
      ],
    });
    updateMock.mockResolvedValue({
      ...SAMPLE_SUPPLIER,
      contacts: [{ fullName: 'Bob', role: 'Support', email: 'bob@example.test' }],
      contactName: 'Bob',
      email: 'bob@example.test',
      phone: null,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/suppliers/s-1',
      headers: authHeader(),
      payload: { contactName: '' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith('s-1', {
      contacts: [{ fullName: 'Bob', role: 'Support', email: 'bob@example.test' }],
      contactName: 'Bob',
      email: 'bob@example.test',
      phone: null,
    });
  });
  test('200 updates multiple contacts and derives the legacy aliases', async () => {
    updateMock.mockResolvedValue(SAMPLE_SUPPLIER);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/suppliers/s-1',
      headers: authHeader(),
      payload: {
        contactName: 'Stale legacy name',
        email: 'stale@example.test',
        phone: '999',
        contacts: [
          { fullName: ' Alice ', email: ' alice@example.test ', phone: ' 123 ' },
          { fullName: 'Bob', role: 'Support' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      's-1',
      expect.objectContaining({
        contacts: [
          {
            fullName: 'Alice',
            role: undefined,
            email: 'alice@example.test',
            phone: '123',
          },
          { fullName: 'Bob', role: 'Support', email: undefined, phone: undefined },
        ],
        contactName: 'Alice',
        email: 'alice@example.test',
        phone: '123',
      }),
    );
  });

  test('200 an empty contacts array clears every legacy contact alias', async () => {
    updateMock.mockResolvedValue({
      ...SAMPLE_SUPPLIER,
      contacts: [],
      contactName: null,
      email: null,
      phone: null,
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/suppliers/s-1',
      headers: authHeader(),
      payload: { contacts: [] },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith('s-1', {
      contacts: [],
      contactName: null,
      email: null,
      phone: null,
    });
  });

  test('200 name="" is treated as "no change" (NOT NULL column)', async () => {
    updateMock.mockResolvedValue(SAMPLE_SUPPLIER);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/suppliers/s-1',
      headers: authHeader(),
      payload: { name: '' },
    });

    expect(res.statusCode).toBe(200);
    const patch = updateMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('name');
  });

  // POST requires vatNumber; PUT keeps that contract so an empty payload can't drop a
  // supplier into a state the create endpoint would reject.
  test('400 vatNumber="" is rejected (mirrors POST contract)', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/suppliers/s-1',
      headers: authHeader(),
      payload: { vatNumber: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('200 vatNumber update with a valid value', async () => {
    updateMock.mockResolvedValue({ ...SAMPLE_SUPPLIER, vatNumber: 'IT999' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/suppliers/s-1',
      headers: authHeader(),
      payload: { vatNumber: 'IT999' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledWith('s-1', expect.objectContaining({ vatNumber: 'IT999' }));
  });

  test('404 when repo returns null', async () => {
    updateMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/suppliers/missing',
      headers: authHeader(),
      payload: { name: 'New' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Supplier not found' });
  });

  test('400 invalid email', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/suppliers/s-1',
      headers: authHeader(),
      payload: { email: 'not-email' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/suppliers/s-1',
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing update permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['crm.suppliers.view']);
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/suppliers/s-1',
      headers: authHeader(),
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /api/suppliers/:id', () => {
  test('204 deletes supplier with audit', async () => {
    deleteByIdMock.mockResolvedValue({ name: 'ACME', supplierCode: 'ACM' });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/suppliers/s-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(deleteByIdMock).toHaveBeenCalledWith('s-1');
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'supplier.deleted',
        entityId: 's-1',
      }),
    );
  });

  test('204 accepts crm.suppliers_all.delete without base delete', async () => {
    getRolePermissionsMock.mockResolvedValue(['crm.suppliers_all.delete']);
    deleteByIdMock.mockResolvedValue({ name: 'ACME', supplierCode: 'ACM' });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/suppliers/s-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(deleteByIdMock).toHaveBeenCalledWith('s-1');
  });

  test('404 when not found', async () => {
    deleteByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/suppliers/missing',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Supplier not found' });
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'DELETE', url: '/api/suppliers/s-1' });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing delete permission', async () => {
    getRolePermissionsMock.mockResolvedValue(['crm.suppliers.view']);
    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/suppliers/s-1',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });

  // Migration 0033 changed the FK from CASCADE to RESTRICT on supplier financial-doc tables.
  // PG raises 23503 when any dependent supplier_invoice/supplier_quote/supplier_sale references
  // the supplier - the route catches it and surfaces 409 instead of leaking a 500.
  test('409 when supplier has financial documents (FK RESTRICT)', async () => {
    deleteByIdMock.mockRejectedValueOnce(
      makeDbError('23503', 'supplier_invoices_supplier_id_suppliers_id_fk'),
    );

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/suppliers/s-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('financial documents');
  });
});
