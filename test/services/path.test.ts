import { describe, expect, test } from 'bun:test';
import { encodePathSegment } from '../../services/api/path';

describe('encodePathSegment', () => {
  test('keeps dot-only and legacy values distinct through WHATWG URL parsing', () => {
    const escapePrefix = '~'.repeat(101);
    expect(encodePathSegment('.')).toBe(`${escapePrefix}.`);
    expect(encodePathSegment('..')).toBe(`${escapePrefix}..`);
    expect(encodePathSegment('@.')).toBe('%40.');
    expect(encodePathSegment('@..')).toBe('%40..');
    expect(encodePathSegment('~'.repeat(100))).toBe('~'.repeat(100));

    expect(new URL(`/api/records/${encodePathSegment('.')}`, 'https://praetor.test').pathname).toBe(
      `/api/records/${escapePrefix}.`,
    );
    expect(
      new URL(`/api/records/${encodePathSegment('..')}`, 'https://praetor.test').pathname,
    ).toBe(`/api/records/${escapePrefix}..`);
  });

  test('uses normal percent-encoding for other opaque segment values', () => {
    expect(encodePathSegment('../../products/prod-9?admin=true#fragment')).toBe(
      '..%2F..%2Fproducts%2Fprod-9%3Fadmin%3Dtrue%23fragment',
    );
    expect(encodePathSegment('SQ-001')).toBe('SQ-001');
  });
});
