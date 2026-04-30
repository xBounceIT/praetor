import pool, { type QueryExecutor } from '../db/index.ts';

export const PROFILE_OPTION_CATEGORIES = [
  'sector',
  'numberOfEmployees',
  'revenue',
  'officeCountRange',
] as const;

export type ProfileOptionCategory = (typeof PROFILE_OPTION_CATEGORIES)[number];

export type ProfileOption = {
  id: string;
  category: ProfileOptionCategory;
  value: string;
  sortOrder: number;
  usageCount: number;
  createdAt: number | null;
  updatedAt: number | null;
};

// Internal allowlist: maps category to the column on `clients` that stores the option's value.
// Keeping this private prevents any caller from injecting an arbitrary column name into the
// cascade UPDATE — only this module touches the SQL.
const VALUE_FIELD_BY_CATEGORY: Record<ProfileOptionCategory, string> = {
  sector: 'sector',
  numberOfEmployees: 'number_of_employees',
  revenue: 'revenue',
  officeCountRange: 'office_count_range',
};

const getUsageCountExpression = (category: ProfileOptionCategory): string => {
  const column = VALUE_FIELD_BY_CATEGORY[category];
  return `(SELECT COUNT(*) FROM clients c WHERE c.${column} = o.value)`;
};

const mapRow = (row: Record<string, unknown>): ProfileOption => ({
  id: String(row.id),
  category: String(row.category) as ProfileOptionCategory,
  value: String(row.value),
  sortOrder: Number(row.sort_order ?? 0),
  usageCount: Number(row.usage_count ?? 0),
  createdAt: row.created_at ? new Date(String(row.created_at)).getTime() : null,
  updatedAt: row.updated_at ? new Date(String(row.updated_at)).getTime() : null,
});

export const listByCategory = async (
  category: ProfileOptionCategory,
  exec: QueryExecutor = pool,
): Promise<ProfileOption[]> => {
  const usageCountExpr = getUsageCountExpression(category);
  const { rows } = await exec.query(
    `SELECT
       o.id,
       o.category,
       o.value,
       o.sort_order,
       o.created_at,
       o.updated_at,
       ${usageCountExpr} as usage_count
     FROM client_profile_options o
     WHERE o.category = $1
     ORDER BY o.sort_order ASC, o.value ASC`,
    [category],
  );
  return rows.map(mapRow);
};

export const findByCategoryAndId = async (
  category: ProfileOptionCategory,
  id: string,
  exec: QueryExecutor = pool,
): Promise<{ id: string; value: string } | null> => {
  const { rows } = await exec.query<{ id: string; value: string }>(
    `SELECT id, value FROM client_profile_options WHERE id = $1 AND category = $2`,
    [id, category],
  );
  return rows[0] ?? null;
};

export const findByCategoryAndValue = async (
  category: ProfileOptionCategory,
  value: string,
  excludeId: string | null,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  if (excludeId) {
    const { rows } = await exec.query<{ id: string }>(
      `SELECT id FROM client_profile_options
       WHERE category = $1 AND LOWER(value) = LOWER($2) AND id <> $3`,
      [category, value, excludeId],
    );
    return rows.length > 0;
  }
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM client_profile_options WHERE category = $1 AND LOWER(value) = LOWER($2)`,
    [category, value],
  );
  return rows.length > 0;
};

export const getNextSortOrder = async (
  category: ProfileOptionCategory,
  exec: QueryExecutor = pool,
): Promise<number> => {
  const { rows } = await exec.query<{ next_sort_order: string | number | null }>(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 as next_sort_order
       FROM client_profile_options WHERE category = $1`,
    [category],
  );
  return Number(rows[0]?.next_sort_order ?? 1);
};

export type NewProfileOption = {
  id: string;
  category: ProfileOptionCategory;
  value: string;
  sortOrder: number;
};

export const create = async (
  input: NewProfileOption,
  exec: QueryExecutor = pool,
): Promise<ProfileOption> => {
  const { rows } = await exec.query(
    `INSERT INTO client_profile_options (id, category, value, sort_order)
     VALUES ($1, $2, $3, $4)
     RETURNING id, category, value, sort_order, created_at, updated_at`,
    [input.id, input.category, input.value, input.sortOrder],
  );
  return mapRow({ ...rows[0], usage_count: 0 });
};

/**
 * Updates the option row and, when the value changed, cascades the new value to all clients
 * whose corresponding column held the old value. The cascade column is selected internally from
 * the category allowlist — no caller-supplied column names ever reach the SQL.
 */
export const update = async (
  category: ProfileOptionCategory,
  id: string,
  patch: { value: string; sortOrder: number | null; previousValue: string },
  exec: QueryExecutor = pool,
): Promise<ProfileOption | null> => {
  const updateResult = await exec.query(
    `UPDATE client_profile_options
       SET value = $1,
           sort_order = COALESCE($2, sort_order),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND category = $4`,
    [patch.value, patch.sortOrder, id, category],
  );

  if ((updateResult.rowCount ?? 0) === 0) return null;

  if (patch.previousValue !== patch.value) {
    const fieldName = VALUE_FIELD_BY_CATEGORY[category];
    await exec.query(`UPDATE clients SET ${fieldName} = $1 WHERE ${fieldName} = $2`, [
      patch.value,
      patch.previousValue,
    ]);
  }

  const usageCountExpr = getUsageCountExpression(category);
  const { rows } = await exec.query(
    `SELECT
       o.id,
       o.category,
       o.value,
       o.sort_order,
       o.created_at,
       o.updated_at,
       ${usageCountExpr} as usage_count
     FROM client_profile_options o
     WHERE o.id = $1 AND o.category = $2`,
    [id, category],
  );
  return rows[0] ? mapRow(rows[0]) : null;
};

export const getUsageCount = async (
  category: ProfileOptionCategory,
  id: string,
  exec: QueryExecutor = pool,
): Promise<number> => {
  const usageCountExpr = getUsageCountExpression(category);
  const { rows } = await exec.query<{ usage_count: string | number | null }>(
    `SELECT ${usageCountExpr} as usage_count
       FROM client_profile_options o
       WHERE o.id = $1`,
    [id],
  );
  return Number(rows[0]?.usage_count ?? 0);
};

export const deleteById = async (id: string, exec: QueryExecutor = pool): Promise<boolean> => {
  const { rowCount } = await exec.query(`DELETE FROM client_profile_options WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
};
