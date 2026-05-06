import { and, desc, eq } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { type OrderVersionSnapshot, orderVersions } from '../db/schema/orderVersions.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import type { ClientOrder, ClientOrderItem } from './clientsOrdersRepo.ts';

export type { OrderVersionSnapshot } from '../db/schema/orderVersions.ts';

export type OrderVersionReason = 'update' | 'restore';

export type OrderVersionRow = {
  id: string;
  orderId: string;
  reason: OrderVersionReason;
  createdByUserId: string | null;
  createdAt: number;
};

export type OrderVersion = OrderVersionRow & { snapshot: OrderVersionSnapshot };

type OrderVersionRowSelect = Pick<
  typeof orderVersions.$inferSelect,
  'id' | 'orderId' | 'reason' | 'createdByUserId' | 'createdAt'
>;

const mapRow = (row: OrderVersionRowSelect): OrderVersionRow => ({
  id: row.id,
  orderId: row.orderId,
  reason: row.reason === 'restore' ? 'restore' : 'update',
  createdByUserId: row.createdByUserId,
  createdAt: row.createdAt?.getTime() ?? 0,
});

const mapVersion = (row: typeof orderVersions.$inferSelect): OrderVersion => ({
  ...mapRow(row),
  snapshot: row.snapshot,
});

export const buildSnapshot = (
  order: ClientOrder,
  items: ClientOrderItem[],
): OrderVersionSnapshot => {
  const { linkedQuoteId: _linkedQuote, linkedOfferId: _linkedOffer, ...orderSnapshot } = order;
  return { schemaVersion: 1, order: orderSnapshot, items };
};

export const listForOrder = async (
  orderId: string,
  exec: DbExecutor = db,
): Promise<OrderVersionRow[]> => {
  const rows = await exec
    .select({
      id: orderVersions.id,
      orderId: orderVersions.orderId,
      reason: orderVersions.reason,
      createdByUserId: orderVersions.createdByUserId,
      createdAt: orderVersions.createdAt,
    })
    .from(orderVersions)
    .where(eq(orderVersions.orderId, orderId))
    .orderBy(desc(orderVersions.createdAt));
  return rows.map(mapRow);
};

// Scoped on BOTH orderId and id so a versionId cannot be used to read a snapshot from a
// different order (cross-order restore would otherwise be possible).
export const findById = async (
  orderId: string,
  versionId: string,
  exec: DbExecutor = db,
): Promise<OrderVersion | null> => {
  const rows = await exec
    .select()
    .from(orderVersions)
    .where(and(eq(orderVersions.orderId, orderId), eq(orderVersions.id, versionId)))
    .limit(1);
  return rows[0] ? mapVersion(rows[0]) : null;
};

export type NewOrderVersionInput = {
  orderId: string;
  snapshot: OrderVersionSnapshot;
  reason: OrderVersionReason;
  createdByUserId: string | null;
};

export const insert = async (
  input: NewOrderVersionInput,
  exec: DbExecutor = db,
): Promise<OrderVersionRow> => {
  const rows = await exec
    .insert(orderVersions)
    .values({
      id: generatePrefixedId('ov'),
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
  const result = await exec.delete(orderVersions).where(eq(orderVersions.orderId, orderId));
  return result.rowCount ?? 0;
};
