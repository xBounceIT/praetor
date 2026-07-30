import { sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import type { ProjectRuleActionConfig } from '../db/schema/projectRules.ts';

export type ProjectRuleUserRecipientOption = {
  id: string;
  name: string;
  username: string;
  avatarInitials: string;
};

export type ProjectRuleRoleRecipientOption = {
  id: string;
  name: string;
};

export type ProjectRuleWebhookOption = {
  id: string;
  name: string;
};

export type ProjectRuleFilterUserOption = ProjectRuleUserRecipientOption & {
  isDisabled: boolean;
};

export type ProjectRuleFilterTaskOption = {
  id: string;
  name: string;
  isDisabled: boolean;
};

export type ProjectRuleRecipientOptions = {
  users: ProjectRuleUserRecipientOption[];
  roles: ProjectRuleRoleRecipientOption[];
  webhooks: ProjectRuleWebhookOption[];
  filters: {
    users: ProjectRuleFilterUserOption[];
    tasks: ProjectRuleFilterTaskOption[];
  };
};

export type ProjectRuleRecipientValidationOptions = {
  allowedDisabledWebhookIds?: readonly string[];
  allowedUnassignedRoleIds?: readonly string[];
};

type UserRecipientRow = {
  id: string;
  name: string;
  username: string;
  avatarInitials: string | null;
};

type FilterUserRow = UserRecipientRow & {
  isDisabled: boolean | null;
};

type FilterTaskRow = {
  id: string;
  name: string;
  isDisabled: boolean | null;
};

type RoleRecipientRow = {
  id: string;
  name: string;
};

type WebhookOptionRow = {
  id: string;
  name: string;
};

const uniqueStrings = (values: readonly string[]): string[] =>
  Array.from(
    values.reduce((strings, value) => {
      const trimmed = value.trim();
      if (trimmed) strings.add(trimmed);
      return strings;
    }, new Set<string>()),
  );

const mapUserRow = (row: UserRecipientRow): ProjectRuleUserRecipientOption => ({
  id: row.id,
  name: row.name,
  username: row.username,
  avatarInitials: row.avatarInitials ?? '',
});

const mapFilterUserRow = (row: FilterUserRow): ProjectRuleFilterUserOption => ({
  ...mapUserRow(row),
  isDisabled: row.isDisabled ?? false,
});

const roleHasEnabledProjectAssignee = (projectId: string) => sql`
  EXISTS (
    SELECT 1
    FROM users u
    INNER JOIN user_projects up ON up.user_id = u.id
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    WHERE up.project_id = ${projectId}
      AND COALESCE(u.is_disabled, false) = false
      AND (u.role = r.id OR ur.role_id = r.id)
  )
`;

export const listRecipientOptions = async (
  projectId: string,
  exec: DbExecutor = db,
): Promise<ProjectRuleRecipientOptions> => {
  const [userRows, roleRows, webhookRows, filterUserRows, filterTaskRows] = await Promise.all([
    executeRows<UserRecipientRow>(
      exec,
      sql`
        SELECT u.id, u.name, u.username, u.avatar_initials AS "avatarInitials"
        FROM users u
        INNER JOIN user_projects up ON up.user_id = u.id
        WHERE up.project_id = ${projectId}
          AND COALESCE(u.is_disabled, false) = false
        ORDER BY u.name
      `,
    ),
    executeRows<RoleRecipientRow>(
      exec,
      sql`
        SELECT r.id, r.name
        FROM roles r
        WHERE ${roleHasEnabledProjectAssignee(projectId)}
        ORDER BY r.name
      `,
    ),
    executeRows<WebhookOptionRow>(
      exec,
      sql`
        SELECT id, name
        FROM webhooks
        WHERE enabled = true
        ORDER BY name
      `,
    ),
    executeRows<FilterUserRow>(
      exec,
      sql`
        SELECT
          u.id,
          u.name,
          u.username,
          u.avatar_initials AS "avatarInitials",
          u.is_disabled AS "isDisabled"
        FROM users u
        WHERE EXISTS (
          SELECT 1
          FROM user_projects up
          WHERE up.project_id = ${projectId}
            AND up.user_id = u.id
        )
        OR EXISTS (
          SELECT 1
          FROM time_entries te
          WHERE te.project_id = ${projectId}
            AND te.user_id = u.id
        )
        ORDER BY u.name
      `,
    ),
    executeRows<FilterTaskRow>(
      exec,
      sql`
        SELECT t.id, t.name, t.is_disabled AS "isDisabled"
        FROM tasks t
        WHERE t.project_id = ${projectId}
        ORDER BY t.name
      `,
    ),
  ]);

  return {
    users: userRows.map(mapUserRow),
    roles: roleRows,
    webhooks: webhookRows,
    filters: {
      users: filterUserRows.map(mapFilterUserRow),
      tasks: filterTaskRows.map((row) => ({
        id: row.id,
        name: row.name,
        isDisabled: row.isDisabled ?? false,
      })),
    },
  };
};

export const findInvalidScheduleFilterIds = async (
  projectId: string,
  filters: { userIds: readonly string[]; taskIds: readonly string[] },
  exec: DbExecutor = db,
  allowed: { userIds?: readonly string[]; taskIds?: readonly string[] } = {},
): Promise<{ userIds: string[]; taskIds: string[] }> => {
  const userIds = uniqueStrings(filters.userIds);
  const taskIds = uniqueStrings(filters.taskIds);
  const allowedUserIds = uniqueStrings(allowed.userIds ?? []);
  const allowedTaskIds = uniqueStrings(allowed.taskIds ?? []);
  const [validUsers, validTasks] = await Promise.all([
    userIds.length === 0
      ? Promise.resolve([])
      : executeRows<{ id: string }>(
          exec,
          sql`
            SELECT u.id
            FROM users u
            WHERE u.id = ANY(${sql.param(userIds)}::text[])
              AND (
                EXISTS (
                  SELECT 1 FROM user_projects up
                  WHERE up.project_id = ${projectId}
                    AND up.user_id = u.id
                )
                OR EXISTS (
                  SELECT 1 FROM time_entries te
                  WHERE te.project_id = ${projectId}
                    AND te.user_id = u.id
                )
                OR (
                  ${allowedUserIds.length > 0}
                  AND u.id = ANY(${sql.param(allowedUserIds)}::text[])
                )
              )
          `,
        ),
    taskIds.length === 0
      ? Promise.resolve([])
      : executeRows<{ id: string }>(
          exec,
          sql`
            SELECT t.id
            FROM tasks t
            WHERE t.id = ANY(${sql.param(taskIds)}::text[])
              AND (
                t.project_id = ${projectId}
                OR (
                  ${allowedTaskIds.length > 0}
                  AND t.id = ANY(${sql.param(allowedTaskIds)}::text[])
                )
              )
          `,
        ),
  ]);
  const validUserIds = new Set([...validUsers.map((row) => row.id), ...allowedUserIds]);
  const validTaskIds = new Set([...validTasks.map((row) => row.id), ...allowedTaskIds]);
  return {
    userIds: userIds.filter((id) => !validUserIds.has(id)),
    taskIds: taskIds.filter((id) => !validTaskIds.has(id)),
  };
};

export const findInvalidRecipientIds = async (
  projectId: string,
  config: ProjectRuleActionConfig,
  exec: DbExecutor = db,
  options: ProjectRuleRecipientValidationOptions = {},
): Promise<{ userIds: string[]; roleIds: string[]; webhookIds: string[] }> => {
  const userIds = uniqueStrings(config.recipientUserIds);
  const roleIds = uniqueStrings(config.recipientRoleIds);
  const webhookIds = uniqueStrings(config.webhookIds);
  const allowedDisabledWebhookIds = uniqueStrings(options.allowedDisabledWebhookIds ?? []);
  const allowedUnassignedRoleIds = uniqueStrings(options.allowedUnassignedRoleIds ?? []);
  const [validUserRows, validRoleRows, validWebhookRows] = await Promise.all([
    userIds.length === 0
      ? Promise.resolve([])
      : executeRows<{ id: string }>(
          exec,
          sql`
            SELECT u.id
            FROM users u
            INNER JOIN user_projects up ON up.user_id = u.id
            WHERE up.project_id = ${projectId}
              AND u.id = ANY(${sql.param(userIds)}::text[])
              AND COALESCE(u.is_disabled, false) = false
          `,
        ),
    roleIds.length === 0
      ? Promise.resolve([])
      : executeRows<{ id: string }>(
          exec,
          sql`
            SELECT r.id
            FROM roles r
            WHERE r.id = ANY(${sql.param(roleIds)}::text[])
              AND (
                ${roleHasEnabledProjectAssignee(projectId)}
                OR (
                  ${allowedUnassignedRoleIds.length > 0}
                  AND r.id = ANY(${sql.param(allowedUnassignedRoleIds)}::text[])
                )
              )
          `,
        ),
    webhookIds.length === 0
      ? Promise.resolve([])
      : executeRows<{ id: string }>(
          exec,
          sql`
            SELECT id
            FROM webhooks
            WHERE id = ANY(${sql.param(webhookIds)}::text[])
              AND (
                enabled = true
                OR (
                  ${allowedDisabledWebhookIds.length > 0}
                  AND id = ANY(${sql.param(allowedDisabledWebhookIds)}::text[])
                )
              )
          `,
        ),
  ]);

  const validUserIds = new Set(validUserRows.map((row) => row.id));
  const validRoleIds = new Set(validRoleRows.map((row) => row.id));
  const validWebhookIds = new Set(validWebhookRows.map((row) => row.id));
  return {
    userIds: userIds.filter((id) => !validUserIds.has(id)),
    roleIds: roleIds.filter((id) => !validRoleIds.has(id)),
    webhookIds: webhookIds.filter((id) => !validWebhookIds.has(id)),
  };
};

export const resolveRecipientUserIds = async (
  projectId: string,
  config: ProjectRuleActionConfig,
  exec: DbExecutor = db,
): Promise<string[]> => {
  const recipientUserIds = uniqueStrings(config.recipientUserIds);
  const recipientRoleIds = uniqueStrings(config.recipientRoleIds);
  const rows = await executeRows<{ id: string }>(
    exec,
    sql`
      SELECT DISTINCT u.id
      FROM users u
      INNER JOIN user_projects up
        ON up.user_id = u.id
       AND up.project_id = ${projectId}
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      WHERE COALESCE(u.is_disabled, false) = false
        AND (
          (
            ${recipientUserIds.length > 0}
            AND u.id = ANY(${sql.param(recipientUserIds)}::text[])
          )
          OR (
            ${recipientRoleIds.length > 0}
            AND (
              u.role = ANY(${sql.param(recipientRoleIds)}::text[])
              OR ur.role_id = ANY(${sql.param(recipientRoleIds)}::text[])
            )
          )
        )
      ORDER BY u.id
    `,
  );
  return rows.map((row) => row.id);
};
