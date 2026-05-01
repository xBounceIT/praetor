import { beforeEach, describe, expect, test } from 'bun:test';
import * as productsRepo from '../../repositories/productsRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

describe('getSnapshots', () => {
  test('returns empty Map when given no ids without issuing a query', async () => {
    const result = await productsRepo.getSnapshots([], exec);
    expect(result.size).toBe(0);
    expect(exec.calls).toHaveLength(0);
  });

  test('deduplicates ids and passes a unique-set array to ANY($1)', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.getSnapshots(['p-1', 'p-1', 'p-2'], exec);
    expect(exec.calls[0].sql).toContain('id = ANY($1)');
    expect(exec.calls[0].params).toEqual([['p-1', 'p-2']]);
  });

  test('maps cost as number and preserves null molPercentage', async () => {
    exec.enqueue({
      rows: [
        { id: 'p-1', costo: '10.5', molPercentage: '20' },
        { id: 'p-2', costo: '5', molPercentage: null },
      ],
    });
    const result = await productsRepo.getSnapshots(['p-1', 'p-2'], exec);
    expect(result.get('p-1')).toEqual({ productCost: 10.5, productMolPercentage: 20 });
    expect(result.get('p-2')).toEqual({ productCost: 5, productMolPercentage: null });
  });

  test('coerces empty/falsy ids out before deduplication', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.getSnapshots(['', 'p-1', ''], exec);
    expect(exec.calls[0].params).toEqual([['p-1']]);
  });
});

// ===========================================================================
// Product CRUD
// ===========================================================================

const sampleProductRow = {
  id: 'p-1',
  name: 'Widget',
  productCode: 'WGT-001',
  createdAt: '2024-01-15T10:00:00Z',
  description: 'A widget',
  costo: 12.5,
  molPercentage: 30,
  costUnit: 'unit',
  category: 'cat-a',
  subcategory: 'sub-a',
  type: 'good',
  supplierId: null,
  supplierName: null,
  isDisabled: false,
};

describe('listAllProducts', () => {
  test('joins suppliers and converts createdAt to epoch ms', async () => {
    exec.enqueue({ rows: [sampleProductRow] });
    const result = await productsRepo.listAllProducts(exec);
    expect(exec.calls[0].sql).toContain('LEFT JOIN suppliers');
    expect(result[0].createdAt).toBe(new Date('2024-01-15T10:00:00Z').getTime());
    expect(result[0].name).toBe('Widget');
  });

  test('returns null createdAt when row.createdAt is null', async () => {
    exec.enqueue({ rows: [{ ...sampleProductRow, createdAt: null }] });
    const [row] = await productsRepo.listAllProducts(exec);
    expect(row.createdAt).toBeNull();
  });
});

describe('findProductById / findProductCoreById', () => {
  test('findProductById returns mapped row when present', async () => {
    exec.enqueue({ rows: [sampleProductRow] });
    const result = await productsRepo.findProductById('p-1', exec);
    expect(result?.id).toBe('p-1');
    expect(exec.calls[0].params).toEqual(['p-1']);
  });

  test('findProductById returns null when no row', async () => {
    exec.enqueue({ rows: [] });
    expect(await productsRepo.findProductById('p-1', exec)).toBeNull();
  });

  test('findProductCoreById returns just type/supplierId/category', async () => {
    exec.enqueue({
      rows: [{ type: 'service', supplierId: 's-1', category: 'cat-a' }],
    });
    const result = await productsRepo.findProductCoreById('p-1', exec);
    expect(result).toEqual({ type: 'service', supplierId: 's-1', category: 'cat-a' });
  });
});

describe('existsProductByName / existsProductByCode', () => {
  test('existsProductByName uses LOWER() for case-insensitive matching', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.existsProductByName('Widget', null, exec);
    expect(exec.calls[0].sql).toContain('LOWER(name) = LOWER($1)');
    expect(exec.calls[0].params).toEqual(['Widget']);
  });

  test('existsProductByName with excludeId adds the AND id != $2 clause', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.existsProductByName('Widget', 'p-2', exec);
    expect(exec.calls[0].sql).toContain('id != $2');
    expect(exec.calls[0].params).toEqual(['Widget', 'p-2']);
  });

  test('existsProductByCode without excludeId queries by exact match', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.existsProductByCode('WGT-001', null, exec);
    expect(exec.calls[0].sql).toContain('product_code = $1');
    expect(exec.calls[0].params).toEqual(['WGT-001']);
  });

  test.each([
    [[{ id: 'p-1' }], true],
    [[], false],
  ] as const)('existsProductByCode returns %s for rows %j', async (rows, expected) => {
    exec.enqueue({ rows: [...rows] });
    expect(await productsRepo.existsProductByCode('WGT-001', null, exec)).toBe(expected);
  });
});

