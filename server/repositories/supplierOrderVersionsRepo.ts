import { and, desc, eq } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import {
  type SupplierOrderVersionSnapshot,
  supplierOrderVersions,
} from '../db/schema/supplierOrderVersions.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import type { SupplierOrder, SupplierOrderItem } from './supplierOrdersRepo.ts';

export type { SupplierOrderVersionSnapshot } from '../db/schema/supplierOrderVersions.ts';

export type SupplierOrderVersionReason = 'update' | 'restore';

export type SupplierOrderVersionRow = {
  id: string;
  orderId: string;
  reason: SupplierOrderVersionReason;
  createdByUserId: string | null;
  createdAt: number;
};

export type SupplierOrderVersion = SupplierOrderVersionRow & {
  snapshot: SupplierOrderVersionSnapshot;
};

type SupplierOrderVersionRowSelect = Pick<
  typeof supplierOrderVersions.$inferSelect,
  'id' | 'orderId' | 'reason' | 'createdByUserId' | 'createdAt'
>;

const mapRow = (row: SupplierOrderVersionRowSelect): SupplierOrderVersionRow => ({
  id: row.id,
  orderId: row.orderId,
  reason: row.reason === 'restore' ? 'restore' : 'update',
  createdByUserId: row.createdByUserId,
  createdAt: row.createdAt?.getTime() ?? 0,
});

const mapVersion = (row: typeof supplierOrderVersions.$inferSelect): SupplierOrderVersion => ({
  ...mapRow(row),
  snapshot: row.snapshot,
});

export const buildSnapshot = (
  order: SupplierOrder,
  items: SupplierOrderItem[],
): SupplierOrderVersionSnapshot => ({ schemaVersion: 1, order, items });

export const listForOrder = async (
  orderId: string,
  exec: DbExecutor = db,
): Promise<SupplierOrderVersionRow[]> => {
  const rows = await exec
    .select({
      id: supplierOrderVersions.id,
      orderId: supplierOrderVersions.orderId,
      reason: supplierOrderVersions.reason,
      createdByUserId: supplierOrderVersions.createdByUserId,
      createdAt: supplierOrderVersions.createdAt,
    })
    .from(supplierOrderVersions)
    .where(eq(supplierOrderVersions.orderId, orderId))
    .orderBy(desc(supplierOrderVersions.createdAt));
  return rows.map(mapRow);
};

// Scoped on BOTH orderId and id so a versionId cannot be used to read a snapshot from a
// different order (cross-order restore would otherwise be possible).
export const findById = async (
  orderId: string,
  versionId: string,
  exec: DbExecutor = db,
): Promise<SupplierOrderVersion | null> => {
  const rows = await exec
    .select()
    .from(supplierOrderVersions)
    .where(and(eq(supplierOrderVersions.orderId, orderId), eq(supplierOrderVersions.id, versionId)))
    .limit(1);
  return rows[0] ? mapVersion(rows[0]) : null;
};

export type NewSupplierOrderVersionInput = {
  orderId: string;
  snapshot: SupplierOrderVersionSnapshot;
  reason: SupplierOrderVersionReason;
  createdByUserId: string | null;
};

export const insert = async (
  input: NewSupplierOrderVersionInput,
  exec: DbExecutor = db,
): Promise<SupplierOrderVersionRow> => {
  const rows = await exec
    .insert(supplierOrderVersions)
    .values({
      id: generatePrefixedId('sov'),
      orderId: input.orderId,
      snapshot: input.snapshot,
      reason: input.reason,
      createdByUserId: input.createdByUserId,
    })
    .returning();
  return mapRow(rows[0]);
};

export const deleteAllForOrder = async (
  orderId: string,
  exec: DbExecutor = db,
): Promise<number> => {
  const result = await exec
    .delete(supplierOrderVersions)
    .where(eq(supplierOrderVersions.orderId, orderId));
  return result.rowCount ?? 0;
};
