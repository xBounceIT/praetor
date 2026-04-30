import pool, { type QueryExecutor } from '../db/index.ts';

export type Role = {
  id: string;
  name: string;
  isSystem: boolean;
  isAdmin: boolean;
};

const SELECT_COLUMNS = `id, name, is_system AS "isSystem", is_admin AS "isAdmin"`;

export const findExistingIds = async (
  ids: string[],
  exec: QueryExecutor = pool,
): Promise<Set<string>> => {
  if (ids.length === 0) return new Set();
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM roles WHERE id = ANY($1::text[])`,
    [ids],
  );
  return new Set(rows.map((r) => r.id));
};

export const userHasRole = async (
  userId: string,
  roleId: string,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rows } = await exec.query(
    `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2 LIMIT 1`,
    [userId, roleId],
  );
  return rows.length > 0;
};

export const listAvailableRolesForUser = async (
  userId: string,
  exec: QueryExecutor = pool,
): Promise<Role[]> => {
  const { rows } = await exec.query<Role>(
    `SELECT r.id, r.name, r.is_system AS "isSystem", r.is_admin AS "isAdmin"
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1
      ORDER BY r.name`,
    [userId],
  );
  return rows;
};

export const listAll = async (exec: QueryExecutor = pool): Promise<Role[]> => {
  const { rows } = await exec.query<Role>(`SELECT ${SELECT_COLUMNS} FROM roles ORDER BY name`);
  return rows;
};

export const findById = async (id: string, exec: QueryExecutor = pool): Promise<Role | null> => {
  const { rows } = await exec.query<Role>(`SELECT ${SELECT_COLUMNS} FROM roles WHERE id = $1`, [
    id,
  ]);
  return rows[0] ?? null;
};

export const listExplicitPermissions = async (
  roleId: string,
  exec: QueryExecutor = pool,
): Promise<string[]> => {
  const { rows } = await exec.query<{ permission: string }>(
    `SELECT permission FROM role_permissions WHERE role_id = $1`,
    [roleId],
  );
  return rows.map((r) => r.permission);
};

export const insertRole = async (
  id: string,
  name: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(
    `INSERT INTO roles (id, name, is_system, is_admin) VALUES ($1, $2, FALSE, FALSE)`,
    [id, name],
  );
};

export const updateRoleName = async (
  id: string,
  name: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(`UPDATE roles SET name = $1 WHERE id = $2`, [name, id]);
};

export const deleteRole = async (id: string, exec: QueryExecutor = pool): Promise<void> => {
  await exec.query(`DELETE FROM roles WHERE id = $1`, [id]);
};

export const insertPermission = async (
  roleId: string,
  permission: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(
    `INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [roleId, permission],
  );
};

export const clearPermissions = async (
  roleId: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(`DELETE FROM role_permissions WHERE role_id = $1`, [roleId]);
};

export const isRoleInUse = async (roleId: string, exec: QueryExecutor = pool): Promise<boolean> => {
  const { rows } = await exec.query(`SELECT 1 FROM users WHERE role = $1 LIMIT 1`, [roleId]);
  return rows.length > 0;
};
