import { eq, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { users } from '../db/schema/users.ts';
import { parseDbNumber } from '../utils/parse.ts';
import { ADMIN_ROLE_ID, TOP_MANAGER_ROLE_ID } from '../utils/permissions.ts';
import {
  ASSIGNMENT_SPECS,
  type AssignmentSource,
  type AssignmentSpec,
} from './userAssignmentsRepo.ts';

export type EmployeeType = 'app_user' | 'internal' | 'external';

export type AuthUser = {
  id: string;
  name: string;
  username: string;
  role: string;
  avatarInitials: string;
  isDisabled: boolean;
};

export type LoginUser = AuthUser & { passwordHash: string | null };

export const findAuthUserById = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<AuthUser | null> => {
  const rows = await exec
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      role: users.role,
      avatarInitials: users.avatarInitials,
      isDisabled: users.isDisabled,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    name: rows[0].name,
    username: rows[0].username,
    role: rows[0].role,
    avatarInitials: rows[0].avatarInitials,
    isDisabled: rows[0].isDisabled ?? false,
  };
};

export const findLoginUserByUsername = async (
  username: string,
  exec: DbExecutor = db,
): Promise<LoginUser | null> => {
  const rows = await exec
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      role: users.role,
      passwordHash: users.passwordHash,
      avatarInitials: users.avatarInitials,
      isDisabled: users.isDisabled,
    })
    .from(users)
    .where(eq(users.username, username));
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    name: rows[0].name,
    username: rows[0].username,
    role: rows[0].role,
    passwordHash: rows[0].passwordHash,
    avatarInitials: rows[0].avatarInitials,
    isDisabled: rows[0].isDisabled ?? false,
  };
};

export const getPasswordHash = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<string | null> => {
  const rows = await exec
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId));
  return rows[0]?.passwordHash ?? null;
};

export const updatePasswordHash = async (
  userId: string,
  passwordHash: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec.update(users).set({ passwordHash }).where(eq(users.id, userId));
};

export const findCostPerHour = async (userId: string, exec: DbExecutor = db): Promise<number> => {
  const rows = await exec
    .select({ costPerHour: users.costPerHour })
    .from(users)
    .where(eq(users.id, userId));
  return parseDbNumber(rows[0]?.costPerHour, 0);
};

export const updateNameByUsername = async (
  username: string,
  name: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec.update(users).set({ name }).where(eq(users.username, username));
};

// For users that authenticate externally (e.g. LDAP) and must never log in locally. Satisfies
// the `password_hash NOT NULL` column with a malformed bcrypt that no plaintext can match.
export const LDAP_PLACEHOLDER_PASSWORD_HASH = '$2a$10$invalidpasswordhashforldapuser00000000000000';

export type NewUser = {
  id: string;
  name: string;
  username: string;
  passwordHash: string;
  role: string;
  avatarInitials: string;
};

export const createUser = async (user: NewUser, exec: DbExecutor = db): Promise<void> => {
  await exec.insert(users).values({
    id: user.id,
    name: user.name,
    username: user.username,
    passwordHash: user.passwordHash,
    role: user.role,
    avatarInitials: user.avatarInitials,
  });
};

// ===========================================================================
// User-management endpoints (full CRUD, role replacement, assignments)
// ===========================================================================

export type UserListRow = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: string;
  avatarInitials: string;
  costPerHour: number;
  isDisabled: boolean;
  employeeType: EmployeeType;
  hasTopManagerRole: boolean;
  isAdminOnly: boolean;
};

export type UserCore = {
  id: string;
  name: string;
  username: string;
  role: string;
  employeeType: EmployeeType;
};

export type UpdatedUserRow = {
  id: string;
  name: string;
  username: string;
  role: string;
  avatarInitials: string;
  costPerHour: number;
  isDisabled: boolean;
  employeeType: EmployeeType;
};

