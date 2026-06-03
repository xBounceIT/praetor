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

export type ProjectRuleRecipientOptions = {
  users: ProjectRuleUserRecipientOption[];
  roles: ProjectRuleRoleRecipientOption[];
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

export const listRecipientOptions = async (
  projectId: string,
  exec: DbExecutor = db,
): Promise<ProjectRuleRecipientOptions> => {
  const [userRows, roleRows] = await Promise.all([
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
        ORDER BY r.name
      `,
    ),
  ]);

  return {
    users: userRows.map(mapUserRow),
    roles: roleRows,
  };
};

export const findInvalidRecipientIds = async (
  projectId: string,
  config: ProjectRuleActionConfig,
  exec: DbExecutor = db,
): Promise<{ userIds: string[]; roleIds: string[] }> => {
  const userIds = uniqueStrings(config.recipientUserIds);
  const roleIds = uniqueStrings(config.recipientRoleIds);
  const [validUserRows, validRoleRows] = await Promise.all([
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
          sql`SELECT id FROM roles WHERE id = ANY(${sql.param(roleIds)}::text[])`,
        ),
  ]);

  const validUserIds = new Set(validUserRows.map((row) => row.id));
  const validRoleIds = new Set(validRoleRows.map((row) => row.id));
  return {
    userIds: userIds.filter((id) => !validUserIds.has(id)),
    roleIds: roleIds.filter((id) => !validRoleIds.has(id)),
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
      LEFT JOIN user_projects up
        ON up.user_id = u.id
       AND up.project_id = ${projectId}
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      WHERE COALESCE(u.is_disabled, false) = false
        AND (
          (
            ${recipientUserIds.length > 0}
            AND up.user_id IS NOT NULL
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
