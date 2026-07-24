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
import * as realDrizzle from '../../db/drizzle.ts';
import * as realProductsRepo from '../../repositories/productsRepo.ts';
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
import { signToken } from '../helpers/jwt.ts';
import { makeWithDbTransactionMock } from '../helpers/withDbTransactionMock.ts';

const usersRepoSnap = { ...realUsersRepo };
const rolesRepoSnap = { ...realRolesRepo };
const permissionsSnap = { ...realPermissions };
const productsRepoSnap = { ...realProductsRepo };
const suppliersRepoSnap = { ...realSuppliersRepo };
const auditSnap = { ...realAudit };
const drizzleSnap = { ...realDrizzle };

// Auth-middleware deps
const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

// Products repo mocks
const listAllProductsMock = mock();
const findProductByIdMock = mock();
const findProductCoreByIdMock = mock();
const existsProductByNameMock = mock();
const existsProductByCodeMock = mock();
const insertProductMock = mock();
const updateProductDynamicMock = mock();
const deleteProductByIdMock = mock();

const listAllProductTypesWithCountsMock = mock();
const findProductTypeByNameMock = mock();
const getCostUnitForTypeMock = mock();
const existsProductTypeByNameMock = mock();
const lockProductTypeByIdMock = mock();
const insertProductTypeMock = mock();
const updateProductTypeFieldsMock = mock();
const propagateProductTypeNameMock = mock();
const propagateProductTypeCostUnitMock = mock();
const countProductsForTypeMock = mock();
const countCategoriesForTypeMock = mock();
const deleteProductTypeIfUnusedMock = mock();

const listInternalCategoriesByTypeMock = mock();
const findInternalCategoryByIdMock = mock();
const findCategoryIdByNameAndTypeMock = mock();
const existsInternalCategoryByNameTypeMock = mock();
const insertInternalCategoryMock = mock();
const updateInternalCategoryFieldsMock = mock();
const propagateCategoryNameToProductsMock = mock();
const clearProductsCategoryByNameMock = mock();
const deleteInternalCategoryByIdMock = mock();
const countProductsForCategoryMock = mock();

const listInternalSubcategoriesByTypeMock = mock();
const existsInternalSubcategoryByNameInCategoryMock = mock();
const insertInternalSubcategoryMock = mock();
const updateInternalSubcategoryNameMock = mock();
const propagateSubcategoryNameToProductsMock = mock();
const clearProductsSubcategoryByNameMock = mock();
const deleteInternalSubcategoryByCategoryAndNameMock = mock();
const deleteInternalSubcategoryAndClearProductsMock = mock();
const countProductsForSubcategoryMock = mock();
const checkProductsLinkedToTransactionsMock = mock();

