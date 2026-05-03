import { eq, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { projects } from '../db/schema/projects.ts';
import { getForeignKeyViolation } from '../utils/db-errors.ts';
import { ForeignKeyError } from '../utils/http-errors.ts';
import {
  MANUAL_ASSIGNMENT_SOURCE,
  PROJECT_CASCADE_ASSIGNMENT_SOURCE,
  TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE,
} from '../utils/top-manager-assignments.ts';

export type Project = {
  id: string;
  name: string;
  clientId: string;
  color: string;
  description: string | null;
  isDisabled: boolean;
  createdAt: number;
  orderId: string | null;
};

const mapRow = (row: typeof projects.$inferSelect): Project => ({
  id: row.id,
  name: row.name,
  clientId: row.clientId,
  color: row.color,
  description: row.description,
  isDisabled: row.isDisabled ?? false,
  // `created_at` has DEFAULT CURRENT_TIMESTAMP but is technically nullable in the schema;
  // `?? 0` is a TS-strict appeasement for the unreachable branch.
  createdAt: row.createdAt?.getTime() ?? 0,
  orderId: row.orderId,
});

export const listAll = async (exec: DbExecutor = db): Promise<Project[]> => {
  const rows = await exec.select().from(projects).orderBy(projects.name);
  return rows.map(mapRow);
};

export const listForUser = async (userId: string, exec: DbExecutor = db): Promise<Project[]> => {
  // user_projects is un-modeled (Tier 5+); raw SQL with named-key rows.
  type Row = {
    id: string;
    name: string;
    client_id: string;
    color: string;
    description: string | null;
    is_disabled: boolean | null;
    created_at: string | Date | null;
    order_id: string | null;
  };
  const rows = await executeRows<Row>(
    exec,
    sql`SELECT p.id, p.name, p.client_id, p.color, p.description, p.is_disabled, p.created_at, p.order_id
       FROM projects p
       INNER JOIN user_projects up ON p.id = up.project_id
      WHERE up.user_id = ${userId}
      ORDER BY p.name`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    clientId: row.client_id,
    color: row.color,
    description: row.description,
    isDisabled: row.is_disabled ?? false,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : 0,
    orderId: row.order_id,
  }));
};

export const findClientId = async (id: string, exec: DbExecutor = db): Promise<string | null> => {
  const rows = await exec
    .select({ clientId: projects.clientId })
    .from(projects)
    .where(eq(projects.id, id));
  return rows[0]?.clientId ?? null;
};

export const lockClientIdById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<string | null> => {
  const rows = await exec
    .select({ clientId: projects.clientId })
    .from(projects)
    .where(eq(projects.id, id))
    .for('update');
  return rows[0]?.clientId ?? null;
};

export const lockNameAndClientById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ name: string; clientId: string } | null> => {
  const rows = await exec
    .select({ name: projects.name, clientId: projects.clientId })
    .from(projects)
    .where(eq(projects.id, id))
    .for('update');
  return rows[0] ?? null;
};

export type NewProject = {
  id: string;
  name: string;
  clientId: string;
  color: string;
  description: string | null;
  isDisabled: boolean;
  orderId?: string | null;
};

const PROJECT_ORDER_FK_CONSTRAINT = 'projects_order_id_fkey';

export const create = async (project: NewProject, exec: DbExecutor = db): Promise<Project> => {
  try {
    const rows = await exec
      .insert(projects)
      .values({
        id: project.id,
        name: project.name,
        clientId: project.clientId,
        color: project.color,
        description: project.description,
        isDisabled: project.isDisabled,
        orderId: project.orderId ?? null,
      })
      .returning();
    return mapRow(rows[0]);
  } catch (err) {
    const fk = getForeignKeyViolation(err);
    if (fk) {
      if (fk.constraint === PROJECT_ORDER_FK_CONSTRAINT) throw new ForeignKeyError('Linked order');
      throw new ForeignKeyError('Client');
    }
    throw err;
  }
};

export type ProjectUpdate = {
  name?: string | null;
  clientId?: string | null;
  color?: string | null;
  description?: string | null;
  isDisabled?: boolean;
};

export const update = async (
  id: string,
  patch: ProjectUpdate,
  exec: DbExecutor = db,
): Promise<Project | null> => {
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.clientId !== undefined) set.clientId = patch.clientId;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.isDisabled !== undefined) set.isDisabled = patch.isDisabled;

  if (Object.keys(set).length === 0) {
    const rows = await exec.select().from(projects).where(eq(projects.id, id));
    return rows[0] ? mapRow(rows[0]) : null;
  }

  try {
    const rows = await exec.update(projects).set(set).where(eq(projects.id, id)).returning();
    return rows[0] ? mapRow(rows[0]) : null;
  } catch (err) {
    if (getForeignKeyViolation(err)) throw new ForeignKeyError('Client');
    throw err;
  }
};

export const deleteById = async (id: string, exec: DbExecutor = db): Promise<void> => {
  await exec.delete(projects).where(eq(projects.id, id));
};

export const findAssignedUserIds = async (
  projectId: string,
  exec: DbExecutor = db,
): Promise<string[]> => {
  const rows = await executeRows<{ user_id: string }>(
    exec,
    sql`SELECT user_id FROM user_projects WHERE project_id = ${projectId}`,
  );
  return rows.map((r) => r.user_id);
};

export const findNonTopManagerUserIds = async (
  projectId: string,
  exec: DbExecutor = db,
): Promise<string[]> => {
  const rows = await executeRows<{ user_id: string }>(
    exec,
    sql`SELECT user_id FROM user_projects
        WHERE project_id = ${projectId} AND assignment_source != ${TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE}`,
  );
  return rows.map((r) => r.user_id);
};

export const clearNonTopManagerAssignments = async (
  projectId: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await executeRows(
    exec,
    sql`DELETE FROM user_projects
        WHERE project_id = ${projectId} AND assignment_source != ${TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE}`,
  );
};

export const addManualAssignments = async (
  projectId: string,
  userIds: string[],
  exec: DbExecutor = db,
): Promise<void> => {
  if (userIds.length === 0) return;
  await executeRows(
    exec,
    sql`INSERT INTO user_projects (user_id, project_id, assignment_source)
        SELECT unnest(${sql.param(userIds)}::text[]), ${projectId}, ${MANUAL_ASSIGNMENT_SOURCE}
        ON CONFLICT DO NOTHING`,
  );
};

export const ensureClientCascadeAssignments = async (
  userIds: string[],
  clientId: string,
  exec: DbExecutor = db,
): Promise<void> => {
  if (userIds.length === 0) return;
  await executeRows(
    exec,
    sql`INSERT INTO user_clients (user_id, client_id, assignment_source)
        SELECT unnest(${sql.param(userIds)}::text[]), ${clientId}, ${PROJECT_CASCADE_ASSIGNMENT_SOURCE}
        ON CONFLICT DO NOTHING`,
  );
};

export const removeClientCascadeForUsersIfUnused = async (
  userIds: string[],
  clientId: string,
  exec: DbExecutor = db,
): Promise<void> => {
  if (userIds.length === 0) return;
  await executeRows(
    exec,
    sql`DELETE FROM user_clients uc
        WHERE uc.user_id = ANY(${sql.param(userIds)}::text[])
          AND uc.client_id = ${clientId}
          AND uc.assignment_source = ${PROJECT_CASCADE_ASSIGNMENT_SOURCE}
          AND NOT EXISTS (
            SELECT 1 FROM user_projects up
            INNER JOIN projects p ON up.project_id = p.id
            WHERE up.user_id = uc.user_id AND p.client_id = ${clientId}
          )`,
  );
};
