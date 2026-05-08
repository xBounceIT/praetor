import { describe, expect, test } from 'bun:test';
import { ForeignKeyError, NotFoundError } from '../../utils/http-errors.ts';

describe('NotFoundError', () => {
  test('is an Error instance', () => {
    const err = new NotFoundError('User');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(NotFoundError);
  });

  test('message uses the entity name with " not found" suffix', () => {
    expect(new NotFoundError('User').message).toBe('User not found');
    expect(new NotFoundError('Project').message).toBe('Project not found');
  });

  test('name is "NotFoundError"', () => {
    expect(new NotFoundError('Anything').name).toBe('NotFoundError');
  });

  test('stack trace is captured', () => {
    const err = new NotFoundError('User');
    expect(typeof err.stack).toBe('string');
    expect(err.stack?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('ForeignKeyError', () => {
  test('is an Error instance', () => {
    const err = new ForeignKeyError('Project');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ForeignKeyError);
  });

  test('message uses the target name with " not found" suffix', () => {
    expect(new ForeignKeyError('Project').message).toBe('Project not found');
  });

  test('exposes the target on the readonly property', () => {
    const err = new ForeignKeyError('Customer');
    expect(err.target).toBe('Customer');
  });

  test('name is "ForeignKeyError"', () => {
    expect(new ForeignKeyError('any').name).toBe('ForeignKeyError');
  });

  test('is distinguishable from NotFoundError despite identical message format', () => {
    const fk = new ForeignKeyError('Project');
    expect(fk).not.toBeInstanceOf(NotFoundError);
  });
});
