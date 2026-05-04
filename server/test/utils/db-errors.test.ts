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

  const wrap = (leaf: unknown, levels: number): unknown => {
    let current: unknown = leaf;
    for (let i = 0; i < levels; i++) {
      const wrapper = new Error(`level-${i}`) as Error & { cause?: unknown };
      wrapper.cause = current;
      current = wrapper;
    }
    return current;
  };

  test('finds a DatabaseError at the maximum supported depth (7 wrappers)', () => {
    const leaf = makeDbError('23505');
    expect(getUniqueViolation(wrap(leaf, 7))).toBe(leaf);
  });

  test('returns null when the DatabaseError is beyond the depth bound (8 wrappers)', () => {
    const leaf = makeDbError('23505');
    expect(getUniqueViolation(wrap(leaf, 8))).toBeNull();
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
