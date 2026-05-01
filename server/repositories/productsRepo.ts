import pool, { type QueryExecutor } from '../db/index.ts';
import { parseDbNumber, parseNullableDbNumber } from '../utils/parse.ts';

// Transaction-item tables that hold a `product_id` foreign key. Used in linked-products
// existence checks when renaming/deleting categories, subcategories, and types.
const TRANSACTION_ITEM_TABLES = [
  'quote_items',
  'customer_offer_items',
  'sale_items',
  'invoice_items',
  'supplier_quote_items',
  'supplier_sale_items',
  'supplier_invoice_items',
] as const;

const PRODUCT_LINKED_EXISTS_CLAUSE = TRANSACTION_ITEM_TABLES.map(
  (t) => `SELECT 1 FROM ${t} WHERE product_id = pr.id`,
).join(' UNION ALL ');

export type ProductSnapshot = {
  productCost: number;
  productMolPercentage: number | null;
};

/**
 * Reads product cost (`costo`) and MOL% (`mol_percentage`) for a set of product ids,
 * deduplicates the inputs, and returns a Map keyed by product id.
 */
export const getSnapshots = async (
  productIds: string[],
  exec: QueryExecutor = pool,
): Promise<Map<string, ProductSnapshot>> => {
  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
  const snapshots = new Map<string, ProductSnapshot>();
  if (uniqueIds.length === 0) return snapshots;

  const { rows } = await exec.query<{
    id: string;
    costo: string | number | null;
    molPercentage: string | number | null;
  }>(
    `SELECT id, costo, mol_percentage as "molPercentage"
       FROM products
      WHERE id = ANY($1)`,
    [uniqueIds],
  );

  for (const row of rows) {
    snapshots.set(row.id, {
      productCost: parseDbNumber(row.costo, 0),
      productMolPercentage: parseNullableDbNumber(row.molPercentage),
    });
  }
  return snapshots;
};

// ===========================================================================
// Product CRUD endpoints
// ===========================================================================

export type CostUnit = 'unit' | 'hours';

export type ProductRow = {
  id: string;
  name: string;
  productCode: string;
  createdAt: number | null;
  description: string | null;
  costo: number;
  molPercentage: number;
  costUnit: CostUnit;
  category: string | null;
  subcategory: string | null;
  type: string;
  supplierId: string | null;
  supplierName?: string | null;
  isDisabled: boolean;
};

export type ProductCore = {
  type: string;
  supplierId: string | null;
  category: string | null;
};

export type NewProduct = {
  id: string;
  name: string;
  productCode: string;
  description: string | null;
  costo: number;
  molPercentage: number;
  costUnit: CostUnit;
  category: string | null;
  subcategory: string | null;
  type: string;
  supplierId: string | null;
};

export type ProductUpdateFields = Partial<{
  name: string;
  productCode: string;
  description: string | null;
  costo: number;
  molPercentage: number;
  type: string;
  category: string | null;
  subcategory: string | null;
  supplierId: string | null;
  costUnit: CostUnit;
  isDisabled: boolean;
}>;

const toEpochMs = (v: unknown): number | null =>
  v === null || v === undefined ? null : new Date(v as string | Date).getTime();

const mapProductRow = (row: Record<string, unknown>): ProductRow => ({
  ...(row as Omit<ProductRow, 'createdAt' | 'costo' | 'molPercentage'>),
  costo: parseDbNumber(row.costo as string | number | null | undefined, 0),
  molPercentage: parseDbNumber(row.molPercentage as string | number | null | undefined, 0),
  createdAt: toEpochMs(row.createdAt),
});

const PRODUCT_LIST_COLUMNS = `
  p.id,
  p.name,
  p.product_code as "productCode",
  p.created_at as "createdAt",
  p.description,
  p.costo,
  p.mol_percentage as "molPercentage",
  p.cost_unit as "costUnit",
  p.category,
  p.subcategory,
  p.type,
  p.supplier_id as "supplierId",
  s.name as "supplierName",
  p.is_disabled as "isDisabled"
`;

const PRODUCT_DETAIL_COLUMNS = `
  id,
  name,
  product_code as "productCode",
  created_at as "createdAt",
  description,
  costo,
  mol_percentage as "molPercentage",
  cost_unit as "costUnit",
  category,
  subcategory,
  type,
  is_disabled as "isDisabled",
  supplier_id as "supplierId"
`;

