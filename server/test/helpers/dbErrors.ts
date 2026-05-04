import { DatabaseError } from 'pg';

export const makeDbError = (code: string, constraint?: string): DatabaseError => {
  const err = new DatabaseError('boom', 0, 'error');
  err.code = code;
  if (constraint) err.constraint = constraint;
  return err;
};
