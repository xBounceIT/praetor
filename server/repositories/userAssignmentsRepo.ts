import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { userClients } from '../db/schema/clients.ts';
import { userProjects } from '../db/schema/projects.ts';
import { userTasks } from '../db/schema/tasks.ts';
import { TOP_MANAGER_ROLE_ID } from '../utils/permissions.ts';
import * as rolesRepo from './rolesRepo.ts';

export const MANUAL_ASSIGNMENT_SOURCE = 'manual';
export const TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE = 'top_manager_auto';
export const PROJECT_CASCADE_ASSIGNMENT_SOURCE = 'project_cascade';

export type AssignmentSource =
  | typeof MANUAL_ASSIGNMENT_SOURCE
  | typeof TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE
  | typeof PROJECT_CASCADE_ASSIGNMENT_SOURCE;

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

// Qualified `"<table>"."assignment_source"` reference for the raw-SQL helpers — `mergedSource`
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

// Auto-assign one user (a newly-promoted top manager) to every existing entity in the
// owning table. The CASE preserves any existing manual rows.
const assignAllToUserAsTopManager = (
  spec: AssignmentSpec,
  userId: string,
  exec: DbExecutor,
): Promise<unknown> =>
  exec.execute(sql`
    INSERT INTO ${sql.identifier(spec.table)} (user_id, ${sql.identifier(spec.fkColumn)}, assignment_source)
    SELECT ${userId}, id, ${TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE}
    FROM ${sql.identifier(spec.sourceTable)}
    ON CONFLICT (user_id, ${sql.identifier(spec.fkColumn)}) DO UPDATE
    SET assignment_source = ${mergedSource(tableAssignmentSourceCol(spec))}
  `);

export const userHasTopManagerRole = (userId: string, exec: DbExecutor = db) =>
  rolesRepo.userHasRole(userId, TOP_MANAGER_ROLE_ID, exec);

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

// The cascade rebuild reads from `user_projects`, which the parallel deletes above may have
// just modified — keep it sequenced after `await Promise.all([...])` so it sees the final
// state, never an interleaved view.
export const syncTopManagerAssignmentsForUser = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<void> => {
  const isTopManager = await userHasTopManagerRole(userId, exec);

  if (!isTopManager) {
    await Promise.all([
      exec
        .delete(userClients)
        .where(
          and(
            eq(userClients.userId, userId),
            eq(userClients.assignmentSource, TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE),
          ),
        ),
      exec
        .delete(userProjects)
        .where(
          and(
            eq(userProjects.userId, userId),
            eq(userProjects.assignmentSource, TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE),
          ),
        ),
      exec
        .delete(userTasks)
        .where(
          and(
            eq(userTasks.userId, userId),
            eq(userTasks.assignmentSource, TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE),
          ),
        ),
    ]);
    await applyProjectCascadeToClients(userId, exec);
    return;
  }

  await Promise.all([
    assignAllToUserAsTopManager(ASSIGNMENT_SPECS.clients, userId, exec),
    assignAllToUserAsTopManager(ASSIGNMENT_SPECS.projects, userId, exec),
    assignAllToUserAsTopManager(ASSIGNMENT_SPECS.tasks, userId, exec),
  ]);
};
