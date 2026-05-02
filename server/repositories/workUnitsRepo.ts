import { type SQL, sql } from 'drizzle-orm';
import pool, { type QueryExecutor } from '../db/index.ts';

export type Manager = { id: string; name: string };

export type WorkUnit = {
  id: string;
  name: string;
  managers: Manager[];
  description: string | null;
  isDisabled: boolean;
  userCount: number;
};

const baseSelect = `
  SELECT w.id, w.name, w.description, w.is_disabled AS "isDisabled",
    (
      SELECT COALESCE(json_agg(json_build_object('id', u.id, 'name', u.name)), '[]')
      FROM work_unit_managers wum
      JOIN users u ON wum.user_id = u.id
      WHERE wum.work_unit_id = w.id
    ) AS managers,
    (SELECT COUNT(*)::int FROM user_work_units uw WHERE uw.work_unit_id = w.id) AS "userCount"
  FROM work_units w
`;

export const findById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<WorkUnit | null> => {
  const { rows } = await exec.query<WorkUnit>(`${baseSelect} WHERE w.id = $1`, [id]);
  return rows[0] ?? null;
};

export const listAll = async (exec: QueryExecutor = pool): Promise<WorkUnit[]> => {
  const { rows } = await exec.query<WorkUnit>(`${baseSelect} ORDER BY w.name`);
  return rows;
};

export const listManagedBy = async (
  managerId: string,
  exec: QueryExecutor = pool,
): Promise<WorkUnit[]> => {
  const { rows } = await exec.query<WorkUnit>(
    `${baseSelect}
     WHERE EXISTS (
       SELECT 1 FROM work_unit_managers wum
       WHERE wum.work_unit_id = w.id AND wum.user_id = $1
     )
     ORDER BY w.name`,
    [managerId],
  );
  return rows;
};

export type NewWorkUnit = {
  id: string;
  name: string;
  description: string | null;
};

export const create = async (workUnit: NewWorkUnit, exec: QueryExecutor = pool): Promise<void> => {
  await exec.query(`INSERT INTO work_units (id, name, description) VALUES ($1, $2, $3)`, [
    workUnit.id,
    workUnit.name,
    workUnit.description,
  ]);
};

export const addManagers = async (
  unitId: string,
  userIds: string[],
  exec: QueryExecutor = pool,
): Promise<void> => {
  if (userIds.length === 0) return;
  await exec.query(
    `INSERT INTO work_unit_managers (work_unit_id, user_id)
     SELECT $1, unnest($2::text[])
     ON CONFLICT DO NOTHING`,
    [unitId, userIds],
  );
};

export const addUsersToUnit = async (
  unitId: string,
  userIds: string[],
  exec: QueryExecutor = pool,
): Promise<void> => {
  if (userIds.length === 0) return;
  await exec.query(
    `INSERT INTO user_work_units (work_unit_id, user_id)
     SELECT $1, unnest($2::text[])
     ON CONFLICT DO NOTHING`,
    [unitId, userIds],
  );
};

export const lockById = async (id: string, exec: QueryExecutor = pool): Promise<boolean> => {
  const { rows } = await exec.query(`SELECT id FROM work_units WHERE id = $1 FOR UPDATE`, [id]);
  return rows.length > 0;
};

export type UpdateFields = {
  name?: string | null;
  description?: string | null;
  isDisabled?: boolean;
};

export const updateFields = async (
  id: string,
  fields: UpdateFields,
  exec: QueryExecutor = pool,
): Promise<void> => {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (fields.name !== undefined) {
    sets.push(`name = $${idx++}`);
    values.push(fields.name);
  }
  if (fields.description !== undefined) {
    sets.push(`description = $${idx++}`);
    values.push(fields.description);
  }
  if (fields.isDisabled !== undefined) {
    sets.push(`is_disabled = $${idx++}`);
    values.push(fields.isDisabled);
  }

  if (sets.length === 0) return;

  values.push(id);
  await exec.query(`UPDATE work_units SET ${sets.join(', ')} WHERE id = $${idx}`, values);
};

export const clearManagers = async (unitId: string, exec: QueryExecutor = pool): Promise<void> => {
  await exec.query(`DELETE FROM work_unit_managers WHERE work_unit_id = $1`, [unitId]);
};

export const clearUsers = async (unitId: string, exec: QueryExecutor = pool): Promise<void> => {
  await exec.query(`DELETE FROM user_work_units WHERE work_unit_id = $1`, [unitId]);
};

export const deleteById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<{ name: string } | null> => {
  const { rows } = await exec.query<{ name: string }>(
    `DELETE FROM work_units WHERE id = $1 RETURNING name`,
    [id],
  );
  return rows[0] ?? null;
};

export const findUserIds = async (
  unitId: string,
  exec: QueryExecutor = pool,
): Promise<string[]> => {
  const { rows } = await exec.query<{ id: string }>(
    `SELECT u.id
       FROM user_work_units uw
       JOIN users u ON uw.user_id = u.id
      WHERE uw.work_unit_id = $1`,
    [unitId],
  );
  return rows.map((r) => r.id);
};

export const findNameById = async (
  unitId: string,
  exec: QueryExecutor = pool,
): Promise<string | null> => {
  const { rows } = await exec.query<{ name: string }>(`SELECT name FROM work_units WHERE id = $1`, [
    unitId,
  ]);
  return rows[0]?.name ?? null;
};

export const isUserManagerOfUnit = async (
  userId: string,
  unitId: string,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rows } = await exec.query(
    `SELECT 1 FROM work_unit_managers WHERE work_unit_id = $1 AND user_id = $2 LIMIT 1`,
    [unitId, userId],
  );
  return rows.length > 0;
};

export const isUserManagedBy = async (
  managerId: string,
  targetUserId: string,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rows } = await exec.query(
    `SELECT 1
       FROM user_work_units uwu
       JOIN work_unit_managers wum ON uwu.work_unit_id = wum.work_unit_id
      WHERE wum.user_id = $1 AND uwu.user_id = $2
      LIMIT 1`,
    [managerId, targetUserId],
  );
  return rows.length > 0;
};

// Legacy `$N`-placeholder string — used by un-converted repos that still author raw `pg`
// query strings. Remove when this repo is converted to Drizzle (Tier 3 of the conversion
// roadmap), at which point `managedUserIdsSubquerySql` is the only call shape that remains.
export const managedUserIdsSubquery = (paramIdx: number) =>
  `SELECT uwu.user_id
     FROM user_work_units uwu
     JOIN work_unit_managers wum ON uwu.work_unit_id = wum.work_unit_id
    WHERE wum.user_id = $${paramIdx}`;

// Drizzle-flavored sibling of `managedUserIdsSubquery` for repos using `sql\`\`` templates.
// Drizzle's tagged template handles parameter numbering automatically, so the caller
// passes the actual managerId rather than a `$N` index.
export const managedUserIdsSubquerySql = (managerId: string): SQL =>
  sql`SELECT uwu.user_id
        FROM user_work_units uwu
        JOIN work_unit_managers wum ON uwu.work_unit_id = wum.work_unit_id
       WHERE wum.user_id = ${managerId}`;

export const listManagedUserIds = async (
  managerId: string,
  exec: QueryExecutor = pool,
): Promise<string[]> => {
  const { rows } = await exec.query<{ user_id: string }>(
    `SELECT DISTINCT uwu.user_id
       FROM user_work_units uwu
       JOIN work_unit_managers wum ON uwu.work_unit_id = wum.work_unit_id
      WHERE wum.user_id = $1`,
    [managerId],
  );
  return rows.map((r) => String(r.user_id)).filter(Boolean);
};
