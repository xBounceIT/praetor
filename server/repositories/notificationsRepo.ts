import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { type DbExecutor, db, runAtomically } from '../db/drizzle.ts';
import { notifications } from '../db/schema/notifications.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';

// Matches the predicate of the partial index `idx_notifications_user_unread`
// (`WHERE is_read = false`) so countUnreadForUser / markAllReadForUser can
// use it instead of a sequential scan. `is_read` is NOT NULL since migration
// 0050, so `= false` cannot miss legacy NULL rows.
const isUnread = eq(notifications.isRead, false);

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

export type NewNotificationForUsers = {
  type: string;
  title: string;
  message?: string | null;
  data?: Record<string, unknown> | null;
};

// Sweep rows written under the pre-#612 global id; can be removed once no
// pre-#612 binary is in service.
const LEGACY_ADMIN_PASSWORD_WARNING_NOTIFICATION_ID = 'admin-default-password-warning';
export const ADMIN_PASSWORD_WARNING_TYPE = 'admin_password_warning';
export const TIP_NOTIFICATION_TYPE = 'tip';
export const RIL_PREFERENCES_TIP_ID = 'ril_preferences';

// Short prefix so that `apw-${userId}` fits inside `notifications.id`'s varchar(50)
// even when `userId` is a `u-<uuid>` (38 chars) — full id stays at 42 chars.
export const adminPasswordWarningNotificationId = (userId: string): string => `apw-${userId}`;
export const rilPreferencesTipNotificationId = (userId: string): string => `tip-ril-${userId}`;

const ADMIN_PASSWORD_WARNING_TITLE = 'Change the default admin password';
const ADMIN_PASSWORD_WARNING_MESSAGE =
  'The admin account is still using the default password. Change it from Settings as soon as possible.';
const adminPasswordWarningData = { reason: 'default_admin_password' };
const RIL_PREFERENCES_TIP_TITLE = 'Set up your RIL travel preferences';
const RIL_PREFERENCES_TIP_MESSAGE =
  'Choose the default travel value for each weekday so your RIL is pre-filled correctly.';

const mapRow = (row: typeof notifications.$inferSelect): Notification => ({
  id: row.id,
  userId: row.userId,
  type: row.type,
  title: row.title,
  message: row.message ?? '',
  data: row.data,
  isRead: row.isRead,
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

export const createForUsers = async (
  userIds: string[],
  notification: NewNotificationForUsers,
  exec: DbExecutor = db,
): Promise<number> => {
  const uniqueUserIds = Array.from(
    userIds.reduce((ids, userId) => {
      const trimmed = userId.trim();
      if (trimmed) ids.add(trimmed);
      return ids;
    }, new Set<string>()),
  );
  if (uniqueUserIds.length === 0) return 0;

  await exec.insert(notifications).values(
    uniqueUserIds.map((userId) => ({
      id: generatePrefixedId('n'),
      userId,
      type: notification.type,
      title: notification.title,
      message: notification.message ?? null,
      data: notification.data ?? null,
      isRead: false,
    })),
  );
  return uniqueUserIds.length;
};

export const createRilPreferencesTip = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec
    .insert(notifications)
    .values({
      id: rilPreferencesTipNotificationId(userId),
      userId,
      type: TIP_NOTIFICATION_TYPE,
      title: RIL_PREFERENCES_TIP_TITLE,
      message: RIL_PREFERENCES_TIP_MESSAGE,
      data: {
        tipId: RIL_PREFERENCES_TIP_ID,
        destination: 'settings/ril',
      },
      isRead: false,
    })
    .onConflictDoNothing({ target: notifications.id });
};

export const upsertAdminPasswordWarning = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<void> =>
  runAtomically(exec, async (tx) => {
    const warning = {
      userId,
      type: ADMIN_PASSWORD_WARNING_TYPE,
      title: ADMIN_PASSWORD_WARNING_TITLE,
      message: ADMIN_PASSWORD_WARNING_MESSAGE,
      data: adminPasswordWarningData,
      isRead: false,
    };

    await tx
      .delete(notifications)
      .where(eq(notifications.id, LEGACY_ADMIN_PASSWORD_WARNING_NOTIFICATION_ID));

    await tx
      .insert(notifications)
      .values({
        id: adminPasswordWarningNotificationId(userId),
        ...warning,
      })
      .onConflictDoUpdate({
        target: notifications.id,
        set: {
          ...warning,
          createdAt: sql`CURRENT_TIMESTAMP`,
        },
      });
  });

export const deleteAdminPasswordWarning = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec
    .delete(notifications)
    .where(
      inArray(notifications.id, [
        adminPasswordWarningNotificationId(userId),
        LEGACY_ADMIN_PASSWORD_WARNING_NOTIFICATION_ID,
      ]),
    );
};
