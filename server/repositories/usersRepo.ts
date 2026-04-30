import pool, { type QueryExecutor } from '../db/index.ts';

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

export const updateNameByUsername = async (
  username: string,
  name: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(`UPDATE users SET name = $2 WHERE username = $1`, [username, name]);
};

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
