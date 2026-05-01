import { and, count, desc, eq, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { notifications } from '../db/schema/notifications.ts';

// `is_read IS NOT TRUE` matches both `false` and NULL rows so list / count / markAll
// agree on what "unread" means (mapRow coerces null → false). Drizzle's `eq(col, false)`
// would parameterize the comparison and miss NULL. The partial index
// `idx_notifications_user_unread` (predicate `is_read = false`) is not matched by this
// predicate — the NULL-handling consistency is the tradeoff we want.
const isUnread = sql`${notifications.isRead} IS NOT TRUE`;

export type Notification = {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: number;
};

const mapRow = (row: typeof notifications.$inferSelect): Notification => ({
  id: row.id,
  userId: row.userId,
  type: row.type,
  title: row.title,
  message: row.message ?? '',
  data: row.data,
  isRead: row.isRead ?? false,
  // `created_at` is nullable in the schema (mirrors `schema.sql`) but has
  // DEFAULT CURRENT_TIMESTAMP, so the runtime invariant is that it always has a value;
  // `?? 0` is a TS-strict appeasement for the unreachable branch.
  createdAt: row.createdAt?.getTime() ?? 0,
});

export const listForUser = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<Notification[]> => {
  const rows = await exec
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(50);
  return rows.map(mapRow);
};

export const countUnreadForUser = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<number> => {
  const [result] = await exec
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isUnread));
  return result?.value ?? 0;
};

export const markReadForUser = async (
  id: string,
  userId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const result = await exec
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
  return (result.rowCount ?? 0) > 0;
};

export const markAllReadForUser = async (userId: string, exec: DbExecutor = db): Promise<void> => {
  await exec
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.userId, userId), isUnread));
};

export const deleteForUser = async (
  id: string,
  userId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const result = await exec
    .delete(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
  return (result.rowCount ?? 0) > 0;
};
