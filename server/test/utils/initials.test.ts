import { describe, expect, test } from 'bun:test';
import { computeAvatarInitials } from '../../utils/initials.ts';

describe('computeAvatarInitials', () => {
  test('returns the uppercased first letter for a single name', () => {
    expect(computeAvatarInitials('alice')).toBe('A');
  });

  test('returns the first letters of the first two name parts', () => {
    expect(computeAvatarInitials('alice smith')).toBe('AS');
  });

  test('truncates to two characters when more than two parts are given', () => {
    expect(computeAvatarInitials('alice mary smith')).toBe('AM');
  });

  test('uppercases the result', () => {
    expect(computeAvatarInitials('john doe')).toBe('JD');
  });

  test('returns empty string for empty input', () => {
    expect(computeAvatarInitials('')).toBe('');
  });

  test('handles consecutive spaces without crashing', () => {
    expect(computeAvatarInitials('  alice  smith ')).toBe('AS');
  });

  test('handles unicode-letter names', () => {
    expect(computeAvatarInitials('élise marc')).toBe('ÉM');
  });

  test('returns single initial when the second part is missing a first char', () => {
    // Input like "John " (trailing space) → parts = ['John', ''] → 'J' + '' = 'J'
    expect(computeAvatarInitials('John ')).toBe('J');
  });
});
