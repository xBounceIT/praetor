import { type QueryExecutor, query } from '../db/index.ts';

const generateSequentialId = async (
  prefix: string,
  table: string,
  executor?: QueryExecutor,
): Promise<string> => {
  const exec = executor ?? { query };
  const year = new Date().getFullYear();
  const result = await exec.query(
    `SELECT COALESCE(MAX(CAST(split_part(id, '-', 3) AS INTEGER)), 0) as "maxSequence"
     FROM ${table}
     WHERE id ~ $1`,
    [`^${prefix}-${year}-[0-9]+$`],
  );
  const nextSequence = Number(result.rows[0]?.maxSequence ?? 0) + 1;
  return `${prefix}-${year}-${String(nextSequence).padStart(4, '0')}`;
};

export const generateClientOrderId = (executor?: QueryExecutor) =>
  generateSequentialId('ORD', 'sales', executor);
export const generateSupplierOrderId = (executor?: QueryExecutor) =>
  generateSequentialId('SORD', 'supplier_sales', executor);

export const generateItemId = (prefix: string): string =>
  `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
