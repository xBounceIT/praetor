import { DatabaseError } from 'pg';

export { DatabaseError };

// Drizzle wraps thrown driver errors in `DrizzleQueryError` with the original `DatabaseError`
// available via `.cause`. Walk the cause chain (bounded depth) so callers can detect violations
// regardless of whether the error came from a Drizzle-converted or legacy-pg path.
const extractDatabaseError = (err: unknown): DatabaseError | null => {
  let current: unknown = err;
  for (let depth = 0; depth < 8; depth++) {
    if (current instanceof DatabaseError) return current;
    if (current === null || typeof current !== 'object') return null;
    const next = (current as { cause?: unknown }).cause;
    if (next === current) return null;
    current = next;
  }
  return null;
};

const findByCode = (err: unknown, code: string): DatabaseError | null => {
  const dbErr = extractDatabaseError(err);
  return dbErr?.code === code ? dbErr : null;
};

export const getUniqueViolation = (err: unknown): DatabaseError | null => findByCode(err, '23505');

export const getForeignKeyViolation = (err: unknown): DatabaseError | null =>
  findByCode(err, '23503');

export const isUniqueViolation = (err: unknown): err is DatabaseError =>
  getUniqueViolation(err) !== null;

export const isForeignKeyViolation = (err: unknown): err is DatabaseError =>
  getForeignKeyViolation(err) !== null;
