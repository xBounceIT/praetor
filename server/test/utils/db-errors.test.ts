import { describe, expect, test } from 'bun:test';
import { getForeignKeyViolation, getUniqueViolation } from '../../utils/db-errors.ts';
import { makeDbError } from '../helpers/dbErrors.ts';

describe('getUniqueViolation', () => {
  test('returns the DatabaseError when SQLSTATE is 23505', () => {
    const err = makeDbError('23505');
    expect(getUniqueViolation(err)).toBe(err);
  });

  test('returns null for unrelated SQLSTATE', () => {
    expect(getUniqueViolation(makeDbError('23503'))).toBeNull();
  });

  test('returns null for plain Error instances', () => {
    expect(getUniqueViolation(new Error('boom'))).toBeNull();
  });

  test('returns null for null/undefined/non-error inputs', () => {
    expect(getUniqueViolation(null)).toBeNull();
    expect(getUniqueViolation(undefined)).toBeNull();
    expect(getUniqueViolation('string-error')).toBeNull();
    expect(getUniqueViolation(42)).toBeNull();
  });

  test('walks the cause chain to find a wrapped DatabaseError', () => {
    const inner = makeDbError('23505');
    const wrapper = new Error('drizzle wrapper') as Error & { cause: unknown };
    wrapper.cause = inner;
    expect(getUniqueViolation(wrapper)).toBe(inner);
  });

  test('walks multi-level cause chains', () => {
    const inner = makeDbError('23505');
    const middle = new Error('mid') as Error & { cause: unknown };
    middle.cause = inner;
    const outer = new Error('outer') as Error & { cause: unknown };
    outer.cause = middle;
    expect(getUniqueViolation(outer)).toBe(inner);
  });

  test('does not loop forever when cause references itself', () => {
    const err = new Error('self-ref') as Error & { cause: unknown };
    err.cause = err;
    expect(getUniqueViolation(err)).toBeNull();
  });

  test('bounds depth at 8 — deeper chains return null', () => {
    let current: Error & { cause?: unknown } = new Error('leaf');
    for (let i = 0; i < 9; i++) {
      const wrapper = new Error(`level-${i}`) as Error & { cause?: unknown };
      wrapper.cause = current;
      current = wrapper;
    }
    expect(getUniqueViolation(current)).toBeNull();
  });
});

describe('getForeignKeyViolation', () => {
  test('returns the DatabaseError when SQLSTATE is 23503', () => {
    const err = makeDbError('23503');
    expect(getForeignKeyViolation(err)).toBe(err);
  });

  test('returns null for unique-violation SQLSTATE', () => {
    expect(getForeignKeyViolation(makeDbError('23505'))).toBeNull();
  });

  test('walks the cause chain to find a wrapped DatabaseError', () => {
    const inner = makeDbError('23503');
    const wrapper = new Error('drizzle wrapper') as Error & { cause: unknown };
    wrapper.cause = inner;
    expect(getForeignKeyViolation(wrapper)).toBe(inner);
  });
});