describe('insertProduct', () => {
  test('passes all 11 columns in declared order and maps the returned row', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'p-1',
          name: 'Widget',
          productCode: 'WGT-001',
          createdAt: '2024-01-15T10:00:00Z',
          description: null,
          costo: 12.5,
          molPercentage: 30,
          costUnit: 'unit',
          category: null,
          subcategory: null,
          type: 'good',
          supplierId: null,
        },
      ],
      rowCount: 1,
    });
    await productsRepo.insertProduct(
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
      exec,
    );
    expect(exec.calls[0].params).toEqual([
      'p-1',
      'Widget',
      'WGT-001',
      null,
      12.5,
      30,
      'unit',
      null,
      null,
      'good',
      null,
    ]);
  });
});

describe('updateProductDynamic', () => {
  test('returns null without issuing a query when fields is empty', async () => {
    const result = await productsRepo.updateProductDynamic('p-1', {}, exec);
    expect(result).toBeNull();
    expect(exec.calls.length).toBe(0);
  });

  test('builds SET only for the provided fields and appends id last', async () => {
    exec.enqueue({ rows: [sampleProductRow], rowCount: 1 });
    await productsRepo.updateProductDynamic(
      'p-1',
      { name: 'New Name', costo: 99, isDisabled: true },
      exec,
    );
    const sql = exec.calls[0].sql;
    expect(sql).toContain('name = $1');
    expect(sql).toContain('costo = $2');
    expect(sql).toContain('is_disabled = $3');
    expect(sql).toContain('WHERE id = $4');
    expect(exec.calls[0].params).toEqual(['New Name', 99, true, 'p-1']);
  });

  test('uses snake_case column names for camelCase keys', async () => {
    exec.enqueue({ rows: [sampleProductRow], rowCount: 1 });
    await productsRepo.updateProductDynamic(
      'p-1',
      { productCode: 'X-1', molPercentage: 10, supplierId: 's-2', costUnit: 'hours' },
      exec,
    );
    const sql = exec.calls[0].sql;
    expect(sql).toContain('product_code = $1');
    expect(sql).toContain('mol_percentage = $2');
    expect(sql).toContain('supplier_id = $3');
    expect(sql).toContain('cost_unit = $4');
  });

  test('returns null when UPDATE finds no row', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    const result = await productsRepo.updateProductDynamic('p-1', { name: 'X' }, exec);
    expect(result).toBeNull();
  });
});

describe('deleteProductById', () => {
  test('returns the {name, productCode} from RETURNING', async () => {
    exec.enqueue({ rows: [{ name: 'Widget', productCode: 'WGT-001' }], rowCount: 1 });
    const result = await productsRepo.deleteProductById('p-1', exec);
    expect(result).toEqual({ name: 'Widget', productCode: 'WGT-001' });
  });

  test('returns null when no row was deleted', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    expect(await productsRepo.deleteProductById('p-1', exec)).toBeNull();
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
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
          productCount: '5',
          categoryCount: '3',
        },
      ],
    });
    const [row] = await productsRepo.listAllProductTypesWithCounts(exec);
    expect(row.productCount).toBe(5);
    expect(row.categoryCount).toBe(3);
    expect(row.createdAt).toBe(new Date('2024-01-01T00:00:00Z').getTime());
  });
});

describe('findProductTypeByName', () => {
  test('findProductTypeByName returns {costUnit} or null', async () => {
    exec.enqueue({ rows: [{ costUnit: 'hours' }] });
    expect(await productsRepo.findProductTypeByName('service', exec)).toEqual({
      costUnit: 'hours',
    });
    exec.enqueue({ rows: [] });
    expect(await productsRepo.findProductTypeByName('missing', exec)).toBeNull();
  });
});

