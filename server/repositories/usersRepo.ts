import pool, { buildBulkInsertPlaceholders, type QueryExecutor } from '../db/index.ts';
import { parseDbNumber } from '../utils/parse.ts';
import { ADMIN_ROLE_ID, TOP_MANAGER_ROLE_ID } from '../utils/permissions.ts';
import type { AssignmentSource } from '../utils/top-manager-assignments.ts';

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
  exec: QueryExecutor = pool,
): Promise<AuthUser | null> => {
  const { rows } = await exec.query<AuthUser>(
    `SELECT
        id,
        name,
        username,
        role,
        avatar_initials AS "avatarInitials",
        is_disabled AS "isDisabled"
      FROM users
      WHERE id = $1`,
    [userId],
  );
  return rows[0] ?? null;
};

export const findLoginUserByUsername = async (
  username: string,
  exec: QueryExecutor = pool,
): Promise<LoginUser | null> => {
  const { rows } = await exec.query<LoginUser>(
    `SELECT
        id,
        name,
        username,
        role,
        password_hash AS "passwordHash",
        avatar_initials AS "avatarInitials",
        is_disabled AS "isDisabled"
      FROM users
      WHERE username = $1`,
    [username],
  );
  return rows[0] ?? null;
};

export const getPasswordHash = async (
  userId: string,
  exec: QueryExecutor = pool,
): Promise<string | null> => {
  const { rows } = await exec.query<{ passwordHash: string | null }>(
    `SELECT password_hash as "passwordHash" FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0]?.passwordHash ?? null;
};

export const updatePasswordHash = async (
  userId: string,
  passwordHash: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, userId]);
};

export const findCostPerHour = async (
  userId: string,
  exec: QueryExecutor = pool,
): Promise<number> => {
  const { rows } = await exec.query<{ costPerHour: string | number | null }>(
    `SELECT cost_per_hour AS "costPerHour" FROM users WHERE id = $1`,
    [userId],
  );
  return parseDbNumber(rows[0]?.costPerHour, 0);
};

export const updateNameByUsername = async (
  username: string,
  name: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(`UPDATE users SET name = $2 WHERE username = $1`, [username, name]);
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

export const createUser = async (user: NewUser, exec: QueryExecutor = pool): Promise<void> => {
  await exec.query(
    `INSERT INTO users (id, name, username, password_hash, role, avatar_initials)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [user.id, user.name, user.username, user.passwordHash, user.role, user.avatarInitials],
  );
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

// SAFE: TOP_MANAGER_ROLE_ID and ADMIN_ROLE_ID are compile-time string constants from
// utils/permissions.ts. Never interpolate dynamic / user-supplied values into this fragment —
// pass them as bind parameters instead.
const USER_LIST_FLAG_COLUMNS = `
  EXISTS (
    SELECT 1
    FROM user_roles ur
    WHERE ur.user_id = u.id AND ur.role_id = '${TOP_MANAGER_ROLE_ID}'
  ) AS "hasTopManagerRole",
  (
    u.role = '${ADMIN_ROLE_ID}'
    AND NOT EXISTS (
      SELECT 1
      FROM user_roles ur_admin_only
      WHERE ur_admin_only.user_id = u.id AND ur_admin_only.role_id <> '${ADMIN_ROLE_ID}'
    )
  ) AS "isAdminOnly"
`;

export const listAllForAdmin = async (exec: QueryExecutor = pool): Promise<UserListRow[]> => {
  const { rows } = await exec.query<UserListRowDb>(
    `SELECT u.id,
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
  exec: QueryExecutor = pool,
): Promise<UserListRow[]> => {
  const conditions: string[] = ['u.id = $1'];
  if (options.canViewManagedUsers) conditions.push('wum.user_id = $1');
  if (options.canViewInternal) conditions.push("u.employee_type = 'internal'");
  if (options.canViewExternal) conditions.push("u.employee_type = 'external'");

  const { rows } = await exec.query<UserListRowDb>(
    `SELECT DISTINCT u.id,
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
       WHERE (${conditions.join(' OR ')})
         AND NOT EXISTS (
           SELECT 1 FROM user_roles ur_tm
           WHERE ur_tm.user_id = u.id AND ur_tm.role_id = '${TOP_MANAGER_ROLE_ID}'
         )
       ORDER BY u.name`,
    [viewerId],
  );
  return rows.map(mapUserListRow);
};

export const findById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<UserListRow | null> => {
  const { rows } = await exec.query<UserListRowDb>(
    `SELECT u.id,
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
      WHERE u.id = $1`,
    [id],
  );
  return rows[0] ? mapUserListRow(rows[0]) : null;
};

export const findCoreById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<UserCore | null> => {
  const { rows } = await exec.query<{
    id: string;
    name: string;
    username: string;
    role: string;
    employeeType: string | null;
  }>(
    `SELECT id, name, username, role, employee_type AS "employeeType"
       FROM users
      WHERE id = $1`,
    [id],
  );
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
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rows } = await exec.query(`SELECT id FROM users WHERE username = $1`, [username]);
  return rows.length > 0;
};

export const insertUser = async (user: NewFullUser, exec: QueryExecutor = pool): Promise<void> => {
  await exec.query(
    `INSERT INTO users (id, name, username, password_hash, role, avatar_initials, cost_per_hour, is_disabled, employee_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      user.id,
      user.name,
      user.username,
      user.passwordHash,
      user.role,
      user.avatarInitials,
      user.costPerHour,
      user.isDisabled,
      user.employeeType,
    ],
  );
};

export const deleteById = async (id: string, exec: QueryExecutor = pool): Promise<boolean> => {
  const { rowCount } = await exec.query(`DELETE FROM users WHERE id = $1 RETURNING id`, [id]);
  return (rowCount ?? 0) > 0;
};

export const updateUserDynamic = async (
  id: string,
  fields: UserUpdateFields,
  exec: QueryExecutor = pool,
): Promise<UpdatedUserRow | null> => {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (fields.name !== undefined) {
    sets.push(`name = $${idx++}`);
    params.push(fields.name);
  }
  if (fields.isDisabled !== undefined) {
    sets.push(`is_disabled = $${idx++}`);
    params.push(fields.isDisabled);
  }
  if (fields.costPerHour !== undefined) {
    sets.push(`cost_per_hour = $${idx++}`);
    params.push(fields.costPerHour);
  }
  if (fields.role !== undefined) {
    sets.push(`role = $${idx++}`);
    params.push(fields.role);
  }

  if (sets.length === 0) return null;

  params.push(id);
  const { rows } = await exec.query<UpdatedUserRowDb>(
    `UPDATE users SET ${sets.join(', ')}
       WHERE id = $${idx}
   RETURNING id, name, username, role,
             avatar_initials AS "avatarInitials",
             cost_per_hour AS "costPerHour",
             is_disabled AS "isDisabled",
             employee_type AS "employeeType"`,
    params,
  );
  return rows[0] ? mapUpdatedUserRow(rows[0]) : null;
};

export const addUserRole = async (
  userId: string,
  roleId: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(
    `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, roleId],
  );
};

export const clearUserRoles = async (userId: string, exec: QueryExecutor = pool): Promise<void> => {
  await exec.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
};

export const replaceUserRoles = async (
  userId: string,
  roleIds: string[],
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
  if (roleIds.length === 0) return;

  const params: unknown[] = [];
  for (const roleId of roleIds) params.push(userId, roleId);
  const placeholders = buildBulkInsertPlaceholders(roleIds.length, 2);
  await exec.query(
    `INSERT INTO user_roles (user_id, role_id) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
    params,
  );
};

export const setPrimaryRole = async (
  userId: string,
  roleId: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(`UPDATE users SET role = $1 WHERE id = $2`, [roleId, userId]);
};

export const getUserRoleIds = async (
  userId: string,
  exec: QueryExecutor = pool,
): Promise<string[]> => {
  const { rows } = await exec.query<{ roleId: string }>(
    `SELECT role_id AS "roleId" FROM user_roles WHERE user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.roleId);
};

export const canManageUser = async (
  targetUserId: string,
  managerUserId: string,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rows } = await exec.query(
    `SELECT 1
       FROM user_work_units uw
       JOIN work_unit_managers wum ON uw.work_unit_id = wum.work_unit_id
      WHERE uw.user_id = $1 AND wum.user_id = $2
      LIMIT 1`,
    [targetUserId, managerUserId],
  );
  return rows.length > 0;
};

export const getAssignments = async (
  userId: string,
  exec: QueryExecutor = pool,
): Promise<UserAssignments> => {
  const [clientsRes, projectsRes, tasksRes] = await Promise.all([
    exec.query<{ clientId: string }>(
      `SELECT client_id AS "clientId" FROM user_clients WHERE user_id = $1`,
      [userId],
    ),
    exec.query<{ projectId: string }>(
      `SELECT project_id AS "projectId" FROM user_projects WHERE user_id = $1`,
      [userId],
    ),
    exec.query<{ taskId: string }>(
      `SELECT task_id AS "taskId" FROM user_tasks WHERE user_id = $1`,
      [userId],
    ),
  ]);
  return {
    clientIds: clientsRes.rows.map((r) => r.clientId),
    projectIds: projectsRes.rows.map((r) => r.projectId),
    taskIds: tasksRes.rows.map((r) => r.taskId),
  };
};

type AssignmentTable = {
  table: 'user_clients' | 'user_projects' | 'user_tasks';
  column: 'client_id' | 'project_id' | 'task_id';
};

const ASSIGNMENT_TABLES = {
  clients: { table: 'user_clients', column: 'client_id' },
  projects: { table: 'user_projects', column: 'project_id' },
  tasks: { table: 'user_tasks', column: 'task_id' },
} as const satisfies Record<'clients' | 'projects' | 'tasks', AssignmentTable>;

const replaceAssignments = async (
  spec: AssignmentTable,
  userId: string,
  ids: string[],
  source: AssignmentSource,
  exec: QueryExecutor,
): Promise<void> => {
  await exec.query(`DELETE FROM ${spec.table} WHERE user_id = $1`, [userId]);
  if (ids.length === 0) return;

  const params: unknown[] = [];
  for (const id of ids) params.push(userId, id, source);
  const placeholders = buildBulkInsertPlaceholders(ids.length, 3);
  await exec.query(
    `INSERT INTO ${spec.table} (user_id, ${spec.column}, assignment_source)
     VALUES ${placeholders}
     ON CONFLICT DO NOTHING`,
    params,
  );
};

export const replaceUserClients = (
  userId: string,
  clientIds: string[],
  source: AssignmentSource,
  exec: QueryExecutor = pool,
): Promise<void> => replaceAssignments(ASSIGNMENT_TABLES.clients, userId, clientIds, source, exec);

export const replaceUserProjects = (
  userId: string,
  projectIds: string[],
  source: AssignmentSource,
  exec: QueryExecutor = pool,
): Promise<void> =>
  replaceAssignments(ASSIGNMENT_TABLES.projects, userId, projectIds, source, exec);

export const replaceUserTasks = (
  userId: string,
  taskIds: string[],
  source: AssignmentSource,
  exec: QueryExecutor = pool,
): Promise<void> => replaceAssignments(ASSIGNMENT_TABLES.tasks, userId, taskIds, source, exec);

export const clearProjectCascadeAssignments = async (
  userId: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(
    `DELETE FROM user_clients WHERE user_id = $1 AND assignment_source = 'project_cascade'`,
    [userId],
  );
};

export const applyProjectCascadeToClients = async (
  userId: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(
    `INSERT INTO user_clients (user_id, client_id, assignment_source)
     SELECT $1, p.client_id, 'project_cascade'
       FROM user_projects up
       JOIN projects p ON up.project_id = p.id
      WHERE up.user_id = $1
     ON CONFLICT (user_id, client_id) DO NOTHING`,
    [userId],
  );
};
