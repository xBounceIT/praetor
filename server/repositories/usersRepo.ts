import { eq, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows, runAtomically } from '../db/drizzle.ts';
import type { UserAuthMethod } from '../db/schema/users.ts';
import { users } from '../db/schema/users.ts';
import { NotFoundError } from '../utils/http-errors.ts';
import { parseDbNumber } from '../utils/parse.ts';
import { ADMIN_ROLE_ID, TOP_MANAGER_ROLE_ID } from '../utils/permissions.ts';

export type EmployeeType = 'app_user' | 'internal' | 'external';
export type AuthMethod = UserAuthMethod;

export type AuthUser = {
  id: string;
  name: string;
  username: string;
  role: string;
  avatarInitials: string;
  isDisabled: boolean;
  sessionVersion: number;
  tokenVersion: number;
};

export type LoginUser = AuthUser & {
  passwordHash: string | null;
  employeeType: EmployeeType;
};
export type LoginUserWithAuth = LoginUser & {
  authMethod: AuthMethod;
  authProviderId: string | null;
};

const LOGIN_USER_PROJECTION = {
  id: users.id,
  name: users.name,
  username: users.username,
  role: users.role,
  passwordHash: users.passwordHash,
  avatarInitials: users.avatarInitials,
  isDisabled: users.isDisabled,
  employeeType: users.employeeType,
  authMethod: users.authMethod,
  authProviderId: users.authProviderId,
  sessionVersion: users.sessionVersion,
  tokenVersion: users.tokenVersion,
} as const;

type LoginUserRow = {
  id: string;
  name: string;
  username: string;
  role: string;
  passwordHash: string | null;
  avatarInitials: string | null;
  isDisabled: boolean | null;
  employeeType: string | null;
  authMethod: AuthMethod | null;
  authProviderId: string | null;
  sessionVersion: number;
  tokenVersion: number;
};

const mapLoginUserRow = (row: LoginUserRow): LoginUserWithAuth => ({
  id: row.id,
  name: row.name,
  username: row.username,
  role: row.role,
  passwordHash: row.passwordHash,
  avatarInitials: row.avatarInitials ?? '',
  isDisabled: row.isDisabled ?? false,
  employeeType: (row.employeeType as EmployeeType | null) ?? 'app_user',
  authMethod: row.authMethod ?? 'local',
  authProviderId: row.authProviderId ?? null,
  sessionVersion: row.sessionVersion,
  tokenVersion: row.tokenVersion,
});

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
      sessionVersion: users.sessionVersion,
      tokenVersion: users.tokenVersion,
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
    sessionVersion: rows[0].sessionVersion,
    tokenVersion: rows[0].tokenVersion,
  };
};

export const bumpSessionVersion = async (userId: string, exec: DbExecutor = db): Promise<void> => {
  await exec
    .update(users)
    .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, userId));
};

// Subquery resolving the user's current token_version inside an INSERT, so the
// freshly-issued PAT or MCP token records the value atomically instead of
// falling back to the column default. Bridges the issue/bump race so a token
// issued the instant before a password rotation is invalidated by the next auth.
export const currentTokenVersionSubquery = (userId: string) =>
  sql<number>`(SELECT ${users.tokenVersion} FROM ${users} WHERE ${users.id} = ${userId})`;

// Atomic credential rotation: bumping `session_version` AND `token_version` in
// the same UPDATE that stores the new hash guarantees no window in which the new
// password is live but stolen tokens still validate. Session JWTs key off
// session_version; PATs and MCP tokens key off token_version, so this single
// rotation revokes every long- and short-lived credential the user holds.
// Returns the new session_version so the caller can re-sign their own
// x-auth-token and stay logged in.
export const rotatePasswordAndBumpSession = async (
  userId: string,
  passwordHash: string,
  exec: DbExecutor = db,
): Promise<number> => {
  const rows = await exec
    .update(users)
    .set({
      passwordHash,
      sessionVersion: sql`${users.sessionVersion} + 1`,
      tokenVersion: sql`${users.tokenVersion} + 1`,
    })
    .where(eq(users.id, userId))
    .returning({ sessionVersion: users.sessionVersion });
  if (!rows[0]) throw new NotFoundError('User');
  return rows[0].sessionVersion;
};

export const findLoginUserByUsername = async (
  username: string,
  exec: DbExecutor = db,
): Promise<LoginUserWithAuth | null> => {
  const rows = await exec
    .select(LOGIN_USER_PROJECTION)
    .from(users)
    .where(eq(users.username, username));
  return rows[0] ? mapLoginUserRow(rows[0]) : null;
};

