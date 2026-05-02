import { and, eq, type SQL, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { userWorkUnits } from '../db/schema/userWorkUnits.ts';
import { workUnitManagers } from '../db/schema/workUnitManagers.ts';
import { workUnits } from '../db/schema/workUnits.ts';

export type Manager = { id: string; name: string };

export type WorkUnit = {
  id: string;
  name: string;
  managers: Manager[];
  description: string | null;
  isDisabled: boolean;
  userCount: number;
};

// SQL fragment used by findById/listAll/listManagedBy. Uses raw aliases (`w`, `wum`, `u`, `uw`)
// because the JSON aggregate / scalar subquery shape is awkward to express in the query builder
// and the legacy SQL is already battle-tested. The `AS "isDisabled"`/`AS "userCount"` aliases
// emit the camelCase keys directly, which is why these functions skip a mapRow step.
const baseSelect = sql`
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

export const findById = async (id: string, exec: DbExecutor = db): Promise<WorkUnit | null> => {
  const rows = await executeRows<WorkUnit>(exec, sql`${baseSelect} WHERE w.id = ${id}`);
  return rows[0] ?? null;
};

export const listAll = async (exec: DbExecutor = db): Promise<WorkUnit[]> => {
  const rows = await executeRows<WorkUnit>(exec, sql`${baseSelect} ORDER BY w.name`);
  return rows;
};

export const listManagedBy = async (
  managerId: string,
  exec: DbExecutor = db,
): Promise<WorkUnit[]> => {
  const rows = await executeRows<WorkUnit>(
    exec,
    sql`${baseSelect}
      WHERE EXISTS (
        SELECT 1 FROM work_unit_managers wum
        WHERE wum.work_unit_id = w.id AND wum.user_id = ${managerId}
      )
      ORDER BY w.name`,
  );
  return rows;
};

export type NewWorkUnit = {
  id: string;
  name: string;
  description: string | null;
};

export const create = async (workUnit: NewWorkUnit, exec: DbExecutor = db): Promise<void> => {
  await exec.insert(workUnits).values({
    id: workUnit.id,
    name: workUnit.name,
    description: workUnit.description,
  });
};

export const addManagers = async (
  unitId: string,
  userIds: string[],
  exec: DbExecutor = db,
): Promise<void> => {
  if (userIds.length === 0) return;
  await exec
    .insert(workUnitManagers)
    .values(userIds.map((userId) => ({ workUnitId: unitId, userId })))
    .onConflictDoNothing();
};

export const addUsersToUnit = async (
  unitId: string,
  userIds: string[],
  exec: DbExecutor = db,
): Promise<void> => {
  if (userIds.length === 0) return;
  await exec
    .insert(userWorkUnits)
    .values(userIds.map((userId) => ({ workUnitId: unitId, userId })))
    .onConflictDoNothing();
};

export const lockById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const rows = await exec
    .select({ id: workUnits.id })
    .from(workUnits)
    .where(eq(workUnits.id, id))
    .for('update');
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
  exec: DbExecutor = db,
): Promise<void> => {
  const set: Record<string, unknown> = {};
  if (fields.name !== undefined) set.name = fields.name;
  if (fields.description !== undefined) set.description = fields.description;
  if (fields.isDisabled !== undefined) set.isDisabled = fields.isDisabled;

  if (Object.keys(set).length === 0) return;

  await exec.update(workUnits).set(set).where(eq(workUnits.id, id));
};

export const clearManagers = async (unitId: string, exec: DbExecutor = db): Promise<void> => {
  await exec.delete(workUnitManagers).where(eq(workUnitManagers.workUnitId, unitId));
};

export const clearUsers = async (unitId: string, exec: DbExecutor = db): Promise<void> => {
  await exec.delete(userWorkUnits).where(eq(userWorkUnits.workUnitId, unitId));
};

export const deleteById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ name: string } | null> => {
  const rows = await exec
    .delete(workUnits)
    .where(eq(workUnits.id, id))
    .returning({ name: workUnits.name });
  return rows[0] ?? null;
};

export const findUserIds = async (unitId: string, exec: DbExecutor = db): Promise<string[]> => {
  // JOIN users (un-modeled): keep as raw SQL. The JOIN filters out user_work_units rows
  // pointing to deleted users — defensive even though the FK has ON DELETE CASCADE.
  const rows = await executeRows<{ id: string }>(
    exec,
    sql`SELECT u.id
          FROM user_work_units uw
          JOIN users u ON uw.user_id = u.id
         WHERE uw.work_unit_id = ${unitId}`,
  );
  return rows.map((r) => r.id);
};

export const findNameById = async (
  unitId: string,
  exec: DbExecutor = db,
): Promise<string | null> => {
  const rows = await exec
    .select({ name: workUnits.name })
    .from(workUnits)
    .where(eq(workUnits.id, unitId));
  return rows[0]?.name ?? null;
};

export const isUserManagerOfUnit = async (
  userId: string,
  unitId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const rows = await exec
    .select({ exists: sql`1` })
    .from(workUnitManagers)
    .where(and(eq(workUnitManagers.workUnitId, unitId), eq(workUnitManagers.userId, userId)))
    .limit(1);
  return rows.length > 0;
};

export const isUserManagedBy = async (
  managerId: string,
  targetUserId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const rows = await exec
    .select({ exists: sql`1` })
    .from(userWorkUnits)
    .innerJoin(workUnitManagers, eq(userWorkUnits.workUnitId, workUnitManagers.workUnitId))
    .where(and(eq(workUnitManagers.userId, managerId), eq(userWorkUnits.userId, targetUserId)))
    .limit(1);
  return rows.length > 0;
};

// Drizzle SQL fragment for the "user_ids managed by `managerId`" subquery, for embedding in
// other repos' `sql\`\`` templates (e.g. entriesRepo's manager-scope filters).
export const managedUserIdsSubquerySql = (managerId: string): SQL =>
  sql`SELECT uwu.user_id
        FROM user_work_units uwu
        JOIN work_unit_managers wum ON uwu.work_unit_id = wum.work_unit_id
       WHERE wum.user_id = ${managerId}`;

export const listManagedUserIds = async (
  managerId: string,
  exec: DbExecutor = db,
): Promise<string[]> => {
  const rows = await executeRows<{ user_id: string }>(
    exec,
    sql`SELECT DISTINCT uwu.user_id
          FROM user_work_units uwu
          JOIN work_unit_managers wum ON uwu.work_unit_id = wum.work_unit_id
         WHERE wum.user_id = ${managerId}`,
  );
  return rows.map((r) => String(r.user_id)).filter(Boolean);
};
