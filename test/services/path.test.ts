import { describe, expect, test } from 'bun:test';
import { encodePathSegment } from '../../services/api/path';

describe('encodePathSegment', () => {
  test('keeps dot-only and marker-like values distinct through WHATWG URL parsing', () => {
    expect(encodePathSegment('.')).toBe('%40.');
    expect(encodePathSegment('..')).toBe('%40..');
    expect(encodePathSegment('@.')).toBe('%40%40.');
    expect(encodePathSegment('@..')).toBe('%40%40..');

    expect(new URL(`/api/records/${encodePathSegment('.')}`, 'https://praetor.test').pathname).toBe(
      '/api/records/%40.',
    );
    expect(
      new URL(`/api/records/${encodePathSegment('..')}`, 'https://praetor.test').pathname,
    ).toBe('/api/records/%40..');
  });

  test('uses normal percent-encoding for other opaque segment values', () => {
    expect(encodePathSegment('../../products/prod-9?admin=true#fragment')).toBe(
      '..%2F..%2Fproducts%2Fprod-9%3Fadmin%3Dtrue%23fragment',
    );
    expect(encodePathSegment('SQ-001')).toBe('SQ-001');
  });
});
