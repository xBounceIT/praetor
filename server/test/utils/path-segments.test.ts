import { describe, expect, test } from 'bun:test';
import { decodePathSegment } from '../../utils/path-segments.ts';

describe('decodePathSegment', () => {
  test('reverses the collision-free dot-only transport escapes', () => {
    const escapePrefix = '~'.repeat(101);
    for (const [transportValue, expected] of [
      [`${escapePrefix}.`, '.'],
      [`${escapePrefix}..`, '..'],
    ] as const) {
      expect(decodePathSegment(transportValue)).toBe(expected);
    }
  });

  test('passes ordinary and legacy unescaped values through', () => {
    expect(decodePathSegment('SQ-001')).toBe('SQ-001');
    expect(decodePathSegment('../../products/prod-9')).toBe('../../products/prod-9');
    expect(decodePathSegment('@.')).toBe('@.');
    expect(decodePathSegment('@..')).toBe('@..');
    expect(decodePathSegment('@code')).toBe('@code');
    expect(decodePathSegment('~'.repeat(100))).toBe('~'.repeat(100));
  });
});
