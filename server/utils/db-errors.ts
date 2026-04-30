import { DatabaseError } from 'pg';

export { DatabaseError };

const hasCode = (err: unknown, code: string): err is DatabaseError =>
  err instanceof DatabaseError && err.code === code;

export const isForeignKeyViolation = (err: unknown): err is DatabaseError => hasCode(err, '23503');

export const isUniqueViolation = (err: unknown): err is DatabaseError => hasCode(err, '23505');
