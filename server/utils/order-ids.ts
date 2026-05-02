import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';

export const generatePrefixedId = (prefix: string): string => `${prefix}-${randomUUID()}`;

const generateSequentialId = async (
  prefix: string,
  table: string,
  exec: DbExecutor = db,
): Promise<string> => {
  const year = new Date().getFullYear();
  // Table name is a static internal literal ('sales' / 'supplier_sales'); `sql.raw` is safe.
  const rows = await executeRows<{ maxSequence: string | number | null }>(
    exec,
    sql`SELECT COALESCE(MAX(CAST(split_part(id, '-', 3) AS INTEGER)), 0) AS "maxSequence"
          FROM ${sql.raw(table)}
         WHERE id ~ ${`^${prefix}-${year}-[0-9]+$`}`,
  );
  const nextSequence = Number(rows[0]?.maxSequence ?? 0) + 1;
  return `${prefix}-${year}-${String(nextSequence).padStart(4, '0')}`;
};

export const generateClientOrderId = (exec?: DbExecutor) =>
  generateSequentialId('ORD', 'sales', exec);
export const generateSupplierOrderId = (exec?: DbExecutor) =>
  generateSequentialId('SORD', 'supplier_sales', exec);

export const generateItemId = (prefix: string): string =>
  `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
