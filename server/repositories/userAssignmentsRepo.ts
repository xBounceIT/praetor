import { type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { type DbExecutor, db, executeRows, runAtomically } from '../db/drizzle.ts';
import {
  type AssignmentSource,
  MANUAL_ASSIGNMENT_SOURCE,
  PROJECT_CASCADE_ASSIGNMENT_SOURCE,
  TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE,
} from '../db/schema/_userAssignmentTable.ts';
import { userClients } from '../db/schema/clients.ts';
import { userProjects } from '../db/schema/projects.ts';
import { userTasks } from '../db/schema/tasks.ts';
import { TOP_MANAGER_ROLE_ID } from '../utils/permissions.ts';
import * as rolesRepo from './rolesRepo.ts';

// Re-export so existing callsites keep importing from `userAssignmentsRepo` even though the
// canonical definitions live in the schema-level `_userAssignmentTable.ts` (where the CHECK
// constraint and column type also reference them).
export {
  type AssignmentSource,
  MANUAL_ASSIGNMENT_SOURCE,
  PROJECT_CASCADE_ASSIGNMENT_SOURCE,
  TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE,
};

// Conflict resolution for the upsert: manual wins over top_manager_auto wins over the existing
// row's source. `excluded.assignment_source` references the proposed-insert row (PG syntax).
// `col` resolves to the qualified `"user_X"."assignment_source"` and can be either a typed
// Drizzle column (Drizzle-builder path) or a raw `sql.identifier(...)` chunk (raw-SQL path).
const mergedSource = (col: SQL | AnyPgColumn) => sql`CASE
    WHEN ${col} = ${MANUAL_ASSIGNMENT_SOURCE}
      OR excluded.assignment_source = ${MANUAL_ASSIGNMENT_SOURCE}
    THEN ${MANUAL_ASSIGNMENT_SOURCE}
    WHEN ${col} = ${TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE}
      OR excluded.assignment_source = ${TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE}
    THEN ${TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE}
    ELSE ${col}
  END`;

// Allowlist of (join table, FK column, owning table) triples. Spec entries feed `sql.identifier`
// for the bulk INSERT...SELECT helpers; raw caller input never reaches the SQL identifier.
export type AssignmentSpec = {
  table: 'user_clients' | 'user_projects' | 'user_tasks';
  fkColumn: 'client_id' | 'project_id' | 'task_id';
  sourceTable: 'clients' | 'projects' | 'tasks';
};

export const ASSIGNMENT_SPECS = {
  clients: { table: 'user_clients', fkColumn: 'client_id', sourceTable: 'clients' },
  projects: { table: 'user_projects', fkColumn: 'project_id', sourceTable: 'projects' },
  tasks: { table: 'user_tasks', fkColumn: 'task_id', sourceTable: 'tasks' },
} as const satisfies Record<'clients' | 'projects' | 'tasks', AssignmentSpec>;

// Qualified `"<table>"."assignment_source"` reference for the raw-SQL helpers - `mergedSource`
// expects this shape so it works the same as for the typed-builder path.
const tableAssignmentSourceCol = (spec: AssignmentSpec): SQL =>
  sql`${sql.identifier(spec.table)}.assignment_source`;

// Auto-assign every existing top manager to one specific entity (called when the entity is
// created). Spec is allowlisted; `targetId` is parameterized.
const assignAllTopManagersTo = (
  spec: AssignmentSpec,
  targetId: string,
  exec: DbExecutor,
): Promise<unknown> =>
  exec.execute(sql`
    INSERT INTO ${sql.identifier(spec.table)} (user_id, ${sql.identifier(spec.fkColumn)}, assignment_source)
    SELECT ur.user_id, ${targetId}, ${TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE}
    FROM user_roles ur
    WHERE ur.role_id = ${TOP_MANAGER_ROLE_ID}
    ON CONFLICT (user_id, ${sql.identifier(spec.fkColumn)}) DO UPDATE
    SET assignment_source = ${mergedSource(tableAssignmentSourceCol(spec))}
  `);

const clearTopManagerAssignmentsForUser = (userId: string, exec: DbExecutor): Promise<unknown> =>
  exec.execute(sql`
    WITH deleted_clients AS (
      DELETE FROM user_clients
      WHERE user_id = ${userId}
        AND assignment_source = ${TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE}
      RETURNING 1
    ),
    deleted_projects AS (
      DELETE FROM user_projects
      WHERE user_id = ${userId}
        AND assignment_source = ${TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE}
      RETURNING 1
    ),
    deleted_tasks AS (
      DELETE FROM user_tasks
      WHERE user_id = ${userId}
        AND assignment_source = ${TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE}
      RETURNING 1
    )
    SELECT 1
  `);

const assignAllScopesToUserAsTopManager = (userId: string, exec: DbExecutor): Promise<unknown> =>
  exec.execute(sql`
    WITH client_assignments AS (
      INSERT INTO user_clients (user_id, client_id, assignment_source)
      SELECT ${userId}, id, ${TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE}
      FROM clients
      ON CONFLICT (user_id, client_id) DO UPDATE
      SET assignment_source = ${mergedSource(tableAssignmentSourceCol(ASSIGNMENT_SPECS.clients))}
      RETURNING 1
    ),
    project_assignments AS (
      INSERT INTO user_projects (user_id, project_id, assignment_source)
      SELECT ${userId}, id, ${TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE}
      FROM projects
      ON CONFLICT (user_id, project_id) DO UPDATE
      SET assignment_source = ${mergedSource(tableAssignmentSourceCol(ASSIGNMENT_SPECS.projects))}
      RETURNING 1
    ),
    task_assignments AS (
      INSERT INTO user_tasks (user_id, task_id, assignment_source)
      SELECT ${userId}, id, ${TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE}
      FROM tasks
      ON CONFLICT (user_id, task_id) DO UPDATE
      SET assignment_source = ${mergedSource(tableAssignmentSourceCol(ASSIGNMENT_SPECS.tasks))}
      RETURNING 1
    )
    SELECT 1
  `);

export const userHasTopManagerRole = (userId: string, exec: DbExecutor = db): Promise<boolean> =>
  rolesRepo.userHasRole(userId, TOP_MANAGER_ROLE_ID, exec);

const isAssignedToUser = async (
  spec: AssignmentSpec,
  userId: string,
  targetId: string,
  exec: DbExecutor,
): Promise<boolean> => {
  const rows = await executeRows<{ exists: boolean }>(
    exec,
    sql`SELECT EXISTS (
      SELECT 1
      FROM ${sql.identifier(spec.table)}
      WHERE user_id = ${userId} AND ${sql.identifier(spec.fkColumn)} = ${targetId}
    ) AS "exists"`,
  );
  return rows[0]?.exists === true;
};

const filterAssignedIds = async (
  spec: AssignmentSpec,
  userId: string,
  targetIds: string[],
  exec: DbExecutor,
): Promise<Set<string>> => {
  if (targetIds.length === 0) return new Set();
  const uniqueIds = Array.from(new Set(targetIds));
  const rows = await executeRows<{ id: string }>(
    exec,
    sql`SELECT ${sql.identifier(spec.fkColumn)} AS id
        FROM ${sql.identifier(spec.table)}
        WHERE user_id = ${userId}
          AND ${sql.identifier(spec.fkColumn)} = ANY(${sql.param(uniqueIds)}::text[])`,
  );
  return new Set(rows.map((row) => row.id));
};

export const isClientAssignedToUser = (
  userId: string,
  clientId: string,
  exec: DbExecutor = db,
): Promise<boolean> => isAssignedToUser(ASSIGNMENT_SPECS.clients, userId, clientId, exec);

export const isProjectAssignedToUser = (
  userId: string,
  projectId: string,
  exec: DbExecutor = db,
): Promise<boolean> => isAssignedToUser(ASSIGNMENT_SPECS.projects, userId, projectId, exec);

export const isTaskAssignedToUser = (
  userId: string,
  taskId: string,
  exec: DbExecutor = db,
): Promise<boolean> => isAssignedToUser(ASSIGNMENT_SPECS.tasks, userId, taskId, exec);

export const filterAssignedClientIds = (
  userId: string,
  clientIds: string[],
  exec: DbExecutor = db,
): Promise<Set<string>> => filterAssignedIds(ASSIGNMENT_SPECS.clients, userId, clientIds, exec);

export const filterAssignedProjectIds = (
  userId: string,
  projectIds: string[],
  exec: DbExecutor = db,
): Promise<Set<string>> => filterAssignedIds(ASSIGNMENT_SPECS.projects, userId, projectIds, exec);

export const filterAssignedTaskIds = (
  userId: string,
  taskIds: string[],
  exec: DbExecutor = db,
): Promise<Set<string>> => filterAssignedIds(ASSIGNMENT_SPECS.tasks, userId, taskIds, exec);

export const assignClientToUser = async (
  userId: string,
  clientId: string,
  source: AssignmentSource = MANUAL_ASSIGNMENT_SOURCE,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec
    .insert(userClients)
    .values({ userId, clientId, assignmentSource: source })
    .onConflictDoUpdate({
      target: [userClients.userId, userClients.clientId],
      set: { assignmentSource: mergedSource(userClients.assignmentSource) },
    });
};

export const assignProjectToUser = async (
  userId: string,
  projectId: string,
  source: AssignmentSource = MANUAL_ASSIGNMENT_SOURCE,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec
    .insert(userProjects)
    .values({ userId, projectId, assignmentSource: source })
    .onConflictDoUpdate({
      target: [userProjects.userId, userProjects.projectId],
      set: { assignmentSource: mergedSource(userProjects.assignmentSource) },
    });
};

export const assignTaskToUser = async (
  userId: string,
  taskId: string,
  source: AssignmentSource = MANUAL_ASSIGNMENT_SOURCE,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec
    .insert(userTasks)
    .values({ userId, taskId, assignmentSource: source })
    .onConflictDoUpdate({
      target: [userTasks.userId, userTasks.taskId],
      set: { assignmentSource: mergedSource(userTasks.assignmentSource) },
    });
};

export const assignClientToTopManagers = async (
  clientId: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await assignAllTopManagersTo(ASSIGNMENT_SPECS.clients, clientId, exec);
};

export const assignProjectToTopManagers = async (
  projectId: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await assignAllTopManagersTo(ASSIGNMENT_SPECS.projects, projectId, exec);
};

export const assignTaskToTopManagers = async (
  taskId: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await assignAllTopManagersTo(ASSIGNMENT_SPECS.tasks, taskId, exec);
};

export const clearProjectCascadeAssignments = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await executeRows(
    exec,
    sql`DELETE FROM user_clients WHERE user_id = ${userId} AND assignment_source = ${PROJECT_CASCADE_ASSIGNMENT_SOURCE}`,
  );
};