const findSupplierNameByIdMock = mock();
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
  mock.module('../../repositories/productsRepo.ts', () => ({
    ...productsRepoSnap,
    listAllProducts: listAllProductsMock,
    findProductById: findProductByIdMock,
    findProductCoreById: findProductCoreByIdMock,
    existsProductByName: existsProductByNameMock,
    existsProductByCode: existsProductByCodeMock,
    insertProduct: insertProductMock,
    updateProductDynamic: updateProductDynamicMock,
    deleteProductById: deleteProductByIdMock,
    listAllProductTypesWithCounts: listAllProductTypesWithCountsMock,
    findProductTypeByName: findProductTypeByNameMock,
    getCostUnitForType: getCostUnitForTypeMock,
    existsProductTypeByName: existsProductTypeByNameMock,
    lockProductTypeById: lockProductTypeByIdMock,
    insertProductType: insertProductTypeMock,
    updateProductTypeFields: updateProductTypeFieldsMock,
    propagateProductTypeName: propagateProductTypeNameMock,
    propagateProductTypeCostUnit: propagateProductTypeCostUnitMock,
    countProductsForType: countProductsForTypeMock,
    countCategoriesForType: countCategoriesForTypeMock,
    deleteProductTypeIfUnused: deleteProductTypeIfUnusedMock,
    listInternalCategoriesByType: listInternalCategoriesByTypeMock,
    findInternalCategoryById: findInternalCategoryByIdMock,
    findCategoryIdByNameAndType: findCategoryIdByNameAndTypeMock,
    existsInternalCategoryByNameType: existsInternalCategoryByNameTypeMock,
    insertInternalCategory: insertInternalCategoryMock,
    updateInternalCategoryFields: updateInternalCategoryFieldsMock,
    propagateCategoryNameToProducts: propagateCategoryNameToProductsMock,
    clearProductsCategoryByName: clearProductsCategoryByNameMock,
    deleteInternalCategoryById: deleteInternalCategoryByIdMock,
    countProductsForCategory: countProductsForCategoryMock,
    listInternalSubcategoriesByType: listInternalSubcategoriesByTypeMock,
    existsInternalSubcategoryByNameInCategory: existsInternalSubcategoryByNameInCategoryMock,
    insertInternalSubcategory: insertInternalSubcategoryMock,
    updateInternalSubcategoryName: updateInternalSubcategoryNameMock,
    propagateSubcategoryNameToProducts: propagateSubcategoryNameToProductsMock,
    clearProductsSubcategoryByName: clearProductsSubcategoryByNameMock,
    deleteInternalSubcategoryByCategoryAndName: deleteInternalSubcategoryByCategoryAndNameMock,
    deleteInternalSubcategoryAndClearProducts: deleteInternalSubcategoryAndClearProductsMock,
    countProductsForSubcategory: countProductsForSubcategoryMock,
    checkProductsLinkedToTransactions: checkProductsLinkedToTransactionsMock,
  }));
  mock.module('../../repositories/suppliersRepo.ts', () => ({
    ...suppliersRepoSnap,
    findNameById: findSupplierNameByIdMock,
  }));
  mock.module('../../utils/audit.ts', () => ({
    ...auditSnap,
    logAudit: logAuditMock,
  }));
  mock.module('../../db/drizzle.ts', () => ({
    ...drizzleSnap,
    withDbTransaction: withDbTransactionMock,
  }));

  routePlugin = (await import('../../routes/products.ts')).default as FastifyPluginAsync;
});

