import pool, { type QueryExecutor } from '../db/index.ts';

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

export type AvailableRole = {
  id: string;
  name: string;
  isSystem: boolean;
  isAdmin: boolean;
};

export const listAvailableRolesForUser = async (
  userId: string,
  exec: QueryExecutor = pool,
): Promise<AvailableRole[]> => {
  const { rows } = await exec.query<AvailableRole>(
    `SELECT r.id, r.name, r.is_system AS "isSystem", r.is_admin AS "isAdmin"
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1
      ORDER BY r.name`,
    [userId],
  );
  return rows;
};
