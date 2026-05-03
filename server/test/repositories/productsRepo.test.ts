import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as productsRepo from '../../repositories/productsRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// `products` columns in schema declaration order:
// id, name, product_code, costo, mol_percentage, cost_unit, category, type, description,
// subcategory, is_disabled, created_at, supplier_id
const PRODUCT_BASE: readonly unknown[] = [
  'p-1',
  'Widget',
  'WGT-001',
  '12.50',
  '30.00',
  'unit',
  'cat-a',
  'good',
  'A widget',
  'sub-a',
  false,
  new Date('2024-01-15T10:00:00Z'),
  null,
];
const productRow = (overrides: Record<number, unknown> = {}) => makeRow(PRODUCT_BASE, overrides);

// `product_types` columns in schema declaration order:
// id, name, cost_unit, created_at, updated_at
const PRODUCT_TYPE_BASE: readonly unknown[] = [
  'pt-1',
  'good',
  'unit',
  new Date('2024-01-01T00:00:00Z'),
  new Date('2024-01-02T00:00:00Z'),
];
const productTypeRow = (overrides: Record<number, unknown> = {}) =>
  makeRow(PRODUCT_TYPE_BASE, overrides);

// `internal_product_categories` columns in schema declaration order:
// id, name, type, cost_unit, created_at, updated_at
const CATEGORY_BASE: readonly unknown[] = [
  'ipc-1',
  'Mechanical',
  'good',
  'unit',
  new Date('2024-01-01T00:00:00Z'),
  new Date('2024-01-02T00:00:00Z'),
];
const categoryRow = (overrides: Record<number, unknown> = {}) => makeRow(CATEGORY_BASE, overrides);

describe('getSnapshots', () => {
  test('returns empty Map when given no ids without issuing a query', async () => {
    const result = await productsRepo.getSnapshots([], testDb);
    expect(result.size).toBe(0);
    expect(exec.calls).toHaveLength(0);
  });

  test('deduplicates ids and binds each id as a separate `in` param', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.getSnapshots(['p-1', 'p-1', 'p-2'], testDb);
    // Drizzle's `inArray` generates `"products"."id" in ($1, $2)` with one param per id.
    expect(exec.calls[0].sql.toLowerCase()).toContain('"products"."id" in');
    expect(exec.calls[0].params).toEqual(['p-1', 'p-2']);
  });

  test('maps cost as number and preserves null molPercentage', async () => {
    exec.enqueue({
      rows: [
        ['p-1', '10.5', '20'],
        ['p-2', '5', null],
      ],
    });
    const result = await productsRepo.getSnapshots(['p-1', 'p-2'], testDb);
    expect(result.get('p-1')).toEqual({ productCost: 10.5, productMolPercentage: 20 });
    expect(result.get('p-2')).toEqual({ productCost: 5, productMolPercentage: null });
  });

  test('coerces empty/falsy ids out before deduplication', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.getSnapshots(['', 'p-1', ''], testDb);
    expect(exec.calls[0].params).toEqual(['p-1']);
  });
});

// ===========================================================================
// Product CRUD
// ===========================================================================

// `findProductById` projection order (shared base — also used by `listAllProducts` with
// `supplier_name` appended at the end):
// id, name, product_code, created_at, description, costo, mol_percentage, cost_unit,
// category, subcategory, type, supplier_id, is_disabled
const DETAIL_PRODUCT_BASE: readonly unknown[] = [
  'p-1',
  'Widget',
  'WGT-001',
  new Date('2024-01-15T10:00:00Z'),
  'A widget',
  '12.50',
  '30.00',
  'unit',
  'cat-a',
  'sub-a',
  'good',
  null,
  false,
];

// `listAllProducts` projection: DETAIL_PRODUCT_BASE + [supplier_name].
const LIST_PRODUCT_BASE: readonly unknown[] = [...DETAIL_PRODUCT_BASE, null];

