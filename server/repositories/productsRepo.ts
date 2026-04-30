import pool, { type QueryExecutor } from '../db/index.ts';
import { parseDbNumber, parseNullableDbNumber } from '../utils/parse.ts';

export type ProductSnapshot = {
  productCost: number;
  productMolPercentage: number | null;
};

/**
 * Reads product cost (`costo`) and MOL% (`mol_percentage`) for a set of product ids,
 * deduplicates the inputs, and returns a Map keyed by product id.
 */
export const getSnapshots = async (
  productIds: string[],
  exec: QueryExecutor = pool,
): Promise<Map<string, ProductSnapshot>> => {
  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
  const snapshots = new Map<string, ProductSnapshot>();
  if (uniqueIds.length === 0) return snapshots;

  const { rows } = await exec.query<{
    id: string;
    costo: string | number | null;
    molPercentage: string | number | null;
  }>(
    `SELECT id, costo, mol_percentage as "molPercentage"
       FROM products
      WHERE id = ANY($1)`,
    [uniqueIds],
  );

  for (const row of rows) {
    snapshots.set(row.id, {
      productCost: parseDbNumber(row.costo, 0),
      productMolPercentage: parseNullableDbNumber(row.molPercentage),
    });
  }
  return snapshots;
};
