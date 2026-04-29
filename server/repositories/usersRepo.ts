import pool, { type QueryExecutor } from '../db/index.ts';

export const getPasswordHash = async (
  userId: string,
  exec: QueryExecutor = pool,
): Promise<string | null> => {
  const { rows } = await exec.query<{ passwordHash: string }>(
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