describe('listAllProducts', () => {
  test('joins suppliers and converts createdAt to epoch ms', async () => {
    exec.enqueue({ rows: [LIST_PRODUCT_BASE.slice()] });
    const result = await productsRepo.listAllProducts(testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('left join "suppliers"');
    expect(result[0].createdAt).toBe(new Date('2024-01-15T10:00:00Z').getTime());
    expect(result[0].name).toBe('Widget');
  });

  test('returns null createdAt when row.createdAt is null', async () => {
    exec.enqueue({ rows: [makeRow(LIST_PRODUCT_BASE, { 3: null })] });
    const [row] = await productsRepo.listAllProducts(testDb);
    expect(row.createdAt).toBeNull();
  });
});

describe('findProductById / findProductCoreById', () => {
  test('findProductById returns mapped row when present', async () => {
    exec.enqueue({ rows: [DETAIL_PRODUCT_BASE.slice()] });
    const result = await productsRepo.findProductById('p-1', testDb);
    expect(result?.id).toBe('p-1');
    expect(exec.calls[0].params).toEqual(['p-1']);
  });

  test('findProductById returns null when no row', async () => {
    exec.enqueue({ rows: [] });
    expect(await productsRepo.findProductById('p-1', testDb)).toBeNull();
  });

  test('findProductCoreById returns just type/supplierId/category', async () => {
    // Projection: type, supplier_id, category — 3-element positional row.
    exec.enqueue({ rows: [['service', 's-1', 'cat-a']] });
    const result = await productsRepo.findProductCoreById('p-1', testDb);
    expect(result).toEqual({ type: 'service', supplierId: 's-1', category: 'cat-a' });
  });
});

describe('existsProductByName / existsProductByCode', () => {
  test('existsProductByName uses LOWER() for case-insensitive matching', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.existsProductByName('Widget', null, testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('lower(');
    expect(exec.calls[0].params).toContain('Widget');
  });

  test('existsProductByName with excludeId adds the id <> predicate', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.existsProductByName('Widget', 'p-2', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toMatch(/"products"\."id"\s*<>/);
    expect(exec.calls[0].params).toContain('Widget');
    expect(exec.calls[0].params).toContain('p-2');
  });

  test('existsProductByCode without excludeId queries by exact match', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.existsProductByCode('WGT-001', null, testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('"products"."product_code"');
    expect(exec.calls[0].params).toContain('WGT-001');
  });

  test.each([
    [[['p-1']], true],
    [[], false],
  ] as const)('existsProductByCode returns %s for matching rows', async (rows, expected) => {
    exec.enqueue({ rows: [...rows] });
    expect(await productsRepo.existsProductByCode('WGT-001', null, testDb)).toBe(expected);
  });
});

describe('insertProduct', () => {
  test('passes all 11 input columns through and maps the returned row', async () => {
    // INSERT ... RETURNING with no explicit cols returns all 13 products columns.
    exec.enqueue({ rows: [productRow()], rowCount: 1 });
    const result = await productsRepo.insertProduct(
      {
        id: 'p-1',
        name: 'Widget',
        productCode: 'WGT-001',
        description: null,
        costo: 12.5,
        molPercentage: 30,
        costUnit: 'unit',
        category: null,
        subcategory: null,
        type: 'good',
        supplierId: null,
      },
      testDb,
    );
    // The 11 user-provided values appear among the bound params; Drizzle's order matches
    // the insert object's key order.
    const params = exec.calls[0].params;
    expect(params).toContain('p-1');
    expect(params).toContain('Widget');
    expect(params).toContain('WGT-001');
    expect(params).toContain('12.5');
    expect(params).toContain('30');
    expect(params).toContain('unit');
    expect(params).toContain('good');
    expect(result.id).toBe('p-1');
  });
});

describe('updateProductDynamic', () => {
  test('returns null without issuing a query when fields is empty', async () => {
    const result = await productsRepo.updateProductDynamic('p-1', {}, testDb);
    expect(result).toBeNull();
    expect(exec.calls.length).toBe(0);
  });

  test('builds SET only for the provided fields and includes id in WHERE', async () => {
    exec.enqueue({ rows: [productRow()], rowCount: 1 });
    await productsRepo.updateProductDynamic(
      'p-1',
      { name: 'New Name', costo: 99, isDisabled: true },
      testDb,
    );
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('"name"');
    expect(sql).toContain('"costo"');
    expect(sql).toContain('"is_disabled"');
    expect(sql).toContain('"products"."id"');
    expect(exec.calls[0].params).toContain('New Name');
    expect(exec.calls[0].params).toContain('99');
    expect(exec.calls[0].params).toContain(true);
    expect(exec.calls[0].params).toContain('p-1');
  });

  test('uses snake_case column names for camelCase keys', async () => {
    exec.enqueue({ rows: [productRow()], rowCount: 1 });
    await productsRepo.updateProductDynamic(
      'p-1',
      { productCode: 'X-1', molPercentage: 10, supplierId: 's-2', costUnit: 'hours' },
      testDb,
    );
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('"product_code"');
    expect(sql).toContain('"mol_percentage"');
    expect(sql).toContain('"supplier_id"');
    expect(sql).toContain('"cost_unit"');
  });

  test('returns null when UPDATE finds no row', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    const result = await productsRepo.updateProductDynamic('p-1', { name: 'X' }, testDb);
    expect(result).toBeNull();
  });
});

