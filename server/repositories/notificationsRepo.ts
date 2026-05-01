import { and, count, desc, eq, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { notifications } from '../db/schema/notifications.ts';

// `is_read = false` is written as a SQL literal (not eq(..., false)) so PG can match
// the predicate against the partial index `idx_notifications_user_unread WHERE is_read = false`.
// A parameterized `is_read = $N` defeats the partial-index match under generic plans.
const isUnread = sql`${notifications.isRead} = false`;

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
  createdAt: row.createdAt ? row.createdAt.getTime() : 0,
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