describe('existsProductTypeByName', () => {
  test('without excludeId checks LOWER() match', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.existsProductTypeByName('Service', null, exec);
    expect(exec.calls[0].sql).toContain('LOWER(name) = LOWER($1)');
    expect(exec.calls[0].params).toEqual(['Service']);
  });

  test('with excludeId excludes the given id', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.existsProductTypeByName('Service', 'pt-1', exec);
    expect(exec.calls[0].sql).toContain('id != $2');
    expect(exec.calls[0].params).toEqual(['Service', 'pt-1']);
  });
});

describe('findProductTypeById / insertProductType / updateProductTypeFields', () => {
  test('findProductTypeById returns the mapped row or null', async () => {
    exec.enqueue({ rows: [{ id: 'pt-1', name: 'good', costUnit: 'unit' }] });
    const result = await productsRepo.findProductTypeById('pt-1', exec);
    expect(result).toEqual({ id: 'pt-1', name: 'good', costUnit: 'unit' });

    exec.enqueue({ rows: [] });
    expect(await productsRepo.findProductTypeById('pt-99', exec)).toBeNull();
  });

  test('insertProductType passes [id, name, costUnit] and zero counts', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'pt-1',
          name: 'good',
          costUnit: 'unit',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
      rowCount: 1,
    });
    const result = await productsRepo.insertProductType('pt-1', 'good', 'unit', exec);
    expect(exec.calls[0].params).toEqual(['pt-1', 'good', 'unit']);
    expect(result.productCount).toBe(0);
    expect(result.categoryCount).toBe(0);
  });

  test('updateProductTypeFields passes [name, costUnit, id]', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'pt-1',
          name: 'service',
          costUnit: 'hours',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
        },
      ],
      rowCount: 1,
    });
    await productsRepo.updateProductTypeFields('pt-1', 'service', 'hours', exec);
    expect(exec.calls[0].params).toEqual(['service', 'hours', 'pt-1']);
  });

  test('updateProductTypeFields returns null when no row updated', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    expect(await productsRepo.updateProductTypeFields('pt-99', 'x', 'unit', exec)).toBeNull();
  });
});

describe('product type propagations', () => {
  test('propagateProductTypeName updates both products.type and internal_product_categories.type', async () => {
    exec.enqueue({ rows: [], rowCount: 5 });
    exec.enqueue({ rows: [], rowCount: 3 });
    await productsRepo.propagateProductTypeName('old', 'new', exec);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('UPDATE products SET type = $1 WHERE type = $2');
    expect(exec.calls[0].params).toEqual(['new', 'old']);
    expect(exec.calls[1].sql).toContain('UPDATE internal_product_categories SET type');
    expect(exec.calls[1].params).toEqual(['new', 'old']);
  });

  test('propagateProductTypeCostUnit updates products (internal only) and categories', async () => {
    exec.enqueue({ rows: [], rowCount: 4 });
    exec.enqueue({ rows: [], rowCount: 2 });
    await productsRepo.propagateProductTypeCostUnit('good', 'hours', exec);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('supplier_id IS NULL');
    expect(exec.calls[0].params).toEqual(['hours', 'good']);
    expect(exec.calls[1].sql).toContain('UPDATE internal_product_categories SET cost_unit');
    expect(exec.calls[1].params).toEqual(['hours', 'good']);
  });
});

describe('countProductsForType / countCategoriesForType', () => {
  test.each([
    ['7', 7],
    ['0', 0],
  ] as const)('countProductsForType parses "%s" to %s', async (count, expected) => {
    exec.enqueue({ rows: [{ count }] });
    expect(await productsRepo.countProductsForType('good', exec)).toBe(expected);
    expect(exec.calls[0].params).toEqual(['good']);
  });

  test('countProductsForType returns 0 when no row', async () => {
    exec.enqueue({ rows: [] });
    expect(await productsRepo.countProductsForType('good', exec)).toBe(0);
  });

  test('countCategoriesForType filters by type and parses count', async () => {
    exec.enqueue({ rows: [{ count: '4' }] });
    expect(await productsRepo.countCategoriesForType('good', exec)).toBe(4);
    expect(exec.calls[0].sql).toContain('FROM internal_product_categories WHERE type = $1');
  });
});