describe('deleteProductById', () => {
  test('returns the {name, productCode} from RETURNING', async () => {
    // RETURNING { name, productCode } — 2-element positional row.
    exec.enqueue({ rows: [['Widget', 'WGT-001']], rowCount: 1 });
    const result = await productsRepo.deleteProductById('p-1', testDb);
    expect(result).toEqual({ name: 'Widget', productCode: 'WGT-001' });
  });

  test('returns null when no row was deleted', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    expect(await productsRepo.deleteProductById('p-1', testDb)).toBeNull();
  });
});

// ===========================================================================
// Product types
// ===========================================================================

describe('listAllProductTypesWithCounts', () => {
  test('parses string counts from pg into numbers', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'pt-1',
          name: 'good',
          costUnit: 'unit',
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-02T00:00:00Z'),
          productCount: '5',
          categoryCount: '3',
        },
      ],
    });
    const [row] = await productsRepo.listAllProductTypesWithCounts(testDb);
    expect(row.productCount).toBe(5);
    expect(row.categoryCount).toBe(3);
    expect(row.createdAt).toBe(new Date('2024-01-01T00:00:00Z').getTime());
  });
});

describe('findProductTypeByName', () => {
  test('returns the costUnit value or null', async () => {
    exec.enqueue({ rows: [['hours']] });
    expect(await productsRepo.findProductTypeByName('service', testDb)).toBe('hours');
    exec.enqueue({ rows: [] });
    expect(await productsRepo.findProductTypeByName('missing', testDb)).toBeNull();
  });
});

describe('existsProductTypeByName', () => {
  test('without excludeId checks LOWER() match', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.existsProductTypeByName('Service', null, testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('lower(');
    expect(exec.calls[0].params).toContain('Service');
  });

  test('with excludeId excludes the given id', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.existsProductTypeByName('Service', 'pt-1', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toMatch(/"product_types"\."id"\s*<>/);
    expect(exec.calls[0].params).toContain('Service');
    expect(exec.calls[0].params).toContain('pt-1');
  });
});

describe('findProductTypeById / insertProductType / updateProductTypeFields', () => {
  test('findProductTypeById returns the mapped row or null', async () => {
    // Projection: id, name, costUnit — 3-element positional row.
    exec.enqueue({ rows: [['pt-1', 'good', 'unit']] });
    const result = await productsRepo.findProductTypeById('pt-1', testDb);
    expect(result).toEqual({ id: 'pt-1', name: 'good', costUnit: 'unit' });

    exec.enqueue({ rows: [] });
    expect(await productsRepo.findProductTypeById('pt-99', testDb)).toBeNull();
  });

  test('insertProductType passes id/name/costUnit and returns row with zero counts', async () => {
    // INSERT ... RETURNING with no explicit cols returns all 5 product_types columns.
    exec.enqueue({ rows: [productTypeRow()], rowCount: 1 });
    const result = await productsRepo.insertProductType('pt-1', 'good', 'unit', testDb);
    expect(exec.calls[0].params).toContain('pt-1');
    expect(exec.calls[0].params).toContain('good');
    expect(exec.calls[0].params).toContain('unit');
    expect(result.productCount).toBe(0);
    expect(result.categoryCount).toBe(0);
  });

  test('updateProductTypeFields binds [name, costUnit, id]', async () => {
    exec.enqueue({
      rows: [productTypeRow({ 1: 'service', 2: 'hours' })],
      rowCount: 1,
    });
    await productsRepo.updateProductTypeFields('pt-1', 'service', 'hours', testDb);
    const params = exec.calls[0].params;
    expect(params).toContain('service');
    expect(params).toContain('hours');
    expect(params).toContain('pt-1');
  });

  test('updateProductTypeFields returns null when no row updated', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    expect(await productsRepo.updateProductTypeFields('pt-99', 'x', 'unit', testDb)).toBeNull();
  });
});

