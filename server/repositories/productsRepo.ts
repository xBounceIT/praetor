import { and, asc, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { productCategories } from '../db/schema/productCategories.ts';
import { productSubcategories } from '../db/schema/productSubcategories.ts';
import { products } from '../db/schema/products.ts';
import { productTypes } from '../db/schema/productTypes.ts';
import { suppliers } from '../db/schema/suppliers.ts';
import type { CostUnit } from '../utils/cost-unit.ts';
import { numericForDb, parseDbNumber, parseNullableDbNumber } from '../utils/parse.ts';

// Accepts whatever pg returns for a timestamp column. Drizzle's typed `.select()` paths
// give us `Date`, but raw `executeRows` queries (this file uses both) can surface a string
// if the pg type parsers are reconfigured — coerce defensively, like projectsRepo does.
const epochMs = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  return new Date(v as string | number | Date).getTime();
};

const LEGACY_HOURS_TYPES = new Set(['service', 'consulting']);

// Transaction-item tables holding a `product_id` foreign key.
const TRANSACTION_ITEM_TABLES = [
  'quote_items',
  'customer_offer_items',
  'sale_items',
  'invoice_items',
  'supplier_quote_items',
  'supplier_sale_items',
  'supplier_invoice_items',
] as const;

const PRODUCT_LINKED_EXISTS_CLAUSE = sql.join(
  TRANSACTION_ITEM_TABLES.map(
    (t) => sql`SELECT 1 FROM ${sql.identifier(t)} WHERE product_id = pr.id`,
  ),
  sql` UNION ALL `,
);

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
  exec: DbExecutor = db,
): Promise<Map<string, ProductSnapshot>> => {
  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
  const snapshots = new Map<string, ProductSnapshot>();
  if (uniqueIds.length === 0) return snapshots;

  const rows = await exec
    .select({
      id: products.id,
      costo: products.costo,
      molPercentage: products.molPercentage,
    })
    .from(products)
    .where(inArray(products.id, uniqueIds));

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

type ProductSelectRow = typeof products.$inferSelect & { supplierName?: string | null };

const mapProductRow = (row: ProductSelectRow): ProductRow => ({
  id: row.id,
  name: row.name,
  productCode: row.productCode,
  createdAt: epochMs(row.createdAt),
  description: row.description,
  costo: parseDbNumber(row.costo, 0),
  molPercentage: parseDbNumber(row.molPercentage, 0),
  costUnit: row.costUnit,
  category: row.category,
  subcategory: row.subcategory,
  type: row.type,
  supplierId: row.supplierId,
  supplierName: row.supplierName ?? null,
  isDisabled: row.isDisabled ?? false,
});

const PRODUCT_COLUMNS = {
  id: products.id,
  name: products.name,
  productCode: products.productCode,
  createdAt: products.createdAt,
  description: products.description,
  costo: products.costo,
  molPercentage: products.molPercentage,
  costUnit: products.costUnit,
  category: products.category,
  subcategory: products.subcategory,
  type: products.type,
  supplierId: products.supplierId,
  isDisabled: products.isDisabled,
} as const;

export const listAllProducts = async (exec: DbExecutor = db): Promise<ProductRow[]> => {
  const rows = await exec
    .select({ ...PRODUCT_COLUMNS, supplierName: suppliers.name })
    .from(products)
    .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
    .orderBy(asc(products.name));
  return rows.map(mapProductRow);
};

export const findProductById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<ProductRow | null> => {
  const rows = await exec.select(PRODUCT_COLUMNS).from(products).where(eq(products.id, id));
  return rows[0] ? mapProductRow(rows[0]) : null;
};

export const findProductCoreById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<ProductCore | null> => {
  const rows = await exec
    .select({
      type: products.type,
      supplierId: products.supplierId,
      category: products.category,
    })
    .from(products)
    .where(eq(products.id, id));
  return rows[0] ?? null;
};

export const existsProductByName = async (
  name: string,
  excludeId: string | null,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const conditions = [sql`LOWER(${products.name}) = LOWER(${name})`];
  if (excludeId) conditions.push(ne(products.id, excludeId));
  const rows = await exec
    .select({ id: products.id })
    .from(products)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
};

export const existsProductByCode = async (
  code: string,
  excludeId: string | null,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const conditions = [eq(products.productCode, code)];
  if (excludeId) conditions.push(ne(products.id, excludeId));
  const rows = await exec
    .select({ id: products.id })
    .from(products)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
};

export const insertProduct = async (
  product: NewProduct,
  exec: DbExecutor = db,
): Promise<ProductRow> => {
  const rows = await exec
    .insert(products)
    .values({
      id: product.id,
      name: product.name,
      productCode: product.productCode,
      description: product.description,
      costo: numericForDb(product.costo),
      molPercentage: numericForDb(product.molPercentage),
      costUnit: product.costUnit,
      category: product.category,
      subcategory: product.subcategory,
      type: product.type,
      supplierId: product.supplierId,
    })
    .returning();
  return mapProductRow(rows[0]);
};

export const updateProductDynamic = async (
  id: string,
  fields: ProductUpdateFields,
  exec: DbExecutor = db,
): Promise<ProductRow | null> => {
  const setClause: Partial<typeof products.$inferInsert> = {};
  if (fields.name !== undefined) setClause.name = fields.name;
  if (fields.productCode !== undefined) setClause.productCode = fields.productCode;
  if (fields.description !== undefined) setClause.description = fields.description;
  if (fields.costo !== undefined) setClause.costo = numericForDb(fields.costo);
  if (fields.molPercentage !== undefined)
    setClause.molPercentage = numericForDb(fields.molPercentage);
  if (fields.type !== undefined) setClause.type = fields.type;
  if (fields.category !== undefined) setClause.category = fields.category;
  if (fields.subcategory !== undefined) setClause.subcategory = fields.subcategory;
  if (fields.supplierId !== undefined) setClause.supplierId = fields.supplierId;
  if (fields.costUnit !== undefined) setClause.costUnit = fields.costUnit;
  if (fields.isDisabled !== undefined) setClause.isDisabled = fields.isDisabled;

  if (Object.keys(setClause).length === 0) return null;

  const rows = await exec.update(products).set(setClause).where(eq(products.id, id)).returning();
  return rows[0] ? mapProductRow(rows[0]) : null;
};

export const deleteProductById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ name: string; productCode: string } | null> => {
  const rows = await exec
    .delete(products)
    .where(eq(products.id, id))
    .returning({ name: products.name, productCode: products.productCode });
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

type ProductTypeSelectRow = typeof productTypes.$inferSelect & {
  productCount?: string | number | null;
  categoryCount?: string | number | null;
};

const mapProductTypeRow = (row: ProductTypeSelectRow): ProductTypeRow => ({
  id: row.id,
  name: row.name,
  costUnit: row.costUnit,
  createdAt: epochMs(row.createdAt),
  updatedAt: epochMs(row.updatedAt),
  productCount: parseDbNumber(row.productCount, 0),
  categoryCount: parseDbNumber(row.categoryCount, 0),
});

export const listAllProductTypesWithCounts = async (
  exec: DbExecutor = db,
): Promise<ProductTypeRow[]> => {
  const rows = await executeRows<ProductTypeSelectRow>(
    exec,
    sql`SELECT
          t.id,
          t.name,
          t.cost_unit AS "costUnit",
          t.created_at AS "createdAt",
          t.updated_at AS "updatedAt",
          COALESCE(p.count, 0) AS "productCount",
          COALESCE(c.count, 0) AS "categoryCount"
        FROM product_types t
        LEFT JOIN (
          SELECT type, COUNT(*) AS count FROM products GROUP BY type
        ) p ON t.name = p.type
        LEFT JOIN (
          SELECT type, COUNT(*) AS count FROM internal_product_categories GROUP BY type
        ) c ON t.name = c.type
        ORDER BY t.name ASC`,
  );
  return rows.map(mapProductTypeRow);
};

export const findProductTypeByName = async (
  name: string,
  exec: DbExecutor = db,
): Promise<CostUnit | null> => {
  const rows = await exec
    .select({ costUnit: productTypes.costUnit })
    .from(productTypes)
    .where(eq(productTypes.name, name));
  return rows[0]?.costUnit ?? null;
};

// Falls back to the historical defaults for service/consulting types when the row is missing.
export const getCostUnitForType = async (
  typeName: string,
  exec: DbExecutor = db,
): Promise<CostUnit> => {
  const found = await findProductTypeByName(typeName, exec);
  if (found !== null) return found;
  return LEGACY_HOURS_TYPES.has(typeName) ? 'hours' : 'unit';
};

export const existsProductTypeByName = async (
  name: string,
  excludeId: string | null,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const conditions = [sql`LOWER(${productTypes.name}) = LOWER(${name})`];
  if (excludeId) conditions.push(ne(productTypes.id, excludeId));
  const rows = await exec
    .select({ id: productTypes.id })
    .from(productTypes)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
};

export const findProductTypeById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<ProductTypeCore | null> => {
  const rows = await exec
    .select({ id: productTypes.id, name: productTypes.name, costUnit: productTypes.costUnit })
    .from(productTypes)
    .where(eq(productTypes.id, id));
  return rows[0] ?? null;
};

export const insertProductType = async (
  id: string,
  name: string,
  costUnit: CostUnit,
  exec: DbExecutor = db,
): Promise<ProductTypeRow> => {
  const rows = await exec.insert(productTypes).values({ id, name, costUnit }).returning();
  return mapProductTypeRow(rows[0]);
};

export const updateProductTypeFields = async (
  id: string,
  name: string,
  costUnit: CostUnit,
  exec: DbExecutor = db,
): Promise<ProductTypeRow | null> => {
  const rows = await exec
    .update(productTypes)
    .set({ name, costUnit, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(productTypes.id, id))
    .returning();
  return rows[0] ? mapProductTypeRow(rows[0]) : null;
};

export const propagateProductTypeName = async (
  oldName: string,
  newName: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec.update(products).set({ type: newName }).where(eq(products.type, oldName));
  await exec
    .update(productCategories)
    .set({ type: newName })
    .where(eq(productCategories.type, oldName));
};

export const propagateProductTypeCostUnit = async (
  typeName: string,
  costUnit: CostUnit,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec
    .update(products)
    .set({ costUnit })
    .where(and(eq(products.type, typeName), isNull(products.supplierId)));
  await exec
    .update(productCategories)
    .set({ costUnit })
    .where(eq(productCategories.type, typeName));
};

export const countProductsForType = async (
  typeName: string,
  exec: DbExecutor = db,
): Promise<number> => {
  const [row] = await exec
    .select({ value: count() })
    .from(products)
    .where(eq(products.type, typeName));
  return row?.value ?? 0;
};

export const countCategoriesForType = async (
  typeName: string,
  exec: DbExecutor = db,
): Promise<number> => {
  const [row] = await exec
    .select({ value: count() })
    .from(productCategories)
    .where(eq(productCategories.type, typeName));
  return row?.value ?? 0;
};

export const deleteProductTypeById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const result = await exec.delete(productTypes).where(eq(productTypes.id, id));
  return (result.rowCount ?? 0) > 0;
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

type InternalCategorySelectRow = typeof productCategories.$inferSelect & {
  productCount?: string | number | null;
  hasLinkedProducts?: boolean | null;
};

const mapInternalCategoryRow = (row: InternalCategorySelectRow): InternalCategoryRow => ({
  id: row.id,
  name: row.name,
  type: row.type,
  costUnit: row.costUnit,
  createdAt: epochMs(row.createdAt),
  updatedAt: epochMs(row.updatedAt),
  productCount: parseDbNumber(row.productCount, 0),
  hasLinkedProducts: row.hasLinkedProducts ?? false,
});

export const listInternalCategoriesByType = async (
  type: string,
  exec: DbExecutor = db,
): Promise<InternalCategoryRow[]> => {
  const rows = await executeRows<InternalCategorySelectRow>(
    exec,
    sql`SELECT c.id, c.name, c.type,
              c.cost_unit AS "costUnit",
              c.created_at AS "createdAt", c.updated_at AS "updatedAt",
              COALESCE(p.count, 0) AS "productCount",
              COALESCE(lp.has_linked, false) AS "hasLinkedProducts"
        FROM internal_product_categories c
        LEFT JOIN (
          SELECT category, COUNT(*) AS count
            FROM products
           WHERE type = ${type} AND supplier_id IS NULL
           GROUP BY category
        ) p ON c.name = p.category
        LEFT JOIN (
          SELECT pr.category, true AS has_linked
            FROM products pr
           WHERE pr.type = ${type}
             AND pr.supplier_id IS NULL
             AND EXISTS (${PRODUCT_LINKED_EXISTS_CLAUSE})
           GROUP BY pr.category
        ) lp ON c.name = lp.category
        WHERE c.type = ${type}
        ORDER BY c.name ASC`,
  );
  return rows.map(mapInternalCategoryRow);
};

export const findInternalCategoryById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ id: string; name: string; type: string } | null> => {
  const rows = await exec
    .select({
      id: productCategories.id,
      name: productCategories.name,
      type: productCategories.type,
    })
    .from(productCategories)
    .where(eq(productCategories.id, id));
  return rows[0] ?? null;
};

export const findCategoryIdByNameAndType = async (
  name: string,
  type: string,
  exec: DbExecutor = db,
): Promise<string | null> => {
  const rows = await exec
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(and(eq(productCategories.name, name), eq(productCategories.type, type)));
  return rows[0]?.id ?? null;
};

export const existsInternalCategoryByNameType = async (
  name: string,
  type: string,
  excludeId: string | null,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const conditions = [
    sql`LOWER(${productCategories.name}) = LOWER(${name})`,
    eq(productCategories.type, type),
  ];
  if (excludeId) conditions.push(ne(productCategories.id, excludeId));
  const rows = await exec
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
};

export const insertInternalCategory = async (
  id: string,
  name: string,
  type: string,
  costUnit: CostUnit,
  exec: DbExecutor = db,
): Promise<InternalCategoryRow> => {
  const rows = await exec
    .insert(productCategories)
    .values({ id, name, type, costUnit })
    .returning();
  return mapInternalCategoryRow(rows[0]);
};

export const updateInternalCategoryFields = async (
  id: string,
  name: string,
  costUnit: CostUnit,
  exec: DbExecutor = db,
): Promise<InternalCategoryRow | null> => {
  const rows = await exec
    .update(productCategories)
    .set({ name, costUnit, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(productCategories.id, id))
    .returning();
  return rows[0] ? mapInternalCategoryRow(rows[0]) : null;
};

export const propagateCategoryNameToProducts = async (
  oldName: string,
  newName: string,
  type: string,
  costUnit: CostUnit,
  exec: DbExecutor = db,
): Promise<number> => {
  const result = await exec
    .update(products)
    .set({ category: newName, costUnit })
    .where(
      and(eq(products.category, oldName), eq(products.type, type), isNull(products.supplierId)),
    );
  return result.rowCount ?? 0;
};

export const clearProductsCategoryByName = async (
  name: string,
  type: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec
    .update(products)
    .set({ category: null, subcategory: null })
    .where(and(eq(products.category, name), eq(products.type, type), isNull(products.supplierId)));
};

export const deleteInternalCategoryById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const result = await exec.delete(productCategories).where(eq(productCategories.id, id));
  return (result.rowCount ?? 0) > 0;
};

export const countProductsForCategory = async (
  name: string,
  type: string,
  exec: DbExecutor = db,
): Promise<number> => {
  const [row] = await exec
    .select({ value: count() })
    .from(products)
    .where(and(eq(products.category, name), eq(products.type, type), isNull(products.supplierId)));
  return row?.value ?? 0;
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
  exec: DbExecutor = db,
): Promise<SubcategoryRow[]> => {
  const rows = await executeRows<{
    name: string;
    productCount: string | number | null;
    hasLinkedProducts: boolean | null;
  }>(
    exec,
    sql`SELECT s.name,
              COALESCE(p.count, 0) AS "productCount",
              COALESCE(lp.has_linked, false) AS "hasLinkedProducts"
        FROM internal_product_subcategories s
        LEFT JOIN (
          SELECT pr.subcategory, COUNT(*) AS count
            FROM products pr
            JOIN internal_product_categories c
              ON c.name = pr.category AND c.type = pr.type
           WHERE c.id = ${categoryId} AND pr.supplier_id IS NULL
           GROUP BY pr.subcategory
        ) p ON s.name = p.subcategory
        LEFT JOIN (
          SELECT pr.subcategory, true AS has_linked
            FROM products pr
            JOIN internal_product_categories c
              ON c.name = pr.category AND c.type = pr.type
           WHERE c.id = ${categoryId}
             AND pr.supplier_id IS NULL
             AND EXISTS (${PRODUCT_LINKED_EXISTS_CLAUSE})
           GROUP BY pr.subcategory
        ) lp ON s.name = lp.subcategory
        WHERE s.category_id = ${categoryId}
        ORDER BY s.name ASC`,
  );
  return rows.map((row) => ({
    name: row.name,
    productCount: parseDbNumber(row.productCount, 0),
    hasLinkedProducts: row.hasLinkedProducts ?? false,
  }));
};

export const existsInternalSubcategoryByNameInCategory = async (
  name: string,
  categoryId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const rows = await exec
    .select({ id: productSubcategories.id })
    .from(productSubcategories)
    .where(
      and(
        eq(productSubcategories.categoryId, categoryId),
        sql`LOWER(${productSubcategories.name}) = LOWER(${name})`,
      ),
    )
    .limit(1);
  return rows.length > 0;
};

export const insertInternalSubcategory = async (
  id: string,
  categoryId: string,
  name: string,
  exec: DbExecutor = db,
): Promise<{ name: string }> => {
  const rows = await exec
    .insert(productSubcategories)
    .values({ id, categoryId, name })
    .returning({ name: productSubcategories.name });
  return rows[0];
};

export const updateInternalSubcategoryName = async (
  categoryId: string,
  oldName: string,
  newName: string,
  exec: DbExecutor = db,
): Promise<{ id: string } | null> => {
  const rows = await exec
    .update(productSubcategories)
    .set({ name: newName, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(
      and(eq(productSubcategories.categoryId, categoryId), eq(productSubcategories.name, oldName)),
    )
    .returning({ id: productSubcategories.id });
  return rows[0] ?? null;
};

export const propagateSubcategoryNameToProducts = async (
  oldName: string,
  newName: string,
  type: string,
  category: string,
  exec: DbExecutor = db,
): Promise<number> => {
  const result = await exec
    .update(products)
    .set({ subcategory: newName })
    .where(
      and(
        eq(products.type, type),
        eq(products.category, category),
        isNull(products.supplierId),
        eq(products.subcategory, oldName),
      ),
    );
  return result.rowCount ?? 0;
};

export const clearProductsSubcategoryByName = async (
  name: string,
  type: string,
  category: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec
    .update(products)
    .set({ subcategory: null })
    .where(
      and(
        eq(products.type, type),
        eq(products.category, category),
        isNull(products.supplierId),
        eq(products.subcategory, name),
      ),
    );
};

export const deleteInternalSubcategoryByCategoryAndName = async (
  categoryId: string,
  name: string,
  exec: DbExecutor = db,
): Promise<{ id: string } | null> => {
  const rows = await exec
    .delete(productSubcategories)
    .where(
      and(eq(productSubcategories.categoryId, categoryId), eq(productSubcategories.name, name)),
    )
    .returning({ id: productSubcategories.id });
  return rows[0] ?? null;
};

export const countProductsForSubcategory = async (
  name: string,
  type: string,
  category: string,
  exec: DbExecutor = db,
): Promise<number> => {
  const [row] = await exec
    .select({ value: count() })
    .from(products)
    .where(
      and(
        eq(products.type, type),
        eq(products.category, category),
        isNull(products.supplierId),
        eq(products.subcategory, name),
      ),
    );
  return row?.value ?? 0;
};

// ===========================================================================
// Cross-domain link checks
// ===========================================================================

export const checkProductsLinkedToTransactions = async (
  category: string,
  type: string,
  subcategory: string | undefined,
  exec: DbExecutor = db,
): Promise<{ linked: boolean; count: number }> => {
  const subcategoryClause =
    subcategory !== undefined ? sql`AND subcategory = ${subcategory}` : sql``;
  const linkCountSubqueries = sql.join(
    TRANSACTION_ITEM_TABLES.map(
      (t) =>
        sql`SELECT COUNT(*)::bigint AS c FROM ${sql.identifier(t)} WHERE product_id IN (SELECT id FROM matched)`,
    ),
    sql` UNION ALL `,
  );

  const rows = await executeRows<{ total: string | number | null }>(
    exec,
    sql`WITH matched AS (
          SELECT id FROM products
          WHERE category = ${category} AND type = ${type} AND supplier_id IS NULL
                ${subcategoryClause}
        )
        SELECT COALESCE(SUM(c), 0)::bigint AS total FROM (${linkCountSubqueries}) sub`,
  );
  const totalLinks = parseDbNumber(rows[0]?.total, 0);

  return { linked: totalLinks > 0, count: totalLinks };
};