describe('deleteProductTypeById', () => {
  test.each([
    [1, true],
    [0, false],
  ] as const)('returns %s when rowCount is %s', async (rowCount, expected) => {
    exec.enqueue({ rows: [], rowCount });
    expect(await productsRepo.deleteProductTypeById('pt-1', exec)).toBe(expected);
  });
});

// ===========================================================================
// Internal categories
// ===========================================================================

const sampleCategoryRow = {
  id: 'ipc-1',
  name: 'Mechanical',
  type: 'good',
  costUnit: 'unit',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
  productCount: '3',
  hasLinkedProducts: true,
};

describe('listInternalCategoriesByType', () => {
  test('passes type as $1 and parses productCount + hasLinkedProducts', async () => {
    exec.enqueue({ rows: [sampleCategoryRow] });
    const [row] = await productsRepo.listInternalCategoriesByType('good', exec);
    expect(exec.calls[0].params).toEqual(['good']);
    expect(row.productCount).toBe(3);
    expect(row.hasLinkedProducts).toBe(true);
    expect(row.createdAt).toBe(new Date('2024-01-01T00:00:00Z').getTime());
  });
});

describe('findInternalCategoryById / findCategoryIdByNameAndType', () => {
  test('findInternalCategoryById returns {id, name, type} or null', async () => {
    exec.enqueue({ rows: [{ id: 'ipc-1', name: 'Mechanical', type: 'good' }] });
    expect(await productsRepo.findInternalCategoryById('ipc-1', exec)).toEqual({
      id: 'ipc-1',
      name: 'Mechanical',
      type: 'good',
    });

    exec.enqueue({ rows: [] });
    expect(await productsRepo.findInternalCategoryById('ipc-99', exec)).toBeNull();
  });

  test('findCategoryIdByNameAndType returns the id string or null', async () => {
    exec.enqueue({ rows: [{ id: 'ipc-1' }] });
    expect(await productsRepo.findCategoryIdByNameAndType('Mechanical', 'good', exec)).toBe(
      'ipc-1',
    );

    exec.enqueue({ rows: [] });
    expect(await productsRepo.findCategoryIdByNameAndType('Missing', 'good', exec)).toBeNull();
  });
});

describe('existsInternalCategoryByNameType', () => {
  test('without excludeId compares LOWER name + type', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.existsInternalCategoryByNameType('Mechanical', 'good', null, exec);
    expect(exec.calls[0].sql).toContain('LOWER(name) = LOWER($1) AND type = $2');
    expect(exec.calls[0].params).toEqual(['Mechanical', 'good']);
  });

  test('with excludeId adds AND id != $3', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.existsInternalCategoryByNameType('Mechanical', 'good', 'ipc-1', exec);
    expect(exec.calls[0].sql).toContain('id != $3');
    expect(exec.calls[0].params).toEqual(['Mechanical', 'good', 'ipc-1']);
  });
});

describe('insertInternalCategory / updateInternalCategoryFields', () => {
  test('insertInternalCategory passes [id, name, type, costUnit] and starts with zero counts', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'ipc-1',
          name: 'Mechanical',
          type: 'good',
          costUnit: 'unit',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
      rowCount: 1,
    });
    const result = await productsRepo.insertInternalCategory(
      'ipc-1',
      'Mechanical',
      'good',
      'unit',
      exec,
    );
    expect(exec.calls[0].params).toEqual(['ipc-1', 'Mechanical', 'good', 'unit']);
    expect(result.productCount).toBe(0);
    expect(result.hasLinkedProducts).toBe(false);
  });

  test('updateInternalCategoryFields passes [name, costUnit, id]', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'ipc-1',
          name: 'Renamed',
          type: 'good',
          costUnit: 'unit',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
        },
      ],
      rowCount: 1,
    });
    await productsRepo.updateInternalCategoryFields('ipc-1', 'Renamed', 'unit', exec);
    expect(exec.calls[0].params).toEqual(['Renamed', 'unit', 'ipc-1']);
  });

  test('updateInternalCategoryFields returns null when no row updated', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    expect(await productsRepo.updateInternalCategoryFields('ipc-99', 'x', 'unit', exec)).toBeNull();
  });
});

