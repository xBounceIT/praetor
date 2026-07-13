import { DatabaseError } from 'pg';

export { DatabaseError };

// Drizzle wraps thrown driver errors in `DrizzleQueryError` with the original error available via
// `.cause`. Match PostgreSQL errors structurally by SQLSTATE: `instanceof DatabaseError` is not
// reliable when the driver is loaded more than once (for example in isolated tests or bundles).
const findByCode = (err: unknown, code: string): DatabaseError | null => {
  let current: unknown = err;
  for (let depth = 0; depth < 8; depth++) {
    if (current === null || typeof current !== 'object') return null;
    const candidate = current as { cause?: unknown; code?: unknown };
    if (candidate.code === code) return current as DatabaseError;
    const next = candidate.cause;
    if (next === current) return null;
    current = next;
  }
  return null;
};

export const getUniqueViolation = (err: unknown): DatabaseError | null => findByCode(err, '23505');

export const getForeignKeyViolation = (err: unknown): DatabaseError | null =>
  findByCode(err, '23503');
