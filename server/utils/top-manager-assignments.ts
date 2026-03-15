import { query } from '../db/index.ts';
import { TOP_MANAGER_ROLE_ID } from './permissions.ts';

export const MANUAL_ASSIGNMENT_SOURCE = 'manual';
export const TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE = 'top_manager_auto';

export type AssignmentSource =
  | typeof MANUAL_ASSIGNMENT_SOURCE
  | typeof TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE;

const mergeAssignmentSourceSql = (table: string, targetColumn: string) => `
  INSERT INTO ${table} (user_id, ${targetColumn}, assignment_source)
  VALUES ($1, $2, $3)
  ON CONFLICT (user_id, ${targetColumn}) DO UPDATE
  SET assignment_source = CASE
    WHEN ${table}.assignment_source = '${MANUAL_ASSIGNMENT_SOURCE}'
      OR EXCLUDED.assignment_source = '${MANUAL_ASSIGNMENT_SOURCE}'
    THEN '${MANUAL_ASSIGNMENT_SOURCE}'
    ELSE ${table}.assignment_source
  END
`;

const assignAllForUserSql = (table: string, sourceTable: string, targetColumn: string) => `
  INSERT INTO ${table} (user_id, ${targetColumn}, assignment_source)
  SELECT $1, id, $2
  FROM ${sourceTable}
  ON CONFLICT (user_id, ${targetColumn}) DO UPDATE
  SET assignment_source = CASE
    WHEN ${table}.assignment_source = '${MANUAL_ASSIGNMENT_SOURCE}'
      OR EXCLUDED.assignment_source = '${MANUAL_ASSIGNMENT_SOURCE}'
    THEN '${MANUAL_ASSIGNMENT_SOURCE}'
    ELSE ${table}.assignment_source
  END
`;

const assignAllTopManagersSql = (table: string, targetColumn: string) => `
  INSERT INTO ${table} (user_id, ${targetColumn}, assignment_source)
  SELECT ur.user_id, $1, $3
  FROM user_roles ur
  WHERE ur.role_id = $2
  ON CONFLICT (user_id, ${targetColumn}) DO UPDATE
  SET assignment_source = CASE
    WHEN ${table}.assignment_source = '${MANUAL_ASSIGNMENT_SOURCE}'
      OR EXCLUDED.assignment_source = '${MANUAL_ASSIGNMENT_SOURCE}'
    THEN '${MANUAL_ASSIGNMENT_SOURCE}'
    ELSE ${table}.assignment_source
  END
`;

export const userHasTopManagerRole = async (userId: string) => {
  const result = await query(
    'SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2 LIMIT 1',
    [userId, TOP_MANAGER_ROLE_ID],
  );
  return result.rows.length > 0;
};

export const assignClientToUser = async (
  userId: string,
  clientId: string,
  source: AssignmentSource = MANUAL_ASSIGNMENT_SOURCE,
) => {
  await query(mergeAssignmentSourceSql('user_clients', 'client_id'), [userId, clientId, source]);
};

export const assignProjectToUser = async (
  userId: string,
  projectId: string,
  source: AssignmentSource = MANUAL_ASSIGNMENT_SOURCE,
) => {
  await query(mergeAssignmentSourceSql('user_projects', 'project_id'), [userId, projectId, source]);
};

export const assignTaskToUser = async (
  userId: string,
  taskId: string,
  source: AssignmentSource = MANUAL_ASSIGNMENT_SOURCE,
) => {
  await query(mergeAssignmentSourceSql('user_tasks', 'task_id'), [userId, taskId, source]);
};

export const assignClientToTopManagers = async (clientId: string) => {
  await query(assignAllTopManagersSql('user_clients', 'client_id'), [
    clientId,
    TOP_MANAGER_ROLE_ID,
    TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE,
  ]);
};

export const assignProjectToTopManagers = async (projectId: string) => {
  await query(assignAllTopManagersSql('user_projects', 'project_id'), [
    projectId,
    TOP_MANAGER_ROLE_ID,
    TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE,
  ]);
};

export const assignTaskToTopManagers = async (taskId: string) => {
  await query(assignAllTopManagersSql('user_tasks', 'task_id'), [
    taskId,
    TOP_MANAGER_ROLE_ID,
    TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE,
  ]);
};

export const syncTopManagerAssignmentsForUser = async (userId: string) => {
  const isTopManager = await userHasTopManagerRole(userId);

  if (!isTopManager) {
    await query('DELETE FROM user_clients WHERE user_id = $1 AND assignment_source = $2', [
      userId,
      TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE,
    ]);
    await query('DELETE FROM user_projects WHERE user_id = $1 AND assignment_source = $2', [
      userId,
      TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE,
    ]);
    await query('DELETE FROM user_tasks WHERE user_id = $1 AND assignment_source = $2', [
      userId,
      TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE,
    ]);
    return;
  }

  await query(assignAllForUserSql('user_clients', 'clients', 'client_id'), [
    userId,
    TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE,
  ]);
  await query(assignAllForUserSql('user_projects', 'projects', 'project_id'), [
    userId,
    TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE,
  ]);
  await query(assignAllForUserSql('user_tasks', 'tasks', 'task_id'), [
    userId,
    TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE,
  ]);
};
