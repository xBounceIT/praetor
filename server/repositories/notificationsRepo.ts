import pool, { type QueryExecutor } from '../db/index.ts';

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

export const listForUser = async (
  userId: string,
  exec: QueryExecutor = pool,
): Promise<Notification[]> => {
  const { rows } = await exec.query<Notification>(
    `SELECT
        id,
        user_id as "userId",
        type,
        title,
        message,
        data,
        is_read as "isRead",
        EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt"
      FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50`,
    [userId],
  );
  return rows;
};

export const countUnreadForUser = async (
  userId: string,
  exec: QueryExecutor = pool,
): Promise<number> => {
  const { rows } = await exec.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = FALSE`,
    [userId],
  );
  return Number.parseInt(rows[0].count, 10);
};

export const markReadForUser = async (
  id: string,
  userId: string,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rowCount } = await exec.query(
    `UPDATE notifications
       SET is_read = TRUE
     WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
};

export const markAllReadForUser = async (
  userId: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(`UPDATE notifications SET is_read = TRUE WHERE user_id = $1`, [userId]);
};

export const deleteForUser = async (
  id: string,
  userId: string,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rowCount } = await exec.query(
    `DELETE FROM notifications WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
};
