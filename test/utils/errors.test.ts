import { describe, expect, test } from 'bun:test';
import { getErrorMessage } from '../../utils/errors';

describe('getErrorMessage', () => {
  test('returns Error.message when given an Error instance', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  test('returns "Unknown error" when given an Error with empty message', () => {
    expect(getErrorMessage(new Error(''))).toBe('Unknown error');
  });

  test('returns "Unknown error" for non-Error values (string)', () => {
    expect(getErrorMessage('something failed')).toBe('Unknown error');
  });

  test('returns "Unknown error" for non-Error values (object without message)', () => {
    expect(getErrorMessage({ code: 500 })).toBe('Unknown error');
  });

  test('returns "Unknown error" for null', () => {
    expect(getErrorMessage(null)).toBe('Unknown error');
  });

  test('returns "Unknown error" for undefined', () => {
    expect(getErrorMessage(undefined)).toBe('Unknown error');
  });

  test('uses message from a subclass of Error', () => {
    class CustomError extends Error {}
    expect(getErrorMessage(new CustomError('custom'))).toBe('custom');
  });

  test('returns "Unknown error" for whitespace-only Error.message', () => {
    expect(getErrorMessage(new Error('   '))).toBe('Unknown error');
  });

  test('returns "Unknown error" for tab/newline-only Error.message', () => {
    expect(getErrorMessage(new Error('\t\n'))).toBe('Unknown error');
  });
});
