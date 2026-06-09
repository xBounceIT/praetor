import { describe, expect, test } from 'bun:test';
import { getInitials } from '../../utils/initials';

describe('getInitials', () => {
  test('first+last initials for a multi-word name', () => {
    expect(getInitials('Andrea Scognamiglio')).toBe('AS');
    expect(getInitials('Top Manager')).toBe('TM');
  });

  test('uses first+last (not middle) for three or more words', () => {
    expect(getInitials('Anna Maria Rossi')).toBe('AR');
  });

  test('first two letters for a single-word name', () => {
    expect(getInitials('Madonna')).toBe('MA');
  });

  test('collapses extra whitespace between words', () => {
    expect(getInitials('  Mario   Rossi  ')).toBe('MR');
  });

  test('falls back to "?" for a blank name', () => {
    expect(getInitials('   ')).toBe('?');
    expect(getInitials('')).toBe('?');
  });

  test('upper-cases lowercase names', () => {
    expect(getInitials('mario rossi')).toBe('MR');
  });
});