export const findLoginUserByNormalizedUsername = async (
  username: string,
  exec: DbExecutor = db,
): Promise<LoginUserWithAuth | null> => {
  const normalized = username.trim().toLowerCase();
  if (!normalized) return null;
  const rows = await exec
    .select(LOGIN_USER_PROJECTION)
    .from(users)
    .where(sql`LOWER(${users.username}) = ${normalized}`);
  return rows[0] ? mapLoginUserRow(rows[0]) : null;
};

export const findLoginUserById = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<LoginUserWithAuth | null> => {
  const rows = await exec.select(LOGIN_USER_PROJECTION).from(users).where(eq(users.id, userId));
  return rows[0] ? mapLoginUserRow(rows[0]) : null;
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
export const EXTERNAL_PLACEHOLDER_PASSWORD_HASH = LDAP_PLACEHOLDER_PASSWORD_HASH;

export type NewUser = {
  id: string;
  name: string;
  username: string;
  passwordHash: string;
  role: string;
  avatarInitials: string;
  authMethod?: AuthMethod;
  authProviderId?: string | null;
};

export const createUser = async (user: NewUser, exec: DbExecutor = db): Promise<void> => {
  await exec.insert(users).values({
    id: user.id,
    name: user.name,
    username: user.username,
    passwordHash: user.passwordHash,
    role: user.role,
    avatarInitials: user.avatarInitials,
    authMethod: user.authMethod ?? 'local',
    authProviderId: user.authProviderId ?? null,
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
  authMethod: AuthMethod;
  authProviderId: string | null;
  authProviderName: string | null;
};

export type UserCore = {
  id: string;
  name: string;
  username: string;
  role: string;
  employeeType: EmployeeType;
  authMethod: AuthMethod;
  authProviderId: string | null;
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
  authMethod?: AuthMethod;
  authProviderId?: string | null;
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
  authMethod: string | null;
  authProviderId: string | null;
  authProviderName: string | null;
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
  authMethod: (row.authMethod as AuthMethod | null) ?? 'local',
  authProviderId: row.authProviderId ?? null,
  authProviderName: row.authProviderName ?? null,
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
            u.auth_method AS "authMethod",
            u.auth_provider_id AS "authProviderId",
            sp.name AS "authProviderName",
            ${USER_LIST_FLAG_COLUMNS}
       FROM users u
       LEFT JOIN settings s ON s.user_id = u.id
       LEFT JOIN sso_providers sp ON sp.id = u.auth_provider_id
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
                     u.auth_method AS "authMethod",
                     u.auth_provider_id AS "authProviderId",
                     sp.name AS "authProviderName",
                     ${USER_LIST_FLAG_COLUMNS}
       FROM users u
       LEFT JOIN settings s ON s.user_id = u.id
       LEFT JOIN sso_providers sp ON sp.id = u.auth_provider_id
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
            u.auth_method AS "authMethod",
            u.auth_provider_id AS "authProviderId",
            sp.name AS "authProviderName",
            ${USER_LIST_FLAG_COLUMNS}
       FROM users u
       LEFT JOIN settings s ON s.user_id = u.id
       LEFT JOIN sso_providers sp ON sp.id = u.auth_provider_id
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
      authMethod: users.authMethod,
      authProviderId: users.authProviderId,
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
    authMethod: rows[0].authMethod ?? 'local',
    authProviderId: rows[0].authProviderId ?? null,
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
    authMethod: user.authMethod ?? 'local',
    authProviderId: user.authProviderId ?? null,
  });
};

export const updateAuthMethod = async (
  id: string,
  authMethod: AuthMethod,
  authProviderId: string | null,
  exec: DbExecutor = db,
): Promise<UserListRow | null> => {
  await exec.update(users).set({ authMethod, authProviderId }).where(eq(users.id, id));
  return findById(id, exec);
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

export const replaceUserRoles = async (
  userId: string,
  roleIds: string[],
  exec: DbExecutor = db,
): Promise<void> => {
  // A partial failure (INSERT throws after the DELETE commits) would otherwise wipe
  // the user's secondary roles.
  await runAtomically(exec, async (tx) => {
    await executeRows(tx, sql`DELETE FROM user_roles WHERE user_id = ${userId}`);
    if (roleIds.length === 0) return;

    const valueRows = roleIds.map((roleId) => sql`(${userId}, ${roleId})`);
    await executeRows(
      tx,
      sql`INSERT INTO user_roles (user_id, role_id) VALUES ${sql.join(valueRows, sql`, `)} ON CONFLICT DO NOTHING`,
    );
  });
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