describe('propagateCategoryNameToProducts / clearProductsCategoryByName', () => {
  test('propagateCategoryNameToProducts only touches internal products', async () => {
    exec.enqueue({ rows: [], rowCount: 4 });
    await productsRepo.propagateCategoryNameToProducts('oldCat', 'newCat', 'good', 'unit', exec);
    expect(exec.calls[0].sql).toContain('supplier_id IS NULL');
    expect(exec.calls[0].params).toEqual(['newCat', 'unit', 'oldCat', 'good']);
  });

  test('clearProductsCategoryByName clears category and subcategory', async () => {
    exec.enqueue({ rows: [], rowCount: 2 });
    await productsRepo.clearProductsCategoryByName('cat-a', 'good', exec);
    expect(exec.calls[0].sql).toContain('SET category = NULL, subcategory = NULL');
    expect(exec.calls[0].params).toEqual(['cat-a', 'good']);
  });
});

describe('deleteInternalCategoryById / countProductsForCategory', () => {
  test.each([
    [1, true],
    [0, false],
  ] as const)('deleteInternalCategoryById returns %s when rowCount is %s', async (rowCount, expected) => {
    exec.enqueue({ rows: [], rowCount });
    expect(await productsRepo.deleteInternalCategoryById('ipc-1', exec)).toBe(expected);
  });

  test('countProductsForCategory parses count and filters supplier_id IS NULL', async () => {
    exec.enqueue({ rows: [{ count: '6' }] });
    expect(await productsRepo.countProductsForCategory('cat-a', 'good', exec)).toBe(6);
    expect(exec.calls[0].sql).toContain('supplier_id IS NULL');
    expect(exec.calls[0].params).toEqual(['cat-a', 'good']);
  });
});

// ===========================================================================
// Internal subcategories
// ===========================================================================

describe('listInternalSubcategoriesByType', () => {
  test('passes [categoryId] and parses productCount', async () => {
    exec.enqueue({
      rows: [{ name: 'sub-a', productCount: '2', hasLinkedProducts: false }],
    });
    const [row] = await productsRepo.listInternalSubcategoriesByType('ipc-1', exec);
    expect(exec.calls[0].params).toEqual(['ipc-1']);
    expect(row).toEqual({ name: 'sub-a', productCount: 2, hasLinkedProducts: false });
  });
});

describe('existsInternalSubcategoryByNameInCategory', () => {
  test('passes [categoryId, name] and case-insensitive matches', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.existsInternalSubcategoryByNameInCategory('Sub-A', 'ipc-1', exec);
    expect(exec.calls[0].sql).toContain('LOWER(name) = LOWER($2)');
    expect(exec.calls[0].params).toEqual(['ipc-1', 'Sub-A']);
  });

  test.each([
    [[{ '?column?': 1 }], true],
    [[], false],
  ] as const)('returns %s when query returns %j rows', async (rows, expected) => {
    exec.enqueue({ rows: [...rows] });
    expect(
      await productsRepo.existsInternalSubcategoryByNameInCategory('sub-a', 'ipc-1', exec),
    ).toBe(expected);
  });
});

describe('insertInternalSubcategory / updateInternalSubcategoryName', () => {
  test('insertInternalSubcategory passes [id, categoryId, name] and returns the row', async () => {
    exec.enqueue({ rows: [{ name: 'sub-a' }], rowCount: 1 });
    const result = await productsRepo.insertInternalSubcategory('ips-1', 'ipc-1', 'sub-a', exec);
    expect(exec.calls[0].params).toEqual(['ips-1', 'ipc-1', 'sub-a']);
    expect(result).toEqual({ name: 'sub-a' });
  });

  test('updateInternalSubcategoryName passes [newName, categoryId, oldName]', async () => {
    exec.enqueue({ rows: [{ id: 'ips-1' }], rowCount: 1 });
    const result = await productsRepo.updateInternalSubcategoryName('ipc-1', 'old', 'new', exec);
    expect(exec.calls[0].params).toEqual(['new', 'ipc-1', 'old']);
    expect(result).toEqual({ id: 'ips-1' });
  });

  test('updateInternalSubcategoryName returns null when no row matched', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    expect(
      await productsRepo.updateInternalSubcategoryName('ipc-1', 'old', 'new', exec),
    ).toBeNull();
  });
});

