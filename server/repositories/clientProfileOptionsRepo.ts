import { and, eq, ne, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { clientProfileOptions } from '../db/schema/clientProfileOptions.ts';

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

// Build a `(SELECT COUNT(*)...)` SQL fragment for the usage-count subquery against `clients`.
// Uses `sql.identifier` to safely inject the allowlisted column name; the value comes from
// the internal `VALUE_FIELD_BY_CATEGORY` map, never from a caller.
const usageCountSubquery = (category: ProfileOptionCategory) =>
  sql`(SELECT COUNT(*) FROM clients c WHERE c.${sql.identifier(VALUE_FIELD_BY_CATEGORY[category])} = o.value)`;

type ProfileOptionRow = {
  id: string;
  category: string;
  value: string;
  sort_order: number | string;
  usage_count: number | string | null;
  created_at: string | Date | null;
  updated_at: string | Date | null;
};

const mapRow = (row: ProfileOptionRow): ProfileOption => ({
  id: row.id,
  category: row.category as ProfileOptionCategory,
  value: row.value,
  sortOrder: Number(row.sort_order ?? 0),
  usageCount: Number(row.usage_count ?? 0),
  createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
});

export const listByCategory = async (
  category: ProfileOptionCategory,
  exec: DbExecutor = db,
): Promise<ProfileOption[]> => {
  const rows = await executeRows<ProfileOptionRow>(
    exec,
    sql`SELECT
       o.id,
       o.category,
       o.value,
       o.sort_order,
       o.created_at,
       o.updated_at,
       ${usageCountSubquery(category)} as usage_count
     FROM client_profile_options o
     WHERE o.category = ${category}
     ORDER BY o.sort_order ASC, o.value ASC`,
  );
  return rows.map(mapRow);
};

export const findByCategoryAndId = async (
  category: ProfileOptionCategory,
  id: string,
  exec: DbExecutor = db,
): Promise<{ id: string; value: string } | null> => {
  const rows = await exec
    .select({ id: clientProfileOptions.id, value: clientProfileOptions.value })
    .from(clientProfileOptions)
    .where(and(eq(clientProfileOptions.id, id), eq(clientProfileOptions.category, category)));
  return rows[0] ?? null;
};

export const findByCategoryAndValue = async (
  category: ProfileOptionCategory,
  value: string,
  excludeId: string | null,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const conditions = [
    eq(clientProfileOptions.category, category),
    sql`LOWER(${clientProfileOptions.value}) = LOWER(${value})`,
  ];
  if (excludeId) conditions.push(ne(clientProfileOptions.id, excludeId));
  const rows = await exec
    .select({ id: clientProfileOptions.id })
    .from(clientProfileOptions)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
};

export const getNextSortOrder = async (
  category: ProfileOptionCategory,
  exec: DbExecutor = db,
): Promise<number> => {
  const rows = await exec
    .select({ next: sql<string | number>`COALESCE(MAX(${clientProfileOptions.sortOrder}), 0) + 1` })
    .from(clientProfileOptions)
    .where(eq(clientProfileOptions.category, category));
  return Number(rows[0]?.next ?? 1);
};

export type NewProfileOption = {
  id: string;
  category: ProfileOptionCategory;
  value: string;
  sortOrder: number;
};

export const create = async (
  input: NewProfileOption,
  exec: DbExecutor = db,
): Promise<ProfileOption> => {
  const rows = await exec
    .insert(clientProfileOptions)
    .values({
      id: input.id,
      category: input.category,
      value: input.value,
      sortOrder: input.sortOrder,
    })
    .returning();
  const row = rows[0];
  return mapRow({
    id: row.id,
    category: row.category,
    value: row.value,
    sort_order: row.sortOrder,
    usage_count: 0,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
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
  exec: DbExecutor = db,
): Promise<ProfileOption | null> => {
  const updateResult = await exec
    .update(clientProfileOptions)
    .set({
      value: patch.value,
      sortOrder: sql`COALESCE(${patch.sortOrder}, ${clientProfileOptions.sortOrder})`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(clientProfileOptions.id, id), eq(clientProfileOptions.category, category)));

  if ((updateResult.rowCount ?? 0) === 0) return null;

  if (patch.previousValue !== patch.value) {
    const fieldName = VALUE_FIELD_BY_CATEGORY[category];
    // Cross-table cascade into `clients` (un-modeled until PR 6). `sql.identifier` pulls
    // the column from the internal allowlist — no caller input ever reaches the SQL identifier.
    await executeRows(
      exec,
      sql`UPDATE clients SET ${sql.identifier(fieldName)} = ${patch.value}
          WHERE ${sql.identifier(fieldName)} = ${patch.previousValue}`,
    );
  }

  const rows = await executeRows<ProfileOptionRow>(
    exec,
    sql`SELECT
       o.id,
       o.category,
       o.value,
       o.sort_order,
       o.created_at,
       o.updated_at,
       ${usageCountSubquery(category)} as usage_count
     FROM client_profile_options o
     WHERE o.id = ${id} AND o.category = ${category}`,
  );
  return rows[0] ? mapRow(rows[0]) : null;
};

export const getUsageCount = async (
  category: ProfileOptionCategory,
  id: string,
  exec: DbExecutor = db,
): Promise<number> => {
  const rows = await executeRows<{ usage_count: string | number | null }>(
    exec,
    sql`SELECT ${usageCountSubquery(category)} as usage_count
       FROM client_profile_options o
       WHERE o.id = ${id}`,
  );
  return Number(rows[0]?.usage_count ?? 0);
};

export const deleteById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const result = await exec.delete(clientProfileOptions).where(eq(clientProfileOptions.id, id));
  return (result.rowCount ?? 0) > 0;
};
