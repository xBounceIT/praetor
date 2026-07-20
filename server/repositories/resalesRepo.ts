import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import {
  type ResaleBillingFrequency,
  resaleActivities,
  resaleCategories,
  resales,
} from '../db/schema/resales.ts';
import { saleItems, sales } from '../db/schema/sales.ts';
import { supplierSales } from '../db/schema/supplierSales.ts';
import type { SupplierOrder, SupplierOrderItem } from '../repositories/supplierOrdersRepo.ts';
import * as supplierOrdersRepo from '../repositories/supplierOrdersRepo.ts';
import { effectiveDurationMultiplier } from '../utils/duration-unit.ts';
import {
  getDiscountedUnitPrice,
  getDocumentDiscountAmount,
  roundCurrency,
} from '../utils/invoice-math.ts';
import { numericForDb, parseDbNumber } from '../utils/parse.ts';

const epochMs = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  return new Date(value as string | number | Date).getTime();
};

export type ResaleCategory = {
  id: string;
  name: string;
  createdAt: number | null;
  updatedAt: number | null;
  activityCount: number;
  hasLinkedActivities: boolean;
};

export type ResaleActivity = {
  id: string;
  resaleId: string;
  name: string;
  billingFrequency: ResaleBillingFrequency;
  categoryId: string;
  categoryName: string;
  cost: number;
  revenue: number;
  released: boolean;
  dueDate: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Resale = {
  id: string;
  clientOrderId: string;
  supplierOrderId: string;
  clientName: string;
  supplierName: string;
  supplierOrderCost: number;
  activityCostTotal: number;
  resaleRevenue: number;
  costVariance: number;
  startDate: string | null;
  dueDate: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  activities: ResaleActivity[];
};

export type ResaleOrderOption = {
  clientOrderId: string;
  clientName: string;
  supplierOrders: Array<{
    id: string;
    supplierName: string;
    total: number;
  }>;
};

type ResaleBaseRow = {
  id: string;
  clientOrderId: string;
  supplierOrderId: string;
  clientName: string;
  supplierName: string;
  startDate: string | null;
  dueDate: string | null;
  notes: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
};

type ActivitySelectRow = typeof resaleActivities.$inferSelect & {
  categoryName: string | null;
};

const mapActivity = (row: ActivitySelectRow): ResaleActivity => ({
  id: row.id,
  resaleId: row.resaleId,
  name: row.name,
  billingFrequency: row.billingFrequency ?? 'one_time',
  categoryId: row.categoryId,
  categoryName: row.categoryName ?? '',
  cost: parseDbNumber(row.cost, 0),
  revenue: parseDbNumber(row.revenue, 0),
  released: row.released ?? false,
  dueDate: row.dueDate ?? null,
  notes: row.notes,
  createdAt: epochMs(row.createdAt),
  updatedAt: epochMs(row.updatedAt),
});

const mapCategory = (
  row: typeof resaleCategories.$inferSelect & {
    activityCount?: string | number | null;
  },
): ResaleCategory => {
  const activityCount = parseDbNumber(row.activityCount, 0);
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt ? epochMs(row.createdAt) : null,
    updatedAt: row.updatedAt ? epochMs(row.updatedAt) : null,
    activityCount,
    hasLinkedActivities: activityCount > 0,
  };
};

export const computeSupplierOrderTotal = (
  order: Pick<SupplierOrder, 'discount' | 'discountType'>,
  items: SupplierOrderItem[],
): number => {
  const subtotal = items.reduce((sum, item) => {
    const duration = effectiveDurationMultiplier(
      item.durationUnit,
      item.durationMonths,
      item.pricingSemanticsVersion,
    );
    const discountedUnitPrice = getDiscountedUnitPrice(
      Number(item.unitPrice || 0),
      Number(item.discount || 0),
    );
    return sum + Number(item.quantity || 0) * discountedUnitPrice * duration;
  }, 0);

  const discount = Number(order.discount || 0);
  const discountAmount = getDocumentDiscountAmount(subtotal, discount, order.discountType);

  return roundCurrency(subtotal - discountAmount);
};

export const computeSupplierOrderCost = async (
  supplierOrderId: string,
  exec: DbExecutor = db,
): Promise<number> => {
  const full = await supplierOrdersRepo.findFullForSnapshot(supplierOrderId, exec);
  if (!full) return 0;
  return computeSupplierOrderTotal(full.order, full.items);
};