export const applyProjectCascadeToClients = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await executeRows(
    exec,
    sql`INSERT INTO user_clients (user_id, client_id, assignment_source)
        SELECT ${userId}, p.client_id, ${PROJECT_CASCADE_ASSIGNMENT_SOURCE}
          FROM user_projects up
          JOIN projects p ON up.project_id = p.id
         WHERE up.user_id = ${userId}
        ON CONFLICT (user_id, client_id) DO NOTHING`,
  );
};

export const syncTopManagerAssignmentsForUser = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<void> => {
  // Keep the role read and assignment fan-out in one atomic scope for standalone callers;
  // callers that already supplied a transaction reuse it via runAtomically.
  await runAtomically(exec, async (tx) => {
    const isTopManager = await userHasTopManagerRole(userId, tx);

    if (!isTopManager) {
      await clearTopManagerAssignmentsForUser(userId, tx);
      // Cascade rebuild reads from `user_projects`, which the deletes above just modified.
      await applyProjectCascadeToClients(userId, tx);
      return;
    }

    await assignAllScopesToUserAsTopManager(userId, tx);
  });
};

const replaceAssignments = (
  spec: AssignmentSpec,
  userId: string,
  ids: string[],
  source: AssignmentSource,
  exec: DbExecutor,
): Promise<void> =>
  runAtomically(exec, async (tx) => {
    // sql.identifier safely injects the allowlisted table/column from ASSIGNMENT_SPECS.
    await executeRows(tx, sql`DELETE FROM ${sql.identifier(spec.table)} WHERE user_id = ${userId}`);
    if (ids.length > 0) {
      const valueRows = ids.map((id) => sql`(${userId}, ${id}, ${source})`);
      await executeRows(
        tx,
        sql`INSERT INTO ${sql.identifier(spec.table)} (user_id, ${sql.identifier(spec.fkColumn)}, assignment_source)
            VALUES ${sql.join(valueRows, sql`, `)}
            ON CONFLICT DO NOTHING`,
      );
    }
  });

export const replaceUserClients = (
  userId: string,
  clientIds: string[],
  source: AssignmentSource,
  exec: DbExecutor = db,
): Promise<void> => replaceAssignments(ASSIGNMENT_SPECS.clients, userId, clientIds, source, exec);

export const replaceUserProjects = (
  userId: string,
  projectIds: string[],
  source: AssignmentSource,
  exec: DbExecutor = db,
): Promise<void> => replaceAssignments(ASSIGNMENT_SPECS.projects, userId, projectIds, source, exec);

export const replaceUserTasks = (
  userId: string,
  taskIds: string[],
  source: AssignmentSource,
  exec: DbExecutor = db,
): Promise<void> => replaceAssignments(ASSIGNMENT_SPECS.tasks, userId, taskIds, source, exec);