export type UserUpdateFields = {
  name?: string;
  isDisabled?: boolean;
  costPerHour?: number | null;
  role?: string;
};

export type UserAssignments = {
  clientIds: string[];
  projectIds: string[];
  taskIds: string[];
};

export type ManagerScopeOptions = {
  canViewManagedUsers: boolean;
  canViewInternal: boolean;
  canViewExternal: boolean;
};

export type NewFullUser = {
  id: string;
  name: string;
  username: string;
  passwordHash: string;
  role: string;
  avatarInitials: string;
  costPerHour: number;
  isDisabled: boolean;
  employeeType: EmployeeType;
};

type UserListRowDb = {
  id: string;
  name: string;
  username: string;
  email: string | null;
  role: string;
  avatarInitials: string | null;
  costPerHour: string | number | null;
  isDisabled: boolean | null;
  employeeType: string | null;
  hasTopManagerRole: boolean | null;
  isAdminOnly: boolean | null;
};

const mapUserListRow = (row: UserListRowDb): UserListRow => ({
  id: row.id,
  name: row.name,
  username: row.username,
  email: row.email ?? '',
  role: row.role,
  avatarInitials: row.avatarInitials ?? '',
  costPerHour: parseDbNumber(row.costPerHour, 0),
  isDisabled: !!row.isDisabled,
  employeeType: (row.employeeType as EmployeeType | null) ?? 'app_user',
  hasTopManagerRole: !!row.hasTopManagerRole,
  isAdminOnly: !!row.isAdminOnly,
});

type UpdatedUserRowDb = {
  id: string;
  name: string;
  username: string;
  role: string;
  avatarInitials: string | null;
  costPerHour: string | number | null;
  isDisabled: boolean | null;
  employeeType: string | null;
};

const mapUpdatedUserRow = (row: UpdatedUserRowDb): UpdatedUserRow => ({
  id: row.id,
  name: row.name,
  username: row.username,
  role: row.role,
  avatarInitials: row.avatarInitials ?? '',
  costPerHour: parseDbNumber(row.costPerHour, 0),
  isDisabled: !!row.isDisabled,
  employeeType: (row.employeeType as EmployeeType | null) ?? 'app_user',
});

const USER_LIST_FLAG_COLUMNS = sql`
  EXISTS (
    SELECT 1
    FROM user_roles ur
    WHERE ur.user_id = u.id AND ur.role_id = ${TOP_MANAGER_ROLE_ID}
  ) AS "hasTopManagerRole",
  (
    u.role = ${ADMIN_ROLE_ID}
    AND NOT EXISTS (
      SELECT 1
      FROM user_roles ur_admin_only
      WHERE ur_admin_only.user_id = u.id AND ur_admin_only.role_id <> ${ADMIN_ROLE_ID}
    )
  ) AS "isAdminOnly"
`;

export const listAllForAdmin = async (exec: DbExecutor = db): Promise<UserListRow[]> => {
  const rows = await executeRows<UserListRowDb>(
    exec,
    sql`SELECT u.id,
            u.name,
            u.username,
            COALESCE(s.email, '') AS email,
            u.role,
            u.avatar_initials AS "avatarInitials",
            u.cost_per_hour AS "costPerHour",
            u.is_disabled AS "isDisabled",
            u.employee_type AS "employeeType",
            ${USER_LIST_FLAG_COLUMNS}
       FROM users u
       LEFT JOIN settings s ON s.user_id = u.id
       ORDER BY u.name`,
  );
  return rows.map(mapUserListRow);
};

