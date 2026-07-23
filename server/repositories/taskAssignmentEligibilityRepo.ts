import { sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { ADMIN_ROLE_ID, TOP_MANAGER_ROLE_ID } from '../utils/permissions.ts';

export type TaskAssigneeVisibility = {
  viewerId: string;
  canViewAllUsers: boolean;
  canViewManagedUsers: boolean;
  canViewInternal: boolean;
  canViewExternal: boolean;
};

export const findIneligibleAssigneeIds = async (
  userIds: string[],
  visibility: TaskAssigneeVisibility,
  exec: DbExecutor = db,
): Promise<string[]> => {
  if (userIds.length === 0) return [];

  const scopedVisibility = visibility.canViewAllUsers
    ? sql`TRUE`
    : sql`(
        u.id = ${visibility.viewerId}
        OR (
          ${visibility.canViewManagedUsers}
          AND EXISTS (
            SELECT 1
            FROM user_work_units assignee_uw
            INNER JOIN work_unit_managers viewer_wum
              ON viewer_wum.work_unit_id = assignee_uw.work_unit_id
            WHERE assignee_uw.user_id = u.id
              AND viewer_wum.user_id = ${visibility.viewerId}
          )
        )
        OR (${visibility.canViewInternal} AND u.employee_type IN ('app_user', 'internal'))
        OR (${visibility.canViewExternal} AND u.employee_type = 'external')
      )`;

  const eligibleRows = await executeRows<{ id: string }>(
    exec,
    sql`
      SELECT u.id
      FROM users u
      WHERE u.id = ANY(${sql.param(userIds)}::text[])
        AND COALESCE(u.is_disabled, false) = false
        AND u.role <> ${TOP_MANAGER_ROLE_ID}
        AND NOT EXISTS (
          SELECT 1
          FROM user_roles top_manager_role
          WHERE top_manager_role.user_id = u.id
            AND top_manager_role.role_id = ${TOP_MANAGER_ROLE_ID}
        )
        AND NOT (
          u.role = ${ADMIN_ROLE_ID}
          AND NOT EXISTS (
            SELECT 1
            FROM user_roles non_admin_role
            WHERE non_admin_role.user_id = u.id
              AND non_admin_role.role_id <> ${ADMIN_ROLE_ID}
          )
        )
        AND ${scopedVisibility}
    `,
  );

  const eligibleIds = new Set(eligibleRows.map(({ id }) => id));
  return userIds.filter((id) => !eligibleIds.has(id));
};