const hydrateResales = async (rows: ResaleBaseRow[], exec: DbExecutor = db): Promise<Resale[]> => {
  if (rows.length === 0) return [];

  const resaleIds = rows.map((row) => row.id);
  const activities = await listActivitiesForResaleIds(resaleIds, exec);
  const activitiesByResale = new Map<string, ResaleActivity[]>();
  for (const activity of activities) {
    const bucket = activitiesByResale.get(activity.resaleId) ?? [];
    bucket.push(activity);
    activitiesByResale.set(activity.resaleId, bucket);
  }

  const supplierOrderIds = Array.from(new Set(rows.map((row) => row.supplierOrderId)));
  const supplierCosts = new Map<string, number>();
  await Promise.all(
    supplierOrderIds.map(async (id) => {
      supplierCosts.set(id, await computeSupplierOrderCost(id, exec));
    }),
  );

  return rows.map((row) => {
    const rowActivities = activitiesByResale.get(row.id) ?? [];
    const resaleRevenue = roundCurrency(
      rowActivities.reduce((sum, activity) => sum + activity.revenue, 0),
    );
    const activityCostTotal = roundCurrency(
      rowActivities.reduce((sum, activity) => sum + activity.cost, 0),
    );
    const supplierOrderCost = supplierCosts.get(row.supplierOrderId) ?? 0;
    return {
      id: row.id,
      clientOrderId: row.clientOrderId,
      supplierOrderId: row.supplierOrderId,
      clientName: row.clientName,
      supplierName: row.supplierName,
      supplierOrderCost,
      activityCostTotal,
      resaleRevenue,
      costVariance: roundCurrency(activityCostTotal - supplierOrderCost),
      startDate: row.startDate,
      dueDate: row.dueDate,
      notes: row.notes,
      createdAt: epochMs(row.createdAt),
      updatedAt: epochMs(row.updatedAt),
      activities: rowActivities,
    };
  });
};

const baseResaleSelect = {
  id: resales.id,
  clientOrderId: resales.clientOrderId,
  supplierOrderId: resales.supplierOrderId,
  clientName: sales.clientName,
  supplierName: supplierSales.supplierName,
  startDate: resales.startDate,
  dueDate: resales.dueDate,
  notes: resales.notes,
  createdAt: resales.createdAt,
  updatedAt: resales.updatedAt,
} as const;

const activitySelect = {
  id: resaleActivities.id,
  resaleId: resaleActivities.resaleId,
  name: resaleActivities.name,
  billingFrequency: resaleActivities.billingFrequency,
  categoryId: resaleActivities.categoryId,
  cost: resaleActivities.cost,
  revenue: resaleActivities.revenue,
  released: resaleActivities.released,
  dueDate: resaleActivities.dueDate,
  notes: resaleActivities.notes,
  createdAt: resaleActivities.createdAt,
  updatedAt: resaleActivities.updatedAt,
  categoryName: resaleCategories.name,
} as const;

type ActivitySelectResult = {
  [K in keyof typeof activitySelect]: K extends 'categoryName'
    ? string | null
    : (typeof resaleActivities.$inferSelect)[K & keyof typeof resaleActivities.$inferSelect];
};

export const listAll = async (exec: DbExecutor = db): Promise<Resale[]> => {
  const rows = await exec
    .select(baseResaleSelect)
    .from(resales)
    .innerJoin(sales, eq(resales.clientOrderId, sales.id))
    .innerJoin(supplierSales, eq(resales.supplierOrderId, supplierSales.id))
    .orderBy(desc(resales.createdAt), asc(resales.id));
  return hydrateResales(rows, exec);
};

export const findById = async (id: string, exec: DbExecutor = db): Promise<Resale | null> => {
  const rows = await exec
    .select(baseResaleSelect)
    .from(resales)
    .innerJoin(sales, eq(resales.clientOrderId, sales.id))
    .innerJoin(supplierSales, eq(resales.supplierOrderId, supplierSales.id))
    .where(eq(resales.id, id))
    .limit(1);
  const hydrated = await hydrateResales(rows, exec);
  return hydrated[0] ?? null;
};

export const existsById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const rows = await exec.select({ id: resales.id }).from(resales).where(eq(resales.id, id));
  return rows.length > 0;
};

export const existsByOrderPair = async (
  clientOrderId: string,
  supplierOrderId: string,
  excludeResaleId: string | null = null,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const conditions = [
    eq(resales.clientOrderId, clientOrderId),
    eq(resales.supplierOrderId, supplierOrderId),
  ];
  if (excludeResaleId) conditions.push(ne(resales.id, excludeResaleId));
  const rows = await exec
    .select({ id: resales.id })
    .from(resales)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
};