const PRODUCT_INSERT_RETURNING = `
  id,
  name,
  product_code as "productCode",
  created_at as "createdAt",
  description,
  costo,
  mol_percentage as "molPercentage",
  cost_unit as "costUnit",
  category,
  subcategory,
  type,
  supplier_id as "supplierId"
`;

export const listAllProducts = async (exec: QueryExecutor = pool): Promise<ProductRow[]> => {
  const { rows } = await exec.query(
    `SELECT ${PRODUCT_LIST_COLUMNS}
       FROM products p
       LEFT JOIN suppliers s ON p.supplier_id = s.id
      ORDER BY p.name ASC`,
  );
  return rows.map(mapProductRow);
};

export const findProductById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<ProductRow | null> => {
  const { rows } = await exec.query(
    `SELECT ${PRODUCT_DETAIL_COLUMNS}
       FROM products
      WHERE id = $1`,
    [id],
  );
  return rows[0] ? mapProductRow(rows[0]) : null;
};

export const findProductCoreById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<ProductCore | null> => {
  const { rows } = await exec.query<{
    type: string;
    supplierId: string | null;
    category: string | null;
  }>(
    `SELECT type, supplier_id AS "supplierId", category
       FROM products
      WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
};

export const existsProductByName = async (
  name: string,
  excludeId: string | null,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rows } = excludeId
    ? await exec.query(`SELECT id FROM products WHERE LOWER(name) = LOWER($1) AND id != $2`, [
        name,
        excludeId,
      ])
    : await exec.query(`SELECT id FROM products WHERE LOWER(name) = LOWER($1)`, [name]);
  return rows.length > 0;
};

export const existsProductByCode = async (
  code: string,
  excludeId: string | null,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rows } = excludeId
    ? await exec.query(`SELECT id FROM products WHERE product_code = $1 AND id != $2`, [
        code,
        excludeId,
      ])
    : await exec.query(`SELECT id FROM products WHERE product_code = $1`, [code]);
  return rows.length > 0;
};

export const insertProduct = async (
  product: NewProduct,
  exec: QueryExecutor = pool,
): Promise<ProductRow> => {
  const { rows } = await exec.query(
    `INSERT INTO products (id, name, product_code, description, costo, mol_percentage, cost_unit, category, subcategory, type, supplier_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${PRODUCT_INSERT_RETURNING}`,
    [
      product.id,
      product.name,
      product.productCode,
      product.description,
      product.costo,
      product.molPercentage,
      product.costUnit,
      product.category,
      product.subcategory,
      product.type,
      product.supplierId,
    ],
  );
  return mapProductRow(rows[0]);
};

export const updateProductDynamic = async (
  id: string,
  fields: ProductUpdateFields,
  exec: QueryExecutor = pool,
): Promise<ProductRow | null> => {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  const push = (column: string, value: unknown) => {
    sets.push(`${column} = $${idx++}`);
    params.push(value);
  };

  if (fields.name !== undefined) push('name', fields.name);
  if (fields.productCode !== undefined) push('product_code', fields.productCode);
  if (fields.description !== undefined) push('description', fields.description);
  if (fields.costo !== undefined) push('costo', fields.costo);
  if (fields.molPercentage !== undefined) push('mol_percentage', fields.molPercentage);
  if (fields.type !== undefined) push('type', fields.type);
  if (fields.category !== undefined) push('category', fields.category);
  if (fields.subcategory !== undefined) push('subcategory', fields.subcategory);
  if (fields.supplierId !== undefined) push('supplier_id', fields.supplierId);
  if (fields.costUnit !== undefined) push('cost_unit', fields.costUnit);
  if (fields.isDisabled !== undefined) push('is_disabled', fields.isDisabled);

  if (sets.length === 0) return null;

  params.push(id);
  const { rows } = await exec.query(
    `UPDATE products
        SET ${sets.join(', ')}
      WHERE id = $${idx}
   RETURNING ${PRODUCT_DETAIL_COLUMNS}`,
    params,
  );
  return rows[0] ? mapProductRow(rows[0]) : null;
};

export const deleteProductById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<{ name: string; productCode: string } | null> => {
  const { rows } = await exec.query<{ name: string; productCode: string }>(
    `DELETE FROM products
      WHERE id = $1
   RETURNING name, product_code as "productCode"`,
    [id],
  );
  return rows[0] ?? null;
};

// ===========================================================================
// Product types (user-managed)
// ===========================================================================

export type ProductTypeRow = {
  id: string;
  name: string;
  costUnit: CostUnit;
  createdAt: number | null;
  updatedAt: number | null;
  productCount: number;
  categoryCount: number;
};

export type ProductTypeCore = {
  id: string;
  name: string;
  costUnit: CostUnit;
};

const mapProductTypeRow = (row: Record<string, unknown>): ProductTypeRow => ({
  id: row.id as string,
  name: row.name as string,
  costUnit: row.costUnit as CostUnit,
  createdAt: toEpochMs(row.createdAt),
  updatedAt: toEpochMs(row.updatedAt),
  productCount: parseDbNumber(row.productCount as string | number | null | undefined, 0),
  categoryCount: parseDbNumber(row.categoryCount as string | number | null | undefined, 0),
});

export const listAllProductTypesWithCounts = async (
  exec: QueryExecutor = pool,
): Promise<ProductTypeRow[]> => {
  const { rows } = await exec.query(
    `SELECT
        t.id,
        t.name,
        t.cost_unit as "costUnit",
        t.created_at as "createdAt",
        t.updated_at as "updatedAt",
        COALESCE(p.count, 0) as "productCount",
        COALESCE(c.count, 0) as "categoryCount"
       FROM product_types t
       LEFT JOIN (
         SELECT type, COUNT(*) as count FROM products GROUP BY type
       ) p ON t.name = p.type
       LEFT JOIN (
         SELECT type, COUNT(*) as count FROM internal_product_categories GROUP BY type
       ) c ON t.name = c.type
       ORDER BY t.name ASC`,
  );
  return rows.map(mapProductTypeRow);
};

export const findProductTypeByName = async (
  name: string,
  exec: QueryExecutor = pool,
): Promise<{ costUnit: CostUnit } | null> => {
  const { rows } = await exec.query<{ costUnit: CostUnit }>(
    `SELECT cost_unit AS "costUnit" FROM product_types WHERE name = $1`,
    [name],
  );
  return rows[0] ?? null;
};

// Returns the cost_unit registered for `typeName`, falling back to the historical defaults
// for service/consulting types when the registered row is missing.
export const getCostUnitForType = async (
  typeName: string,
  exec: QueryExecutor = pool,
): Promise<CostUnit> => {
  const found = await findProductTypeByName(typeName, exec);
  if (found) return found.costUnit;
  return typeName === 'service' || typeName === 'consulting' ? 'hours' : 'unit';
};

export const existsProductTypeByName = async (
  name: string,
  excludeId: string | null,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rows } = excludeId
    ? await exec.query(`SELECT id FROM product_types WHERE LOWER(name) = LOWER($1) AND id != $2`, [
        name,
        excludeId,
      ])
    : await exec.query(`SELECT id FROM product_types WHERE LOWER(name) = LOWER($1)`, [name]);
  return rows.length > 0;
};

export const findProductTypeById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<{ id: string; name: string; costUnit: CostUnit } | null> => {
  const { rows } = await exec.query<{ id: string; name: string; costUnit: CostUnit }>(
    `SELECT id, name, cost_unit AS "costUnit" FROM product_types WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
};

export const insertProductType = async (
  id: string,
  name: string,
  costUnit: CostUnit,
  exec: QueryExecutor = pool,
): Promise<ProductTypeRow> => {
  const { rows } = await exec.query(
    `INSERT INTO product_types (id, name, cost_unit)
     VALUES ($1, $2, $3)
     RETURNING id, name, cost_unit as "costUnit",
               created_at as "createdAt", updated_at as "updatedAt"`,
    [id, name, costUnit],
  );
  return mapProductTypeRow({ ...rows[0], productCount: 0, categoryCount: 0 });
};

export const updateProductTypeFields = async (
  id: string,
  name: string,
  costUnit: CostUnit,
  exec: QueryExecutor = pool,
): Promise<ProductTypeRow | null> => {
  const { rows } = await exec.query(
    `UPDATE product_types
        SET name = $1, cost_unit = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
   RETURNING id, name, cost_unit as "costUnit",
             created_at as "createdAt", updated_at as "updatedAt"`,
    [name, costUnit, id],
  );
  return rows[0] ? mapProductTypeRow({ ...rows[0], productCount: 0, categoryCount: 0 }) : null;
};

export const propagateProductTypeName = async (
  oldName: string,
  newName: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(`UPDATE products SET type = $1 WHERE type = $2`, [newName, oldName]);
  await exec.query(`UPDATE internal_product_categories SET type = $1 WHERE type = $2`, [
    newName,
    oldName,
  ]);
};

export const propagateProductTypeCostUnit = async (
  typeName: string,
  costUnit: CostUnit,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(`UPDATE products SET cost_unit = $1 WHERE type = $2 AND supplier_id IS NULL`, [
    costUnit,
    typeName,
  ]);
  await exec.query(`UPDATE internal_product_categories SET cost_unit = $1 WHERE type = $2`, [
    costUnit,
    typeName,
  ]);
};

export const countProductsForType = async (
  typeName: string,
  exec: QueryExecutor = pool,
): Promise<number> => {
  const { rows } = await exec.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM products WHERE type = $1`,
    [typeName],
  );
  return parseDbNumber(rows[0]?.count, 0);
};

export const countCategoriesForType = async (
  typeName: string,
  exec: QueryExecutor = pool,
): Promise<number> => {
  const { rows } = await exec.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM internal_product_categories WHERE type = $1`,
    [typeName],
  );
  return parseDbNumber(rows[0]?.count, 0);
};

export const deleteProductTypeById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rowCount } = await exec.query(`DELETE FROM product_types WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
};

// ===========================================================================
// Internal product categories
// ===========================================================================

export type InternalCategoryRow = {
  id: string;
  name: string;
  type: string;
  costUnit: CostUnit;
  createdAt: number | null;
  updatedAt: number | null;
  productCount: number;
  hasLinkedProducts: boolean;
};

const mapInternalCategoryRow = (row: Record<string, unknown>): InternalCategoryRow => ({
  id: row.id as string,
  name: row.name as string,
  type: row.type as string,
  costUnit: row.costUnit as CostUnit,
  createdAt: toEpochMs(row.createdAt),
  updatedAt: toEpochMs(row.updatedAt),
  productCount: parseDbNumber(row.productCount as string | number | null | undefined, 0),
  hasLinkedProducts: !!row.hasLinkedProducts,
});

export const listInternalCategoriesByType = async (
  type: string,
  exec: QueryExecutor = pool,
): Promise<InternalCategoryRow[]> => {
  const { rows } = await exec.query(
    `SELECT c.id, c.name, c.type,
            c.cost_unit as "costUnit",
            c.created_at as "createdAt", c.updated_at as "updatedAt",
            COALESCE(p.count, 0) as "productCount",
            COALESCE(lp.has_linked, false) as "hasLinkedProducts"
       FROM internal_product_categories c
       LEFT JOIN (
         SELECT category, COUNT(*) as count
           FROM products
          WHERE type = $1 AND supplier_id IS NULL
          GROUP BY category
       ) p ON c.name = p.category
       LEFT JOIN (
         SELECT pr.category, true as has_linked
           FROM products pr
          WHERE pr.type = $1
            AND pr.supplier_id IS NULL
            AND EXISTS (${PRODUCT_LINKED_EXISTS_CLAUSE})
          GROUP BY pr.category
       ) lp ON c.name = lp.category
      WHERE c.type = $1
      ORDER BY c.name ASC`,
    [type],
  );
  return rows.map(mapInternalCategoryRow);
};

export const findInternalCategoryById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<{ id: string; name: string; type: string } | null> => {
  const { rows } = await exec.query<{ id: string; name: string; type: string }>(
    `SELECT id, name, type FROM internal_product_categories WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
};