export const listScopedForManager = async (
  viewerId: string,
  options: ManagerScopeOptions,
  exec: DbExecutor = db,
): Promise<UserListRow[]> => {
  const conditions = [sql`u.id = ${viewerId}`];
  if (options.canViewManagedUsers) conditions.push(sql`wum.user_id = ${viewerId}`);
  if (options.canViewInternal) conditions.push(sql`u.employee_type = 'internal'`);
  if (options.canViewExternal) conditions.push(sql`u.employee_type = 'external'`);

  const whereClause = sql.join(conditions, sql` OR `);

  const rows = await executeRows<UserListRowDb>(
    exec,
    sql`SELECT DISTINCT u.id,
                     u.name,
                     u.username,
                     COALESCE(s.email, '') AS email,
                     u.role,
                     u.avatar_initials AS "avatarInitials",
                     u.cost_per_hour AS "costPerHour",
                     u.is_disabled AS "isDisabled",
                     u.employee_type AS "employeeType",
                     ${USER_LIST_FLAG_COLUMNS}
       FROM users u
       LEFT JOIN settings s ON s.user_id = u.id
       LEFT JOIN user_work_units uw ON u.id = uw.user_id
       LEFT JOIN work_unit_managers wum ON uw.work_unit_id = wum.work_unit_id
       WHERE (${whereClause})
         AND NOT EXISTS (
           SELECT 1 FROM user_roles ur_tm
           WHERE ur_tm.user_id = u.id AND ur_tm.role_id = ${TOP_MANAGER_ROLE_ID}
         )
       ORDER BY u.name`,
  );
  return rows.map(mapUserListRow);
};

export const findById = async (id: string, exec: DbExecutor = db): Promise<UserListRow | null> => {
  const rows = await executeRows<UserListRowDb>(
    exec,
    sql`SELECT u.id,
            u.name,
            u.username,
            COALESCE(s.email, '') AS email,
            u.role,
            u.avatar_initials AS "avatarInitials",
            u.cost_per_hour AS "costPerHour",
            u.is_disabled AS "isDisabled",
            u.employee_type AS "employeeType",
            ${USER_LIST_FLAG_COLUMNS}
       FROM users u
       LEFT JOIN settings s ON s.user_id = u.id
      WHERE u.id = ${id}`,
  );
  return rows[0] ? mapUserListRow(rows[0]) : null;
};

export const findCoreById = async (id: string, exec: DbExecutor = db): Promise<UserCore | null> => {
  const rows = await exec
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      role: users.role,
      employeeType: users.employeeType,
    })
    .from(users)
    .where(eq(users.id, id));
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    name: rows[0].name,
    username: rows[0].username,
    role: rows[0].role,
    employeeType: (rows[0].employeeType as EmployeeType | null) ?? 'app_user',
  };
};

export const existsByUsername = async (
  username: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const rows = await exec
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return rows.length > 0;
};

export const insertUser = async (user: NewFullUser, exec: DbExecutor = db): Promise<void> => {
  await exec.insert(users).values({
    id: user.id,
    name: user.name,
    username: user.username,
    passwordHash: user.passwordHash,
    role: user.role,
    avatarInitials: user.avatarInitials,
    costPerHour: String(user.costPerHour),
    isDisabled: user.isDisabled,
    employeeType: user.employeeType,
  });
};

export const deleteById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const rows = await exec.delete(users).where(eq(users.id, id)).returning({ id: users.id });
  return rows.length > 0;
};

export const updateUserDynamic = async (
  id: string,
  fields: UserUpdateFields,
  exec: DbExecutor = db,
): Promise<UpdatedUserRow | null> => {
  const set: Record<string, unknown> = {};
  if (fields.name !== undefined) set.name = fields.name;
  if (fields.isDisabled !== undefined) set.isDisabled = fields.isDisabled;
  if (fields.costPerHour !== undefined) {
    set.costPerHour = fields.costPerHour === null ? null : String(fields.costPerHour);
  }
  if (fields.role !== undefined) set.role = fields.role;

  if (Object.keys(set).length === 0) return null;

  const rows = await exec.update(users).set(set).where(eq(users.id, id)).returning({
    id: users.id,
    name: users.name,
    username: users.username,
    role: users.role,
    avatarInitials: users.avatarInitials,
    costPerHour: users.costPerHour,
    isDisabled: users.isDisabled,
    employeeType: users.employeeType,
  });
  return rows[0] ? mapUpdatedUserRow(rows[0]) : null;
};