describe('product type propagations', () => {
  test('propagateProductTypeName updates products.type then internal_product_categories.type', async () => {
    exec.enqueue({ rows: [], rowCount: 5 });
    exec.enqueue({ rows: [], rowCount: 3 });
    await productsRepo.propagateProductTypeName('old', 'new', testDb);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql.toLowerCase()).toContain('update "products"');
    expect(exec.calls[0].params).toContain('new');
    expect(exec.calls[0].params).toContain('old');
    expect(exec.calls[1].sql.toLowerCase()).toContain('update "internal_product_categories"');
    expect(exec.calls[1].params).toContain('new');
    expect(exec.calls[1].params).toContain('old');
  });

  test('propagateProductTypeCostUnit updates products (internal only) and categories', async () => {
    exec.enqueue({ rows: [], rowCount: 4 });
    exec.enqueue({ rows: [], rowCount: 2 });
    await productsRepo.propagateProductTypeCostUnit('good', 'hours', testDb);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql.toLowerCase()).toContain('"supplier_id" is null');
    expect(exec.calls[0].params).toContain('hours');
    expect(exec.calls[0].params).toContain('good');
    expect(exec.calls[1].sql.toLowerCase()).toContain('update "internal_product_categories"');
    expect(exec.calls[1].params).toContain('hours');
    expect(exec.calls[1].params).toContain('good');
  });
});

describe('countProductsForType / countCategoriesForType', () => {
  test.each([
    ['7', 7],
    ['0', 0],
  ] as const)('countProductsForType parses "%s" to %s', async (countValue, expected) => {
    exec.enqueue({ rows: [[countValue]] });
    expect(await productsRepo.countProductsForType('good', testDb)).toBe(expected);
    expect(exec.calls[0].params).toContain('good');
  });

  test('countProductsForType returns 0 when no row', async () => {
    exec.enqueue({ rows: [] });
    expect(await productsRepo.countProductsForType('good', testDb)).toBe(0);
  });

  test('countCategoriesForType filters by type and parses count', async () => {
    exec.enqueue({ rows: [['4']] });
    expect(await productsRepo.countCategoriesForType('good', testDb)).toBe(4);
    expect(exec.calls[0].sql.toLowerCase()).toContain('"internal_product_categories"');
    expect(exec.calls[0].params).toContain('good');
  });
});

describe('deleteProductTypeById', () => {
  test.each([
    [1, true],
    [0, false],
  ] as const)('returns %s when rowCount is %s', async (rowCount, expected) => {
    exec.enqueue({ rows: [], rowCount });
    expect(await productsRepo.deleteProductTypeById('pt-1', testDb)).toBe(expected);
  });
});

// ===========================================================================
// Internal categories
// ===========================================================================

describe('listInternalCategoriesByType', () => {
  test('binds type as a single param and parses productCount + hasLinkedProducts', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'ipc-1',
          name: 'Mechanical',
          type: 'good',
          costUnit: 'unit',
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-02T00:00:00Z'),
          productCount: '3',
          hasLinkedProducts: true,
        },
      ],
    });
    const [row] = await productsRepo.listInternalCategoriesByType('good', testDb);
    expect(exec.calls[0].params).toContain('good');
    expect(row.productCount).toBe(3);
    expect(row.hasLinkedProducts).toBe(true);
    expect(row.createdAt).toBe(new Date('2024-01-01T00:00:00Z').getTime());
  });
});

