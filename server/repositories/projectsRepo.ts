import pool, { type QueryExecutor } from '../db/index.ts';
import { isForeignKeyViolation } from '../utils/db-errors.ts';
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

type ProjectRaw = {
  id: string;
  name: string;
  client_id: string;
  color: string;
  description: string | null;
  is_disabled: boolean;
  created_at: string | Date;
  order_id: string | null;
};

const PROJECT_COLUMNS = `id, name, client_id, color, description, is_disabled, created_at, order_id`;

const mapRow = (row: ProjectRaw): Project => ({
  id: row.id,
  name: row.name,
  clientId: row.client_id,
  color: row.color,
  description: row.description,
  isDisabled: row.is_disabled,
  createdAt: new Date(row.created_at).getTime(),
  orderId: row.order_id,
});

export const listAll = async (exec: QueryExecutor = pool): Promise<Project[]> => {
  const { rows } = await exec.query<ProjectRaw>(
    `SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY name`,
  );
  return rows.map(mapRow);
};

export const listForUser = async (
  userId: string,
  exec: QueryExecutor = pool,
): Promise<Project[]> => {
  const { rows } = await exec.query<ProjectRaw>(
    `SELECT p.id, p.name, p.client_id, p.color, p.description, p.is_disabled, p.created_at, p.order_id
       FROM projects p
       INNER JOIN user_projects up ON p.id = up.project_id
      WHERE up.user_id = $1
      ORDER BY p.name`,
    [userId],
  );
  return rows.map(mapRow);
};

export const findClientId = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<string | null> => {
  const { rows } = await exec.query<{ client_id: string }>(
    `SELECT client_id FROM projects WHERE id = $1`,
    [id],
  );
  return rows[0]?.client_id ?? null;
};

export const lockClientIdById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<string | null> => {
  const { rows } = await exec.query<{ client_id: string }>(
    `SELECT client_id FROM projects WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0]?.client_id ?? null;
};

export const lockNameAndClientById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<{ name: string; clientId: string } | null> => {
  const { rows } = await exec.query<{ name: string; client_id: string }>(
    `SELECT name, client_id FROM projects WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!rows[0]) return null;
  return { name: rows[0].name, clientId: rows[0].client_id };
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

export const create = async (project: NewProject, exec: QueryExecutor = pool): Promise<Project> => {
  try {
    const { rows } = await exec.query<ProjectRaw>(
      `INSERT INTO projects (id, name, client_id, color, description, is_disabled, order_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${PROJECT_COLUMNS}`,
      [
        project.id,
        project.name,
        project.clientId,
        project.color,
        project.description,
        project.isDisabled,
        project.orderId ?? null,
      ],
    );
    return mapRow(rows[0]);
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      if (err.constraint === PROJECT_ORDER_FK_CONSTRAINT) throw new ForeignKeyError('Linked order');
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
  exec: QueryExecutor = pool,
): Promise<Project | null> => {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  const fields: Array<[string, unknown]> = [
    ['name', patch.name],
    ['client_id', patch.clientId],
    ['color', patch.color],
    ['description', patch.description],
    ['is_disabled', patch.isDisabled],
  ];
  for (const [col, value] of fields) {
    if (value !== undefined) {
      sets.push(`${col} = $${idx++}`);
      params.push(value);
    }
  }

  if (sets.length === 0) {
    const { rows } = await exec.query<ProjectRaw>(
      `SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = $1`,
      [id],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  params.push(id);
  try {
    const { rows } = await exec.query<ProjectRaw>(
      `UPDATE projects SET ${sets.join(', ')} WHERE id = $${idx} RETURNING ${PROJECT_COLUMNS}`,
      params,
    );
    return rows[0] ? mapRow(rows[0]) : null;
  } catch (err) {
    if (isForeignKeyViolation(err)) throw new ForeignKeyError('Client');
    throw err;
  }
};

export const deleteById = async (id: string, exec: QueryExecutor = pool): Promise<void> => {
  await exec.query(`DELETE FROM projects WHERE id = $1`, [id]);
};

export const findAssignedUserIds = async (
  projectId: string,
  exec: QueryExecutor = pool,
): Promise<string[]> => {
  const { rows } = await exec.query<{ user_id: string }>(
    `SELECT user_id FROM user_projects WHERE project_id = $1`,
    [projectId],
  );
  return rows.map((r) => r.user_id);
};

export const findNonTopManagerUserIds = async (
  projectId: string,
  exec: QueryExecutor = pool,
): Promise<string[]> => {
  const { rows } = await exec.query<{ user_id: string }>(
    `SELECT user_id FROM user_projects
      WHERE project_id = $1 AND assignment_source != $2`,
    [projectId, TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE],
  );
  return rows.map((r) => r.user_id);
};

export const clearNonTopManagerAssignments = async (
  projectId: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(`DELETE FROM user_projects WHERE project_id = $1 AND assignment_source != $2`, [
    projectId,
    TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE,
  ]);
};

export const addManualAssignments = async (
  projectId: string,
  userIds: string[],
  exec: QueryExecutor = pool,
): Promise<void> => {
  if (userIds.length === 0) return;
  await exec.query(
    `INSERT INTO user_projects (user_id, project_id, assignment_source)
     SELECT unnest($1::text[]), $2, $3 ON CONFLICT DO NOTHING`,
    [userIds, projectId, MANUAL_ASSIGNMENT_SOURCE],
  );
};

export const ensureClientCascadeAssignments = async (
  userIds: string[],
  clientId: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  if (userIds.length === 0) return;
  await exec.query(
    `INSERT INTO user_clients (user_id, client_id, assignment_source)
     SELECT unnest($1::text[]), $2, $3 ON CONFLICT DO NOTHING`,
    [userIds, clientId, PROJECT_CASCADE_ASSIGNMENT_SOURCE],
  );
};

export const removeClientCascadeForUsersIfUnused = async (
  userIds: string[],
  clientId: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  if (userIds.length === 0) return;
  await exec.query(
    `DELETE FROM user_clients uc
      WHERE uc.user_id = ANY($1::text[])
        AND uc.client_id = $2
        AND uc.assignment_source = $3
        AND NOT EXISTS (
          SELECT 1 FROM user_projects up
          INNER JOIN projects p ON up.project_id = p.id
          WHERE up.user_id = uc.user_id AND p.client_id = $2
        )`,
    [userIds, clientId, PROJECT_CASCADE_ASSIGNMENT_SOURCE],
  );
};
