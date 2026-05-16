import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';

export const generatePrefixedId = (prefix: string): string => `${prefix}-${randomUUID()}`;

// Per-prefix sequences. `0038_add_order_id_sequences` creates these as standalone Postgres
// SEQUENCEs and initializes them past the historical MAX, so existing IDs can't collide
// with new ones. nextval() is atomic and lock-free; this eliminates the previous
// SELECT MAX + INSERT TOCTOU race that allowed two concurrent inserts to produce the same id.
//
// Trade-off vs. the old per-year MAX scan: the sequence is global, so once we roll over
// a year the displayed counter doesn't reset to 0001. We keep the year prefix in the
// displayed id for readability/grouping, but the suffix is monotonic across years.
const SEQUENCE_NAMES = {
  ORD: 'order_id_seq',
  SORD: 'supplier_order_id_seq',
} as const;

type SequentialPrefix = keyof typeof SEQUENCE_NAMES;

export const ORDER_ID_SEQUENCE_MIN_DIGITS = 4;

export const formatSequenceSuffix = (
  sequence: string | number | bigint,
  minDigits = ORDER_ID_SEQUENCE_MIN_DIGITS,
): string => {
  const value = String(sequence);
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid sequence value: ${value}`);
  }
  return value.padStart(minDigits, '0');
};

const generateSequentialId = async (
  prefix: SequentialPrefix,
  exec: DbExecutor = db,
): Promise<string> => {
  const year = new Date().getFullYear();
  const sequenceName = SEQUENCE_NAMES[prefix];
  // Sequence name is a static internal literal; `sql.raw` is safe here.
  const rows = await executeRows<{ nextValue: string | number }>(
    exec,
    sql`SELECT nextval(${sql.raw(`'${sequenceName}'`)}) AS "nextValue"`,
  );
  if (rows.length === 0 || rows[0]?.nextValue == null) {
    throw new Error(`Sequence ${sequenceName} returned no value — schema migration likely missing`);
  }
  return `${prefix}-${year}-${formatSequenceSuffix(rows[0].nextValue)}`;
};

export const generateClientOrderId = (exec?: DbExecutor) => generateSequentialId('ORD', exec);
export const generateSupplierOrderId = (exec?: DbExecutor) => generateSequentialId('SORD', exec);