export const addUserRole = async (
  userId: string,
  roleId: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await executeRows(
    exec,
    sql`INSERT INTO user_roles (user_id, role_id) VALUES (${userId}, ${roleId}) ON CONFLICT DO NOTHING`,
  );
};

export const clearUserRoles = async (userId: string, exec: DbExecutor = db): Promise<void> => {
  await executeRows(exec, sql`DELETE FROM user_roles WHERE user_id = ${userId}`);
};

export const replaceUserRoles = async (
  userId: string,
  roleIds: string[],
  exec: DbExecutor = db,
): Promise<void> => {
  await executeRows(exec, sql`DELETE FROM user_roles WHERE user_id = ${userId}`);
  if (roleIds.length === 0) return;

  const valueRows = roleIds.map((roleId) => sql`(${userId}, ${roleId})`);
  await executeRows(
    exec,
    sql`INSERT INTO user_roles (user_id, role_id) VALUES ${sql.join(valueRows, sql`, `)} ON CONFLICT DO NOTHING`,
  );
};

export const setPrimaryRole = async (
  userId: string,
  roleId: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec.update(users).set({ role: roleId }).where(eq(users.id, userId));
};

export const getUserRoleIds = async (userId: string, exec: DbExecutor = db): Promise<string[]> => {
  const rows = await executeRows<{ roleId: string }>(
    exec,
    sql`SELECT role_id AS "roleId" FROM user_roles WHERE user_id = ${userId}`,
  );
  return rows.map((r) => r.roleId);
};

export const canManageUser = async (
  targetUserId: string,
  managerUserId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const rows = await executeRows<{ '?column?': number }>(
    exec,
    sql`SELECT 1
         FROM user_work_units uw
         JOIN work_unit_managers wum ON uw.work_unit_id = wum.work_unit_id
        WHERE uw.user_id = ${targetUserId} AND wum.user_id = ${managerUserId}
        LIMIT 1`,
  );
  return rows.length > 0;
};

export const getAssignments = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<UserAssignments> => {
  const [clientsRows, projectsRows, tasksRows] = await Promise.all([
    executeRows<{ clientId: string }>(
      exec,
      sql`SELECT client_id AS "clientId" FROM user_clients WHERE user_id = ${userId}`,
    ),
    executeRows<{ projectId: string }>(
      exec,
      sql`SELECT project_id AS "projectId" FROM user_projects WHERE user_id = ${userId}`,
    ),
    executeRows<{ taskId: string }>(
      exec,
      sql`SELECT task_id AS "taskId" FROM user_tasks WHERE user_id = ${userId}`,
    ),
  ]);
  return {
    clientIds: clientsRows.map((r) => r.clientId),
    projectIds: projectsRows.map((r) => r.projectId),
    taskIds: tasksRows.map((r) => r.taskId),
  };
};

const replaceAssignments = async (
  spec: AssignmentSpec,
  userId: string,
  ids: string[],
  source: AssignmentSource,
  exec: DbExecutor,
): Promise<void> => {
  // sql.identifier safely injects the allowlisted table/column from ASSIGNMENT_SPECS.
  await executeRows(exec, sql`DELETE FROM ${sql.identifier(spec.table)} WHERE user_id = ${userId}`);
  if (ids.length === 0) return;

  const valueRows = ids.map((id) => sql`(${userId}, ${id}, ${source})`);
  await executeRows(
    exec,
    sql`INSERT INTO ${sql.identifier(spec.table)} (user_id, ${sql.identifier(spec.fkColumn)}, assignment_source)
        VALUES ${sql.join(valueRows, sql`, `)}
        ON CONFLICT DO NOTHING`,
  );
};

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