describe('propagateSubcategoryNameToProducts / clearProductsSubcategoryByName / deleteInternalSubcategoryByCategoryAndName', () => {
  test('propagateSubcategoryNameToProducts returns the affected row count', async () => {
    exec.enqueue({ rows: [{ id: 'p-1' }, { id: 'p-2' }], rowCount: 2 });
    const count = await productsRepo.propagateSubcategoryNameToProducts(
      'old',
      'new',
      'good',
      'cat-a',
      exec,
    );
    expect(count).toBe(2);
    expect(exec.calls[0].sql).toContain('supplier_id IS NULL');
    expect(exec.calls[0].params).toEqual(['new', 'good', 'cat-a', 'old']);
  });

  test('clearProductsSubcategoryByName sets subcategory to NULL', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    await productsRepo.clearProductsSubcategoryByName('sub-a', 'good', 'cat-a', exec);
    expect(exec.calls[0].sql).toContain('SET subcategory = NULL');
    expect(exec.calls[0].params).toEqual(['good', 'cat-a', 'sub-a']);
  });

  test('deleteInternalSubcategoryByCategoryAndName returns {id} or null', async () => {
    exec.enqueue({ rows: [{ id: 'ips-1' }], rowCount: 1 });
    expect(
      await productsRepo.deleteInternalSubcategoryByCategoryAndName('ipc-1', 'sub-a', exec),
    ).toEqual({ id: 'ips-1' });

    exec.enqueue({ rows: [], rowCount: 0 });
    expect(
      await productsRepo.deleteInternalSubcategoryByCategoryAndName('ipc-1', 'sub-a', exec),
    ).toBeNull();
  });
});

// ===========================================================================
// Cross-domain link checks
// ===========================================================================

describe('checkProductsLinkedToTransactions', () => {
  test('returns {linked: false, count: 0} when no products match category+type', async () => {
    exec.enqueue({ rows: [] });
    const result = await productsRepo.checkProductsLinkedToTransactions(
      'cat-a',
      'good',
      undefined,
      exec,
    );
    expect(result).toEqual({ linked: false, count: 0 });
    expect(exec.calls).toHaveLength(1);
  });

  test('without subcategory, the product-id query has only $1 and $2 params', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.checkProductsLinkedToTransactions('cat-a', 'good', undefined, exec);
    expect(exec.calls[0].params).toEqual(['cat-a', 'good']);
    expect(exec.calls[0].sql).not.toContain('subcategory');
  });

  test('with subcategory, adds AND subcategory = $3', async () => {
    exec.enqueue({ rows: [] });
    await productsRepo.checkProductsLinkedToTransactions('cat-a', 'good', 'sub-a', exec);
    expect(exec.calls[0].sql).toContain('AND subcategory = $3');
    expect(exec.calls[0].params).toEqual(['cat-a', 'good', 'sub-a']);
  });

  test('runs a single UNION-ALL count query that references all 7 transaction tables', async () => {
    exec.enqueue({ rows: [{ id: 'p-1' }, { id: 'p-2' }] });
    exec.enqueue({ rows: [{ total: '5' }] });
    const result = await productsRepo.checkProductsLinkedToTransactions(
      'cat-a',
      'good',
      undefined,
      exec,
    );
    expect(exec.calls).toHaveLength(2); // 1 product fetch + 1 aggregated count
    expect(result).toEqual({ linked: true, count: 5 });
    const linkSql = exec.calls[1].sql;
    expect(linkSql).toContain('quote_items');
    expect(linkSql).toContain('customer_offer_items');
    expect(linkSql).toContain('sale_items');
    expect(linkSql).toContain('invoice_items');
    expect(linkSql).toContain('supplier_quote_items');
    expect(linkSql).toContain('supplier_sale_items');
    expect(linkSql).toContain('supplier_invoice_items');
    expect(exec.calls[1].params).toEqual([['p-1', 'p-2']]);
  });

  test('returns {linked: false, count: 0} when products match but no links', async () => {
    exec.enqueue({ rows: [{ id: 'p-1' }] });
    exec.enqueue({ rows: [{ total: '0' }] });
    const result = await productsRepo.checkProductsLinkedToTransactions(
      'cat-a',
      'good',
      undefined,
      exec,
    );
    expect(result).toEqual({ linked: false, count: 0 });
  });
});