describe('findInternalCategoryById / findCategoryIdByNameAndType', () => {
  test('findInternalCategoryById returns {id, name, type} or null', async () => {
    // Projection: id, name, type — 3-element positional row.
    exec.enqueue({ rows: [['ipc-1', 'Mechanical', 'good']] });
    expect(await productsRepo.findInternalCategoryById('ipc-1', testDb)).toEqual({
      id: 'ipc-1',
      name: 'Mechanical',
      type: 'good',
    });

    exec.enqueue({ rows: [] });
    expect(await productsRepo.findInternalCategoryById('ipc-99', testDb)).toBeNull();
  });

  test('findCategoryIdByNameAndType returns the id string or null', async () => {
    // Projection: id — 1-element positional row.
    exec.enqueue({ rows: [['ipc-1']] });
    expect(await productsRepo.findCategoryIdByNameAndType('Mechanical', 'good', testDb)).toBe(
      'ipc-1',
    );

    exec.enqueue({ rows: [] });
    expect(await productsRepo.findCategoryIdByNameAndType('Missing', 'good', testDb)).toBeNull();
  });
});

describe('existsInternalCategoryByNameType', () => {
  test('without excludeId compares LOWER name + type', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.existsInternalCategoryByNameType('Mechanical', 'good', null, testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('lower(');
    expect(exec.calls[0].params).toContain('Mechanical');
    expect(exec.calls[0].params).toContain('good');
  });

  test('with excludeId adds the id <> predicate', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.existsInternalCategoryByNameType('Mechanical', 'good', 'ipc-1', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toMatch(/"internal_product_categories"\."id"\s*<>/);
    expect(exec.calls[0].params).toContain('ipc-1');
  });
});

describe('insertInternalCategory / updateInternalCategoryFields', () => {
  test('insertInternalCategory binds [id, name, type, costUnit] and starts with zero counts', async () => {
    exec.enqueue({ rows: [categoryRow()], rowCount: 1 });
    const result = await productsRepo.insertInternalCategory(
      'ipc-1',
      'Mechanical',
      'good',
      'unit',
      testDb,
    );
    const params = exec.calls[0].params;
    expect(params).toContain('ipc-1');
    expect(params).toContain('Mechanical');
    expect(params).toContain('good');
    expect(params).toContain('unit');
    expect(result.productCount).toBe(0);
    expect(result.hasLinkedProducts).toBe(false);
  });

  test('updateInternalCategoryFields binds [name, costUnit, id]', async () => {
    exec.enqueue({ rows: [categoryRow({ 1: 'Renamed' })], rowCount: 1 });
    await productsRepo.updateInternalCategoryFields('ipc-1', 'Renamed', 'unit', testDb);
    const params = exec.calls[0].params;
    expect(params).toContain('Renamed');
    expect(params).toContain('unit');
    expect(params).toContain('ipc-1');
  });

  test('updateInternalCategoryFields returns null when no row updated', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    expect(
      await productsRepo.updateInternalCategoryFields('ipc-99', 'x', 'unit', testDb),
    ).toBeNull();
  });
});