afterAll(() => {
  restoreAuthMiddlewareMock();
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
  mock.module('../../utils/permissions.ts', () => permissionsSnap);
  mock.module('../../repositories/productsRepo.ts', () => productsRepoSnap);
  mock.module('../../repositories/suppliersRepo.ts', () => suppliersRepoSnap);
  mock.module('../../utils/audit.ts', () => auditSnap);
  mock.module('../../db/drizzle.ts', () => drizzleSnap);
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
  'catalog.internal_listing.view',
  'catalog.internal_listing.create',
  'catalog.internal_listing.update',
  'catalog.internal_listing.delete',
  'sales.supplier_quotes.view',
  'sales.client_offers.view',
  'accounting.supplier_orders.view',
  'accounting.supplier_invoices.view',
];

const SAMPLE_PRODUCT = {
  id: 'p-1',
  name: 'Widget',
  productCode: 'WGT-1',
  description: null,
  costo: 10,
  molPercentage: 30,
  costUnit: 'unit' as const,
  category: null,
  subcategory: null,
  type: 'goods',
  supplierId: null,
  supplierName: null,
  isDisabled: false,
  createdAt: 1_700_000_000_000,
};

const SAMPLE_TYPE = {
  id: 'pt-1',
  name: 'goods',
  costUnit: 'unit' as const,
  createdAt: 1,
  updatedAt: 2,
};

const SAMPLE_CATEGORY = {
  id: 'ipc-1',
  name: 'Electronics',
  type: 'goods',
  costUnit: 'unit' as const,
  createdAt: 1,
  updatedAt: 2,
  productCount: 0,
  hasLinkedProducts: false,
};

const allMocks = [
  findAuthUserByIdMock,
  userHasRoleMock,
  getRolePermissionsMock,
  listAllProductsMock,
  findProductByIdMock,
  findProductCoreByIdMock,
  existsProductByNameMock,
  existsProductByCodeMock,
  insertProductMock,
  updateProductDynamicMock,
  deleteProductByIdMock,
  listAllProductTypesWithCountsMock,
  findProductTypeByNameMock,
  getCostUnitForTypeMock,
  existsProductTypeByNameMock,
  lockProductTypeByIdMock,
  insertProductTypeMock,
  updateProductTypeFieldsMock,
  propagateProductTypeNameMock,
  propagateProductTypeCostUnitMock,
  countProductsForTypeMock,
  countCategoriesForTypeMock,
  deleteProductTypeIfUnusedMock,
  listInternalCategoriesByTypeMock,
  findInternalCategoryByIdMock,
  findCategoryIdByNameAndTypeMock,
  existsInternalCategoryByNameTypeMock,
  insertInternalCategoryMock,
  updateInternalCategoryFieldsMock,
  propagateCategoryNameToProductsMock,
  clearProductsCategoryByNameMock,
  deleteInternalCategoryByIdMock,
  countProductsForCategoryMock,
  listInternalSubcategoriesByTypeMock,
  existsInternalSubcategoryByNameInCategoryMock,
  insertInternalSubcategoryMock,
  updateInternalSubcategoryNameMock,
  propagateSubcategoryNameToProductsMock,
  clearProductsSubcategoryByNameMock,
  deleteInternalSubcategoryByCategoryAndNameMock,
  deleteInternalSubcategoryAndClearProductsMock,
  countProductsForSubcategoryMock,
  checkProductsLinkedToTransactionsMock,
  findSupplierNameByIdMock,
  logAuditMock,
  withDbTransactionMock,
];

let testApp: FastifyInstance;

beforeEach(async () => {
  for (const m of allMocks) m.mockReset();
  findAuthUserByIdMock.mockResolvedValue(HAPPY_USER);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue(ALL_PERMS);
  resetWithDbTransactionMock();
  logAuditMock.mockImplementation(async () => undefined);
  // Default: no name/code conflicts
  existsProductByNameMock.mockResolvedValue(false);
  existsProductByCodeMock.mockResolvedValue(false);
  // Default valid type lookup
  findProductTypeByNameMock.mockResolvedValue('unit');
  // Default no linked records
  checkProductsLinkedToTransactionsMock.mockResolvedValue({ linked: false, count: 0 });

  testApp = await buildRouteTestApp(routePlugin, '/api/products');
});

afterEach(async () => {
  await testApp.close();
});

const authHeader = () => ({ authorization: `Bearer ${signToken({ userId: 'u1' })}` });

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

describe('GET /api/products', () => {
  test('200 returns list', async () => {
    listAllProductsMock.mockResolvedValue([SAMPLE_PRODUCT]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/products',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(listAllProductsMock).toHaveBeenCalledTimes(1);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/products' });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing all view perms', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/products',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/products', () => {
  test('201 creates product', async () => {
    insertProductMock.mockResolvedValue({ ...SAMPLE_PRODUCT });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/products',
      headers: authHeader(),
      payload: {
        name: 'Widget',
        productCode: 'WGT-1',
        costo: 10,
        molPercentage: 30,
        type: 'goods',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(insertProductMock).toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'product.created' }),
    );
  });

  test('201 generates unique ids for same-millisecond product creates', async () => {
    const fixedNow = 1_700_000_000_000;
    const dateNowSpy = spyOn(Date, 'now').mockReturnValue(fixedNow);
    insertProductMock.mockImplementation(async (input: Record<string, unknown>) => ({
      ...SAMPLE_PRODUCT,
      ...input,
    }));

    try {
      const [firstRes, secondRes] = await Promise.all([
        testApp.inject({
          method: 'POST',
          url: '/api/products',
          headers: authHeader(),
          payload: {
            name: 'Widget 1',
            productCode: 'WGT-1',
            costo: 10,
            molPercentage: 30,
            type: 'goods',
          },
        }),
        testApp.inject({
          method: 'POST',
          url: '/api/products',
          headers: authHeader(),
          payload: {
            name: 'Widget 2',
            productCode: 'WGT-2',
            costo: 10,
            molPercentage: 30,
            type: 'goods',
          },
        }),
      ]);

      expect(firstRes.statusCode).toBe(201);
      expect(secondRes.statusCode).toBe(201);
      expect(insertProductMock).toHaveBeenCalledTimes(2);

      const firstInput = insertProductMock.mock.calls[0]?.[0] as { id: string };
      const secondInput = insertProductMock.mock.calls[1]?.[0] as { id: string };

      expect(firstInput.id).toMatch(/^p-/);
      expect(secondInput.id).toMatch(/^p-/);
      expect(firstInput.id).not.toBe(secondInput.id);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  test('400 invalid productCode characters', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/products',
      headers: authHeader(),
      payload: {
        name: 'Widget',
        productCode: 'bad code!',
        costo: 10,
        molPercentage: 30,
        type: 'goods',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 duplicate name', async () => {
    existsProductByNameMock.mockResolvedValue(true);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/products',
      headers: authHeader(),
      payload: {
        name: 'Widget',
        productCode: 'WGT-1',
        costo: 10,
        molPercentage: 30,
        type: 'goods',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Product name must be unique/);
  });

  test('400 duplicate code', async () => {
    existsProductByCodeMock.mockResolvedValue(true);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/products',
      headers: authHeader(),
      payload: {
        name: 'Widget',
        productCode: 'WGT-1',
        costo: 10,
        molPercentage: 30,
        type: 'goods',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Product code must be unique/);
  });

  test('400 invalid type', async () => {
    findProductTypeByNameMock.mockResolvedValue(null);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/products',
      headers: authHeader(),
      payload: {
        name: 'Widget',
        productCode: 'WGT-1',
        costo: 10,
        molPercentage: 30,
        type: 'unknown',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  test('400 molPercentage out of range', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/products',
      headers: authHeader(),
      payload: {
        name: 'Widget',
        productCode: 'WGT-1',
        costo: 10,
        molPercentage: 100,
        type: 'goods',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/products',
      payload: { name: 'X', productCode: 'X', costo: 0, molPercentage: 1, type: 'goods' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing create perm', async () => {
    getRolePermissionsMock.mockResolvedValue(['catalog.internal_listing.view']);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/products',
      headers: authHeader(),
      payload: { name: 'X', productCode: 'X', costo: 0, molPercentage: 1, type: 'goods' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /api/products/:id', () => {
  test('200 simple update', async () => {
    updateProductDynamicMock.mockResolvedValue({ ...SAMPLE_PRODUCT, name: 'Renamed' });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/products/p-1',
      headers: authHeader(),
      payload: { name: 'Renamed' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateProductDynamicMock).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ name: 'Renamed' }),
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'product.updated' }),
    );
  });

  test('200 isDisabled toggle audits as product.disabled', async () => {
    updateProductDynamicMock.mockResolvedValue({ ...SAMPLE_PRODUCT, isDisabled: true });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/products/p-1',
      headers: authHeader(),
      payload: { isDisabled: true },
    });

    expect(res.statusCode).toBe(200);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'product.disabled' }),
    );
  });

  test('400 invalid isDisabled value does not update product', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/products/p-1',
      headers: authHeader(),
      payload: { isDisabled: 'ture' } as unknown as Record<string, unknown>,
    });

    expect(res.statusCode).toBe(400);
    expect(updateProductDynamicMock).not.toHaveBeenCalled();
  });

  test('200 type change loads currentProduct + recomputes costUnit', async () => {
    findProductCoreByIdMock.mockResolvedValue({
      type: 'goods',
      supplierId: null,
      category: null,
      subcategory: null,
    });
    findProductTypeByNameMock.mockResolvedValue('hours');
    updateProductDynamicMock.mockResolvedValue({
      ...SAMPLE_PRODUCT,
      type: 'services',
      costUnit: 'hours',
    });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/products/p-1',
      headers: authHeader(),
      payload: { type: 'services' },
    });

    expect(res.statusCode).toBe(200);
    expect(findProductCoreByIdMock).toHaveBeenCalledWith('p-1');
    expect(updateProductDynamicMock).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ type: 'services', costUnit: 'hours' }),
    );
  });

  test('404 currentProduct missing when type provided', async () => {
    findProductCoreByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/products/missing',
      headers: authHeader(),
      payload: { type: 'goods' },
    });

    expect(res.statusCode).toBe(404);
  });

  test('404 update returns null', async () => {
    updateProductDynamicMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/products/missing',
      headers: authHeader(),
      payload: { name: 'X' },
    });

    expect(res.statusCode).toBe(404);
  });

  test('400 duplicate name on update', async () => {
    existsProductByNameMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/products/p-1',
      headers: authHeader(),
      payload: { name: 'Taken' },
    });

    expect(res.statusCode).toBe(400);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/products/p-1',
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing update perm', async () => {
    getRolePermissionsMock.mockResolvedValue(['catalog.internal_listing.view']);
    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/products/p-1',
      headers: authHeader(),
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /api/products/:id', () => {
  test('204 deletes product', async () => {
    deleteProductByIdMock.mockResolvedValue({ name: 'Widget', productCode: 'WGT-1' });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/products/p-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'product.deleted' }),
    );
  });

  test('404 not found', async () => {
    deleteProductByIdMock.mockResolvedValue(null);
    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/products/missing',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'DELETE', url: '/api/products/p-1' });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing delete perm', async () => {
    getRolePermissionsMock.mockResolvedValue(['catalog.internal_listing.view']);
    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/products/p-1',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Internal categories
// ---------------------------------------------------------------------------

describe('GET /api/products/internal-categories', () => {
  test('200 returns list', async () => {
    listInternalCategoriesByTypeMock.mockResolvedValue([SAMPLE_CATEGORY]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/products/internal-categories?type=goods',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(listInternalCategoriesByTypeMock).toHaveBeenCalledWith('goods');
  });

  test('400 invalid type', async () => {
    findProductTypeByNameMock.mockResolvedValue(null);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/products/internal-categories?type=bogus',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/products/internal-categories?type=goods',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/products/internal-categories', () => {
  test('201 creates category', async () => {
    existsInternalCategoryByNameTypeMock.mockResolvedValue(false);
    insertInternalCategoryMock.mockResolvedValue({ ...SAMPLE_CATEGORY });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/products/internal-categories',
      headers: authHeader(),
      payload: { name: 'Electronics', type: 'goods' },
    });

    expect(res.statusCode).toBe(201);
    expect(insertInternalCategoryMock).toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'internal_category.created' }),
    );
  });

  test('400 duplicate', async () => {
    existsInternalCategoryByNameTypeMock.mockResolvedValue(true);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/products/internal-categories',
      headers: authHeader(),
      payload: { name: 'Electronics', type: 'goods' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('403 missing create', async () => {
    getRolePermissionsMock.mockResolvedValue(['catalog.internal_listing.view']);
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/products/internal-categories',
      headers: authHeader(),
      payload: { name: 'Electronics', type: 'goods' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /api/products/internal-categories/:id', () => {
  test('200 renames category', async () => {
    findInternalCategoryByIdMock.mockResolvedValue({ ...SAMPLE_CATEGORY });
    existsInternalCategoryByNameTypeMock.mockResolvedValue(false);
    getCostUnitForTypeMock.mockResolvedValue('unit');
    updateInternalCategoryFieldsMock.mockResolvedValue({
      ...SAMPLE_CATEGORY,
      name: 'Renamed',
    });
    propagateCategoryNameToProductsMock.mockResolvedValue(undefined);
    countProductsForCategoryMock.mockResolvedValue(0);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/products/internal-categories/ipc-1',
      headers: authHeader(),
      payload: { name: 'Renamed' },
    });

    expect(res.statusCode).toBe(200);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'internal_category.updated' }),
    );
  });

  test('404 category not found', async () => {
    findInternalCategoryByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/products/internal-categories/missing',
      headers: authHeader(),
      payload: { name: 'X' },
    });

    expect(res.statusCode).toBe(404);
  });

  test('409 linked to transactions blocks rename', async () => {
    findInternalCategoryByIdMock.mockResolvedValue({ ...SAMPLE_CATEGORY });
    getCostUnitForTypeMock.mockResolvedValue('unit');
    existsInternalCategoryByNameTypeMock.mockResolvedValue(false);
    checkProductsLinkedToTransactionsMock.mockResolvedValue({ linked: true, count: 3 });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/products/internal-categories/ipc-1',
      headers: authHeader(),
      payload: { name: 'Renamed' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/Cannot rename category/);
  });
});

