import { describe, expect, test } from 'bun:test';
import { decodePathSegment } from '../../utils/path-segments.ts';

describe('decodePathSegment', () => {
  test('reverses dot-only and leading-marker transport escapes', () => {
    for (const [transportValue, expected] of [
      ['@.', '.'],
      ['@..', '..'],
      ['@@.', '@.'],
      ['@@..', '@..'],
      ['@@code', '@code'],
    ] as const) {
      expect(decodePathSegment(transportValue)).toBe(expected);
    }
  });

  test('passes ordinary and legacy unescaped values through', () => {
    expect(decodePathSegment('SQ-001')).toBe('SQ-001');
    expect(decodePathSegment('../../products/prod-9')).toBe('../../products/prod-9');
    expect(decodePathSegment('@code')).toBe('@code');
  });
});
