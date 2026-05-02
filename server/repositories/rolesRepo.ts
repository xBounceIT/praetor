import { and, eq, inArray, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { rolePermissions, roles, userRoles } from '../db/schema/roles.ts';

export type Role = {
  id: string;
  name: string;
  isSystem: boolean;
  isAdmin: boolean;
};

const ROLE_PROJECTION = {
  id: roles.id,
  name: roles.name,
  isSystem: roles.isSystem,
  isAdmin: roles.isAdmin,
} as const;

const mapRole = (row: {
  id: string;
  name: string;
  isSystem: boolean | null;
  isAdmin: boolean | null;
}): Role => ({
  id: row.id,
  name: row.name,
  isSystem: row.isSystem ?? false,
  isAdmin: row.isAdmin ?? false,
});

export const findExistingIds = async (
  ids: string[],
  exec: DbExecutor = db,
): Promise<Set<string>> => {
  if (ids.length === 0) return new Set();
  const rows = await exec.select({ id: roles.id }).from(roles).where(inArray(roles.id, ids));
  return new Set(rows.map((r) => r.id));
};

export const userHasRole = async (
  userId: string,
  roleId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const rows = await exec
    .select({ exists: sql`1` })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)))
    .limit(1);
  return rows.length > 0;
};

export const listAvailableRolesForUser = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<Role[]> => {
  const rows = await exec
    .select(ROLE_PROJECTION)
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId))
    .orderBy(roles.name);
  return rows.map(mapRole);
};

export const listAll = async (exec: DbExecutor = db): Promise<Role[]> => {
  const rows = await exec.select(ROLE_PROJECTION).from(roles).orderBy(roles.name);
  return rows.map(mapRole);
};

export const findById = async (id: string, exec: DbExecutor = db): Promise<Role | null> => {
  const rows = await exec.select(ROLE_PROJECTION).from(roles).where(eq(roles.id, id));
  return rows[0] ? mapRole(rows[0]) : null;
};

export const listExplicitPermissions = async (
  roleId: string,
  exec: DbExecutor = db,
): Promise<string[]> => {
  const rows = await exec
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
  return rows.map((r) => r.permission);
};

export const listExplicitPermissionsForRoles = async (
  roleIds: string[],
  exec: DbExecutor = db,
): Promise<Map<string, string[]>> => {
  const result = new Map<string, string[]>();
  if (roleIds.length === 0) return result;
  // Pre-populate so callers can `.get(id)` for every requested id without a presence check.
  for (const id of roleIds) result.set(id, []);
  const rows = await exec
    .select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleId, roleIds));
  for (const row of rows) result.get(row.roleId)?.push(row.permission);
  return result;
};

export const insertRole = async (
  id: string,
  name: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec.insert(roles).values({ id, name, isSystem: false, isAdmin: false });
};

export const updateRoleName = async (
  id: string,
  name: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec.update(roles).set({ name }).where(eq(roles.id, id));
};

export const deleteRole = async (id: string, exec: DbExecutor = db): Promise<void> => {
  await exec.delete(roles).where(eq(roles.id, id));
};

export const insertPermission = async (
  roleId: string,
  permission: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec.insert(rolePermissions).values({ roleId, permission }).onConflictDoNothing();
};

export const clearPermissions = async (roleId: string, exec: DbExecutor = db): Promise<void> => {
  await exec.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
};

// `users` is not yet modeled in TS schema; use a raw SQL probe. When usersRepo is converted,
// this can become `db.select({ exists: sql`1` }).from(users)...`.
export const isRoleInUse = async (roleId: string, exec: DbExecutor = db): Promise<boolean> => {
  const rows = await executeRows(exec, sql`SELECT 1 FROM users WHERE role = ${roleId} LIMIT 1`);
  return rows.length > 0;
};
