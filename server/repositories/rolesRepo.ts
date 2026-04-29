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