export const findCategoryIdByNameAndType = async (
  name: string,
  type: string,
  exec: QueryExecutor = pool,
): Promise<string | null> => {
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM internal_product_categories WHERE name = $1 AND type = $2`,
    [name, type],
  );
  return rows[0]?.id ?? null;
};

export const existsInternalCategoryByNameType = async (
  name: string,
  type: string,
  excludeId: string | null,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rows } = excludeId
    ? await exec.query(
        `SELECT id FROM internal_product_categories
          WHERE LOWER(name) = LOWER($1) AND type = $2 AND id != $3`,
        [name, type, excludeId],
      )
    : await exec.query(
        `SELECT id FROM internal_product_categories
          WHERE LOWER(name) = LOWER($1) AND type = $2`,
        [name, type],
      );
  return rows.length > 0;
};

export const insertInternalCategory = async (
  id: string,
  name: string,
  type: string,
  costUnit: CostUnit,
  exec: QueryExecutor = pool,
): Promise<InternalCategoryRow> => {
  const { rows } = await exec.query(
    `INSERT INTO internal_product_categories (id, name, type, cost_unit)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, type, cost_unit as "costUnit",
               created_at as "createdAt", updated_at as "updatedAt"`,
    [id, name, type, costUnit],
  );
  return mapInternalCategoryRow({
    ...rows[0],
    productCount: 0,
    hasLinkedProducts: false,
  });
};

export const updateInternalCategoryFields = async (
  id: string,
  name: string,
  costUnit: CostUnit,
  exec: QueryExecutor = pool,
): Promise<InternalCategoryRow | null> => {
  const { rows } = await exec.query(
    `UPDATE internal_product_categories
        SET name = $1, cost_unit = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
   RETURNING id, name, type, cost_unit as "costUnit",
             created_at as "createdAt", updated_at as "updatedAt"`,
    [name, costUnit, id],
  );
  return rows[0]
    ? mapInternalCategoryRow({ ...rows[0], productCount: 0, hasLinkedProducts: false })
    : null;
};

export const propagateCategoryNameToProducts = async (
  oldName: string,
  newName: string,
  type: string,
  costUnit: CostUnit,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(
    `UPDATE products
        SET category = $1, cost_unit = $2
      WHERE category = $3 AND type = $4 AND supplier_id IS NULL`,
    [newName, costUnit, oldName, type],
  );
};

export const clearProductsCategoryByName = async (
  name: string,
  type: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(
    `UPDATE products
        SET category = NULL, subcategory = NULL
      WHERE category = $1 AND type = $2 AND supplier_id IS NULL`,
    [name, type],
  );
};

export const deleteInternalCategoryById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rowCount } = await exec.query(`DELETE FROM internal_product_categories WHERE id = $1`, [
    id,
  ]);
  return (rowCount ?? 0) > 0;
};

export const countProductsForCategory = async (
  name: string,
  type: string,
  exec: QueryExecutor = pool,
): Promise<number> => {
  const { rows } = await exec.query<{ count: string }>(
    `SELECT COUNT(*) as count
       FROM products
      WHERE category = $1 AND type = $2 AND supplier_id IS NULL`,
    [name, type],
  );
  return parseDbNumber(rows[0]?.count, 0);
};

// ===========================================================================
// Internal product subcategories
// ===========================================================================

export type SubcategoryRow = {
  name: string;
  productCount: number;
  hasLinkedProducts: boolean;
};

export const listInternalSubcategoriesByType = async (
  categoryId: string,
  exec: QueryExecutor = pool,
): Promise<SubcategoryRow[]> => {
  const { rows } = await exec.query<{
    name: string;
    productCount: string | number;
    hasLinkedProducts: boolean;
  }>(
    `SELECT s.name,
            COALESCE(p.count, 0) as "productCount",
            COALESCE(lp.has_linked, false) as "hasLinkedProducts"
       FROM internal_product_subcategories s
       LEFT JOIN (
         SELECT pr.subcategory, COUNT(*) as count
           FROM products pr
           JOIN internal_product_categories c
             ON c.name = pr.category AND c.type = pr.type
          WHERE c.id = $1 AND pr.supplier_id IS NULL
          GROUP BY pr.subcategory
       ) p ON s.name = p.subcategory
       LEFT JOIN (
         SELECT pr.subcategory, true as has_linked
           FROM products pr
           JOIN internal_product_categories c
             ON c.name = pr.category AND c.type = pr.type
          WHERE c.id = $1
            AND pr.supplier_id IS NULL
            AND EXISTS (${PRODUCT_LINKED_EXISTS_CLAUSE})
          GROUP BY pr.subcategory
       ) lp ON s.name = lp.subcategory
      WHERE s.category_id = $1
      ORDER BY s.name ASC`,
    [categoryId],
  );
  return rows.map((row) => ({
    name: row.name,
    productCount: parseDbNumber(row.productCount, 0),
    hasLinkedProducts: !!row.hasLinkedProducts,
  }));
};

export const existsInternalSubcategoryByNameInCategory = async (
  name: string,
  categoryId: string,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rows } = await exec.query(
    `SELECT 1 FROM internal_product_subcategories
      WHERE category_id = $1 AND LOWER(name) = LOWER($2)
      LIMIT 1`,
    [categoryId, name],
  );
  return rows.length > 0;
};

export const insertInternalSubcategory = async (
  id: string,
  categoryId: string,
  name: string,
  exec: QueryExecutor = pool,
): Promise<{ name: string }> => {
  const { rows } = await exec.query<{ name: string }>(
    `INSERT INTO internal_product_subcategories (id, category_id, name)
     VALUES ($1, $2, $3)
     RETURNING name`,
    [id, categoryId, name],
  );
  return rows[0];
};

export const updateInternalSubcategoryName = async (
  categoryId: string,
  oldName: string,
  newName: string,
  exec: QueryExecutor = pool,
): Promise<{ id: string } | null> => {
  const { rows } = await exec.query<{ id: string }>(
    `UPDATE internal_product_subcategories
        SET name = $1, updated_at = CURRENT_TIMESTAMP
      WHERE category_id = $2 AND name = $3
   RETURNING id`,
    [newName, categoryId, oldName],
  );
  return rows[0] ?? null;
};

export const propagateSubcategoryNameToProducts = async (
  oldName: string,
  newName: string,
  type: string,
  category: string,
  exec: QueryExecutor = pool,
): Promise<number> => {
  const { rows } = await exec.query<{ id: string }>(
    `UPDATE products
        SET subcategory = $1
      WHERE type = $2
        AND category = $3
        AND supplier_id IS NULL
        AND subcategory = $4
   RETURNING id`,
    [newName, type, category, oldName],
  );
  return rows.length;
};

export const clearProductsSubcategoryByName = async (
  name: string,
  type: string,
  category: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(
    `UPDATE products
        SET subcategory = NULL
      WHERE type = $1
        AND category = $2
        AND supplier_id IS NULL
        AND subcategory = $3`,
    [type, category, name],
  );
};

export const deleteInternalSubcategoryByCategoryAndName = async (
  categoryId: string,
  name: string,
  exec: QueryExecutor = pool,
): Promise<{ id: string } | null> => {
  const { rows } = await exec.query<{ id: string }>(
    `DELETE FROM internal_product_subcategories
      WHERE category_id = $1 AND name = $2
   RETURNING id`,
    [categoryId, name],
  );
  return rows[0] ?? null;
};

// ===========================================================================
// Cross-domain link checks
// ===========================================================================

const TRANSACTION_LINK_COUNT_SUBQUERIES = TRANSACTION_ITEM_TABLES.map(
  (t) => `SELECT COUNT(*)::bigint AS c FROM ${t} WHERE product_id = ANY($1)`,
).join(' UNION ALL ');

export const checkProductsLinkedToTransactions = async (
  category: string,
  type: string,
  subcategory: string | undefined,
  exec: QueryExecutor = pool,
): Promise<{ linked: boolean; count: number }> => {
  const subcategoryCondition = subcategory !== undefined ? `AND subcategory = $3` : '';
  const params = subcategory !== undefined ? [category, type, subcategory] : [category, type];

  const productResult = await exec.query<{ id: string }>(
    `SELECT id FROM products
       WHERE category = $1
         AND type = $2
         AND supplier_id IS NULL
         ${subcategoryCondition}`,
    params,
  );

  if (productResult.rows.length === 0) {
    return { linked: false, count: 0 };
  }

  const productIds = productResult.rows.map((r) => r.id);
  const linkResult = await exec.query<{ total: string }>(
    `SELECT SUM(c)::bigint AS total FROM (${TRANSACTION_LINK_COUNT_SUBQUERIES}) sub`,
    [productIds],
  );
  const totalLinks = parseDbNumber(linkResult.rows[0]?.total, 0);

  return { linked: totalLinks > 0, count: totalLinks };
};