describe('propagateCategoryNameToProducts / clearProductsCategoryByName', () => {
  test('propagateCategoryNameToProducts only touches internal products and returns affected count', async () => {
    exec.enqueue({ rows: [], rowCount: 4 });
    const count = await productsRepo.propagateCategoryNameToProducts(
      'oldCat',
      'newCat',
      'good',
      'unit',
      testDb,
    );
    expect(count).toBe(4);
    expect(exec.calls[0].sql.toLowerCase()).toContain('"supplier_id" is null');
    expect(exec.calls[0].params).toContain('newCat');
    expect(exec.calls[0].params).toContain('unit');
    expect(exec.calls[0].params).toContain('oldCat');
    expect(exec.calls[0].params).toContain('good');
  });

  test('clearProductsCategoryByName clears category and subcategory', async () => {
    exec.enqueue({ rows: [], rowCount: 2 });
    await productsRepo.clearProductsCategoryByName('cat-a', 'good', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('"category"');
    expect(sql).toContain('"subcategory"');
    expect(exec.calls[0].params).toContain('cat-a');
    expect(exec.calls[0].params).toContain('good');
  });
});

describe('deleteInternalCategoryById / countProductsForCategory', () => {
  test.each([
    [1, true],
    [0, false],
  ] as const)('deleteInternalCategoryById returns %s when rowCount is %s', async (rowCount, expected) => {
    exec.enqueue({ rows: [], rowCount });
    expect(await productsRepo.deleteInternalCategoryById('ipc-1', testDb)).toBe(expected);
  });

  test('countProductsForCategory parses count and filters supplier_id IS NULL', async () => {
    exec.enqueue({ rows: [['6']] });
    expect(await productsRepo.countProductsForCategory('cat-a', 'good', testDb)).toBe(6);
    expect(exec.calls[0].sql.toLowerCase()).toContain('"supplier_id" is null');
    expect(exec.calls[0].params).toContain('cat-a');
    expect(exec.calls[0].params).toContain('good');
  });
});

// ===========================================================================
// Internal subcategories
// ===========================================================================

describe('listInternalSubcategoriesByType', () => {
  test('binds categoryId and parses productCount', async () => {
    // executeRows path — object row.
    exec.enqueue({
      rows: [{ name: 'sub-a', productCount: '2', hasLinkedProducts: false }],
    });
    const [row] = await productsRepo.listInternalSubcategoriesByType('ipc-1', testDb);
    expect(exec.calls[0].params).toContain('ipc-1');
    expect(row).toEqual({ name: 'sub-a', productCount: 2, hasLinkedProducts: false });
  });
});

describe('existsInternalSubcategoryByNameInCategory', () => {
  test('binds [categoryId, name] and case-insensitive matches', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.existsInternalSubcategoryByNameInCategory('Sub-A', 'ipc-1', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('lower(');
    expect(exec.calls[0].params).toContain('ipc-1');
    expect(exec.calls[0].params).toContain('Sub-A');
  });

  test.each([
    [[['ips-1']], true],
    [[], false],
  ] as const)('returns %s when query returns %j rows', async (rows, expected) => {
    exec.enqueue({ rows: [...rows] });
    expect(
      await productsRepo.existsInternalSubcategoryByNameInCategory('sub-a', 'ipc-1', testDb),
    ).toBe(expected);
  });
});

describe('insertInternalSubcategory / updateInternalSubcategoryName', () => {
  test('insertInternalSubcategory binds [id, categoryId, name] and returns the row name', async () => {
    // RETURNING { name } — 1-element positional row.
    exec.enqueue({ rows: [['sub-a']], rowCount: 1 });
    const result = await productsRepo.insertInternalSubcategory('ips-1', 'ipc-1', 'sub-a', testDb);
    const params = exec.calls[0].params;
    expect(params).toContain('ips-1');
    expect(params).toContain('ipc-1');
    expect(params).toContain('sub-a');
    expect(result).toEqual({ name: 'sub-a' });
  });

  test('updateInternalSubcategoryName binds [newName, categoryId, oldName]', async () => {
    // RETURNING { id } — 1-element positional row.
    exec.enqueue({ rows: [['ips-1']], rowCount: 1 });
    const result = await productsRepo.updateInternalSubcategoryName('ipc-1', 'old', 'new', testDb);
    const params = exec.calls[0].params;
    expect(params).toContain('new');
    expect(params).toContain('ipc-1');
    expect(params).toContain('old');
    expect(result).toEqual({ id: 'ips-1' });
  });

  test('updateInternalSubcategoryName returns null when no row matched', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    expect(
      await productsRepo.updateInternalSubcategoryName('ipc-1', 'old', 'new', testDb),
    ).toBeNull();
  });
});