export const isSupplierOrderLinkedToClientOrder = async (
  clientOrderId: string,
  supplierOrderId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const rows = await exec
    .select({ id: saleItems.id })
    .from(saleItems)
    .where(and(eq(saleItems.saleId, clientOrderId), eq(saleItems.supplierSaleId, supplierOrderId)))
    .limit(1);
  return rows.length > 0;
};

export type NewResale = {
  id: string;
  clientOrderId: string;
  supplierOrderId: string;
  startDate: string | null;
  dueDate: string | null;
  notes: string | null;
};

export const create = async (input: NewResale, exec: DbExecutor = db): Promise<Resale> => {
  await exec.insert(resales).values({
    id: input.id,
    clientOrderId: input.clientOrderId,
    supplierOrderId: input.supplierOrderId,
    startDate: input.startDate,
    dueDate: input.dueDate,
    notes: input.notes,
  });
  const created = await findById(input.id, exec);
  if (!created) throw new Error('Resale insert failed');
  return created;
};

export type ResaleUpdate = {
  clientOrderId?: string;
  supplierOrderId?: string;
  startDate?: string | null;
  dueDate?: string | null;
  notes?: string | null;
};

export const update = async (
  id: string,
  patch: ResaleUpdate,
  exec: DbExecutor = db,
): Promise<Resale | null> => {
  const set: Record<string, unknown> = {};
  if (patch.clientOrderId !== undefined) set.clientOrderId = patch.clientOrderId;
  if (patch.supplierOrderId !== undefined) set.supplierOrderId = patch.supplierOrderId;
  if (patch.startDate !== undefined) set.startDate = patch.startDate;
  if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (Object.keys(set).length > 0) {
    set.updatedAt = sql`CURRENT_TIMESTAMP`;
    await exec.update(resales).set(set).where(eq(resales.id, id));
  }
  return findById(id, exec);
};

export const deleteById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const result = await exec.delete(resales).where(eq(resales.id, id));
  return (result.rowCount ?? 0) > 0;
};

export const listActivitiesForResaleIds = async (
  resaleIds: string[],
  exec: DbExecutor = db,
): Promise<ResaleActivity[]> => {
  if (resaleIds.length === 0) return [];
  const rows = await exec
    .select(activitySelect)
    .from(resaleActivities)
    .innerJoin(resaleCategories, eq(resaleActivities.categoryId, resaleCategories.id))
    .where(inArray(resaleActivities.resaleId, resaleIds))
    .orderBy(asc(resaleActivities.createdAt), asc(resaleActivities.id));
  return rows.map((row) => mapActivity(row as ActivitySelectResult));
};

export const findActivityById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<ResaleActivity | null> => {
  const rows = await exec
    .select(activitySelect)
    .from(resaleActivities)
    .innerJoin(resaleCategories, eq(resaleActivities.categoryId, resaleCategories.id))
    .where(eq(resaleActivities.id, id))
    .limit(1);
  return rows[0] ? mapActivity(rows[0] as ActivitySelectResult) : null;
};

export const findActivityResaleId = async (
  id: string,
  exec: DbExecutor = db,
): Promise<string | null> => {
  const rows = await exec
    .select({ resaleId: resaleActivities.resaleId })
    .from(resaleActivities)
    .where(eq(resaleActivities.id, id))
    .limit(1);
  return rows[0]?.resaleId ?? null;
};

export type NewResaleActivity = {
  id: string;
  resaleId: string;
  name: string;
  billingFrequency: ResaleBillingFrequency;
  categoryId: string;
  cost: number;
  revenue: number;
  released: boolean;
  dueDate: string | null;
  notes: string | null;
};

export const createActivity = async (
  input: NewResaleActivity,
  exec: DbExecutor = db,
): Promise<ResaleActivity> => {
  await exec.insert(resaleActivities).values({
    id: input.id,
    resaleId: input.resaleId,
    name: input.name,
    billingFrequency: input.billingFrequency,
    categoryId: input.categoryId,
    cost: numericForDb(input.cost),
    revenue: numericForDb(input.revenue),
    released: input.released,
    dueDate: input.dueDate,
    notes: input.notes,
  });
  const created = await findActivityById(input.id, exec);
  if (!created) throw new Error('Resale activity insert failed');
  return created;
};

export type ResaleActivityUpdate = Partial<Omit<NewResaleActivity, 'id' | 'resaleId'>>;