describe('DELETE /api/products/internal-categories/:id', () => {
  test('204 deletes category', async () => {
    findInternalCategoryByIdMock.mockResolvedValue({ ...SAMPLE_CATEGORY });
    clearProductsCategoryByNameMock.mockResolvedValue(undefined);
    deleteInternalCategoryByIdMock.mockResolvedValue(undefined);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/products/internal-categories/ipc-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'internal_category.deleted' }),
    );
  });

  test('404 not found', async () => {
    findInternalCategoryByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/products/internal-categories/missing',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
  });

  test('409 when linked', async () => {
    findInternalCategoryByIdMock.mockResolvedValue({ ...SAMPLE_CATEGORY });
    checkProductsLinkedToTransactionsMock.mockResolvedValue({ linked: true, count: 2 });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/products/internal-categories/ipc-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Internal subcategories
// ---------------------------------------------------------------------------

describe('GET /api/products/internal-subcategories', () => {
  test('200 lists subcategories', async () => {
    findCategoryIdByNameAndTypeMock.mockResolvedValue('ipc-1');
    listInternalSubcategoriesByTypeMock.mockResolvedValue([
      { name: 'Sub', productCount: 0, hasLinkedProducts: false },
    ]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/products/internal-subcategories?type=goods&category=Electronics',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(listInternalSubcategoriesByTypeMock).toHaveBeenCalledWith('ipc-1');
  });

  test('404 category not found', async () => {
    findCategoryIdByNameAndTypeMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/products/internal-subcategories?type=goods&category=Missing',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/products/internal-subcategories', () => {
  test('201 creates subcategory', async () => {
    findCategoryIdByNameAndTypeMock.mockResolvedValue('ipc-1');
    existsInternalSubcategoryByNameInCategoryMock.mockResolvedValue(false);
    insertInternalSubcategoryMock.mockResolvedValue({ id: 'ips-1', name: 'Sub' });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/products/internal-subcategories',
      headers: authHeader(),
      payload: { name: 'Sub', type: 'goods', category: 'Electronics' },
    });

    expect(res.statusCode).toBe(201);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'internal_subcategory.created' }),
    );
  });

  test('400 duplicate subcategory', async () => {
    findCategoryIdByNameAndTypeMock.mockResolvedValue('ipc-1');
    existsInternalSubcategoryByNameInCategoryMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/products/internal-subcategories',
      headers: authHeader(),
      payload: { name: 'Sub', type: 'goods', category: 'Electronics' },
    });

    expect(res.statusCode).toBe(400);
  });

  test('404 parent category missing', async () => {
    findCategoryIdByNameAndTypeMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/products/internal-subcategories',
      headers: authHeader(),
      payload: { name: 'Sub', type: 'goods', category: 'Missing' },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /api/products/internal-subcategories/:name', () => {
  test('200 renames subcategory', async () => {
    findCategoryIdByNameAndTypeMock.mockResolvedValue('ipc-1');
    updateInternalSubcategoryNameMock.mockResolvedValue({ id: 'ips-1' });
    propagateSubcategoryNameToProductsMock.mockResolvedValue(undefined);
    countProductsForSubcategoryMock.mockResolvedValue(0);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/products/internal-subcategories/Old',
      headers: authHeader(),
      payload: { newName: 'New', type: 'goods', category: 'Electronics' },
    });

    expect(res.statusCode).toBe(200);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'internal_subcategory.renamed' }),
    );
  });

  test('400 duplicate new name', async () => {
    findCategoryIdByNameAndTypeMock.mockResolvedValue('ipc-1');
    existsInternalSubcategoryByNameInCategoryMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/products/internal-subcategories/Old',
      headers: authHeader(),
      payload: { newName: 'New', type: 'goods', category: 'Electronics' },
    });

    expect(res.statusCode).toBe(400);
  });

  test('404 category missing', async () => {
    findCategoryIdByNameAndTypeMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/products/internal-subcategories/Old',
      headers: authHeader(),
      payload: { newName: 'New', type: 'goods', category: 'Missing' },
    });

    expect(res.statusCode).toBe(404);
  });

  test('409 linked products block rename', async () => {
    findCategoryIdByNameAndTypeMock.mockResolvedValue('ipc-1');
    checkProductsLinkedToTransactionsMock.mockResolvedValue({ linked: true, count: 5 });

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/products/internal-subcategories/Old',
      headers: authHeader(),
      payload: { newName: 'New', type: 'goods', category: 'Electronics' },
    });

    expect(res.statusCode).toBe(409);
  });
});