describe('propagateSubcategoryNameToProducts / clearProductsSubcategoryByName / deleteInternalSubcategoryByCategoryAndName', () => {
  test('propagateSubcategoryNameToProducts returns the affected row count', async () => {
    exec.enqueue({ rows: [], rowCount: 2 });
    const count = await productsRepo.propagateSubcategoryNameToProducts(
      'old',
      'new',
      'good',
      'cat-a',
      testDb,
    );
    expect(count).toBe(2);
    expect(exec.calls[0].sql.toLowerCase()).toContain('"supplier_id" is null');
    expect(exec.calls[0].params).toContain('new');
    expect(exec.calls[0].params).toContain('good');
    expect(exec.calls[0].params).toContain('cat-a');
    expect(exec.calls[0].params).toContain('old');
  });

  test('clearProductsSubcategoryByName sets subcategory to NULL', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    await productsRepo.clearProductsSubcategoryByName('sub-a', 'good', 'cat-a', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('"subcategory"');
    expect(exec.calls[0].params).toContain('good');
    expect(exec.calls[0].params).toContain('cat-a');
    expect(exec.calls[0].params).toContain('sub-a');
  });

  test('deleteInternalSubcategoryByCategoryAndName returns {id} or null', async () => {
    exec.enqueue({ rows: [['ips-1']], rowCount: 1 });
    expect(
      await productsRepo.deleteInternalSubcategoryByCategoryAndName('ipc-1', 'sub-a', testDb),
    ).toEqual({ id: 'ips-1' });

    exec.enqueue({ rows: [], rowCount: 0 });
    expect(
      await productsRepo.deleteInternalSubcategoryByCategoryAndName('ipc-1', 'sub-a', testDb),
    ).toBeNull();
  });
});

describe('countProductsForSubcategory', () => {
  test('parses count and filters by type/category/subcategory with supplier_id IS NULL', async () => {
    exec.enqueue({ rows: [['3']] });
    expect(await productsRepo.countProductsForSubcategory('sub-a', 'good', 'cat-a', testDb)).toBe(
      3,
    );
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('"supplier_id" is null');
    expect(sql).toContain('"subcategory"');
    expect(exec.calls[0].params).toContain('good');
    expect(exec.calls[0].params).toContain('cat-a');
    expect(exec.calls[0].params).toContain('sub-a');
  });

  test('returns 0 when no row', async () => {
    exec.enqueue({ rows: [] });
    expect(await productsRepo.countProductsForSubcategory('sub-a', 'good', 'cat-a', testDb)).toBe(
      0,
    );
  });
});

// ===========================================================================
// Cross-domain link checks
// ===========================================================================

describe('checkProductsLinkedToTransactions', () => {
  test('returns {linked: false, count: 0} when SUM is 0', async () => {
    exec.enqueue({ rows: [{ total: '0' }] });
    const result = await productsRepo.checkProductsLinkedToTransactions(
      'cat-a',
      'good',
      undefined,
      testDb,
    );
    expect(result).toEqual({ linked: false, count: 0 });
    expect(exec.calls).toHaveLength(1);
  });

  test('without subcategory, params include only category and type', async () => {
    exec.enqueue({ rows: [{ total: '0' }] });
    await productsRepo.checkProductsLinkedToTransactions('cat-a', 'good', undefined, testDb);
    expect(exec.calls[0].params).toContain('cat-a');
    expect(exec.calls[0].params).toContain('good');
    expect(exec.calls[0].params).not.toContain('sub-a');
  });

  test('with subcategory, adds the subcategory predicate', async () => {
    exec.enqueue({ rows: [{ total: '0' }] });
    await productsRepo.checkProductsLinkedToTransactions('cat-a', 'good', 'sub-a', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('subcategory');
    expect(exec.calls[0].params).toContain('cat-a');
    expect(exec.calls[0].params).toContain('good');
    expect(exec.calls[0].params).toContain('sub-a');
  });

  test('runs a single CTE+UNION-ALL query referencing all 7 transaction tables', async () => {
    exec.enqueue({ rows: [{ total: '5' }] });
    const result = await productsRepo.checkProductsLinkedToTransactions(
      'cat-a',
      'good',
      undefined,
      testDb,
    );
    expect(exec.calls).toHaveLength(1);
    expect(result).toEqual({ linked: true, count: 5 });
    const linkSql = exec.calls[0].sql;
    expect(linkSql).toContain('quote_items');
    expect(linkSql).toContain('customer_offer_items');
    expect(linkSql).toContain('sale_items');
    expect(linkSql).toContain('invoice_items');
    expect(linkSql).toContain('supplier_quote_items');
    expect(linkSql).toContain('supplier_sale_items');
    expect(linkSql).toContain('supplier_invoice_items');
    // Product ids never leave Postgres — the matched-ids CTE feeds all 7 subqueries directly.
    expect(linkSql).toMatch(/with\s+matched\s+as/i);
    expect(exec.calls[0].params).toEqual(['cat-a', 'good']);
  });
});