export const updateActivity = async (
  id: string,
  patch: ResaleActivityUpdate,
  exec: DbExecutor = db,
): Promise<ResaleActivity | null> => {
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.billingFrequency !== undefined) set.billingFrequency = patch.billingFrequency;
  if (patch.categoryId !== undefined) set.categoryId = patch.categoryId;
  if (patch.cost !== undefined) set.cost = numericForDb(patch.cost);
  if (patch.revenue !== undefined) set.revenue = numericForDb(patch.revenue);
  if (patch.released !== undefined) set.released = patch.released;
  if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (Object.keys(set).length > 0) {
    set.updatedAt = sql`CURRENT_TIMESTAMP`;
    await exec.update(resaleActivities).set(set).where(eq(resaleActivities.id, id));
  }
  return findActivityById(id, exec);
};

export const deleteActivityById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const result = await exec.delete(resaleActivities).where(eq(resaleActivities.id, id));
  return (result.rowCount ?? 0) > 0;
};

export const listCategories = async (exec: DbExecutor = db): Promise<ResaleCategory[]> => {
  const rows = await executeRows<
    typeof resaleCategories.$inferSelect & { activityCount: string | number | null }
  >(
    exec,
    sql`SELECT c.id, c.name, c.created_at AS "createdAt", c.updated_at AS "updatedAt",
              COUNT(a.id)::bigint AS "activityCount"
         FROM resale_categories c
         LEFT JOIN resale_activities a ON a.category_id = c.id
        GROUP BY c.id, c.name, c.created_at, c.updated_at
        ORDER BY c.name ASC`,
  );
  return rows.map(mapCategory);
};

export const existsCategoryByName = async (
  name: string,
  excludeId: string | null = null,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const conditions = [sql`LOWER(${resaleCategories.name}) = LOWER(${name})`];
  if (excludeId) conditions.push(ne(resaleCategories.id, excludeId));
  const rows = await exec
    .select({ id: resaleCategories.id })
    .from(resaleCategories)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
};

export const createCategory = async (
  id: string,
  name: string,
  exec: DbExecutor = db,
): Promise<ResaleCategory> => {
  const [row] = await exec.insert(resaleCategories).values({ id, name }).returning();
  return mapCategory(row);
};

export const updateCategory = async (
  id: string,
  name: string,
  exec: DbExecutor = db,
): Promise<ResaleCategory | null> => {
  const [row] = await exec
    .update(resaleCategories)
    .set({ name, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(resaleCategories.id, id))
    .returning();
  return row ? mapCategory(row) : null;
};

export const countActivitiesByCategory = async (
  categoryId: string,
  exec: DbExecutor = db,
): Promise<number> => {
  const [row] = await exec
    .select({ value: count() })
    .from(resaleActivities)
    .where(eq(resaleActivities.categoryId, categoryId));
  return row?.value ?? 0;
};

export const deleteCategoryById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const result = await exec.delete(resaleCategories).where(eq(resaleCategories.id, id));
  return (result.rowCount ?? 0) > 0;
};

export const listOrderOptions = async (exec: DbExecutor = db): Promise<ResaleOrderOption[]> => {
  const rows = await executeRows<{
    clientOrderId: string;
    clientName: string;
    supplierOrderId: string;
    supplierName: string;
  }>(
    exec,
    sql`SELECT s.id AS "clientOrderId",
              s.client_name AS "clientName",
              ss.id AS "supplierOrderId",
              ss.supplier_name AS "supplierName"
         FROM sales s
         JOIN sale_items si ON si.sale_id = s.id
         JOIN supplier_sales ss ON ss.id = si.supplier_sale_id
        WHERE si.supplier_sale_id IS NOT NULL
        GROUP BY s.id, s.client_name, s.created_at, ss.id, ss.supplier_name, ss.created_at
        ORDER BY s.created_at DESC, ss.created_at DESC`,
  );

  const supplierOrderIds = Array.from(new Set(rows.map((row) => row.supplierOrderId)));
  const supplierTotals = new Map<string, number>();
  await Promise.all(
    supplierOrderIds.map(async (id) => {
      supplierTotals.set(id, await computeSupplierOrderCost(id, exec));
    }),
  );

  const options = new Map<string, ResaleOrderOption>();
  for (const row of rows) {
    const option =
      options.get(row.clientOrderId) ??
      ({
        clientOrderId: row.clientOrderId,
        clientName: row.clientName,
        supplierOrders: [],
      } satisfies ResaleOrderOption);
    option.supplierOrders.push({
      id: row.supplierOrderId,
      supplierName: row.supplierName,
      total: supplierTotals.get(row.supplierOrderId) ?? 0,
    });
    options.set(row.clientOrderId, option);
  }

  return Array.from(options.values());
};