describe('DELETE /api/products/internal-subcategories/:name', () => {
  test('204 deletes subcategory', async () => {
    findCategoryIdByNameAndTypeMock.mockResolvedValue('ipc-1');
    deleteInternalSubcategoryAndClearProductsMock.mockResolvedValue({ id: 'ips-1' });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/products/internal-subcategories/Sub?type=goods&category=Electronics',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(deleteInternalSubcategoryAndClearProductsMock).toHaveBeenCalledWith(
      'ipc-1',
      'Sub',
      'goods',
      'Electronics',
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'internal_subcategory.deleted' }),
    );
  });

  test('404 category missing', async () => {
    findCategoryIdByNameAndTypeMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/products/internal-subcategories/Sub?type=goods&category=Missing',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
  });

  test('404 subcategory missing', async () => {
    findCategoryIdByNameAndTypeMock.mockResolvedValue('ipc-1');
    deleteInternalSubcategoryAndClearProductsMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/products/internal-subcategories/Sub?type=goods&category=Electronics',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(clearProductsSubcategoryByNameMock).not.toHaveBeenCalled();
  });

  test('409 linked', async () => {
    findCategoryIdByNameAndTypeMock.mockResolvedValue('ipc-1');
    checkProductsLinkedToTransactionsMock.mockResolvedValue({ linked: true, count: 2 });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/products/internal-subcategories/Sub?type=goods&category=Electronics',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Product types (internal-types)
// ---------------------------------------------------------------------------

describe('GET /api/products/internal-types', () => {
  test('200 lists types', async () => {
    listAllProductTypesWithCountsMock.mockResolvedValue([
      { ...SAMPLE_TYPE, productCount: 0, categoryCount: 0 },
    ]);

    const res = await testApp.inject({
      method: 'GET',
      url: '/api/products/internal-types',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(listAllProductTypesWithCountsMock).toHaveBeenCalledTimes(1);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({ method: 'GET', url: '/api/products/internal-types' });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing view perm', async () => {
    getRolePermissionsMock.mockResolvedValue([]);
    const res = await testApp.inject({
      method: 'GET',
      url: '/api/products/internal-types',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/products/internal-types', () => {
  test('201 creates type', async () => {
    existsProductTypeByNameMock.mockResolvedValue(false);
    insertProductTypeMock.mockResolvedValue({ ...SAMPLE_TYPE });

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/products/internal-types',
      headers: authHeader(),
      payload: { name: 'goods', costUnit: 'unit' },
    });

    expect(res.statusCode).toBe(201);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'product_type.created' }),
    );
  });

  test('400 duplicate name', async () => {
    existsProductTypeByNameMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'POST',
      url: '/api/products/internal-types',
      headers: authHeader(),
      payload: { name: 'goods', costUnit: 'unit' },
    });

    expect(res.statusCode).toBe(400);
  });

  test('400 invalid costUnit', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/products/internal-types',
      headers: authHeader(),
      payload: { name: 'goods', costUnit: 'bogus' },
    });

    expect(res.statusCode).toBe(400);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/api/products/internal-types',
      payload: { name: 'goods', costUnit: 'unit' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('PUT /api/products/internal-types/:id', () => {
  test('200 updates type', async () => {
    lockProductTypeByIdMock.mockResolvedValue({ ...SAMPLE_TYPE });
    existsProductTypeByNameMock.mockResolvedValue(false);
    updateProductTypeFieldsMock.mockResolvedValue({ ...SAMPLE_TYPE, name: 'svc' });
    countProductsForTypeMock.mockResolvedValue(0);
    countCategoriesForTypeMock.mockResolvedValue(0);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/products/internal-types/pt-1',
      headers: authHeader(),
      payload: { name: 'svc' },
    });

    expect(res.statusCode).toBe(200);
    expect(lockProductTypeByIdMock).toHaveBeenCalledWith('pt-1', expect.anything());
    expect(existsProductTypeByNameMock).toHaveBeenCalledWith('svc', 'pt-1', expect.anything());
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'product_type.updated' }),
    );
  });

  test('404 type not found', async () => {
    lockProductTypeByIdMock.mockResolvedValue(null);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/products/internal-types/missing',
      headers: authHeader(),
      payload: { name: 'X' },
    });

    expect(res.statusCode).toBe(404);
  });

  test('400 duplicate name', async () => {
    lockProductTypeByIdMock.mockResolvedValue({ ...SAMPLE_TYPE });
    existsProductTypeByNameMock.mockResolvedValue(true);

    const res = await testApp.inject({
      method: 'PUT',
      url: '/api/products/internal-types/pt-1',
      headers: authHeader(),
      payload: { name: 'taken' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /api/products/internal-types/:id', () => {
  test('204 deletes type', async () => {
    deleteProductTypeIfUnusedMock.mockResolvedValue({
      status: 'deleted',
      type: SAMPLE_TYPE,
    });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/products/internal-types/pt-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);
    expect(deleteProductTypeIfUnusedMock).toHaveBeenCalledWith('pt-1');
    expect(countProductsForTypeMock).not.toHaveBeenCalled();
    expect(countCategoriesForTypeMock).not.toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'product_type.deleted' }),
    );
  });

  test('404 not found', async () => {
    deleteProductTypeIfUnusedMock.mockResolvedValue({ status: 'not_found' });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/products/internal-types/missing',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
  });

  test('409 products linked', async () => {
    deleteProductTypeIfUnusedMock.mockResolvedValue({
      status: 'in_use',
      type: SAMPLE_TYPE,
      productCount: 3,
      categoryCount: 0,
    });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/products/internal-types/pt-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/3 product/);
  });

  test('409 categories linked', async () => {
    deleteProductTypeIfUnusedMock.mockResolvedValue({
      status: 'in_use',
      type: SAMPLE_TYPE,
      productCount: 0,
      categoryCount: 2,
    });

    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/products/internal-types/pt-1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/2 categor/);
  });

  test('401 missing token', async () => {
    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/products/internal-types/pt-1',
    });
    expect(res.statusCode).toBe(401);
  });

  test('403 missing delete perm', async () => {
    getRolePermissionsMock.mockResolvedValue(['catalog.internal_listing.view']);
    const res = await testApp.inject({
      method: 'DELETE',
      url: '/api/products/internal-types/pt-1',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(403);
  });
});
