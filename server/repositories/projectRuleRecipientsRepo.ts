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

export type ProjectRuleRecipientOptions = {
  users: ProjectRuleUserRecipientOption[];
  roles: ProjectRuleRoleRecipientOption[];
  webhooks: ProjectRuleWebhookOption[];
};

export type ProjectRuleRecipientValidationOptions = {
  allowedDisabledWebhookIds?: readonly string[];
};

type UserRecipientRow = {
  id: string;
  name: string;
  username: string;
  avatarInitials: string | null;
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
  const [userRows, roleRows, webhookRows] = await Promise.all([
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
  ]);

  return {
    users: userRows.map(mapUserRow),
    roles: roleRows,
    webhooks: webhookRows,
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
              AND ${roleHasEnabledProjectAssignee(projectId)}
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
